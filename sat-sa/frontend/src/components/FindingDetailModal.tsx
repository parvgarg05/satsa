import React, { useEffect, useState } from 'react';
import { 
  X, AlertTriangle, Target, EyeOff, Activity, RefreshCw, 
  Database, ChevronRight, Scale, ShieldAlert, Building2
} from 'lucide-react';
import type { Finding } from '../types/api';
import { submitExpertFindingLabel } from '../lib/api';

const RISK_COLORS: Record<string, string> = {
  CRITICAL: '#B85C5C',
  HIGH: '#C8794A',
  MEDIUM: '#C19A4A',
  LOW: '#5FAF83',
};

const MODULE_CONFIG: Record<string, { label: string; weight: string; maxPts: string; icon: any; role: string }> = {
  EXECUTION_GAP: {
    label: 'Execution Gap Detection',
    weight: '30%',
    maxPts: '30.0 pts',
    icon: Target,
    role: 'Triage speed, investigation duration, and escalation suppression gaps'
  },
  NEGATIVE_SPACE: {
    label: 'Negative Space Detection',
    weight: '25%',
    maxPts: '25.0 pts',
    icon: EyeOff,
    role: 'Unmonitored assets, missing telemetry, and orphaned alert gaps'
  },
  ANOMALY: {
    label: 'Statistical Anomaly (Isolation Forest)',
    weight: '20%',
    maxPts: '20.0 pts',
    icon: Activity,
    role: 'Multi-dimensional behavioural divergence from population baselines'
  },
  PEER_DEVIATION: {
    label: 'Cross-Entity Peer Comparison',
    weight: '15%',
    maxPts: '15.0 pts',
    icon: AlertTriangle,
    role: 'Sector-relative statistical variances in escalation and duration'
  },
  REPEATED_INCIDENT: {
    label: 'Repeated Incident Clustering',
    weight: '10%',
    maxPts: '10.0 pts',
    icon: RefreshCw,
    role: 'Chronic recurrence on identical assets without remediation'
  }
};

interface FindingDetailModalProps {
  finding: Finding | null;
  onClose: () => void;
  onSelectEvidence: (evidenceId: string) => void;
  onNavigateToEntity?: (entityId: string) => void;
  onReviewSaved?: () => void;
}

