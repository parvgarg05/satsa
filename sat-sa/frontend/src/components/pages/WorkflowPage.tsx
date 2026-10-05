import React, { useState, useRef, useCallback } from 'react';
import {
  Upload, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  ChevronRight, Database, Building2, Activity, FileSearch,
  ArrowRight, Loader2, Info, BarChart2, ShieldCheck
} from 'lucide-react';
import { uploadDataset, uploadExternalDataset, triggerAnalysis, fetchDashboardMetrics, fetchEntities, fetchFindings } from '../../lib/api';
import type { DashboardMetrics, EntitySummary, Finding, ExternalDatasetSummary } from '../../types/api';

// ─── Types ───────────────────────────────────────────────────────────────────

type WorkflowStep =
  | 'idle'
  | 'uploading'
  | 'upload_error'
  | 'upload_success'
  | 'analyzing'
  | 'analysis_error'
  | 'analysis_success'
  | 'backend_unavailable';

interface UploadResult {
  message: string;
  rows_received: Record<string, number>;
  rows_accepted: Record<string, number> | { total: number };
  rows_rejected: Record<string, number>;
  validation_errors: Array<{ field?: string; table?: string; message: string; row?: number }>;
  database_counts: Record<string, number>;
  analysis?: {
    timestamp: string;
    total_findings: number;
    total_entities_scored: number;
  };
}

interface AnalysisResult {
  entities_analyzed: number;
  findings_generated: number;
  high_risk_entities: number;
  critical_entities: number;
  module_counts: Record<string, number>;
  analysis_timestamp: string;
  dataset_version: string;
  duration_ms: number;
}

interface WorkflowPageProps {
  onNavigateToDashboard: () => void;
  onNavigateToEntities: () => void;
  onNavigateToFindings: () => void;
  onSelectEntity: (entityId: string) => void;
  activeAssessment?: import('../../types/api').AssessmentInfo | null;
  onAssessmentChanged?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sumCounts(counts: Record<string, number> | { total: number } | undefined): number {
  if (!counts) return 0;
  if ('total' in counts) return (counts as { total: number }).total;
  return Object.values(counts as Record<string, number>).reduce((a, b) => a + b, 0);
}

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n !== 1 ? 's' : ''}`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StepBadge({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  if (done) return (
    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-transparent border border-emerald-500 flex items-center justify-center">
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
    </span>
  );
  return (
    <span className={`flex-shrink-0 w-6 h-6 rounded-full border flex items-center justify-center text-[11px] font-mono font-semibold transition-colors ${
      active
        ? 'border-app-accent text-app-accent'
        : 'border-app-borderDivider text-app-muted'
    }`}>
      {n}
    </span>
  );
}

function ValidationErrors({ errors }: { errors: UploadResult['validation_errors'] }) {
  if (!errors || errors.length === 0) return null;
  return (
    <div className="mt-3 bg-red-500/5 border border-red-500/20 rounded-md p-3 space-y-1.5 max-h-48 overflow-y-auto">
      <div className="flex items-center space-x-1.5 text-xs font-medium text-red-400 mb-2">
        <XCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{errors.length} validation error{errors.length !== 1 ? 's' : ''}</span>
      </div>
      {errors.map((e, i) => (
        <div key={i} className="text-[11px] text-red-300 font-mono flex items-start space-x-2">
          <span className="text-red-500 shrink-0">
            [{e.table ?? e.field ?? 'row'}{e.row != null ? ` #${e.row}` : ''}]
          </span>
          <span>{e.message}</span>
        </div>
      ))}
    </div>
  );
}

