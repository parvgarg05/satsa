import path from 'node:path';
import fs from 'node:fs';
import * as crypto from 'crypto';
import { DatabaseService } from './db.js';
import { AnalyticsService } from './analytics.service.js';

export interface AssessmentRecord {
  assessment_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  db_path: string;
  cache_path: string;
  dataset_version?: string;
  status: 'READY' | 'ANALYZING' | 'ERROR';
}

export interface AssessmentInfo extends AssessmentRecord {
  is_active: boolean;
  counts: {
    entities: number;
    assets: number;
    alerts: number;
    cases: number;
  };
  total_findings: number;
}

interface RegistryFile {
  active_id: string;
  assessments: Record<string, AssessmentRecord>;
}

export class AssessmentService {
  private assessmentsDir: string;
  private registryPath: string;
  private defaultDbPath: string;
  private activeId: string = 'ASM-DEFAULT';
  private assessments: Map<string, AssessmentRecord> = new Map();
  private dbInstances: Map<string, DatabaseService> = new Map();
  private analyticsInstances: Map<string, AnalyticsService> = new Map();

  constructor(defaultDbPath?: string, assessmentsDir?: string) {
    this.defaultDbPath = defaultDbPath || path.resolve(process.cwd(), 'sat_sa.db');
    this.assessmentsDir = assessmentsDir || path.resolve(path.dirname(this.defaultDbPath), 'assessments');
    this.registryPath = path.resolve(this.assessmentsDir, 'registry.json');
    this.init();
  }

  private init() {
    if (!fs.existsSync(this.assessmentsDir)) {
      fs.mkdirSync(this.assessmentsDir, { recursive: true });
    }

    if (fs.existsSync(this.registryPath)) {
      try {
        const raw = fs.readFileSync(this.registryPath, 'utf-8');
        const parsed = JSON.parse(raw) as RegistryFile;
        this.activeId = parsed.active_id || 'ASM-DEFAULT';
        for (const [id, rec] of Object.entries(parsed.assessments || {})) {
          this.assessments.set(id, rec);
        }
      } catch (err) {
        console.warn('[AssessmentService] Warning reading registry.json, reinitializing default:', err);
      }
    }

    // Ensure default baseline assessment exists
    if (!this.assessments.has('ASM-DEFAULT')) {
      const defaultRec: AssessmentRecord = {
        assessment_id: 'ASM-DEFAULT',
        name: 'Baseline Assessment',
        description: 'Default baseline supervisory assessment',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        db_path: this.defaultDbPath,
        cache_path: path.resolve(path.dirname(this.defaultDbPath), 'analytics_cache.json'),
        status: 'READY'
      };
      this.assessments.set('ASM-DEFAULT', defaultRec);
      if (!this.activeId || !this.assessments.has(this.activeId)) {
        this.activeId = 'ASM-DEFAULT';
      }
      this.persistRegistry();
    }

    // Seed metadata in default DB if connected
    try {
      const defaultDb = this.getDbForAssessment('ASM-DEFAULT');
      if (!defaultDb.getAssessmentMetadata()) {
        defaultDb.setAssessmentMetadata({
          assessment_id: 'ASM-DEFAULT',
          name: 'Baseline Assessment',
          description: 'Default baseline supervisory assessment'
        });
      }
    } catch {
      // ignore
    }
  }

