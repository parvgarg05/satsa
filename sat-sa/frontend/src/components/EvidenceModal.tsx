import React, { useEffect, useState } from 'react';
import { 
  X, Activity, Database, AlertCircle, FileText, Server, 
  Copy, Check, ShieldCheck 
} from 'lucide-react';
import { fetchEvidence } from '../lib/api';
import type { EvidenceResponse } from '../types/api';

const RISK_COLORS: Record<string, string> = {
  CRITICAL: '#B85C5C',
  HIGH: '#C8794A',
  MEDIUM: '#C19A4A',
  LOW: '#5FAF83',
};

interface EvidenceModalProps {
  evidenceId: string;
  onClose: () => void;
}

export function EvidenceModal({ evidenceId, onClose }: EvidenceModalProps) {
  const [evidence, setEvidence] = useState<EvidenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const data = await fetchEvidence(evidenceId);
        setEvidence(data);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to load underlying evidence record from database');
      } finally {
        setLoading(false);
      }
    }
    loadData();

    // Close on Escape
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [evidenceId, onClose]);

  const copyToClipboard = () => {
    if (!evidence) return;
    navigator.clipboard.writeText(JSON.stringify(evidence, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        className="bg-app-surface border border-app-borderStrong rounded-lg w-full max-w-3xl shadow-lg overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-app-borderDivider bg-transparent">
          <div className="flex items-center space-x-3">
            <div className="p-1.5 rounded bg-transparent border border-app-borderDivider text-app-text">
              <Database className="w-4 h-4 text-app-muted" />
            </div>
            <div>
              <div className="flex items-center space-x-2 text-xs">
                <span className="text-app-muted">SQLite Evidence Record</span>
                <span className="text-app-muted">•</span>
                <span className="text-app-muted">Local DB Trace</span>
              </div>
              <h2 className="text-sm font-semibold text-app-text mt-0.5">
                Audit record: <span className="font-mono">{evidenceId}</span>
              </h2>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={copyToClipboard}
              className="inline-flex items-center px-2.5 py-1 text-xs rounded bg-transparent hover:bg-app-surfaceHover text-app-text border border-app-borderBtn transition-colors font-normal"
              title="Copy JSON to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 mr-1 text-emerald-500" />
                  <span className="text-emerald-500">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 mr-1 text-app-muted" />
                  <span>Copy JSON</span>
                </>
              )}
            </button>
            <button 
              onClick={onClose} 
              className="p-1 text-app-muted hover:text-app-text rounded hover:bg-app-surface transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 text-xs text-app-secondary space-y-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-app-secondary">
              <Activity className="w-6 h-6 animate-spin text-app-muted mb-2" />
              <p className="text-xs text-app-muted">Querying underlying SQLite audit tables...</p>
            </div>
          )}

          {error && (
            <div className="p-4 bg-app-surface border border-red-500/30 rounded text-app-text flex items-start space-x-2.5">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="font-medium text-xs text-red-500">Broken Evidence Reference</h4>
                <p className="text-xs text-app-secondary">{error}</p>
                <div className="text-[11px] font-mono text-red-400 bg-red-500/10 p-2 rounded border border-red-500/20 mt-2">
                  Database Integrity Failure: Evidence ID '{evidenceId}' could not be resolved to any underlying alert, case, asset, or entity in sat_sa.db.
                </div>
              </div>
            </div>
          )}

          {evidence && !loading && (
            <div className="space-y-5">
              {/* Record Type Banner */}
              <div className="flex items-center justify-between p-3 bg-app-surface2 rounded border border-app-borderDivider text-xs">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="text-app-muted">Underlying entity record:</span>
                  <span className="font-medium text-app-text capitalize">{evidence.evidence_type.replace('_', ' ')}</span>
                </div>
                <div className="font-mono text-app-muted">
                  Target ID: {evidenceId}
                </div>
              </div>

              {/* Alert Details Card */}
              {evidence.alert && (
                <div className="border border-app-borderDivider rounded-md overflow-hidden bg-transparent">
                  <div className="bg-transparent px-4 py-2 border-b border-app-borderDivider flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <AlertCircle className="w-3.5 h-3.5 text-app-muted" />
                      <h3 className="font-medium text-xs text-app-text uppercase tracking-wider">Alert record details</h3>
                    </div>
                    <span className="text-xs font-mono text-app-muted">{evidence.alert.alert_id}</span>
                  </div>
                  <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-2.5 gap-x-4">
                    <DataPoint label="Alert ID" value={evidence.alert.alert_id} mono />
                    <DataPoint label="Timestamp" value={evidence.alert.timestamp} mono />
                    <DataPoint label="Severity" value={evidence.alert.severity} badge severity={evidence.alert.severity} />
                    <DataPoint label="Status" value={evidence.alert.status} badge />
                    <DataPoint label="Threat Category" value={evidence.alert.category} />
                    <DataPoint label="Associated Asset" value={evidence.alert.asset_id} mono />
                    {evidence.alert.source_ip && <DataPoint label="Source IP" value={evidence.alert.source_ip} mono />}
                    {evidence.alert.destination_ip && <DataPoint label="Destination IP" value={evidence.alert.destination_ip} mono />}
                  </div>
                </div>
              )}

              {/* Related Case Investigation Record */}
              {evidence.case && (
                <div className="border border-app-borderDivider rounded-md overflow-hidden bg-transparent">
                  <div className="bg-transparent px-4 py-2 border-b border-app-borderDivider flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <FileText className="w-3.5 h-3.5 text-app-muted" />
                      <h3 className="font-medium text-xs text-app-text uppercase tracking-wider">SOC case investigation record</h3>
                    </div>
                    <span className="text-xs font-mono text-app-muted">{evidence.case.case_id}</span>
                  </div>
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-3 gap-x-4">
                    <DataPoint label="Case ID" value={evidence.case.case_id} mono />
                    <DataPoint label="Investigator" value={evidence.case.investigator} />
                    <DataPoint 
                      label="Investigation Duration" 
                      value={`${evidence.case.investigation_duration} minutes`} 
                      highlight={evidence.case.investigation_duration < 10 ? 'red' : undefined}
                    />
                    <DataPoint 
                      label="Escalated to Supervisor" 
                      value={evidence.case.escalated ? 'Yes (Escalated)' : 'No (Unescalated)'} 
                      badge 
                      highlight={!evidence.case.escalated ? 'amber' : 'emerald'}
                    />
                    <DataPoint label="Opened At" value={evidence.case.opened_at} mono />
                    <DataPoint label="Closed At" value={evidence.case.closed_at || 'Open'} mono />
                    <DataPoint label="Closure Reason" value={evidence.case.closure_reason || 'N/A'} />
                    <DataPoint 
                      label="Remediation Status" 
                      value={evidence.case.remediation_status || 'Unremediated'} 
                      highlight={evidence.case.remediation_status === 'None' || !evidence.case.remediation_status ? 'red' : 'emerald'}
                    />
                  </div>
                </div>
              )}

              {/* Related Asset Record */}
              {evidence.asset && (
                <div className="border border-app-borderDivider rounded-md overflow-hidden bg-transparent">
                  <div className="bg-transparent px-4 py-2 border-b border-app-borderDivider flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Server className="w-3.5 h-3.5 text-app-muted" />
                      <h3 className="font-medium text-xs text-app-text uppercase tracking-wider">Asset inventory & telemetry status</h3>
                    </div>
                    <span className="text-xs font-mono text-app-muted">{evidence.asset.asset_id}</span>
                  </div>
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-3 gap-x-4">
                    <DataPoint label="Asset ID" value={evidence.asset.asset_id} mono />
                    <DataPoint label="Asset Type" value={evidence.asset.asset_type} />
                    <DataPoint label="Criticality" value={evidence.asset.criticality} badge severity={evidence.asset.criticality} />
                    <DataPoint label="Expected Telemetry" value={evidence.asset.expected_telemetry} />
                    <DataPoint 
                      label="Last Telemetry Timestamp" 
                      value={evidence.asset.last_telemetry || 'No telemetry recorded'} 
                      highlight={!evidence.asset.last_telemetry ? 'red' : undefined}
                      mono
                    />
                    <DataPoint label="Entity Owner" value={evidence.asset.entity_id} mono />
                  </div>
                </div>
              )}

              {/* Finding Drilldown Multiple Evidence records */}
              {evidence.evidence_records && (
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-app-secondary uppercase tracking-wider">
                    Associated finding records ({evidence.evidence_records.alerts.length} alerts, {evidence.evidence_records.cases.length} cases)
                  </h4>
                  {evidence.evidence_records.alerts.slice(0, 5).map((alt) => (
                    <div key={alt.alert_id} className="p-3 bg-app-surface2 rounded border border-app-borderDivider text-xs flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-app-text">{alt.alert_id}</span>
                        <span className="text-app-secondary">{alt.category}</span>
                        <span className="text-app-muted font-mono text-[11px]">({alt.timestamp})</span>
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium capitalize bg-red-500/10 text-red-500">
                        {alt.severity.toLowerCase()}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Collapsible Raw SQLite / JSON View */}
              <div className="border border-app-borderDivider rounded-md overflow-hidden bg-transparent">
                <details className="text-xs group">
                  <summary className="p-3 bg-transparent text-app-secondary hover:text-app-text cursor-pointer flex items-center justify-between select-none">
                    <span>Inspect raw SQLite query record</span>
                    <span className="text-app-muted text-xs group-open:rotate-90 transition-transform">▶</span>
                  </summary>
                  <pre className="p-4 bg-app-bg border-t border-app-borderDivider overflow-x-auto text-xs text-app-secondary font-mono">
                    {JSON.stringify(evidence, null, 2)}
                  </pre>
                </details>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-app-borderDivider bg-transparent flex items-center justify-between text-xs text-app-muted">
          <span>Source: Local SQLite database (`sat_sa.db`)</span>
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-transparent hover:bg-app-surface2 text-app-text font-normal rounded transition-colors text-xs border border-app-borderBtn"
          >
            Close drill-down
          </button>
        </div>
      </div>
    </div>
  );
}

function DataPoint({ 
  label, 
  value, 
  mono = false, 
  badge = false, 
  severity,
  highlight 
}: { 
  label: string; 
  value: any; 
  mono?: boolean; 
  badge?: boolean;
  severity?: string;
  highlight?: 'red' | 'amber' | 'emerald';
}) {
  let badgeClasses = 'text-app-text bg-transparent border border-app-borderDivider';
  if (severity === 'CRITICAL' || highlight === 'red') {
    badgeClasses = 'text-red-500 bg-red-500/10 border border-red-500/20';
  } else if (severity === 'HIGH' || highlight === 'amber') {
    badgeClasses = 'text-orange-500 bg-orange-500/10 border border-orange-500/20';
  } else if (severity === 'MEDIUM') {
    badgeClasses = 'text-amber-500 bg-amber-500/10 border border-amber-500/20';
  } else if (severity === 'LOW' || highlight === 'emerald') {
    badgeClasses = 'text-emerald-500 bg-emerald-500/10 border border-emerald-500/20';
  }

  return (
    <div>
      <div className="text-[11px] text-app-muted mb-0.5">{label}</div>
      <div className={`
        ${mono ? 'font-mono text-app-text text-xs' : 'text-app-text text-xs'}
        ${badge ? `inline-block px-2 py-0.5 rounded text-[11px] font-medium capitalize ${badgeClasses}` : ''}
        ${!badge && highlight === 'red' ? 'text-red-500 font-medium' : ''}
        ${!badge && highlight === 'emerald' ? 'text-emerald-500 font-medium' : ''}
      `}>
        {value ?? 'N/A'}
      </div>
    </div>
  );
}