function RecordTable({ label, counts }: { label: string; counts: Record<string, number> | { total: number } | undefined }) {
  if (!counts) return null;
  const entries = 'total' in (counts as any)
    ? [['total', (counts as any).total]]
    : Object.entries(counts as Record<string, number>).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] text-app-muted uppercase tracking-wider mb-1">{label}</div>
      <div className="flex flex-wrap gap-2">
        {entries.map(([key, val]) => (
          <span key={key} className="text-xs font-mono px-2 py-1 rounded bg-transparent border border-app-borderDivider text-app-text">
            {key}: <strong className="font-semibold">{Number(val).toLocaleString()}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function WorkflowPage({
  onNavigateToDashboard,
  onNavigateToEntities,
  onNavigateToFindings,
  onSelectEntity,
  activeAssessment,
  onAssessmentChanged
}: WorkflowPageProps) {
  const [step, setStep] = useState<WorkflowStep>('idle');
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [topEntities, setTopEntities] = useState<EntitySummary[]>([]);
  const [topFindings, setTopFindings] = useState<Finding[]>([]);
  const [dashMetrics, setDashMetrics] = useState<DashboardMetrics | null>(null);
  const [externalDataset, setExternalDataset] = useState<ExternalDatasetSummary | null>(null);
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [createNewAssessment, setCreateNewAssessment] = useState(true);
  const [assessmentName, setAssessmentName] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const externalFileRef = useRef<HTMLInputElement | null>(null);

  // ── Upload handler ───────────────────────────────────────────────────────
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setSelectedFileName(files.length === 1 ? files[0].name : `${files.length} files (${files.map(f => f.name).join(', ')})`);
    setStep('uploading');
    setUploadResult(null);
    setUploadError(null);
    setAnalysisResult(null);

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }
      if (createNewAssessment) {
        formData.append('new_assessment', 'true');
        const defaultName = assessmentName.trim() || `Assessment ${new Date().toISOString().slice(0, 10)}`;
        formData.append('assessment_name', defaultName);
      }
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setUploadResult(data);
        setUploadError(data.message || 'Upload validation failed');
        setStep('upload_error');
      } else {
        setUploadResult(data);
        setStep('upload_success');
        if (onAssessmentChanged) {
          onAssessmentChanged();
        }
      }
    } catch (err: any) {
      if (err.message?.includes('fetch') || err.message?.includes('network') || err.name === 'TypeError') {
        setStep('backend_unavailable');
      } else {
        setUploadError(err.message || 'Upload failed');
        setStep('upload_error');
      }
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [createNewAssessment, assessmentName, onAssessmentChanged]);

  const handleExternalFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExternalLoading(true);
    setExternalError(null);
    try {
      setExternalDataset(await uploadExternalDataset(file));
    } catch (err: any) {
      setExternalError(err.message || 'External dataset ingestion failed');
    } finally {
      setExternalLoading(false);
      if (externalFileRef.current) externalFileRef.current.value = '';
    }
  }, []);

  // ── Analysis handler ─────────────────────────────────────────────────────
  const handleRunAnalysis = useCallback(async () => {
    setStep('analyzing');
    setAnalysisError(null);
    try {
      const res = await triggerAnalysis();
      setAnalysisResult(res as unknown as AnalysisResult);
      setStep('analysis_success');

      // Fetch enriched data for results view
      try {
        const [metrics, entitiesRes, findingsRes] = await Promise.all([
          fetchDashboardMetrics().catch(() => null),
          fetchEntities({ sort: 'risk_score', order: 'desc' }).catch(() => ({ entities: [] } as any)),
          fetchFindings({ severity: 'CRITICAL' }).catch(() => ({ findings: [] } as any)),
        ]);
        setDashMetrics(metrics);
        setTopEntities(entitiesRes.entities.slice(0, 5));
        setTopFindings(findingsRes.findings.slice(0, 5));
      } catch {
        // Non-fatal — dashboard data enrichment only
      }
    } catch (err: any) {
      if (err.message?.includes('fetch') || err.name === 'TypeError') {
        setStep('backend_unavailable');
      } else {
        setAnalysisError(err.message || 'Analysis pipeline failed');
        setStep('analysis_error');
      }
    }
  }, []);

  // ── Reset ────────────────────────────────────────────────────────────────
  const handleReset = () => {
    setStep('idle');
    setUploadResult(null);
    setUploadError(null);
    setAnalysisResult(null);
    setAnalysisError(null);
    setTopEntities([]);
    setTopFindings([]);
    setDashMetrics(null);
    setSelectedFileName(null);
  };

  // ── Progress derivations ─────────────────────────────────────────────────
  const isStep1Done = step !== 'idle' && step !== 'uploading';
  const isStep2Done = step === 'upload_success' || step === 'analyzing' || step === 'analysis_error' || step === 'analysis_success';
  const isStep3Done = step === 'analyzing' || step === 'analysis_error' || step === 'analysis_success';
  const isStep4Done = step === 'analysis_success';

  const RISK_COLORS: Record<string, string> = {
    CRITICAL: '#B85C5C',
    HIGH: '#C8794A',
    MEDIUM: '#C19A4A',
    LOW: '#5FAF83',
  };

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="border-b border-app-borderDivider pb-4">
        <h1 className="text-lg font-semibold text-app-text tracking-tight">Analysis Workflow</h1>
        <p className="text-xs text-app-secondary mt-1">
          Upload your dataset, validate records, run the analytics pipeline, and inspect findings —
          end-to-end in four guided steps.
        </p>
      </div>

      {/* ── STEP PROGRESS RAIL ── */}
      <div className="bg-app-surface rounded-md p-4">
        <div className="flex items-start gap-3 sm:gap-6 flex-wrap">
          {[
            { n: 1, label: 'Upload dataset', done: isStep1Done, active: step === 'idle' || step === 'uploading' || step === 'upload_error' },
            { n: 2, label: 'Validate & confirm', done: isStep2Done, active: step === 'upload_success' },
            { n: 3, label: 'Run pipeline', done: isStep3Done, active: step === 'analyzing' || step === 'analysis_error' },
            { n: 4, label: 'Review results', done: isStep4Done, active: step === 'analysis_success' },
          ].map((s, i, arr) => (
            <React.Fragment key={s.n}>
              <div className="flex items-center space-x-2">
                <StepBadge n={s.n} active={s.active} done={s.done} />
                <span className={`text-xs font-medium ${s.active ? 'text-app-text' : s.done ? 'text-emerald-500' : 'text-app-muted'}`}>
                  {s.label}
                </span>
              </div>
              {i < arr.length - 1 && (
                <ChevronRight className="w-4 h-4 text-app-muted hidden sm:block mt-0.5" />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          STEP 1 — UPLOAD
         ══════════════════════════════════════════════════════════════════════ */}

      {/* Backend Unavailable */}
      {step === 'backend_unavailable' && (
        <div className="bg-app-surface rounded-md p-6 border border-red-500/20">
          <div className="flex items-start space-x-3">
            <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-app-heading">Backend Unavailable</h2>
              <p className="text-xs text-app-secondary mt-1 leading-relaxed">
                Could not reach the SAT-SA backend at <code className="font-mono text-app-text">localhost:4000</code>.
                Ensure the Node.js server is running (<code className="font-mono">npm start</code> in the <code className="font-mono">backend/</code> directory).
              </p>
              <button
                onClick={handleReset}
                className="mt-3 inline-flex items-center px-3 py-1.5 bg-transparent hover:bg-app-surface2 border border-app-borderBtn text-xs font-medium text-app-text rounded transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Idle — Upload prompt */}
      {step === 'idle' && (
        <div className="bg-app-surface rounded-md">
          <div className="p-5 border-b border-app-borderDivider">
            <div className="flex items-center space-x-2">
              <Upload className="w-4 h-4 text-app-muted" />
              <h2 className="text-sm font-semibold text-app-heading">Step 1 — Upload Dataset</h2>

              {/* Accepted format Info Popover */}
              <div className="relative group inline-flex items-center">
                <button
                  type="button"
                  aria-label="Accepted format information"
                  className="p-1 rounded-full text-app-muted hover:text-app-accent hover:bg-app-surface2 transition-colors cursor-pointer focus:outline-none"
                  title="Accepted format"
                >
                  <Info className="w-4 h-4 text-app-accent" />
                </button>

                {/* Hover Tooltip / Popover */}
                <div className="hidden group-hover:block absolute left-0 top-full pt-1.5 z-50 w-80 sm:w-96 pointer-events-auto">
                  <div className="bg-app-surface border border-app-borderDivider rounded-lg p-4 shadow-xl text-xs text-app-secondary space-y-1.5 font-normal">
                    <div className="flex items-center space-x-1.5 font-medium text-app-heading mb-1 pb-1 border-b border-app-borderDivider">
                      <Info className="w-3.5 h-3.5 text-app-accent" />
                      <span>Accepted format</span>
                    </div>
                    <p>JSON: <code className="font-mono text-app-text bg-app-surface2 px-1 py-0.5 rounded">dataset.json</code> containing entities, assets, alerts, and cases.</p>
                    <p>CSV: Select all 4 CSV files together so cross-table foreign keys validate properly.</p>
                    <p className="text-app-muted">The representative 20-entity dataset (sat_sa.db) is already pre-loaded. Upload a new one to override it.</p>
                  </div>
                </div>
              </div>
            </div>
            <p className="text-xs text-app-secondary mt-1">
              Upload a JSON or CSV file containing entity, asset, alert, and/or case records.
              The backend validates schema, referential integrity, and value constraints before accepting any data.
            </p>
          </div>

          <div className="p-6">
            {/* Assessment Isolation Selector Box */}
            <div className="mb-4 p-3.5 rounded-lg border border-app-borderDivider bg-app-surface2 text-xs space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-app-heading">Active Assessment:</span>
                  <span className="font-mono text-app-accent px-1.5 py-0.5 rounded bg-app-accent/10 border border-app-accent/20">
                    {activeAssessment?.name || activeAssessment?.assessment_id || 'Baseline Assessment'}
                  </span>
                </div>
                <span className="text-[11px] text-app-muted hidden sm:inline">Isolation Mode</span>
              </div>

              <div className="pt-2 border-t border-app-borderDivider/50 flex flex-col space-y-2">
                <label className="flex items-center space-x-2 cursor-pointer text-app-text select-none font-medium">
                  <input
                    type="checkbox"
                    checked={createNewAssessment}
                    onChange={(e) => setCreateNewAssessment(e.target.checked)}
                    className="rounded border-app-borderBtn text-app-accent focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                  />
                  <span>Create New Assessment Period for this upload (Recommended)</span>
                </label>

                {createNewAssessment ? (
                  <div className="pl-5.5 space-y-1">
                    <input
                      type="text"
                      value={assessmentName}
                      onChange={(e) => setAssessmentName(e.target.value)}
                      placeholder={`e.g. Supervisory Audit - ${new Date().toISOString().slice(0, 10)}`}
                      className="w-full sm:w-80 px-2.5 py-1.5 rounded bg-app-surface border border-app-borderBtn text-xs text-app-text placeholder-app-muted focus:outline-none focus:border-app-accent"
                    />
                    <p className="text-[11px] text-app-muted">
                      Assigns a new Assessment ID. All records, findings, and metrics will be strictly isolated from prior assessments.
                    </p>
                  </div>
                ) : (
                  <p className="pl-5.5 text-[11px] text-amber-500/90">
                    Uploading without a new assessment will replace or append data within the current active assessment.
                  </p>
                )}
              </div>
            </div>

            <div
              className="border-2 border-dashed border-app-borderDivider rounded-lg p-10 text-center cursor-pointer hover:border-app-accent hover:bg-app-surface2 transition-colors"
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
            >
              <Upload className="w-8 h-8 text-app-muted mx-auto mb-3" />
              <p className="text-sm font-medium text-app-text mb-1">Click to select dataset file(s)</p>
              <p className="text-xs text-app-muted">Upload dataset.json OR select all 4 CSVs together (entities, assets, alerts, cases)</p>
            </div>

            <input
              type="file"
              ref={fileRef}
              accept=".json,.csv"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </div>
      )}

      <div className="bg-app-surface rounded-md border border-app-borderDivider">
        <div className="p-5 border-b border-app-borderDivider">
          <h2 className="text-sm font-semibold text-app-heading flex items-center space-x-2">
            <Database className="w-4 h-4 text-app-muted" />
            <span>External cybersecurity event dataset</span>
          </h2>
          <p className="text-xs text-amber-400 mt-1">External cybersecurity event dataset — not CSE supervisory data.</p>
          <p className="text-xs text-app-secondary mt-1">
            Stage the four raw redteam fields separately. This does not populate CSE entities, assets, alerts, cases, or risk scores.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <input
            type="file"
            ref={externalFileRef}
            accept=".txt,.gz"
            className="hidden"
            onChange={handleExternalFileChange}
          />
          <button
            onClick={() => externalFileRef.current?.click()}
            disabled={externalLoading}
            className="inline-flex items-center px-3.5 py-2 bg-transparent hover:bg-app-surface2 border border-app-borderBtn text-xs font-medium text-app-text rounded transition-colors disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            {externalLoading ? 'Staging external dataset…' : 'Stage redteam dataset'}
          </button>
          {externalError && <p className="text-xs text-red-400">{externalError}</p>}
          {externalDataset && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {[
                ['Source', externalDataset.source],
                ['Dataset ID', externalDataset.dataset_id],
                ['Records', externalDataset.record_count.toLocaleString()],
                ['Duplicate rows', externalDataset.duplicate_count.toLocaleString()],
                ['Ingested', externalDataset.ingestion_timestamp],
                ['Schema', externalDataset.schema],
                ['Source SHA-256', externalDataset.source_sha256],
                ['Provenance', JSON.stringify(externalDataset.provenance)],
              ].map(([label, value]) => (
                <div key={label} className="p-2.5 bg-app-surface2 rounded border border-app-borderDivider">
                  <span className="text-app-muted block text-[11px]">{label}</span>
                  <span className="font-mono text-app-text break-all">{value}</span>
                </div>
              ))}
              <div className="sm:col-span-2 p-2.5 bg-amber-500/5 rounded border border-amber-500/20 text-amber-300">
                Supervisory modules: required source fields are unavailable. This dataset remains isolated from CSE analytics.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Uploading — spinner */}
      {step === 'uploading' && (
        <div className="bg-app-surface rounded-md p-8 flex flex-col items-center justify-center text-center">
          <Loader2 className="w-7 h-7 text-app-muted animate-spin mb-3" />
          <p className="text-sm font-medium text-app-text">Uploading and validating…</p>
          <p className="text-xs text-app-muted mt-1">
            Checking <code className="font-mono">{selectedFileName}</code> against database schema and referential integrity constraints
          </p>
        </div>
      )}

      {/* Upload Error */}
      {step === 'upload_error' && (
        <div className="bg-app-surface rounded-md border border-red-500/20">
          <div className="p-5 border-b border-app-borderDivider">
            <div className="flex items-center space-x-2">
              <XCircle className="w-4 h-4 text-red-400" />
              <h2 className="text-sm font-semibold text-app-heading">Upload Rejected</h2>
            </div>
            <p className="text-xs text-app-secondary mt-1">
              <code className="font-mono text-app-text">{selectedFileName}</code> was rejected during validation. No data was written to the database.
            </p>
          </div>

          <div className="p-5 space-y-4">
            {uploadResult && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  <div className="p-3 bg-app-surface2 rounded border border-app-borderDivider text-center">
                    <span className="text-app-muted block text-[11px]">Rows received</span>
                    <span className="font-mono font-semibold text-app-text text-lg">{sumCounts(uploadResult.rows_received)}</span>
                  </div>
                  <div className="p-3 bg-app-surface2 rounded border border-app-borderDivider text-center">
                    <span className="text-app-muted block text-[11px]">Rows accepted</span>
                    <span className="font-mono font-semibold text-emerald-500 text-lg">{sumCounts(uploadResult.rows_accepted)}</span>
                  </div>
                  <div className="p-3 bg-app-surface2 rounded border border-red-500/30 text-center">
                    <span className="text-app-muted block text-[11px]">Rows rejected</span>
                    <span className="font-mono font-semibold text-red-400 text-lg">{sumCounts(uploadResult.rows_rejected)}</span>
                  </div>
                </div>
                <ValidationErrors errors={uploadResult.validation_errors} />
              </>
            )}
            {!uploadResult && uploadError && (
              <p className="text-xs text-red-400">{uploadError}</p>
            )}

            <div className="flex items-center space-x-3 pt-2">
              <button
                onClick={handleReset}
                className="inline-flex items-center px-3.5 py-2 bg-transparent hover:bg-app-surface2 border border-app-borderBtn text-xs font-medium text-app-text rounded transition-colors"
              >
                <Upload className="w-3.5 h-3.5 mr-1.5" />
                Upload a different file
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          STEP 2 — VALIDATE & CONFIRM
         ══════════════════════════════════════════════════════════════════════ */}

      {step === 'upload_success' && uploadResult && (
        <div className="bg-app-surface rounded-md">
          <div className="p-5 border-b border-app-borderDivider">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <h2 className="text-sm font-semibold text-app-heading">Step 2 — Dataset Validated</h2>
            </div>
            <p className="text-xs text-app-secondary mt-1">
              <code className="font-mono text-app-text">{selectedFileName}</code> passed validation.
              Review the accepted record counts below, then run the analytics pipeline.
            </p>
          </div>

          <div className="p-5 space-y-4">
            {/* Record counts */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {[
                { label: 'Received', value: sumCounts(uploadResult.rows_received), color: 'text-app-text' },
                { label: 'Accepted', value: sumCounts(uploadResult.rows_accepted), color: 'text-emerald-500' },
                { label: 'Rejected', value: sumCounts(uploadResult.rows_rejected), color: 'text-red-400' },
                { label: 'Validation errors', value: uploadResult.validation_errors?.length ?? 0, color: uploadResult.validation_errors?.length > 0 ? 'text-yellow-400' : 'text-app-muted' },
              ].map(({ label, value, color }) => (
                <div key={label} className="p-3 bg-app-surface2 rounded border border-app-borderDivider text-center">
                  <span className="text-app-muted block text-[11px]">{label}</span>
                  <span className={`font-mono font-semibold text-lg ${color}`}>{value.toLocaleString()}</span>
                </div>
              ))}
            </div>

            {/* Per-table breakdown */}
            <div className="space-y-3 text-xs">
              <RecordTable label="Accepted by table" counts={uploadResult.rows_accepted} />
              {sumCounts(uploadResult.rows_rejected) > 0 && (
                <RecordTable label="Rejected by table" counts={uploadResult.rows_rejected} />
              )}
            </div>

            {/* Database counts */}
            {uploadResult.database_counts && Object.keys(uploadResult.database_counts).length > 0 && (
              <div className="text-xs">
                <div className="text-[11px] text-app-muted uppercase tracking-wider mb-1">Database totals after ingestion</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(uploadResult.database_counts).map(([k, v]) => (
                    <span key={k} className="font-mono px-2 py-1 rounded bg-transparent border border-app-borderDivider text-app-text">
                      {k}: <strong>{Number(v).toLocaleString()}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Non-fatal warnings */}
            {uploadResult.validation_errors?.length > 0 && (
              <ValidationErrors errors={uploadResult.validation_errors} />
            )}

            {/* Empty dataset guard */}
            {sumCounts(uploadResult.rows_accepted) === 0 ? (
              <div className="p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-md flex items-start space-x-3">
                <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-yellow-300">Empty dataset</p>
                  <p className="text-xs text-app-secondary mt-0.5">
                    No rows were accepted. The pipeline will run against the existing database contents.
                    Upload a file with valid entity and alert data to see new analytical results.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="flex items-center space-x-3 pt-2 border-t border-app-borderDivider">
              <button
                onClick={handleReset}
                className="text-xs text-app-muted hover:text-app-text transition-colors"
              >
                Upload different file
              </button>
              <button
                onClick={handleRunAnalysis}
                className="inline-flex items-center px-4 py-2 bg-app-text text-app-bg hover:opacity-90 text-xs font-semibold rounded transition-opacity"
              >
                <Activity className="w-3.5 h-3.5 mr-1.5" />
                Run analytics pipeline
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          STEP 3 — ANALYZING
         ══════════════════════════════════════════════════════════════════════ */}

      {step === 'analyzing' && (
        <div className="bg-app-surface rounded-md p-8 flex flex-col items-center justify-center text-center">
          <Loader2 className="w-7 h-7 text-app-muted animate-spin mb-3" />
          <p className="text-sm font-medium text-app-text">Running analytics pipeline…</p>
          <p className="text-xs text-app-muted mt-2 max-w-sm">
            Executing all five detection modules in sequence:
            Execution Gap → Negative Space → Isolation Forest → Peer Comparison → Repeated Incidents.
            Then computing deterministic risk scores.
          </p>
          <div className="mt-4 grid grid-cols-5 gap-1.5 text-[10px] text-app-muted">
            {['Execution Gap', 'Negative Space', 'Anomaly', 'Peer', 'Repeated'].map(m => (
              <span key={m} className="px-2 py-1 rounded bg-app-surface2 border border-app-borderDivider animate-pulse">
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Analysis Error */}
      {step === 'analysis_error' && (
        <div className="bg-app-surface rounded-md border border-red-500/20">
          <div className="p-5 border-b border-app-borderDivider">
            <div className="flex items-center space-x-2">
              <XCircle className="w-4 h-4 text-red-400" />
              <h2 className="text-sm font-semibold text-app-heading">Pipeline Execution Failed</h2>
            </div>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-xs text-red-400 font-mono">{analysisError}</p>
            <p className="text-xs text-app-secondary">
              Check that the Python analytics engine is installed and the SQLite database is accessible.
              Run <code className="font-mono text-app-text">pip install -r analytics/requirements.txt</code> to install dependencies.
            </p>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleRunAnalysis}
                className="inline-flex items-center px-3.5 py-2 bg-transparent hover:bg-app-surface2 border border-app-borderBtn text-xs font-medium text-app-text rounded transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry pipeline
              </button>
              <button onClick={handleReset} className="text-xs text-app-muted hover:text-app-text transition-colors">
                Start over
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          STEP 4 — RESULTS SUMMARY
         ══════════════════════════════════════════════════════════════════════ */}

      {step === 'analysis_success' && analysisResult && (
        <>
          {/* Summary card */}
          <div className="bg-app-surface rounded-md">
            <div className="p-5 border-b border-app-borderDivider">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <h2 className="text-sm font-semibold text-app-heading">Step 4 — Analysis Complete</h2>
                <span className="text-[11px] text-app-muted font-mono ml-auto">
                  {analysisResult.duration_ms != null ? `${(analysisResult.duration_ms / 1000).toFixed(2)}s` : ''}
                  {' · '}{analysisResult.dataset_version}
                </span>
              </div>
              <p className="text-xs text-app-secondary mt-1">
                All five detection modules ran successfully. Risk scores were recalculated for every entity.
              </p>
            </div>

            <div className="p-5 space-y-4">
              {/* Key metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {[
                  { label: 'Entities analyzed', value: analysisResult.entities_analyzed },
                  { label: 'Findings generated', value: analysisResult.findings_generated },
                  { label: 'High-risk entities', value: analysisResult.high_risk_entities, warn: true },
                  { label: 'Critical entities', value: analysisResult.critical_entities, danger: true },
                ].map(({ label, value, warn, danger }) => (
                  <div key={label} className="p-3 bg-app-surface2 rounded border border-app-borderDivider text-center">
                    <span className="text-app-muted block text-[11px]">{label}</span>
                    <span className={`font-mono font-semibold text-xl block mt-0.5 ${
                      danger ? 'text-red-400' : warn ? 'text-yellow-400' : 'text-app-text'
                    }`}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Module counts */}
              <div>
                <div className="text-[11px] text-app-muted uppercase tracking-wider mb-2">Findings by detection module</div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {Object.entries(analysisResult.module_counts).map(([mod, count]) => (
                    <span key={mod} className="font-mono px-2.5 py-1.5 rounded bg-transparent border border-app-borderDivider text-app-text">
                      {mod.replace('_', ' ')}: <strong>{count}</strong>
                    </span>
                  ))}
                </div>
              </div>

              {/* Dashboard metrics strip if available */}
              {dashMetrics && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-2 border-t border-app-borderDivider">
                  {[
                    { label: 'Total alerts', value: dashMetrics.useful_aggregate_metrics?.total_alerts?.toLocaleString() ?? '—' },
                    { label: 'Total cases', value: dashMetrics.useful_aggregate_metrics?.total_cases?.toLocaleString() ?? '—' },
                    { label: 'Avg risk score', value: dashMetrics.useful_aggregate_metrics?.average_risk_score?.toFixed(1) ?? '—' },
                    { label: 'Telemetry coverage', value: dashMetrics.useful_aggregate_metrics?.telemetry_coverage_pct != null ? `${dashMetrics.useful_aggregate_metrics.telemetry_coverage_pct.toFixed(1)}%` : '—' },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-2 bg-app-surface2 rounded border border-app-borderDivider text-center">
                      <span className="text-app-muted block text-[11px]">{label}</span>
                      <span className="font-mono font-medium text-app-text">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Top high-risk entities */}
          {topEntities.length > 0 && (
            <div className="bg-app-surface rounded-md">
              <div className="p-4 border-b border-app-borderDivider flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Building2 className="w-4 h-4 text-app-muted" />
                  <h3 className="text-xs font-medium text-app-heading uppercase tracking-wider">
                    Top {topEntities.length} Entities by Risk Score
                  </h3>
                </div>
                <button
                  onClick={onNavigateToEntities}
                  className="text-xs text-app-secondary hover:text-app-text flex items-center transition-colors"
                >
                  View all <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                </button>
              </div>
              <div className="divide-y divide-app-borderDivider">
                {topEntities.map(ent => (
                  <div
                    key={ent.entity_id}
                    className="px-4 py-3 flex items-center justify-between hover:bg-app-surface2 transition-colors cursor-pointer"
                    onClick={() => onSelectEntity(ent.entity_id)}
                  >
                    <div>
                      <span
                        className="text-xs font-medium"
                        style={{ color: RISK_COLORS[ent.risk_level] || 'var(--text-primary)' }}
                      >
                        {ent.risk_level}
                      </span>
                      <span className="text-xs text-app-text font-mono ml-2">{ent.entity_id}</span>
                      <span className="text-xs text-app-muted ml-2">{ent.entity_name}</span>
                    </div>
                    <div className="flex items-center space-x-3 text-xs">
                      <span className="font-mono text-app-text font-semibold">{ent.risk_score.toFixed(1)}</span>
                      <span className="text-app-muted">{plural(ent.finding_count, 'finding')}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-app-muted" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top critical findings */}
          {topFindings.length > 0 && (
            <div className="bg-app-surface rounded-md">
              <div className="p-4 border-b border-app-borderDivider flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-app-muted" />
                  <h3 className="text-xs font-medium text-app-heading uppercase tracking-wider">
                    Critical Supervisory Signals
                  </h3>
                </div>
                <button
                  onClick={onNavigateToFindings}
                  className="text-xs text-app-secondary hover:text-app-text flex items-center transition-colors"
                >
                  View all <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                </button>
              </div>
              <div className="divide-y divide-app-borderDivider">
                {topFindings.map(f => (
                  <div key={f.finding_id} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-medium" style={{ color: RISK_COLORS[f.severity] }}>
                        {f.severity}
                      </span>
                      <span className="text-[11px] font-mono text-app-muted">{f.finding_id}</span>
                    </div>
                    <p className="text-xs text-app-text">{f.title}</p>
                    <p className="text-[11px] text-app-secondary mt-0.5">{f.rationale.slice(0, 120)}…</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No findings guard */}
          {analysisResult.findings_generated === 0 && (
            <div className="bg-app-surface rounded-md p-6 flex items-start space-x-3 border border-app-borderDivider">
              <Info className="w-4 h-4 text-app-muted shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-app-text">No findings generated</p>
                <p className="text-xs text-app-secondary mt-0.5 leading-relaxed">
                  The analytics pipeline ran successfully but detected no supervisory signals.
                  This may indicate that the uploaded dataset does not contain any entities with measurable
                  operational anomalies, or that the dataset is too small for the detection thresholds to trigger.
                </p>
              </div>
            </div>
          )}

          {/* Navigation actions */}
          <div className="bg-app-surface rounded-md p-4">
            <div className="flex items-center space-x-1.5 text-xs font-medium text-app-heading uppercase tracking-wider mb-3">
              <BarChart2 className="w-3.5 h-3.5 text-app-muted" />
              <span>Continue to</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={onNavigateToDashboard}
                className="inline-flex items-center px-4 py-2 bg-app-text text-app-bg hover:opacity-90 text-xs font-semibold rounded transition-opacity"
              >
                <BarChart2 className="w-3.5 h-3.5 mr-1.5" />
                Open Dashboard
                <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
              </button>
              <button
                onClick={onNavigateToEntities}
                className="inline-flex items-center px-4 py-2 bg-transparent hover:bg-app-surface2 border border-app-borderBtn text-xs font-medium text-app-text rounded transition-colors"
              >
                <Building2 className="w-3.5 h-3.5 mr-1.5 text-app-muted" />
                Browse Entities
              </button>
              <button
                onClick={onNavigateToFindings}
                className="inline-flex items-center px-4 py-2 bg-transparent hover:bg-app-surface2 border border-app-borderBtn text-xs font-medium text-app-text rounded transition-colors"
              >
                <FileSearch className="w-3.5 h-3.5 mr-1.5 text-app-muted" />
                Supervisory Signals
              </button>
              <button
                onClick={handleReset}
                className="text-xs text-app-muted hover:text-app-text transition-colors px-3 py-2"
              >
                Upload another dataset
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Quick Re-run (bypass upload for already-loaded data) ── */}
      {step === 'idle' && (
        <div className="bg-app-surface rounded-md p-4 border border-app-borderDivider">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-app-text">Run pipeline on existing database</p>
              <p className="text-xs text-app-muted mt-0.5">
                The representative 20-entity dataset is already loaded. Click to run analysis without uploading.
              </p>
            </div>
            <button
              onClick={async () => {
                setStep('analyzing');
                setAnalysisError(null);
                try {
                  const res = await triggerAnalysis();
                  setAnalysisResult(res as unknown as AnalysisResult);
                  setStep('analysis_success');
                  try {
                    const [metrics, entitiesRes, findingsRes] = await Promise.all([
                      fetchDashboardMetrics().catch(() => null),
                      fetchEntities({ sort: 'risk_score', order: 'desc' }).catch(() => ({ entities: [] } as any)),
                      fetchFindings({ severity: 'CRITICAL' }).catch(() => ({ findings: [] } as any)),
                    ]);
                    setDashMetrics(metrics);
                    setTopEntities(entitiesRes.entities.slice(0, 5));
                    setTopFindings(findingsRes.findings.slice(0, 5));
                  } catch {}
                } catch (err: any) {
                  if (err.message?.includes('fetch') || err.name === 'TypeError') {
                    setStep('backend_unavailable');
                  } else {
                    setAnalysisError(err.message || 'Analysis pipeline failed');
                    setStep('analysis_error');
                  }
                }
              }}
              className="inline-flex items-center px-3.5 py-2 bg-transparent hover:bg-app-surface2 border border-app-borderBtn text-xs font-medium text-app-text rounded transition-colors shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-app-muted" />
              Re-run analysis
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