  private persistRegistry() {
    try {
      const data: RegistryFile = {
        active_id: this.activeId,
        assessments: Object.fromEntries(this.assessments.entries())
      };
      fs.writeFileSync(this.registryPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[AssessmentService] Error persisting registry:', err);
    }
  }

  public getActiveAssessmentId(): string {
    return this.activeId;
  }

  public getActiveAssessment(): AssessmentInfo {
    const info = this.getAssessment(this.activeId);
    if (!info) {
      // Fallback to ASM-DEFAULT
      this.activeId = 'ASM-DEFAULT';
      return this.getAssessment('ASM-DEFAULT')!;
    }
    return info;
  }

  public getAssessment(assessmentId: string): AssessmentInfo | null {
    const rec = this.assessments.get(assessmentId);
    if (!rec) return null;

    let counts = { entities: 0, assets: 0, alerts: 0, cases: 0 };
    let totalFindings = 0;
    let datasetVer = rec.dataset_version || 'v0.0.0.0';

    try {
      const db = this.getDbForAssessment(assessmentId);
      counts = db.getCounts();
      datasetVer = `v${counts.entities}.${counts.assets}.${counts.alerts}.${counts.cases}`;

      const rawDb = db.getRawDb();
      try {
        const findingRow = rawDb.prepare('SELECT COUNT(*) as count FROM supervisory_findings').get() as { count: number };
        totalFindings = findingRow?.count || 0;
      } catch {
        totalFindings = 0;
      }
    } catch {
      // Database might be uninitialized or empty
    }

    return {
      ...rec,
      dataset_version: datasetVer,
      is_active: assessmentId === this.activeId,
      counts,
      total_findings: totalFindings
    };
  }

  public listAssessments(): AssessmentInfo[] {
    const list: AssessmentInfo[] = [];
    for (const id of this.assessments.keys()) {
      const info = this.getAssessment(id);
      if (info) list.push(info);
    }
    // Sort so active is first, then newest to oldest
    return list.sort((a, b) => {
      if (a.is_active) return -1;
      if (b.is_active) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }

  public setActiveAssessment(assessmentId: string): AssessmentInfo {
    if (!this.assessments.has(assessmentId)) {
      throw new Error(`Assessment with ID '${assessmentId}' does not exist.`);
    }
    this.activeId = assessmentId;
    this.persistRegistry();
    return this.getAssessment(assessmentId)!;
  }

  public createAssessment(name: string, description?: string, customId?: string): AssessmentInfo {
    const timestampStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    const assessmentId = customId || `ASM-${timestampStr}-${randSuffix}`;

    if (this.assessments.has(assessmentId)) {
      throw new Error(`Assessment with ID '${assessmentId}' already exists.`);
    }

    const dbPath = path.resolve(this.assessmentsDir, `${assessmentId}.db`);
    const cachePath = path.resolve(this.assessmentsDir, `cache_${assessmentId}.json`);

    // Clean up if existing file was somehow there
    if (fs.existsSync(dbPath)) {
      try { fs.unlinkSync(dbPath); } catch {}
    }
    if (fs.existsSync(cachePath)) {
      try { fs.unlinkSync(cachePath); } catch {}
    }

    const now = new Date().toISOString();
    const record: AssessmentRecord = {
      assessment_id: assessmentId,
      name: name || `Assessment ${new Date().toLocaleDateString()}`,
      description: description || 'Supervisory analytics assessment period',
      created_at: now,
      updated_at: now,
      db_path: dbPath,
      cache_path: cachePath,
      status: 'READY'
    };

    this.assessments.set(assessmentId, record);
    this.activeId = assessmentId;
    this.persistRegistry();

    // Initialize Database for this assessment
    const db = new DatabaseService(dbPath);
    this.dbInstances.set(assessmentId, db);
    db.setAssessmentMetadata({
      assessment_id: assessmentId,
      name: record.name,
      description: record.description
    });

    return this.getAssessment(assessmentId)!;
  }

  public getDbForAssessment(assessmentId?: string): DatabaseService {
    const targetId = assessmentId || this.activeId;
    if (this.dbInstances.has(targetId)) {
      return this.dbInstances.get(targetId)!;
    }

    const rec = this.assessments.get(targetId);
    if (!rec) {
      if (targetId === 'ASM-DEFAULT') {
        const db = new DatabaseService(this.defaultDbPath);
        this.dbInstances.set('ASM-DEFAULT', db);
        return db;
      }
      throw new Error(`Assessment '${targetId}' not found.`);
    }

    const db = new DatabaseService(rec.db_path);
    this.dbInstances.set(targetId, db);
    return db;
  }

  public getAnalyticsForAssessment(assessmentId?: string): AnalyticsService {
    const targetId = assessmentId || this.activeId;
    if (this.analyticsInstances.has(targetId)) {
      return this.analyticsInstances.get(targetId)!;
    }

    const rec = this.assessments.get(targetId);
    const cachePath = rec ? rec.cache_path : path.resolve(path.dirname(this.defaultDbPath), `cache_${targetId}.json`);
    const analytics = AnalyticsService.getInstance(cachePath);
    this.analyticsInstances.set(targetId, analytics);
    return analytics;
  }

  public deleteAssessment(assessmentId: string): boolean {
    if (assessmentId === 'ASM-DEFAULT') {
      throw new Error('The default baseline assessment cannot be deleted.');
    }
    if (assessmentId === this.activeId) {
      throw new Error('Cannot delete the currently active assessment. Switch to another assessment first.');
    }

    const rec = this.assessments.get(assessmentId);
    if (!rec) return false;

    // Close and remove db instance
    if (this.dbInstances.has(assessmentId)) {
      try {
        this.dbInstances.get(assessmentId)!.close();
      } catch {}
      this.dbInstances.delete(assessmentId);
    }
    this.analyticsInstances.delete(assessmentId);

    // Remove files
    if (fs.existsSync(rec.db_path)) {
      try { fs.unlinkSync(rec.db_path); } catch {}
    }
    if (fs.existsSync(rec.cache_path)) {
      try { fs.unlinkSync(rec.cache_path); } catch {}
    }

    this.assessments.delete(assessmentId);
    this.persistRegistry();
    return true;
  }
}