export function FindingDetailModal({
  finding,
  onClose,
  onSelectEvidence,
  onNavigateToEntity,
  onReviewSaved
}: FindingDetailModalProps) {
  const [expertLabel, setExpertLabel] = useState<'CONFIRMED' | 'NOT_CONFIRMED' | ''>('');
  const [reviewerId, setReviewerId] = useState('');
  const [reviewRationale, setReviewRationale] = useState('');
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!finding) return null;

  const saveReview = async () => {
    if (!expertLabel || !reviewerId.trim()) return;
    setReviewSaving(true);
    setReviewStatus(null);
    try {
      await submitExpertFindingLabel({
        finding_id: finding.finding_id,
        entity_id: finding.entity_id,
        expert_label: expertLabel,
        reviewer_id: reviewerId.trim(),
        review_timestamp: new Date().toISOString(),
        rationale: reviewRationale.trim()
      });
      setReviewStatus('Independent expert label saved.');
      onReviewSaved?.();
    } catch (error: any) {
      setReviewStatus(error.message || 'Could not save expert label.');
    } finally {
      setReviewSaving(false);
    }
  };

  const sevColor = RISK_COLORS[finding.severity] || 'var(--text-primary)';
  const modConfig = MODULE_CONFIG[finding.finding_type] || {
    label: finding.finding_type.replace('_', ' '),
    weight: '20%',
    maxPts: '20.0 pts',
    icon: Activity,
    role: 'Supervisory signal'
  };
  const ModIcon = modConfig.icon;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        className="bg-app-surface border border-app-borderStrong rounded-lg w-full max-w-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-app-borderDivider bg-transparent">
          <div className="flex items-start space-x-3">
            <div className="p-2 rounded bg-transparent border border-app-borderDivider text-app-text mt-0.5">
              <ModIcon className="w-5 h-5 text-app-muted" />
            </div>
            <div>
              <div className="flex items-center space-x-2 text-xs mb-1">
                <span className="font-mono text-app-muted">{finding.finding_id}</span>
                <span className="text-app-muted">•</span>
                <span className="text-xs font-medium capitalize" style={{ color: sevColor }}>
                  {finding.severity.toLowerCase()} severity
                </span>
                <span className="text-app-muted">•</span>
                <button
                  onClick={() => onNavigateToEntity && onNavigateToEntity(finding.entity_id)}
                  className="font-medium text-app-heading hover:underline inline-flex items-center"
                >
                  <Building2 className="w-3.5 h-3.5 mr-1 text-app-muted" />
                  {finding.entity_id}
                </button>
              </div>
              <h2 className="text-base font-semibold text-app-heading tracking-tight">
                {finding.title}
              </h2>
            </div>
          </div>

          <button 
            onClick={onClose} 
            className="p-1 text-app-muted hover:text-app-text rounded hover:bg-app-surface2 transition-colors ml-3"
            title="Close dialog (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 text-xs text-app-secondary space-y-6">
          {/* 1. Finding Overview & Supervisory Rationale */}
          <div className="bg-app-surface2 rounded-md p-4 border border-app-borderDivider space-y-2">
            <div className="flex items-center space-x-2 text-app-heading font-medium text-xs">
              <ShieldAlert className="w-4 h-4 text-app-muted" />
              <span>Supervisory Rationale & Operational Context</span>
            </div>
            <p className="text-xs text-app-text leading-relaxed">
              {finding.rationale}
            </p>
          </div>

          <div className="border border-app-borderDivider rounded-md p-4 bg-transparent space-y-3">
            <h3 className="text-xs font-medium text-app-heading uppercase tracking-wider">Independent human review</h3>
            <p className="text-[11px] text-app-muted">This label is a reviewer judgement, not an automatic copy of the SAT-SA prediction.</p>
            <div className="flex flex-wrap gap-3 text-xs">
              <label className="inline-flex items-center gap-1.5"><input type="radio" name={`label-${finding.finding_id}`} checked={expertLabel === 'CONFIRMED'} onChange={() => setExpertLabel('CONFIRMED')} /> Confirmed</label>
              <label className="inline-flex items-center gap-1.5"><input type="radio" name={`label-${finding.finding_id}`} checked={expertLabel === 'NOT_CONFIRMED'} onChange={() => setExpertLabel('NOT_CONFIRMED')} /> Not confirmed</label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={reviewerId} onChange={event => setReviewerId(event.target.value)} placeholder="Reviewer ID" className="bg-app-surface2 border border-app-borderDivider rounded px-2.5 py-2 text-xs text-app-text" />
              <input value={reviewRationale} onChange={event => setReviewRationale(event.target.value)} placeholder="Optional review rationale" className="bg-app-surface2 border border-app-borderDivider rounded px-2.5 py-2 text-xs text-app-text" />
            </div>
            <div className="flex items-center gap-3">
              <button disabled={!expertLabel || !reviewerId.trim() || reviewSaving} onClick={saveReview} className="px-3 py-1.5 bg-app-text text-app-bg rounded text-xs disabled:opacity-40">{reviewSaving ? 'Saving...' : 'Save independent label'}</button>
              {reviewStatus && <span className="text-[11px] text-app-muted">{reviewStatus}</span>}
            </div>
          </div>

          {/* 2. Risk Contribution Strip */}
          <div className="border border-app-borderDivider rounded-md p-4 bg-transparent">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Scale className="w-4 h-4 text-app-muted" />
                <h3 className="text-xs font-medium text-app-heading uppercase tracking-wider">
                  Risk Contribution & Weighting
                </h3>
              </div>
              <span className="text-xs font-mono font-medium text-app-heading">
                {modConfig.weight} Model Weight ({modConfig.maxPts})
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 bg-app-surface2 rounded border border-app-borderDivider">
                <span className="text-app-muted block text-[11px]">Detection Module</span>
                <span className="font-medium text-app-heading mt-0.5 block">{modConfig.label}</span>
              </div>
              <div className="p-3 bg-app-surface2 rounded border border-app-borderDivider">
                <span className="text-app-muted block text-[11px]">Severity Impact</span>
                <span className="font-medium capitalize mt-0.5 block" style={{ color: sevColor }}>
                  {finding.severity.toLowerCase()} priority
                </span>
              </div>
              <div className="p-3 bg-app-surface2 rounded border border-app-borderDivider">
                <span className="text-app-muted block text-[11px]">Traceable Evidence</span>
                <span className="font-mono font-medium text-app-heading mt-0.5 block">
                  {finding.evidence_ids?.length || 0} SQLite records
                </span>
              </div>
            </div>
            <p className="text-[11px] text-app-muted mt-2">
              Module objective: {modConfig.role}. Evaluated strictly within the deterministic 0–100 mathematical risk framework.
            </p>
          </div>

          {/* 3. Supporting Metrics & Forensic Observations */}
          {finding.supporting_metrics && Object.keys(finding.supporting_metrics).length > 0 && (
            <div className="border border-app-borderDivider rounded-md p-4 bg-transparent space-y-3">
              <h3 className="text-xs font-medium text-app-heading uppercase tracking-wider">
                Forensic Metrics & Observables
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {Object.entries(finding.supporting_metrics).map(([key, val]) => {
                  let displayVal = String(val);
                  if (typeof val === 'object' && val !== null) {
                    displayVal = JSON.stringify(val);
                  }
                  return (
                    <div key={key} className="p-2.5 bg-app-surface2 rounded border border-app-borderDivider">
                      <div className="text-[11px] text-app-muted font-normal capitalize">
                        {key.replace(/_/g, ' ')}
                      </div>
                      <div className="font-mono text-xs text-app-heading font-medium truncate mt-0.5" title={displayVal}>
                        {displayVal}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 4. Traceable SQLite Evidence IDs (Click to inspect) */}
          <div className="border border-app-borderDivider rounded-md p-4 bg-transparent space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Database className="w-4 h-4 text-app-muted" />
                <h3 className="text-xs font-medium text-app-heading uppercase tracking-wider">
                  Underlying Source Evidence Records ({finding.evidence_ids?.length || 0})
                </h3>
              </div>
              <span className="text-[11px] text-app-muted">
                Click any ID to view original SQLite record
              </span>
            </div>

            {finding.evidence_ids && finding.evidence_ids.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {finding.evidence_ids.map((evId) => (
                  <button
                    key={evId}
                    onClick={() => onSelectEvidence(evId)}
                    className="inline-flex items-center px-3 py-1.5 text-xs font-mono rounded bg-app-surface2 hover:bg-app-surfaceHover text-app-heading border border-app-borderBtn transition-colors"
                    title={`Inspect original SQLite record for ${evId}`}
                  >
                    <span>{evId}</span>
                    <ChevronRight className="w-3.5 h-3.5 ml-1 text-app-muted" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xs text-app-muted p-3 bg-app-surface2 rounded">
                No direct record IDs linked. Finding derived from aggregate statistical vector.
              </div>
            )}
            <p className="text-[11px] text-app-muted pt-1">
              Zero synthetic evidence. Every record identifier is directly queryable against the local SQLite database (`sat_sa.db`).
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-app-borderDivider bg-transparent flex items-center justify-between text-xs text-app-muted">
          <span>Finding ID: <strong className="font-mono font-normal text-app-heading">{finding.finding_id}</strong></span>
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-transparent hover:bg-app-surface2 text-app-text font-normal rounded transition-colors text-xs border border-app-borderBtn"
          >
            Close finding details
          </button>
        </div>
      </div>
    </div>
  );
}
