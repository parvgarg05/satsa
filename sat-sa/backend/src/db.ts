import { DatabaseSync } from 'node:sqlite';
import * as crypto from 'crypto';
import path from 'node:path';
import fs from 'node:fs';

export interface EntityRecord {
  entity_id: string;
  entity_name: string;
  sector: string;
}

export interface AssetRecord {
  asset_id: string;
  entity_id: string;
  asset_type: string;
  criticality: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  expected_telemetry: string;
  last_telemetry: string | null;
}

export interface AlertRecord {
  alert_id: string;
  timestamp: string;
  entity_id: string;
  asset_id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  source_ip?: string | null;
  destination_ip?: string | null;
  status: 'OPEN' | 'INVESTIGATING' | 'CLOSED' | 'ESCALATED';
}

export interface CaseRecord {
  case_id: string;
  alert_id: string;
  entity_id: string;
  investigator: string;
  opened_at: string;
  investigation_duration: number; // in minutes
  escalated: number; // 0 or 1
  closed_at: string | null;
  closure_reason: string | null;
  remediation_status: 'Completed' | 'In Progress' | 'None' | 'Ignored' | null;
}

export class DatabaseService {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || path.resolve(process.cwd(), 'sat_sa.db');
    this.dbPath = resolvedPath;
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(resolvedPath);
    this.initPragmas();
    this.initTables();
  }

  private initPragmas() {
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
  }

  private initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        entity_id TEXT PRIMARY KEY,
        entity_name TEXT NOT NULL,
        sector TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assets (
        asset_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        criticality TEXT NOT NULL CHECK(criticality IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
        expected_telemetry TEXT NOT NULL,
        last_telemetry TEXT,
        FOREIGN KEY (entity_id) REFERENCES entities(entity_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS alerts (
        alert_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
        category TEXT NOT NULL,
        source_ip TEXT,
        destination_ip TEXT,
        status TEXT NOT NULL CHECK(status IN ('OPEN', 'INVESTIGATING', 'CLOSED', 'ESCALATED')),
        FOREIGN KEY (entity_id) REFERENCES entities(entity_id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES assets(asset_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS cases (
        case_id TEXT PRIMARY KEY,
        alert_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        investigator TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        investigation_duration INTEGER NOT NULL CHECK(investigation_duration >= 0),
        escalated INTEGER NOT NULL CHECK(escalated IN (0, 1)),
        closed_at TEXT,
        closure_reason TEXT,
        remediation_status TEXT CHECK(remediation_status IS NULL OR remediation_status IN ('Completed', 'In Progress', 'None', 'Ignored')),
        FOREIGN KEY (alert_id) REFERENCES alerts(alert_id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entities(entity_id) ON DELETE CASCADE
      );

      -- Performance and query indexes
      CREATE INDEX IF NOT EXISTS idx_assets_entity ON assets(entity_id);
      CREATE INDEX IF NOT EXISTS idx_assets_criticality ON assets(criticality);
      CREATE INDEX IF NOT EXISTS idx_alerts_entity ON alerts(entity_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_asset ON alerts(asset_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
      CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp);
      CREATE INDEX IF NOT EXISTS idx_cases_entity ON cases(entity_id);
      CREATE INDEX IF NOT EXISTS idx_cases_alert ON cases(alert_id);
      CREATE INDEX IF NOT EXISTS idx_cases_escalated ON cases(escalated);

      CREATE TABLE IF NOT EXISTS alert_review_priority (
        alert_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        priority_score REAL NOT NULL,
        priority_level TEXT NOT NULL,
        primary_signal TEXT NOT NULL,
        reasons TEXT NOT NULL,
        evidence_ids TEXT NOT NULL,
        calculated_at TEXT NOT NULL,
        FOREIGN KEY (alert_id) REFERENCES alerts(alert_id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entities(entity_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS supervisory_findings (
        finding_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        finding_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        rationale TEXT NOT NULL,
        evidence_ids TEXT NOT NULL,
        supporting_metrics TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (entity_id) REFERENCES entities(entity_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS entity_risk_scores (
        entity_id TEXT PRIMARY KEY,
        entity_name TEXT NOT NULL,
        sector TEXT NOT NULL,
        final_risk_score REAL NOT NULL,
        risk_level TEXT NOT NULL,
        component_scores TEXT NOT NULL,
        component_weighted_contributions TEXT NOT NULL,
        primary_drivers TEXT NOT NULL,
        explanation TEXT NOT NULL,
        calculated_at TEXT NOT NULL,
        FOREIGN KEY (entity_id) REFERENCES entities(entity_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS expert_labels (
        alert_id TEXT PRIMARY KEY,
        expert_decision TEXT NOT NULL CHECK(expert_decision IN ('Match', 'Miss', 'False Positive')),
        reviewer_notes TEXT,
        validated_at TEXT NOT NULL,
        FOREIGN KEY (alert_id) REFERENCES alerts(alert_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS expert_finding_labels (
        finding_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        expert_label TEXT NOT NULL CHECK(expert_label IN ('CONFIRMED', 'NOT_CONFIRMED')),
        reviewer_id TEXT NOT NULL,
        review_timestamp TEXT NOT NULL,
        rationale TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (finding_id) REFERENCES supervisory_findings(finding_id) ON DELETE CASCADE,
        FOREIGN KEY (entity_id) REFERENCES entities(entity_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS validation_runs (
        validation_run_id TEXT PRIMARY KEY,
        dataset_identifier TEXT NOT NULL,
        assessment_period_start TEXT,
        assessment_period_end TEXT,
        methodology_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expert_label_count INTEGER NOT NULL,
        evaluated_finding_count INTEGER NOT NULL,
        metrics TEXT NOT NULL,
        module_metrics TEXT NOT NULL,
        entity_metrics TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        details TEXT NOT NULL,
        previous_hash TEXT,
        hash TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS external_dataset_imports (
        dataset_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_file TEXT NOT NULL,
        source_sha256 TEXT NOT NULL UNIQUE,
        source_size_bytes INTEGER NOT NULL,
        schema TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        record_count INTEGER NOT NULL,
        duplicate_count INTEGER NOT NULL,
        ingestion_timestamp TEXT NOT NULL,
        provenance TEXT NOT NULL,
        raw_content BLOB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS external_redteam_events (
        dataset_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        source_row_number INTEGER NOT NULL,
        raw_record TEXT NOT NULL,
        raw_record_sha256 TEXT NOT NULL,
        column_1 TEXT NOT NULL,
        column_2 TEXT NOT NULL,
        column_3 TEXT NOT NULL,
        column_4 TEXT NOT NULL,
        duplicate_of_event_id TEXT,
        PRIMARY KEY (dataset_id, event_id),
        FOREIGN KEY (dataset_id) REFERENCES external_dataset_imports(dataset_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_external_events_dataset_row ON external_redteam_events(dataset_id, source_row_number);
      CREATE INDEX IF NOT EXISTS idx_external_events_raw_hash ON external_redteam_events(dataset_id, raw_record_sha256);

      CREATE TABLE IF NOT EXISTS assessment_metadata (
        assessment_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        dataset_version TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Ensure audit_logs has hash and previous_hash columns if initialized from older database
    try {
      const cols = (this.db.prepare("PRAGMA table_info(audit_logs)").all() as Array<{ name: string }>).map(c => c.name);
      if (!cols.includes('previous_hash')) {
        this.db.exec("ALTER TABLE audit_logs ADD COLUMN previous_hash TEXT;");
      }
      if (!cols.includes('hash')) {
        this.db.exec("ALTER TABLE audit_logs ADD COLUMN hash TEXT NOT NULL DEFAULT 'GENESIS';");
      }
    } catch {
      // ignore
    }
  }

  public logAudit(operation: string, details: any) {
    try {
      const timestamp = new Date().toISOString();
      const detailsStr = JSON.stringify(details);
      
      const lastLog = this.db.prepare('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1').get() as { hash: string } | undefined;
      const previousHash = lastLog ? lastLog.hash : 'GENESIS';
      
      const payload = `${operation}|${timestamp}|${detailsStr}|${previousHash}`;
      const hash = crypto.createHash('sha256').update(payload).digest('hex');
      
      this.db.prepare('INSERT INTO audit_logs (operation, timestamp, details, previous_hash, hash) VALUES (?, ?, ?, ?, ?)').run(
        operation,
        timestamp,
        detailsStr,
        previousHash,
        hash
      );
    } catch (e: any) {
      console.error('Audit log failed', e);
    }
  }

  public getAuditLogs() {
    return this.db.prepare('SELECT * FROM audit_logs ORDER BY id ASC').all();
  }

  public verifyAuditIntegrity(): { valid: boolean, errors: string[] } {
    const logs = this.getAuditLogs() as any[];
    const errors: string[] = [];
    let expectedPrevious = 'GENESIS';
    
    for (const log of logs) {
      if (log.previous_hash !== expectedPrevious) {
        errors.push(`Chain broken at log ${log.id}: expected previous_hash ${expectedPrevious}, got ${log.previous_hash}`);
      }
      const payload = `${log.operation}|${log.timestamp}|${log.details}|${log.previous_hash}`;
      const computedHash = crypto.createHash('sha256').update(payload).digest('hex');
      if (computedHash !== log.hash) {
        errors.push(`Hash mismatch at log ${log.id}: computed ${computedHash}, stored ${log.hash}`);
      }
      expectedPrevious = log.hash;
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  public getRawDb(): DatabaseSync {
    return this.db;
  }

  public clearAll() {
    this.db.exec(`
      DELETE FROM audit_logs;
      DELETE FROM validation_runs;
      DELETE FROM expert_finding_labels;
      DELETE FROM expert_labels;
      DELETE FROM alert_review_priority;
      DELETE FROM entity_risk_scores;
      DELETE FROM supervisory_findings;
      DELETE FROM cases;
      DELETE FROM alerts;
      DELETE FROM assets;
      DELETE FROM entities;
    `);
  }

  public getTemporalTrends(entityId?: string, daysWindow?: number) {
    let dateFilter = "";
    const params: any[] = [];
    
    if (daysWindow) {
      dateFilter = "AND timestamp >= date('now', '-' || ? || ' days')";
      params.push(daysWindow.toString());
    }
    
    let entityFilter = "";
    if (entityId) {
      entityFilter = "AND entity_id = ?";
      params.push(entityId);
    }
    
    // Fallback if sqlite doesn't like strftime date buckets, we just use substr
    const query = `
      SELECT 
        substr(timestamp, 1, 10) as date_bucket,
        COUNT(*) as total_alerts,
        SUM(CASE WHEN severity = 'CRITICAL' THEN 1 ELSE 0 END) as critical_alerts,
        SUM(CASE WHEN severity = 'HIGH' THEN 1 ELSE 0 END) as high_alerts,
        SUM(CASE WHEN severity NOT IN ('CRITICAL', 'HIGH') THEN 1 ELSE 0 END) as other_alerts
      FROM alerts 
      WHERE 1=1 ${dateFilter} ${entityFilter}
      GROUP BY date_bucket
      ORDER BY date_bucket ASC
    `;
    
    const findingFilter = entityId ? "WHERE entity_id = ?" : "";
    const fParams = entityId ? [entityId] : [];
    const findingsQuery = `
      SELECT 
        substr(created_at, 1, 10) as date_bucket,
        finding_type,
        COUNT(*) as count
      FROM supervisory_findings
      ${findingFilter}
      GROUP BY date_bucket, finding_type
      ORDER BY date_bucket ASC
    `;

    return {
      alert_trends: this.db.prepare(query).all(...params),
      finding_trends: this.db.prepare(findingsQuery).all(...fParams)
    };
  }

  public insertExpertLabels(labels: any[]) {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO expert_labels (alert_id, expert_decision, reviewer_notes, validated_at) VALUES (?, ?, ?, ?)');
    for (const label of labels) {
      if (label.alert_id && label.expert_decision) {
        stmt.run(label.alert_id, label.expert_decision, label.reviewer_notes || '', new Date().toISOString());
      }
    }
  }

  public getValidationMetrics() {
    const rows = this.db.prepare(`
      SELECT 
        e.alert_id, 
        e.expert_decision,
        p.priority_level as system_level
      FROM expert_labels e
      LEFT JOIN alert_review_priority p ON e.alert_id = p.alert_id
    `).all() as any[];

    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    let trueNegatives = 0;

    for (const row of rows) {
      const expertSaysFlag = row.expert_decision === 'Match';
      const systemSaysFlag = row.system_level === 'CRITICAL' || row.system_level === 'HIGH';

      if (expertSaysFlag && systemSaysFlag) truePositives++;
      else if (!expertSaysFlag && systemSaysFlag) falsePositives++;
      else if (expertSaysFlag && !systemSaysFlag) falseNegatives++;
      else if (!expertSaysFlag && !systemSaysFlag) trueNegatives++;
    }

    const precision = (truePositives + falsePositives) > 0 ? truePositives / (truePositives + falsePositives) : 0;
    const recall = (truePositives + falseNegatives) > 0 ? truePositives / (truePositives + falseNegatives) : 0;
    const f1_score = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    return {
      metrics: {
        true_positives: truePositives,
        false_positives: falsePositives,
        false_negatives: falseNegatives,
        true_negatives: trueNegatives,
        precision,
        recall,
        f1_score,
        total_validated: rows.length
      },
      raw_data: rows
    };
  }

  public insertExpertFindingLabels(labels: Array<Record<string, string>>): {
    accepted: number;
    rejected: number;
    errors: Array<{ row: number; field?: string; message: string }>;
  } {
    const errors: Array<{ row: number; field?: string; message: string }> = [];
    const validRows: Array<{
      finding_id: string;
      entity_id: string;
      expert_label: 'CONFIRMED' | 'NOT_CONFIRMED';
      reviewer_id: string;
      review_timestamp: string;
      rationale: string;
      existing: boolean;
    }> = [];
    const seen = new Set<string>();
    const rawDb = this.db;
    const findings = new Map(
      (rawDb.prepare('SELECT finding_id, entity_id FROM supervisory_findings').all() as Array<{ finding_id: string; entity_id: string }>)
        .map(finding => [finding.finding_id, finding.entity_id])
    );

    labels.forEach((label, index) => {
      const rowNumber = index + 2;
      const findingId = (label.finding_id || '').trim();
      const entityId = (label.entity_id || '').trim();
      const expertLabel = (label.expert_label || '').trim().toUpperCase();
      const reviewerId = (label.reviewer_id || '').trim();
      const reviewTimestamp = (label.review_timestamp || '').trim();
      const rationale = (label.rationale || '').trim();

      if (!findingId) errors.push({ row: rowNumber, field: 'finding_id', message: 'finding_id is required' });
      else if (seen.has(findingId)) errors.push({ row: rowNumber, field: 'finding_id', message: `Duplicate finding_id in upload: ${findingId}` });
      else seen.add(findingId);

      if (findingId && !findings.has(findingId)) errors.push({ row: rowNumber, field: 'finding_id', message: `Finding '${findingId}' does not exist` });
      if (!entityId) errors.push({ row: rowNumber, field: 'entity_id', message: 'entity_id is required' });
      else if (findingId && findings.get(findingId) !== entityId) errors.push({ row: rowNumber, field: 'entity_id', message: `entity_id does not match finding '${findingId}'` });
      if (expertLabel !== 'CONFIRMED' && expertLabel !== 'NOT_CONFIRMED') errors.push({ row: rowNumber, field: 'expert_label', message: "expert_label must be CONFIRMED or NOT_CONFIRMED" });
      if (!reviewerId) errors.push({ row: rowNumber, field: 'reviewer_id', message: 'reviewer_id is required' });
      if (!reviewTimestamp || Number.isNaN(new Date(reviewTimestamp).getTime())) errors.push({ row: rowNumber, field: 'review_timestamp', message: 'review_timestamp must be a valid timestamp' });

      const rowHasError = errors.some(error => error.row === rowNumber);
      if (!rowHasError) {
        const existing = !!rawDb.prepare('SELECT 1 FROM expert_finding_labels WHERE finding_id = ?').get(findingId);
        validRows.push({
          finding_id: findingId,
          entity_id: entityId,
          expert_label: expertLabel as 'CONFIRMED' | 'NOT_CONFIRMED',
          reviewer_id: reviewerId,
          review_timestamp: reviewTimestamp,
          rationale,
          existing
        });
      }
    });

    rawDb.exec('BEGIN TRANSACTION;');
    try {
      const now = new Date().toISOString();
      const statement = rawDb.prepare(`
        INSERT INTO expert_finding_labels
        (finding_id, entity_id, expert_label, reviewer_id, review_timestamp, rationale, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(finding_id) DO UPDATE SET
          entity_id = excluded.entity_id,
          expert_label = excluded.expert_label,
          reviewer_id = excluded.reviewer_id,
          review_timestamp = excluded.review_timestamp,
          rationale = excluded.rationale,
          updated_at = excluded.updated_at
      `);
      for (const label of validRows) {
        statement.run(label.finding_id, label.entity_id, label.expert_label, label.reviewer_id, label.review_timestamp, label.rationale || null, now, now);
      }
      rawDb.exec('COMMIT;');
      for (const label of validRows) {
        this.logAudit(label.existing ? 'MODIFY_EXPERT_FINDING_LABEL' : 'CREATE_EXPERT_FINDING_LABEL', {
          finding_id: label.finding_id,
          entity_id: label.entity_id,
          reviewer_id: label.reviewer_id,
          expert_label: label.expert_label
        });
      }
    } catch (error) {
      rawDb.exec('ROLLBACK;');
      throw error;
    }

    const rejectedRows = new Set(errors.map(error => error.row));
    return { accepted: validRows.length, rejected: rejectedRows.size, errors };
  }

  public resetExpertFindingLabels(): void {
    this.db.exec(`
      DELETE FROM expert_finding_labels;
      DELETE FROM validation_runs;
    `);
    this.logAudit('RESET_EXPERT_FINDING_LABELS', { timestamp: new Date().toISOString() });
  }

  public createValidationRun(): Record<string, unknown> {
    const labels = this.db.prepare(`
      SELECT l.finding_id, l.entity_id, l.expert_label, l.reviewer_id, l.review_timestamp,
             f.finding_type
      FROM expert_finding_labels l
      JOIN supervisory_findings f ON f.finding_id = l.finding_id
      ORDER BY l.finding_id
    `).all() as Array<Record<string, string>>;
    if (labels.length === 0) throw new Error('No expert-labelled validation data available.');

    const counts = this.getCounts();
    const datasetIdentifier = `v${counts.entities}.${counts.assets}.${counts.alerts}.${counts.cases}`;
    const methodologyVersion = 'analytics-config-1.0';
    const canonicalLabels = JSON.stringify(labels);
    const validationRunId = `VAL-${crypto.createHash('sha256').update(`${datasetIdentifier}|${methodologyVersion}|${canonicalLabels}`).digest('hex').slice(0, 16).toUpperCase()}`;
    const period = this.db.prepare('SELECT MIN(timestamp) AS start_at, MAX(timestamp) AS end_at FROM alerts').get() as { start_at: string | null; end_at: string | null };
    const metrics = this.calculateValidationMetrics(labels);
    const moduleMetrics: Record<string, unknown> = {};
    for (const module of ['EXECUTION_GAP', 'NEGATIVE_SPACE', 'ANOMALY', 'PEER_DEVIATION', 'REPEATED_INCIDENT']) {
      moduleMetrics[module] = this.calculateValidationMetrics(labels.filter(label => label.finding_type === module));
    }
    const entityMetrics: Record<string, unknown> = {};
    for (const entityId of [...new Set(labels.map(label => label.entity_id))].sort()) {
      entityMetrics[entityId] = this.calculateValidationMetrics(labels.filter(label => label.entity_id === entityId));
    }
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT OR REPLACE INTO validation_runs
      (validation_run_id, dataset_identifier, assessment_period_start, assessment_period_end, methodology_version, created_at, expert_label_count, evaluated_finding_count, metrics, module_metrics, entity_metrics)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(validationRunId, datasetIdentifier, period.start_at, period.end_at, methodologyVersion, createdAt, labels.length, labels.length, JSON.stringify(metrics), JSON.stringify(moduleMetrics), JSON.stringify(entityMetrics));
    this.logAudit('CREATE_VALIDATION_RUN', { validation_run_id: validationRunId, dataset_identifier: datasetIdentifier, expert_label_count: labels.length });
    return this.getValidationRun(validationRunId) as Record<string, unknown>;
  }

  public getValidationSummary(): Record<string, unknown> {
    const labelCount = (this.db.prepare('SELECT COUNT(*) AS count FROM expert_finding_labels').get() as { count: number }).count;
    const runCount = (this.db.prepare('SELECT COUNT(*) AS count FROM validation_runs').get() as { count: number }).count;
    const latest = this.db.prepare('SELECT validation_run_id FROM validation_runs ORDER BY created_at DESC LIMIT 1').get() as { validation_run_id: string } | undefined;
    if (labelCount === 0) {
      return { available: false, message: 'No expert-labelled validation data available.', label_count: 0, validation_run_count: runCount, latest_run: null };
    }
    if (!latest) {
      return { available: false, message: 'Expert labels are available, but no validation run has been created.', label_count: labelCount, validation_run_count: runCount, latest_run: null };
    }
    return { available: true, label_count: labelCount, validation_run_count: runCount, latest_run: this.getValidationRun(latest.validation_run_id) };
  }

  public getValidationRun(validationRunId: string): Record<string, unknown> | null {
    const row = this.db.prepare('SELECT * FROM validation_runs WHERE validation_run_id = ?').get(validationRunId) as Record<string, string> | undefined;
    if (!row) return null;
    return {
      validation_run_id: row.validation_run_id,
      dataset_identifier: row.dataset_identifier,
      assessment_period_start: row.assessment_period_start,
      assessment_period_end: row.assessment_period_end,
      methodology_version: row.methodology_version,
      created_at: row.created_at,
      expert_label_count: Number(row.expert_label_count),
      evaluated_finding_count: Number(row.evaluated_finding_count),
      metrics: JSON.parse(row.metrics),
      module_metrics: JSON.parse(row.module_metrics),
      entity_metrics: JSON.parse(row.entity_metrics)
    };
  }

  private calculateValidationMetrics(labels: Array<Record<string, string>>) {
    const truePositives = labels.filter(label => label.expert_label === 'CONFIRMED').length;
    const falsePositives = labels.filter(label => label.expert_label === 'NOT_CONFIRMED').length;
    const falseNegatives = 0;
    const trueNegatives = 0;
    const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : null;
    const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : null;
    const f1 = precision !== null && recall !== null && precision + recall > 0 ? 2 * precision * recall / (precision + recall) : null;
    return {
      sample_count: labels.length,
      true_positives: truePositives,
      true_negatives: trueNegatives,
      false_positives: falsePositives,
      false_negatives: falseNegatives,
      precision,
      recall,
      f1_score: f1,
      accuracy: null,
      accuracy_explanation: 'Accuracy is not meaningful because this workflow labels detected findings only and has no reviewed non-finding population for true negatives.',
      recall_explanation: 'Recall is conditional on the reviewed SAT-SA finding set; missed findings are not measurable until a reviewed sampling frame includes non-detected cases.',
      one_class_explanation: new Set(labels.map(label => label.expert_label)).size < 2 ? 'Only one expert-label class is present; class-balanced interpretation is limited.' : null,
      confusion_matrix: { predicted_finding: { confirmed: truePositives, not_confirmed: falsePositives } }
    };
  }

  public getCounts() {
    const entities = (this.db.prepare('SELECT COUNT(*) as count FROM entities').get() as { count: number }).count;
    const assets = (this.db.prepare('SELECT COUNT(*) as count FROM assets').get() as { count: number }).count;
    const alerts = (this.db.prepare('SELECT COUNT(*) as count FROM alerts').get() as { count: number }).count;
    const cases = (this.db.prepare('SELECT COUNT(*) as count FROM cases').get() as { count: number }).count;
    return { entities, assets, alerts, cases };
  }

  public getEntity(entityId: string): EntityRecord | null {
    const row = this.db.prepare('SELECT * FROM entities WHERE entity_id = ?').get(entityId) as EntityRecord | undefined;
    return row || null;
  }

  public getEntities(): EntityRecord[] {
    return this.db.prepare('SELECT * FROM entities ORDER BY entity_id').all() as unknown as EntityRecord[];
  }

  public getAsset(assetId: string): AssetRecord | null {
    const row = this.db.prepare('SELECT * FROM assets WHERE asset_id = ?').get(assetId) as AssetRecord | undefined;
    return row || null;
  }

  public getAssetsForEntity(entityId: string): AssetRecord[] {
    return this.db.prepare('SELECT * FROM assets WHERE entity_id = ? ORDER BY criticality, asset_id').all(entityId) as unknown as AssetRecord[];
  }

  public getAlert(alertId: string): AlertRecord | null {
    const row = this.db.prepare('SELECT * FROM alerts WHERE alert_id = ?').get(alertId) as AlertRecord | undefined;
    return row || null;
  }

  public getAlertsForEntity(entityId: string, limit = 100): AlertRecord[] {
    return this.db.prepare('SELECT * FROM alerts WHERE entity_id = ? ORDER BY timestamp DESC LIMIT ?').all(entityId, limit) as unknown as AlertRecord[];
  }

  public getAlertsForAsset(assetId: string, limit = 50): AlertRecord[] {
    return this.db.prepare('SELECT * FROM alerts WHERE asset_id = ? ORDER BY timestamp DESC LIMIT ?').all(assetId, limit) as unknown as AlertRecord[];
  }

  public getCase(caseId: string): CaseRecord | null {
    const row = this.db.prepare('SELECT * FROM cases WHERE case_id = ?').get(caseId) as CaseRecord | undefined;
    return row || null;
  }

  public getCaseByAlertId(alertId: string): CaseRecord | null {
    const row = this.db.prepare('SELECT * FROM cases WHERE alert_id = ?').get(alertId) as CaseRecord | undefined;
    return row || null;
  }

  public getAlertPriorities(filters: {
    entity_id?: string;
    severity?: string;
    priority_level?: string;
    limit?: number;
    offset?: number;
  }): { alerts: any[]; total: number } {
    let baseSql = `
      SELECT p.*, a.severity, a.category, a.status, a.asset_id
      FROM alert_review_priority p
      JOIN alerts a ON p.alert_id = a.alert_id
      WHERE 1=1
    `;
    let countSql = `
      SELECT count(*) as c
      FROM alert_review_priority p
      JOIN alerts a ON p.alert_id = a.alert_id
      WHERE 1=1
    `;

    const jParams: any[] = [];
    if (filters.entity_id) {
      baseSql += ' AND p.entity_id = ?';
      countSql += ' AND p.entity_id = ?';
      jParams.push(filters.entity_id);
    }
    if (filters.priority_level) {
      baseSql += ' AND p.priority_level = ?';
      countSql += ' AND p.priority_level = ?';
      jParams.push(filters.priority_level);
    }
    if (filters.severity) {
      baseSql += ' AND a.severity = ?';
      countSql += ' AND a.severity = ?';
      jParams.push(filters.severity);
    }

    baseSql += ' ORDER BY p.priority_score DESC LIMIT ? OFFSET ?';
    
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    
    // SQLite can throw if the table doesn't exist yet (if pipeline never ran)
    try {
      const total = this.db.prepare(countSql).get(...jParams) as any;
      const rows = this.db.prepare(baseSql).all(...jParams, limit, offset);
      
      for (const row of rows as any[]) {
        if (typeof row.reasons === 'string') {
          try { row.reasons = JSON.parse(row.reasons); } catch {}
        }
        if (typeof row.evidence_ids === 'string') {
          try { row.evidence_ids = JSON.parse(row.evidence_ids); } catch {}
        }
      }
      return { alerts: rows as any[], total: total.c };
    } catch (e: any) {
      // Return empty if table doesn't exist
      return { alerts: [], total: 0 };
    }
  }

  public checkEvidenceExists(id: string): { exists: boolean; table: string | null } {
    if (!id || typeof id !== 'string') return { exists: false, table: null };
    const cleanId = id.trim();

    if (cleanId.startsWith('ALT-')) {
      const row = this.db.prepare('SELECT 1 FROM alerts WHERE alert_id = ?').get(cleanId);
      if (row) return { exists: true, table: 'alerts' };
    } else if (cleanId.startsWith('CAS-')) {
      const row = this.db.prepare('SELECT 1 FROM cases WHERE case_id = ?').get(cleanId);
      if (row) return { exists: true, table: 'cases' };
    } else if (cleanId.startsWith('AST-')) {
      const row = this.db.prepare('SELECT 1 FROM assets WHERE asset_id = ?').get(cleanId);
      if (row) return { exists: true, table: 'assets' };
    } else if (cleanId.startsWith('CSE-')) {
      const row = this.db.prepare('SELECT 1 FROM entities WHERE entity_id = ?').get(cleanId);
      if (row) return { exists: true, table: 'entities' };
    }

    // Fallback checks across all tables
    if (this.db.prepare('SELECT 1 FROM alerts WHERE alert_id = ?').get(cleanId)) return { exists: true, table: 'alerts' };
    if (this.db.prepare('SELECT 1 FROM cases WHERE case_id = ?').get(cleanId)) return { exists: true, table: 'cases' };
    if (this.db.prepare('SELECT 1 FROM assets WHERE asset_id = ?').get(cleanId)) return { exists: true, table: 'assets' };
    if (this.db.prepare('SELECT 1 FROM entities WHERE entity_id = ?').get(cleanId)) return { exists: true, table: 'entities' };

    return { exists: false, table: null };
  }

  public checkFindingsEvidenceIntegrity(findings: Array<{ finding_id: string; evidence_ids?: string[] }>) {
    let totalReferences = 0;
    let validReferences = 0;
    let brokenReferences = 0;
    const brokenDetails: Array<{ finding_id: string; evidence_id: string; reason: string }> = [];

    for (const f of findings) {
      const evIds = f.evidence_ids || [];
      for (const evId of evIds) {
        totalReferences++;
        const check = this.checkEvidenceExists(evId);
        if (check.exists) {
          validReferences++;
        } else {
          brokenReferences++;
          brokenDetails.push({
            finding_id: f.finding_id,
            evidence_id: evId,
            reason: `Record '${evId}' not found in SQLite database tables (alerts, cases, assets, entities)`
          });
        }
      }
    }

    return {
      total_findings: findings.length,
      total_references: totalReferences,
      valid_references: validReferences,
      broken_references: brokenReferences,
      integrity_passed: brokenReferences === 0,
      broken_details: brokenDetails
    };
  }

  public getAggregateStats() {
    const counts = this.getCounts();
    const escRow = this.db.prepare(`
      SELECT 
        COUNT(*) as total_cases,
        SUM(escalated) as escalated_cases,
        AVG(investigation_duration) as avg_duration
      FROM cases
    `).get() as { total_cases: number; escalated_cases: number; avg_duration: number };

    const quickCritRow = this.db.prepare(`
      SELECT COUNT(*) as quick_critical_count
      FROM cases c
      JOIN alerts a ON c.alert_id = a.alert_id
      WHERE a.severity = 'CRITICAL' AND a.status = 'CLOSED' AND c.investigation_duration < 10
    `).get() as { quick_critical_count: number };

    const maxAssetDateRow = this.db.prepare(`
      SELECT MAX(last_telemetry) as max_date FROM assets WHERE last_telemetry IS NOT NULL
    `).get() as { max_date: string | null };
    const anchorDate = maxAssetDateRow?.max_date ? maxAssetDateRow.max_date : new Date().toISOString();

    const critAssetsStaleRow = this.db.prepare(`
      SELECT COUNT(*) as stale_count
      FROM assets
      WHERE criticality = 'CRITICAL' AND (
        last_telemetry IS NULL OR
        julianday(?) - julianday(last_telemetry) > 7
      )
    `).get(anchorDate) as { stale_count: number };

    const freshAssetsRow = this.db.prepare(`
      SELECT COUNT(*) as fresh_count
      FROM assets
      WHERE last_telemetry IS NOT NULL AND (julianday(?) - julianday(last_telemetry)) <= 7.0
    `).get(anchorDate) as { fresh_count: number };

    const totalAssets = counts.assets;
    const telemetryCoveragePct = totalAssets > 0 
      ? Math.round((freshAssetsRow.fresh_count / totalAssets) * 1000) / 10 
      : 0;

    return {
      ...counts,
      total_cases: escRow.total_cases || 0,
      escalated_cases: escRow.escalated_cases || 0,
      escalation_rate: escRow.total_cases > 0 ? (escRow.escalated_cases / escRow.total_cases) : 0,
      avg_investigation_duration: escRow.avg_duration ? Math.round(escRow.avg_duration * 10) / 10 : 0,
      quick_closure_critical_count: quickCritRow.quick_critical_count || 0,
      stale_critical_assets_count: critAssetsStaleRow.stale_count || 0,
      telemetry_coverage_pct: telemetryCoveragePct
    };
  }

  public getDbPath(): string {
    return this.dbPath;
  }

  public getAssessmentMetadata(): { assessment_id: string; name: string; description?: string; dataset_version?: string; created_at: string; updated_at: string } | null {
    try {
      const row = this.db.prepare('SELECT * FROM assessment_metadata LIMIT 1').get() as any;
      return row || null;
    } catch {
      return null;
    }
  }

  public setAssessmentMetadata(meta: { assessment_id: string; name: string; description?: string; dataset_version?: string }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT OR REPLACE INTO assessment_metadata (assessment_id, name, description, dataset_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM assessment_metadata WHERE assessment_id = ?), ?), ?)
    `).run(
      meta.assessment_id,
      meta.name,
      meta.description || null,
      meta.dataset_version || null,
      meta.assessment_id,
      now,
      now
    );
  }

  public close() {
    this.db.close();
  }
}
