import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseService } from './db.js';
import { DataValidator, DataIngestionService, DatasetPayload } from './ingestion.js';
import { AnalyticsService, PipelineResult, EntityRisk, Finding } from './analytics.service.js';
import { ExternalDatasetService } from './external.js';
import { AssessmentService, AssessmentInfo } from './assessment.service.js';

export function createApiRouter(
  initialDbService: DatabaseService, 
  initialAnalyticsService: AnalyticsService,
  assessmentService?: AssessmentService
): Router {
  const router = Router();
  const actualAssessmentService = assessmentService || new AssessmentService(initialDbService.getDbPath());
  const assessmentStorage = new AsyncLocalStorage<{ assessmentId: string }>();

  // Helper to retrieve current assessment metadata
  function getCurrentAssessment(): AssessmentInfo {
    const store = assessmentStorage.getStore();
    const id = store?.assessmentId || actualAssessmentService.getActiveAssessmentId();
    return actualAssessmentService.getAssessment(id) || actualAssessmentService.getActiveAssessment();
  }

  // Scoped proxies that dynamically dispatch to the active or request-specific assessment instance
  const scopedDbService = new Proxy(initialDbService, {
    get(target, prop, receiver) {
      const store = assessmentStorage.getStore();
      const targetDb = store?.assessmentId 
        ? actualAssessmentService.getDbForAssessment(store.assessmentId)
        : actualAssessmentService.getDbForAssessment();
      const value = Reflect.get(targetDb, prop, targetDb);
      if (typeof value === 'function') {
        return value.bind(targetDb);
      }
      return value;
    }
  });

  const scopedAnalyticsService = new Proxy(initialAnalyticsService, {
    get(target, prop, receiver) {
      const store = assessmentStorage.getStore();
      const targetAnalytics = store?.assessmentId 
        ? actualAssessmentService.getAnalyticsForAssessment(store.assessmentId)
        : actualAssessmentService.getAnalyticsForAssessment();
      const value = Reflect.get(targetAnalytics, prop, targetAnalytics);
      if (typeof value === 'function') {
        return value.bind(targetAnalytics);
      }
      return value;
    }
  });

  const scopedIngestionService = new Proxy(new DataIngestionService(initialDbService), {
    get(target, prop, receiver) {
      const store = assessmentStorage.getStore();
      const currentDb = store?.assessmentId
        ? actualAssessmentService.getDbForAssessment(store.assessmentId)
        : actualAssessmentService.getDbForAssessment();
      const instance = new DataIngestionService(currentDb);
      const value = Reflect.get(instance, prop, instance);
      if (typeof value === 'function') {
        return value.bind(instance);
      }
      return value;
    }
  });

  const scopedExternalDatasetService = new Proxy(new ExternalDatasetService(initialDbService), {
    get(target, prop, receiver) {
      const store = assessmentStorage.getStore();
      const currentDb = store?.assessmentId
        ? actualAssessmentService.getDbForAssessment(store.assessmentId)
        : actualAssessmentService.getDbForAssessment();
      const instance = new ExternalDatasetService(currentDb);
      const value = Reflect.get(instance, prop, instance);
      if (typeof value === 'function') {
        return value.bind(instance);
      }
      return value;
    }
  });

  const dbService = scopedDbService;
  const analyticsService = scopedAnalyticsService;
  const ingestionService = scopedIngestionService;
  const externalDatasetService = scopedExternalDatasetService;

  // Middleware: Establish assessment context per request
  router.use((req: Request, _res: Response, next) => {
    const headerId = req.headers['x-assessment-id'] as string;
    const queryId = req.query.assessment_id as string;
    const targetId = headerId || queryId || actualAssessmentService.getActiveAssessmentId();
    assessmentStorage.run({ assessmentId: targetId }, () => {
      next();
    });
  });

  // Assessment Isolation Management Endpoints
  router.get('/assessments', async (_req: Request, res: Response) => {
    try {
      const list = actualAssessmentService.listAssessments();
      return res.status(200).json({
        success: true,
        active_assessment_id: actualAssessmentService.getActiveAssessmentId(),
        assessments: list
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  router.get('/assessments/active', async (_req: Request, res: Response) => {
    try {
      const active = actualAssessmentService.getActiveAssessment();
      return res.status(200).json({
        success: true,
        assessment: active
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  router.post('/assessments', async (req: Request, res: Response) => {
    try {
      const name = req.body?.name || `Assessment ${new Date().toLocaleDateString()}`;
      const description = req.body?.description || 'Supervisory analytics assessment period';
      const created = actualAssessmentService.createAssessment(name, description, req.body?.assessment_id);
      return res.status(201).json({
        success: true,
        message: `Assessment ${created.assessment_id} created successfully`,
        assessment: created
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message || String(err) });
    }
  });

  router.post('/assessments/:id/activate', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const activated = actualAssessmentService.setActiveAssessment(id);
      return res.status(200).json({
        success: true,
        message: `Assessment ${id} activated successfully`,
        active_assessment_id: id,
        assessment: activated
      });
    } catch (err: any) {
      return res.status(404).json({ success: false, error: err.message || String(err) });
    }
  });

  router.delete('/assessments/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      actualAssessmentService.deleteAssessment(id);
      return res.status(200).json({
        success: true,
        message: `Assessment ${id} deleted successfully`
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message || String(err) });
    }
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
  });

  // Helper: ensure analytics have run and get results for current assessment
  async function getAnalyticsResults(): Promise<PipelineResult> {
    const counts = dbService.getCounts();
    if (counts.entities === 0) {
      analyticsService.clearCache();
      return {
        total_findings: 0,
        run_timestamp: new Date().toISOString(),
        elapsed_seconds: 0,
        module_counts: {},
        findings_by_entity: {},
        findings_by_type: {},
        all_findings: [],
        entity_risk: {}
      };
    }
    return await analyticsService.getOrRunAnalysis(dbService.getDbPath());
  }

  router.post('/external-datasets', upload.single('file'), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ success: false, error: 'Upload one redteam text or gzip file as field file' });
      const summary = await externalDatasetService.ingestLanlRedteam(file.buffer, file.originalname);
      dbService.logAudit('INGEST_EXTERNAL_DATASET', {
        dataset_id: summary.dataset_id,
        source: summary.source,
        record_count: summary.record_count,
        source_sha256: summary.source_sha256
      });
      return res.status(200).json({ success: true, external_dataset: summary });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message || String(err) });
    }
  });

  router.get('/external-datasets', async (_req: Request, res: Response) => {
    return res.status(200).json({ success: true, datasets: externalDatasetService.getDatasets() });
  });

  router.get('/external-datasets/:datasetId', async (req: Request, res: Response) => {
    const details = externalDatasetService.getDatasetDetails(String(req.params.datasetId));
    if (!details) return res.status(404).json({ success: false, error: 'External dataset not found' });
    return res.status(200).json({ success: true, external_dataset: details });
  });

  router.get('/external-datasets/:datasetId/events/:eventId', async (req: Request, res: Response) => {
    const event = externalDatasetService.getEvent(String(req.params.datasetId), String(req.params.eventId));
    if (!event) return res.status(404).json({ success: false, error: 'External event not found' });
    return res.status(200).json({ success: true, event });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. POST /api/upload
  // ─────────────────────────────────────────────────────────────────────────────
  router.post('/upload', upload.any(), async (req: Request, res: Response) => {
    try {
      const isNewAssessment = req.body.new_assessment === true || req.body.new_assessment === 'true' ||
                              req.body.create_assessment === true || req.body.create_assessment === 'true';
      let activeAssessment: AssessmentInfo;
      if (isNewAssessment) {
        const assessmentName = req.body.assessment_name || `Assessment ${new Date().toISOString().slice(0, 10)}`;
        activeAssessment = actualAssessmentService.createAssessment(assessmentName, req.body.assessment_description);
        actualAssessmentService.setActiveAssessment(activeAssessment.assessment_id);
      } else {
        activeAssessment = getCurrentAssessment();
      }

      return await assessmentStorage.run({ assessmentId: activeAssessment.assessment_id }, async () => {
        let dataset: DatasetPayload = {};
        const clearExisting = isNewAssessment ? true : (req.body.clearExisting === true || req.body.clearExisting === 'true');

        const files = req.files as Express.Multer.File[] | undefined;

      if (files && files.length > 0) {
        // Handle file uploads
        const csvMap: { entities?: string; assets?: string; alerts?: string; cases?: string } = {};
        let sqliteExport: DatasetPayload | null = null;

        for (const file of files) {
          const content = file.buffer.toString('utf-8');
          const originalName = file.originalname.toLowerCase();

          // Reject completely empty files
          if (!content || content.trim().length === 0) {
            const currentCounts = dbService.getCounts();
            return res.status(400).json({
              success: false,
              message: `Uploaded file '${file.originalname}' is empty`,
              rows_received: { entities: 0, assets: 0, alerts: 0, cases: 0, total: 0 },
              rows_accepted: { entities: 0, assets: 0, alerts: 0, cases: 0, total: 0 },
              rows_rejected: { entities: 0, assets: 0, alerts: 0, cases: 0, total: 0 },
              validation_errors: [{
                table: 'dataset',
                message: `Uploaded file '${file.originalname}' is empty`
              }],
              database_counts: currentCounts,
              inserted: { entities: 0, assets: 0, alerts: 0, cases: 0 },
              errors: [{
                table: 'dataset',
                message: `Uploaded file '${file.originalname}' is empty`
              }]
            });
          }

          if (originalName.endsWith('.json')) {
            try {
              const parsed = JSON.parse(content);
              if (parsed.entities || parsed.assets || parsed.alerts || parsed.cases) {
                dataset = parsed;
              } else if (Array.isArray(parsed)) {
                // If named by table e.g. entities.json
                if (originalName.includes('entit')) dataset.entities = parsed;
                else if (originalName.includes('asset')) dataset.assets = parsed;
                else if (originalName.includes('alert')) dataset.alerts = parsed;
                else if (originalName.includes('case')) dataset.cases = parsed;
              } else {
                dataset = parsed;
              }
            } catch (err: any) {
              const currentCounts = dbService.getCounts();
              return res.status(400).json({
                success: false,
                message: `Failed to parse JSON file '${file.originalname}': ${err.message}`,
                rows_received: { entities: 0, assets: 0, alerts: 0, cases: 0, total: 0 },
                rows_accepted: { entities: 0, assets: 0, alerts: 0, cases: 0, total: 0 },
                rows_rejected: { entities: 0, assets: 0, alerts: 0, cases: 0, total: 0 },
                validation_errors: [{
                  table: 'dataset',
                  message: `Malformed JSON in file '${file.originalname}': ${err.message}`
                }],
                database_counts: currentCounts,
                inserted: { entities: 0, assets: 0, alerts: 0, cases: 0 },
                errors: [{
                  table: 'dataset',
                  message: `Malformed JSON in file '${file.originalname}': ${err.message}`
                }]
              });
            }
          } else if (originalName.endsWith('.db') || originalName.endsWith('.sqlite') || originalName.endsWith('.sqlite3')) {
            if (files.length !== 1) {
              return res.status(400).json({ success: false, message: 'SQLite database exports must be uploaded as a single file.' });
            }
            const tempPath = path.join(os.tmpdir(), `sat-sa-import-${process.pid}-${Date.now()}.db`);
            try {
              fs.writeFileSync(tempPath, file.buffer);
              sqliteExport = ingestionService.readSqliteExport(tempPath);
            } finally {
              try { fs.unlinkSync(tempPath); } catch { /* best-effort cleanup */ }
            }
          } else if (originalName.endsWith('.csv')) {
            if (originalName.includes('entit')) csvMap.entities = content;
            else if (originalName.includes('asset')) csvMap.assets = content;
            else if (originalName.includes('alert')) csvMap.alerts = content;
            else if (originalName.includes('case')) csvMap.cases = content;
            else {
              // Try to inspect headers to determine table
              const firstLine = content.split(/\r?\n/)[0].toLowerCase();
              if (firstLine.includes('entity_name') || firstLine.includes('sector')) csvMap.entities = content;
              else if (firstLine.includes('asset_type') || firstLine.includes('criticality')) csvMap.assets = content;
              else if (firstLine.includes('severity') && firstLine.includes('category')) csvMap.alerts = content;
              else if (firstLine.includes('investigator') || firstLine.includes('investigation_duration')) csvMap.cases = content;
            }
          }
        }

        if (sqliteExport) {
          dataset = sqliteExport;
        }

        // If CSV tables were detected, ingest via ingestCsvTables
        if (Object.keys(csvMap).length > 0) {
          const ingestion = ingestionService.ingestCsvTables(csvMap, clearExisting);
          if (!ingestion.success) {
            return res.status(400).json({
              success: false,
              message: ingestion.message,
              rows_received: ingestion.rows_received,
              rows_accepted: ingestion.rows_accepted,
              rows_rejected: ingestion.rows_rejected,
              validation_errors: ingestion.validation_errors,
              database_counts: ingestion.database_counts,
              inserted: ingestion.inserted,
              errors: ingestion.errors
            });
          }

          // Trigger analytics pipeline on new data
          const analysis = await analyticsService.runAnalysis(dbService.getDbPath());
          await ensureSupervisoryFindingsInDb();
          const counts = dbService.getCounts();
          const datasetVersion = `v${counts.entities}.${counts.assets}.${counts.alerts}.${counts.cases}`;
          dbService.setAssessmentMetadata({
            assessment_id: activeAssessment.assessment_id,
            name: activeAssessment.name,
            description: activeAssessment.description,
            dataset_version: datasetVersion
          });

          return res.status(200).json({
            success: true,
            message: isNewAssessment
              ? `Assessment ${activeAssessment.assessment_id} created, dataset ingested, and analyzed`
              : 'CSV dataset successfully validated, ingested, and analyzed',
            assessment_id: activeAssessment.assessment_id,
            assessment_name: activeAssessment.name,
            dataset_version: datasetVersion,
            rows_received: ingestion.rows_received,
            rows_accepted: ingestion.rows_accepted,
            rows_rejected: ingestion.rows_rejected,
            validation_errors: ingestion.validation_errors,
            database_counts: ingestion.database_counts,
            inserted: ingestion.inserted,
            analysis: {
              timestamp: analysis.run_timestamp,
              total_findings: analysis.total_findings,
              total_entities_scored: Object.keys(analysis.entity_risk).length
            }
          });
        }
      } else if (req.body && (req.body.entities || req.body.assets || req.body.alerts || req.body.cases)) {
        // Direct JSON body
        dataset = {
          entities: req.body.entities,
          assets: req.body.assets,
          alerts: req.body.alerts,
          cases: req.body.cases
        };
      } else {
        const currentCounts = dbService.getCounts();
        return res.status(400).json({
          success: false,
          message: 'No valid dataset found in request. Provide JSON body or upload JSON/CSV files.',
          rows_received: { entities: 0, assets: 0, alerts: 0, cases: 0, total: 0 },
          rows_accepted: { entities: 0, assets: 0, alerts: 0, cases: 0, total: 0 },
          rows_rejected: { entities: 0, assets: 0, alerts: 0, cases: 0, total: 0 },
          validation_errors: [{
            table: 'dataset',
            message: 'No valid dataset found in request. Provide JSON body or upload JSON/CSV files.'
          }],
          database_counts: currentCounts,
          inserted: { entities: 0, assets: 0, alerts: 0, cases: 0 },
          errors: [{
            table: 'dataset',
            message: 'No valid dataset found in request. Provide JSON body or upload JSON/CSV files.'
          }]
        });
      }

      // Ingest JSON dataset
      const ingestion = ingestionService.ingestDataset(dataset, clearExisting);
      if (!ingestion.success) {
        return res.status(400).json({
          success: false,
          message: ingestion.message,
          rows_received: ingestion.rows_received,
          rows_accepted: ingestion.rows_accepted,
          rows_rejected: ingestion.rows_rejected,
          validation_errors: ingestion.validation_errors,
          database_counts: ingestion.database_counts,
          inserted: ingestion.inserted,
          errors: ingestion.errors
        });
      }

      // Automatically run supervisory analytics pipeline on newly ingested data
      const analysis = await analyticsService.runAnalysis(dbService.getDbPath());
      await ensureSupervisoryFindingsInDb();
      const counts = dbService.getCounts();
      const datasetVersion = `v${counts.entities}.${counts.assets}.${counts.alerts}.${counts.cases}`;
      dbService.setAssessmentMetadata({
        assessment_id: activeAssessment.assessment_id,
        name: activeAssessment.name,
        description: activeAssessment.description,
        dataset_version: datasetVersion
      });

      return res.status(200).json({
        success: true,
        message: isNewAssessment
          ? `Assessment ${activeAssessment.assessment_id} created, dataset ingested, and analyzed`
          : 'Dataset successfully validated, ingested, and analyzed',
        assessment_id: activeAssessment.assessment_id,
        assessment_name: activeAssessment.name,
        dataset_version: datasetVersion,
        rows_received: ingestion.rows_received,
        rows_accepted: ingestion.rows_accepted,
        rows_rejected: ingestion.rows_rejected,
        validation_errors: ingestion.validation_errors,
        database_counts: ingestion.database_counts,
        inserted: ingestion.inserted,
        analysis: {
          timestamp: analysis.run_timestamp,
          total_findings: analysis.total_findings,
          total_entities_scored: Object.keys(analysis.entity_risk).length
        }
      });
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: 'Internal server error during upload/ingestion',
        error: err.message || String(err)
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. POST /api/analyze
  // ─────────────────────────────────────────────────────────────────────────────
  router.post('/analyze', async (req: Request, res: Response) => {
    try {
      const startTime = Date.now();
      const result = await analyticsService.runAnalysis(dbService.getDbPath());
      await ensureSupervisoryFindingsInDb();
      const durationMs = Date.now() - startTime;

      const entityRisks = Object.values(result.entity_risk);
      const highRiskEntities = entityRisks.filter(e => e.risk_level === 'HIGH').length;
      const criticalEntities = entityRisks.filter(e => e.risk_level === 'CRITICAL').length;
      const curAssessment = getCurrentAssessment();
      return res.status(200).json({
        success: true,
        message: 'Supervisory analytics pipeline executed successfully',
        assessment_id: curAssessment.assessment_id,
        assessment_name: curAssessment.name,
        entities_analyzed: entityRisks.length,
        findings_generated: result.total_findings,
        high_risk_entities: highRiskEntities,
        critical_entities: criticalEntities,
        module_counts: result.module_counts,
        analysis_timestamp: result.run_timestamp,
        dataset_version: curAssessment.dataset_version || (result as any).dataset_version || 'v1.0',
        // Backward-compatibility fields
        timestamp: result.run_timestamp,
        elapsed_seconds: result.elapsed_seconds,
        duration_ms: durationMs,
        total_findings: result.total_findings,
        total_entities_scored: entityRisks.length
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to execute analytics pipeline',
        error: err.message || String(err)
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. GET /api/dashboard
  // ─────────────────────────────────────────────────────────────────────────────
  router.get('/dashboard', async (req: Request, res: Response) => {
    try {
      const analysis = await getAnalyticsResults();
      const stats = dbService.getAggregateStats();

      // Risk distribution
      const riskDistribution = {
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0
      };

      const highCriticalEntities: Array<{
        entity_id: string;
        entity_name: string;
        sector: string;
        risk_score: number;
        risk_level: string;
        finding_count: number;
        top_severity: string;
      }> = [];

      let totalScore = 0;
      const entityRisks = Object.values(analysis.entity_risk);

      for (const ent of entityRisks) {
        if (ent.risk_level in riskDistribution) {
          riskDistribution[ent.risk_level as keyof typeof riskDistribution]++;
        }
        totalScore += ent.risk_score;

        if (ent.risk_level === 'HIGH' || ent.risk_level === 'CRITICAL') {
          const topSev = ent.findings.reduce((prev, curr) => {
            const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
            return (order[curr.severity] ?? 9) < (order[prev] ?? 9) ? curr.severity : prev;
          }, 'LOW');

          highCriticalEntities.push({
            entity_id: ent.entity_id,
            entity_name: ent.entity_name,
            sector: ent.sector,
            risk_score: ent.risk_score,
            risk_level: ent.risk_level,
            finding_count: ent.findings.length,
            top_severity: topSev
          });
        }
      }

      highCriticalEntities.sort((a, b) => b.risk_score - a.risk_score);

      // Severity distribution across all findings
      const severityDistribution = {
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0
      };

      for (const f of analysis.all_findings) {
        if (f.severity in severityDistribution) {
          severityDistribution[f.severity as keyof typeof severityDistribution]++;
        }
      }

      const avgRiskScore = entityRisks.length > 0
        ? Math.round((totalScore / entityRisks.length) * 10) / 10
        : 0;

      const curAssessment = getCurrentAssessment();
      return res.status(200).json({
        success: true,
        assessment_id: curAssessment.assessment_id,
        assessment_name: curAssessment.name,
        dataset_version: curAssessment.dataset_version,
        total_entities: stats.entities,
        risk_distribution: riskDistribution,
        high_critical_entities: highCriticalEntities,
        finding_counts_by_type: analysis.module_counts,
        severity_distribution: severityDistribution,
        useful_aggregate_metrics: {
          total_assets: stats.assets,
          total_alerts: stats.alerts,
          total_cases: stats.cases,
          average_risk_score: avgRiskScore,
          escalated_cases_ratio: Math.round(stats.escalation_rate * 1000) / 1000,
          avg_investigation_duration_minutes: stats.avg_investigation_duration,
          quick_closure_critical_count: stats.quick_closure_critical_count,
          stale_critical_assets_count: stats.stale_critical_assets_count,
          repeated_incident_clusters: analysis.module_counts.REPEATED_INCIDENT,
          telemetry_coverage_pct: stats.telemetry_coverage_pct ?? 0,
          peer_deviations_count: analysis.module_counts.PEER_DEVIATION
        },
        latest_analysis_timestamp: analysis.run_timestamp
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve dashboard metrics',
        error: err.message || String(err)
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. GET /api/entities
  // ─────────────────────────────────────────────────────────────────────────────
  router.get('/entities', async (req: Request, res: Response) => {
    try {
      const analysis = await getAnalyticsResults();
      const sectorFilter = req.query.sector as string | undefined;
      const riskLevelFilter = req.query.risk_level as string | undefined;
      const sortField = (req.query.sort as string) || 'risk_score';
      const sortOrder = (req.query.order as string) || 'desc';

      let entitiesList = Object.values(analysis.entity_risk).map(ent => {
        const topSev = ent.findings.reduce((prev, curr) => {
          const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
          return (order[curr.severity] ?? 9) < (order[prev] ?? 9) ? curr.severity : prev;
        }, ent.findings.length > 0 ? 'LOW' : 'NONE');

        return {
          entity_id: ent.entity_id,
          entity_name: ent.entity_name,
          sector: ent.sector,
          risk_score: ent.risk_score,
          final_risk_score: (ent as any).final_risk_score ?? ent.risk_score,
          risk_level: ent.risk_level,
          primary_drivers: (ent as any).primary_drivers ?? [],
          finding_count: ent.findings.length,
          top_severity: topSev,
          component_scores: ent.component_scores,
          component_weighted_contributions: (ent as any).component_weighted_contributions ?? {},
          component_raw_scores: (ent as any).component_raw_scores ?? {},
          explanation: ent.explanation
        };
      });

      if (sectorFilter) {
        entitiesList = entitiesList.filter(e => e.sector.toLowerCase() === sectorFilter.toLowerCase());
      }

      if (riskLevelFilter) {
        entitiesList = entitiesList.filter(e => e.risk_level.toUpperCase() === riskLevelFilter.toUpperCase());
      }

      entitiesList.sort((a, b) => {
        let cmp = 0;
        if (sortField === 'entity_name' || sortField === 'name') {
          cmp = a.entity_name.localeCompare(b.entity_name);
        } else if (sortField === 'finding_count') {
          cmp = a.finding_count - b.finding_count;
        } else {
          cmp = a.risk_score - b.risk_score;
        }
        return sortOrder === 'asc' ? cmp : -cmp;
      });

      return res.status(200).json({
        success: true,
        count: entitiesList.length,
        entities: entitiesList
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve entities list',
        error: err.message || String(err)
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. GET /api/entities/:id
  // ─────────────────────────────────────────────────────────────────────────────
  router.get('/entities/:id', async (req: Request, res: Response) => {
    try {
      const entityId = String(req.params.id);
      const analysis = await getAnalyticsResults();

      const entityRisk = analysis.entity_risk[entityId];
      if (!entityRisk) {
        // Check if entity exists in database at all
        const rawEntity = dbService.getEntity(entityId);
        if (!rawEntity) {
          return res.status(404).json({
            success: false,
            error: 'Entity not found',
            entity_id: entityId
          });
        }

        // Entity exists in DB but had no findings/scores computed yet
        const assets = dbService.getAssetsForEntity(entityId);
        const alerts = dbService.getAlertsForEntity(entityId, 20);
        return res.status(200).json({
          success: true,
          entity_id: rawEntity.entity_id,
          entity_name: rawEntity.entity_name,
          sector: rawEntity.sector,
          risk_score: 0,
          risk_level: 'LOW',
          component_scores: {},
          findings: [],
          explanation: {
            entity_id: rawEntity.entity_id,
            entity_name: rawEntity.entity_name,
            risk_score: 0,
            risk_level: 'LOW',
            score_formula: '',
            module_breakdown: [],
            summary: 'No supervisory findings detected for this entity.'
          },
          evidence_references: {
            total_assets: assets.length,
            total_alerts: alerts.length,
            critical_assets: assets.filter(a => a.criticality === 'CRITICAL'),
            recent_alerts: alerts.slice(0, 10)
          }
        });
      }

      // Fetch underlying entity assets and alerts from database for evidence references
      const rawEntity = dbService.getEntity(entityId);
      const assets = dbService.getAssetsForEntity(entityId);
      const alerts = dbService.getAlertsForEntity(entityId, 25);

      return res.status(200).json({
        success: true,
        entity_id: entityRisk.entity_id,
        entity_name: rawEntity?.entity_name || entityRisk.entity_name,
        sector: rawEntity?.sector || entityRisk.sector,
        risk_score: entityRisk.risk_score,
        final_risk_score: (entityRisk as any).final_risk_score ?? entityRisk.risk_score,
        risk_level: entityRisk.risk_level,
        primary_drivers: (entityRisk as any).primary_drivers ?? [],
        component_scores: entityRisk.component_scores,
        component_weighted_contributions: (entityRisk as any).component_weighted_contributions ?? {},
        component_raw_scores: (entityRisk as any).component_raw_scores ?? {},
        findings: entityRisk.findings,
        explanation: entityRisk.explanation,
        evidence_references: {
          total_assets: assets.length,
          total_alerts: alerts.length,
          critical_assets: assets.filter(a => a.criticality === 'CRITICAL'),
          recent_alerts: alerts.slice(0, 10)
        }
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve entity detail',
        error: err.message || String(err)
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. GET /api/findings
  // ─────────────────────────────────────────────────────────────────────────────
  router.get('/alert-priorities', async (req: Request, res: Response) => {
    try {
      const filters = {
        entity_id: req.query.entity_id as string,
        severity: req.query.severity as string,
        priority_level: req.query.priority_level as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };

      const result = dbService.getAlertPriorities(filters);
      return res.status(200).json({
        success: true,
        ...result
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch alert priorities',
        error: err.message || String(err)
      });
    }
  });

  router.get('/priorities/:kind', async (req: Request, res: Response) => {
    try {
      const kind = req.params.kind === 'controls' ? 'control_priorities' : req.params.kind === 'processes' ? 'process_priorities' : null;
      if (!kind) return res.status(400).json({ success: false, error: 'kind must be controls or processes' });
      const rows = dbService.getRawDb().prepare(`SELECT * FROM ${kind} ORDER BY priority_score DESC, priority_name ASC`).all() as any[];
      for (const row of rows) {
        row.finding_ids = JSON.parse(row.finding_ids);
        row.evidence_ids = JSON.parse(row.evidence_ids);
      }
      return res.status(200).json({ success: true, priorities: rows });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/report/:entity_id', async (req: Request, res: Response) => {
    try {
      const entityId = req.params.entity_id as string;
      const rawEntity = dbService.getEntity(entityId);
      if (!rawEntity) return res.status(404).json({ success: false, error: 'Entity not found' });

      const analysis = await getAnalyticsResults();
      const entityRisk = analysis.entity_risk[entityId];
      
      const filters = { entity_id: entityId, limit: 100, offset: 0 };
      const priorityAlerts = dbService.getAlertPriorities(filters);
      const period = dbService.getRawDb().prepare('SELECT MIN(timestamp) AS start_at, MAX(timestamp) AS end_at FROM alerts WHERE entity_id = ?').get(entityId) as { start_at: string | null; end_at: string | null };
      
      dbService.logAudit('GENERATE_REPORT', { entity_id: entityId });

      return res.status(200).json({
        success: true,
        report: {
          entity: rawEntity,
          risk: entityRisk || null,
          prioritized_alerts: priorityAlerts.alerts,
          assessment_period: {
            start_at: period.start_at,
            end_at: period.end_at,
            source: 'SQLite alert timestamps'
          },
          methodology: {
            configuration: 'sat-sa/config/analytics_config.json',
            limitations: [
              'Anomaly feature attribution is a peer-deviation heuristic, not a formal tree contribution.',
              'Expert validation requires an independently reviewed label file.',
              'The bundled sample dataset is synthetic demonstration data.'
            ]
          },
          generated_at: new Date().toISOString()
        }
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/trends', async (req: Request, res: Response) => {
    try {
      const entityId = req.query.entity_id as string | undefined;
      const days = req.query.days ? parseInt(req.query.days as string) : undefined;
      
      const trends = dbService.getTemporalTrends(entityId, days);
      return res.status(200).json({ success: true, ...trends });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  const ensureSupervisoryFindingsInDb = async () => {
    try {
      const analysis = await getAnalyticsResults();
      if (analysis?.all_findings?.length) {
        const insertStmt = dbService.getRawDb().prepare(`
          INSERT OR IGNORE INTO supervisory_findings 
          (finding_id, entity_id, finding_type, severity, title, rationale, evidence_ids, supporting_metrics, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const nowIso = new Date().toISOString();
        const insertMany = dbService.getRawDb().transaction((findings: any[]) => {
          for (const f of findings) {
            insertStmt.run(
              f.finding_id,
              f.entity_id,
              f.finding_type || 'ANOMALY',
              f.severity || 'MEDIUM',
              f.title || f.finding_id,
              f.rationale || '',
              JSON.stringify(f.evidence_ids || []),
              JSON.stringify(f.supporting_metrics || {}),
              nowIso
            );
          }
        });
        insertMany(analysis.all_findings);
      }
    } catch {
      // non-fatal fallback
    }
  };

  router.post('/upload-labels', upload.any(), async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) return res.status(400).json({ success: false, error: 'No files uploaded' });
      const parsed = DataValidator.parseCsvWithMeta(files[0].buffer.toString('utf-8'));
      const requiredHeaders = ['finding_id', 'entity_id', 'expert_label', 'reviewer_id', 'review_timestamp', 'rationale'];
      const missingHeaders = requiredHeaders.filter(header => !parsed.headers.includes(header));
      if (parsed.isEmpty || missingHeaders.length > 0) {
        return res.status(400).json({
          success: false,
          error: parsed.isEmpty ? 'Empty CSV' : 'Expert finding-label CSV is missing required columns',
          validation_errors: missingHeaders.map(field => ({ row: 1, field, message: `Missing required column '${field}'` }))
        });
      }

      // Filter out completely blank/unannotated template placeholder rows
      const candidateRows = parsed.rows.filter(r => r.expert_label && r.expert_label.trim() !== '');
      if (candidateRows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No reviewed findings found. Please fill in expert_label (CONFIRMED or NOT_CONFIRMED) for at least one finding before uploading.',
          validation_errors: [{ row: 2, field: 'expert_label', message: 'At least one finding must have expert_label filled (CONFIRMED or NOT_CONFIRMED)' }]
        });
      }

      // Ensure findings are present in DB before evaluating foreign keys
      await ensureSupervisoryFindingsInDb();

      // Normalize candidate rows with sensible defaults if omitted by human reviewer
      const normalizedRows = candidateRows.map(r => {
        let ts = (r.review_timestamp || '').trim();
        if (!ts || Number.isNaN(new Date(ts).getTime())) {
          ts = new Date().toISOString();
        }
        return {
          ...r,
          reviewer_id: (r.reviewer_id || '').trim() || 'Expert-Reviewer',
          review_timestamp: ts
        };
      });

      const result = dbService.insertExpertFindingLabels(normalizedRows);
      dbService.logAudit('IMPORT_EXPERT_FINDING_LABELS', { accepted: result.accepted, rejected: result.rejected });

      if (result.accepted > 0) {
        try {
          dbService.createValidationRun();
        } catch {
          // non-fatal
        }
      }

      return res.status(result.accepted === 0 && result.rejected > 0 ? 400 : 200).json({
        success: result.accepted > 0,
        accepted: result.accepted,
        rejected: result.rejected,
        validation_errors: result.errors,
        message: `${result.accepted} expert label(s) imported and validation metrics computed.`
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/validation-runs', async (_req: Request, res: Response) => {
    try {
      const run = dbService.createValidationRun();
      return res.status(200).json({ success: true, validation_run: run });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  router.get('/expert-finding-labels', async (_req: Request, res: Response) => {
    try {
      const labels = dbService.getRawDb().prepare(`
        SELECT finding_id, entity_id, expert_label, reviewer_id, review_timestamp, rationale
        FROM expert_finding_labels
        ORDER BY updated_at DESC
      `).all();
      return res.status(200).json({ success: true, labels });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/expert-finding-labels', async (req: Request, res: Response) => {
    try {
      await ensureSupervisoryFindingsInDb();
      const result = dbService.insertExpertFindingLabels([req.body || {}]);
      if (result.accepted === 0) return res.status(400).json({ success: false, accepted: 0, rejected: result.rejected, validation_errors: result.errors });
      try {
        dbService.createValidationRun();
      } catch {
        // non-fatal
      }
      return res.status(200).json({ success: true, accepted: result.accepted, rejected: result.rejected, validation_errors: result.errors });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/expert-finding-labels/reset', async (_req: Request, res: Response) => {
    try {
      dbService.resetExpertFindingLabels();
      return res.status(200).json({ success: true, message: 'All manual validation labels reset successfully.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  const csvCell = (value: unknown) => {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  router.get('/validation-review-template.csv', async (_req: Request, res: Response) => {
    await ensureSupervisoryFindingsInDb();
    const rows = dbService.getRawDb().prepare(`
      SELECT finding_id, entity_id FROM supervisory_findings ORDER BY finding_id
    `).all() as Array<{ finding_id: string; entity_id: string }>;

    const store = assessmentStorage.getStore();
    const curAssessment = actualAssessmentService.getActiveAssessment();
    const effectiveId = store?.assessmentId || curAssessment?.assessment_id || 'default';
    const filename = `REVIEW_TEMPLATE_${effectiveId}.csv`;

    const csv = [
      'finding_id,entity_id,expert_label,reviewer_id,review_timestamp,rationale',
      ...rows.map(row => `${csvCell(row.finding_id)},${csvCell(row.entity_id)},,,,`)
    ].join('\n') + '\n';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.type('text/csv').status(200).send(csv);
  });

  router.get('/validation-labels.csv', async (_req: Request, res: Response) => {
    const rows = dbService.getRawDb().prepare(`
      SELECT finding_id, entity_id, expert_label, reviewer_id, review_timestamp, rationale
      FROM expert_finding_labels ORDER BY finding_id
    `).all() as Array<Record<string, unknown>>;

    const store = assessmentStorage.getStore();
    const curAssessment = actualAssessmentService.getActiveAssessment();
    const effectiveId = store?.assessmentId || curAssessment?.assessment_id || 'default';
    const filename = `expert_finding_labels_${effectiveId}.csv`;

    const csv = [
      'finding_id,entity_id,expert_label,reviewer_id,review_timestamp,rationale',
      ...rows.map(row => [row.finding_id, row.entity_id, row.expert_label, row.reviewer_id, row.review_timestamp, row.rationale].map(csvCell).join(','))
    ].join('\n') + '\n';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.type('text/csv').status(200).send(csv);
  });

  router.get('/validation-metrics', async (req: Request, res: Response) => {
    try {
      const summary = dbService.getValidationSummary();
      return res.status(200).json({ success: true, ...summary });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/validation-runs/:id', async (req: Request, res: Response) => {
    const run = dbService.getValidationRun(String(req.params.id));
    if (!run) return res.status(404).json({ success: false, error: 'Validation run not found' });
    return res.status(200).json({ success: true, validation_run: run });
  });

  router.get('/findings', async (req: Request, res: Response) => {
    try {
      const analysis = await getAnalyticsResults();
      let findingsList = [...analysis.all_findings];

      const entityFilter = req.query.entity_id as string | undefined;
      const typeFilter = req.query.finding_type as string | undefined;
      const severityFilter = req.query.severity as string | undefined;

      if (entityFilter) {
        findingsList = findingsList.filter(f => f.entity_id.toUpperCase() === entityFilter.toUpperCase());
      }

      if (typeFilter) {
        findingsList = findingsList.filter(f => f.finding_type.toUpperCase() === typeFilter.toUpperCase());
      }

      if (severityFilter) {
        findingsList = findingsList.filter(f => f.severity.toUpperCase() === severityFilter.toUpperCase());
      }

      return res.status(200).json({
        success: true,
        count: findingsList.length,
        findings: findingsList
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve findings list',
        error: err.message || String(err)
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. GET /api/findings/:id
  // ─────────────────────────────────────────────────────────────────────────────
  router.get('/findings/:id', async (req: Request, res: Response) => {
    try {
      const findingId = String(req.params.id);
      const analysis = await getAnalyticsResults();

      const finding = analysis.all_findings.find(f => f.finding_id === findingId);
      if (!finding) {
        return res.status(404).json({
          success: false,
          error: 'Finding not found',
          finding_id: findingId
        });
      }

      return res.status(200).json({
        success: true,
        finding_id: finding.finding_id,
        entity_id: finding.entity_id,
        finding_type: finding.finding_type,
        severity: finding.severity,
        title: finding.title,
        rationale: finding.rationale,
        supporting_metrics: finding.supporting_metrics,
        evidence_ids: finding.evidence_ids
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve finding detail',
        error: err.message || String(err)
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. GET /api/evidence/integrity (Audit check: verify all finding evidence in SQLite)
  // ─────────────────────────────────────────────────────────────────────────────
  router.get('/evidence/integrity', async (req: Request, res: Response) => {
    try {
      const analysis = await getAnalyticsResults();
      const findings = analysis.all_findings || [];
      const report = dbService.checkFindingsEvidenceIntegrity(findings);

      return res.status(200).json({
        success: true,
        ...report
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to verify evidence integrity',
        error: err.message || String(err)
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. GET /api/evidence/:id
  // ─────────────────────────────────────────────────────────────────────────────
  router.get('/evidence/:id', async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id).trim();

      // Check 1: Alert ID lookup (ALT-*)
      if (id.startsWith('ALT-')) {
        const alert = dbService.getAlert(id);
        if (alert) {
          const relatedCase = dbService.getCaseByAlertId(id);
          const relatedAsset = alert.asset_id ? dbService.getAsset(alert.asset_id) : null;
          return res.status(200).json({
            success: true,
            id,
            evidence_type: 'alert',
            alert,
            related_case: relatedCase,
            related_asset: relatedAsset
          });
        }
      }

      // Check 2: Case ID lookup (CAS-*)
      if (id.startsWith('CAS-')) {
        const caseRecord = dbService.getCase(id);
        if (caseRecord) {
          const relatedAlert = caseRecord.alert_id ? dbService.getAlert(caseRecord.alert_id) : null;
          const relatedAsset = relatedAlert?.asset_id ? dbService.getAsset(relatedAlert.asset_id) : null;
          return res.status(200).json({
            success: true,
            id,
            evidence_type: 'case',
            case: caseRecord,
            related_alert: relatedAlert,
            related_asset: relatedAsset
          });
        }
      }

      // Check 3: Asset ID lookup (AST-*)
      if (id.startsWith('AST-')) {
        const asset = dbService.getAsset(id);
        if (asset) {
          const entity = dbService.getEntity(asset.entity_id);
          const recentAlerts = dbService.getAlertsForAsset(id, 20);
          return res.status(200).json({
            success: true,
            id,
            evidence_type: 'asset',
            asset,
            entity,
            recent_alerts: recentAlerts
          });
        }
      }

      // Check 4: Finding ID lookup (drill down to all evidence IDs for that finding)
      const analysis = await getAnalyticsResults();
      const finding = analysis.all_findings.find(f => f.finding_id === id);

      if (finding) {
        const alerts: any[] = [];
        const cases: any[] = [];
        const assets: any[] = [];

        for (const evId of finding.evidence_ids.slice(0, 30)) {
          if (evId.startsWith('ALT-')) {
            const a = dbService.getAlert(evId);
            if (a) alerts.push(a);
          } else if (evId.startsWith('CAS-')) {
            const c = dbService.getCase(evId);
            if (c) cases.push(c);
          } else if (evId.startsWith('AST-')) {
            const ast = dbService.getAsset(evId);
            if (ast) assets.push(ast);
          }
        }

        return res.status(200).json({
          success: true,
          id,
          evidence_type: 'finding_drilldown',
          finding: {
            finding_id: finding.finding_id,
            entity_id: finding.entity_id,
            finding_type: finding.finding_type,
            severity: finding.severity,
            title: finding.title,
            rationale: finding.rationale,
            supporting_metrics: finding.supporting_metrics,
            evidence_ids: finding.evidence_ids
          },
          evidence_records: {
            alerts,
            cases,
            assets
          }
        });
      }

      // Check 5: General fallback lookup across all tables if prefix didn't match
      const alt = dbService.getAlert(id);
      if (alt) {
        return res.status(200).json({
          success: true,
          id,
          evidence_type: 'alert',
          alert: alt,
          related_case: dbService.getCaseByAlertId(id),
          related_asset: alt.asset_id ? dbService.getAsset(alt.asset_id) : null
        });
      }

      const cs = dbService.getCase(id);
      if (cs) {
        const relAlt = cs.alert_id ? dbService.getAlert(cs.alert_id) : null;
        return res.status(200).json({
          success: true,
          id,
          evidence_type: 'case',
          case: cs,
          related_alert: relAlt,
          related_asset: relAlt?.asset_id ? dbService.getAsset(relAlt.asset_id) : null
        });
      }

      const ast = dbService.getAsset(id);
      if (ast) {
        return res.status(200).json({
          success: true,
          id,
          evidence_type: 'asset',
          asset: ast,
          entity: dbService.getEntity(ast.entity_id),
          recent_alerts: dbService.getAlertsForAsset(id, 20)
        });
      }

      return res.status(404).json({
        success: false,
        error: 'Evidence record not found in database',
        id,
        broken_reference: true,
        message: `Evidence reference broken: Record '${id}' does not exist in SQLite tables (alerts, cases, assets, entities).`
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve evidence record',
        error: err.message || String(err)
      });
    }
  });

  return router;
}
