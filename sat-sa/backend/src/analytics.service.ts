import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { DatabaseService } from './db.js';

const execFileAsync = promisify(execFile);

export interface Finding {
  finding_id: string;
  entity_id: string;
  finding_type: 'EXECUTION_GAP' | 'NEGATIVE_SPACE' | 'ANOMALY' | 'PEER_DEVIATION' | 'REPEATED_INCIDENT' | string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  rationale: string;
  evidence_ids: string[];
  supporting_metrics: Record<string, any>;
}

export interface ComponentScore {
  finding_type: string;
  weight: number;
  weight_pct: string;
  raw_module_score: number;
  weighted_contribution: number;
  finding_count: number;
  top_severity: string;
  finding_summaries: Array<{
    finding_id: string;
    title: string;
    severity: string;
    evidence_count: number;
  }>;
}

export interface EntityRisk {
  entity_id: string;
  entity_name: string;
  sector: string;
  risk_score: number;
  final_risk_score?: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  primary_drivers?: Array<{
    component: string;
    name: string;
    raw_score: number;
    weight: number;
    weighted_contribution: number;
    finding_count: number;
  }>;
  component_scores: Record<string, ComponentScore>;
  component_weighted_contributions?: Record<string, number>;
  component_raw_scores?: Record<string, number>;
  findings: Finding[];
  explanation: {
    entity_id: string;
    entity_name: string;
    risk_score: number;
    risk_level: string;
    score_formula: string;
    module_breakdown: Array<{
      module: string;
      finding_type: string;
      weight_pct: string;
      raw_module_score: number;
      weighted_contribution: number;
      finding_count: number;
      top_severity: string;
      findings: Array<{
        finding_id: string;
        severity: string;
        title: string;
        why: string;
        evidence_ids: string[];
        evidence_count: number;
        key_metrics: Record<string, any>;
      }>;
    }>;
    summary: string;
  };
}

export interface PipelineResult {
  run_timestamp: string;
  db_path: string;
  elapsed_seconds: number;
  total_findings: number;
  module_counts: {
    EXECUTION_GAP: number;
    NEGATIVE_SPACE: number;
    ANOMALY: number;
    PEER_DEVIATION: number;
    REPEATED_INCIDENT: number;
  };
  findings_by_entity: Record<string, Finding[]>;
  findings_by_type: Record<string, Finding[]>;
  all_findings: Finding[];
  entity_risk: Record<string, EntityRisk>;
}

export class AnalyticsService {
  private static instances: Map<string, AnalyticsService> = new Map();
  private cache: PipelineResult | null = null;
  private cacheFilePath: string;

  public constructor(cachePath?: string) {
    this.cacheFilePath = cachePath || path.resolve(process.cwd(), 'analytics_cache.json');
    this.loadCacheFromDisk();
  }

  public static getInstance(cachePath?: string): AnalyticsService {
    const key = cachePath || path.resolve(process.cwd(), 'analytics_cache.json');
    if (!AnalyticsService.instances.has(key)) {
      AnalyticsService.instances.set(key, new AnalyticsService(key));
    }
    return AnalyticsService.instances.get(key)!;
  }

  public getCacheFilePath(): string {
    return this.cacheFilePath;
  }

  private loadCacheFromDisk(): boolean {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as PipelineResult;
        if (parsed.entity_risk && parsed.all_findings) {
          this.cache = parsed;
          return true;
        }
      }
    } catch {
      this.cache = null;
    }
    return false;
  }

  private saveCacheToDisk(data: PipelineResult): void {
    try {
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(data, null, 2), 'utf-8');
      this.cache = data;
    } catch (err) {
      console.error('[AnalyticsService] Warning: Failed to write analytics cache file', err);
      this.cache = data;
    }
  }

  public findPythonExecutable(): string {
    const candidates = [
      process.env.PYTHON_PATH,
      path.resolve(process.cwd(), '../../.venv/Scripts/python.exe'),
      path.resolve(process.cwd(), '../.venv/Scripts/python.exe'),
      path.resolve(process.cwd(), '.venv/Scripts/python.exe'),
      path.resolve(__dirname, '../../../.venv/Scripts/python.exe'),
      'python',
      'python3'
    ].filter(Boolean) as string[];

    for (const p of candidates) {
      if (p === 'python' || p === 'python3') return p;
      if (fs.existsSync(p)) return p;
    }
    return 'python';
  }

  public findPipelineScript(): string {
    const candidates = [
      path.resolve(process.cwd(), '../analytics/pipeline.py'),
      path.resolve(process.cwd(), 'sat-sa/analytics/pipeline.py'),
      path.resolve(__dirname, '../../analytics/pipeline.py'),
      path.resolve(__dirname, '../analytics/pipeline.py')
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    throw new Error(`pipeline.py script not found. Searched in: ${candidates.join(', ')}`);
  }

  public async runAnalysis(dbPath?: string): Promise<PipelineResult> {
    const resolvedDbPath = dbPath || path.resolve(process.cwd(), 'sat_sa.db');
    if (!fs.existsSync(resolvedDbPath)) {
      throw new Error(`Database file not found at ${resolvedDbPath}`);
    }

    const pythonBin = this.findPythonExecutable();
    const scriptPath = this.findPipelineScript();
    const tempOutJson = path.resolve(process.cwd(), `analytics_run_${Date.now()}.json`);

    try {
      await execFileAsync(pythonBin, [
        scriptPath,
        '--db-path', resolvedDbPath,
        '--output-json', tempOutJson
      ]);

      if (!fs.existsSync(tempOutJson)) {
        throw new Error(`Pipeline did not generate output JSON at ${tempOutJson}`);
      }

      const raw = fs.readFileSync(tempOutJson, 'utf-8');
      const result = JSON.parse(raw) as PipelineResult;

      // Clean up temp file
      try {
        fs.unlinkSync(tempOutJson);
      } catch {
        // ignore cleanup error
      }

      this.saveCacheToDisk(result);
      return result;
    } catch (err: any) {
      // Clean up temp file if present
      if (fs.existsSync(tempOutJson)) {
        try { fs.unlinkSync(tempOutJson); } catch {}
      }
      throw new Error(`Analytics pipeline execution failed: ${err.message || String(err)}`);
    }
  }

  public async getOrRunAnalysis(dbPath?: string): Promise<PipelineResult> {
    if (this.cache && this.cache.entity_risk && Object.keys(this.cache.entity_risk).length > 0) {
      return this.cache;
    }
    return this.runAnalysis(dbPath);
  }

  public getCachedResult(): PipelineResult | null {
    return this.cache;
  }

  public clearCache(): void {
    this.cache = null;
    if (fs.existsSync(this.cacheFilePath)) {
      try { fs.unlinkSync(this.cacheFilePath); } catch {}
    }
  }
}
