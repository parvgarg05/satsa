import React, { useState, useEffect } from 'react';
import { 
  Search, ChevronRight, Activity, Database, Building2, AlertTriangle, FileSearch
} from 'lucide-react';
import { fetchFindings } from '../../lib/api';
import type { Finding } from '../../types/api';
import { EvidenceModal } from '../EvidenceModal';
import { FindingDetailModal } from '../FindingDetailModal';

const RISK_COLORS: Record<string, string> = {
  CRITICAL: '#B85C5C',
  HIGH: '#C8794A',
  MEDIUM: '#C19A4A',
  LOW: '#5FAF83',
};

const MODULE_OPTIONS = [
  { value: 'ALL', label: 'All modules' },
  { value: 'EXECUTION_GAP', label: 'Execution gap' },
  { value: 'NEGATIVE_SPACE', label: 'Negative space' },
  { value: 'ANOMALY', label: 'Statistical anomaly' },
  { value: 'PEER_DEVIATION', label: 'Peer deviation' },
  { value: 'REPEATED_INCIDENT', label: 'Repeated incidents' },
];

const SEVERITY_OPTIONS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

interface FindingsPageProps {
  onNavigateToEntity: (entityId: string) => void;
  onInspectEvidence?: (evidenceId: string) => void;
}

export function FindingsPage({ onNavigateToEntity, onInspectEvidence }: FindingsPageProps) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [moduleFilter, setModuleFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(null);
  const [activeFinding, setActiveFinding] = useState<Finding | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setLoading(true);
      try {
        const res = await fetchFindings({
          severity: severityFilter,
          finding_type: moduleFilter,
        });

        if (isMounted) {
          setFindings(res.findings);
          setError(null);
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Failed to fetch findings');
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => { isMounted = false; };
  }, [severityFilter, moduleFilter]);

  // Client search filter (by entity ID or title)
  const filteredFindings = findings.filter(f => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return f.entity_id.toLowerCase().includes(q) || f.title.toLowerCase().includes(q) || f.rationale.toLowerCase().includes(q);
  });

  const handleOpenEvidence = (evId: string) => {
    if (onInspectEvidence) {
      onInspectEvidence(evId);
    } else {
      setActiveEvidenceId(evId);
    }
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-app-borderDivider pb-4">
        <div>
          <h1 className="text-lg font-semibold text-app-text tracking-tight">Supervisory Signals</h1>
          <p className="text-xs text-app-secondary mt-1">
            Cross-entity inventory of all operational anomalies, compliance gaps, and audit findings
          </p>
        </div>
        <div className="text-xs text-app-muted">
          Showing <span className="font-medium text-app-text">{filteredFindings.length}</span> signals
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div className="bg-app-surface rounded-md p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-app-muted absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by entity, signal title, or keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-app-surface2 border border-app-borderStrong rounded px-3 pl-9 py-2 text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent transition-colors"
            />
          </div>

          {/* Severity */}
          <div>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="w-full bg-app-surface2 border border-app-borderStrong rounded px-3 py-2 text-app-text focus:outline-none focus:border-app-accent transition-colors"
            >
              <option value="ALL">All severities</option>
              {SEVERITY_OPTIONS.filter(s => s !== 'ALL').map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Module */}
          <div>
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="w-full bg-app-surface2 border border-app-borderStrong rounded px-3 py-2 text-app-text focus:outline-none focus:border-app-accent transition-colors"
            >
              {MODULE_OPTIONS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Findings List */}
      <div className="bg-app-surface rounded-md overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-app-secondary">
            <Activity className="w-5 h-5 animate-spin text-app-muted mb-2" />
            <span className="text-xs text-app-muted">Querying supervisory signals...</span>
          </div>
        ) : error ? (
          <div className="p-6 text-center text-red-500 text-xs">
            <AlertTriangle className="w-4 h-4 mx-auto mb-1.5" />
            {error}
          </div>
        ) : filteredFindings.length === 0 && findings.length === 0 ? (
          <div className="p-10 flex flex-col items-center text-center">
            <AlertTriangle className="w-6 h-6 text-app-muted mb-3" />
            <p className="text-sm font-medium text-app-text mb-1">No supervisory signals in database</p>
            <p className="text-xs text-app-secondary mb-4 max-w-sm leading-relaxed">
              The analytics pipeline has not run yet or produced no findings for this dataset.
              Upload a dataset and run the analysis pipeline to generate supervisory signals.
            </p>
            <div className="flex items-center space-x-3 text-xs">
              <span className="text-app-muted">→ Go to</span>
              <span className="font-medium text-app-text">Analysis Workflow</span>
              <span className="text-app-muted">in the sidebar to get started</span>
            </div>
          </div>
        ) : filteredFindings.length === 0 ? (
          <div className="p-10 text-center text-app-muted text-xs">
            No supervisory signals match the selected filters. Try broadening your severity or module selection.
          </div>
        ) : (
          <div className="divide-y divide-app-borderDivider">
            {filteredFindings.map((f) => {
              const sevColor = RISK_COLORS[f.severity] || 'var(--text-primary)';
              const firstEvidenceId = f.evidence_ids && f.evidence_ids[0];

              return (
                <div
                  key={f.finding_id}
                  className="p-6 hover:bg-app-surface2 transition-colors cursor-pointer"
                  onClick={() => setActiveFinding(f)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveFinding(f); }}
                  title="Click to view finding details and traceable evidence"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-2">
                    <div className="flex items-center space-x-3 flex-wrap gap-y-1">
                      <span 
                        className="text-xs font-medium capitalize"
                        style={{ color: sevColor }}
                      >
                        {f.severity.toLowerCase()}
                      </span>
                      
                      <button
                        onClick={(e) => { e.stopPropagation(); onNavigateToEntity(f.entity_id); }}
                        className="text-xs font-mono font-medium text-app-text hover:underline flex items-center"
                        title="Investigate entity"
                      >
                        <Building2 className="w-3.5 h-3.5 mr-1 text-app-muted" />
                        {f.entity_id}
                      </button>

                      <span className="text-xs text-app-muted capitalize">
                        {f.finding_type.replace('_', ' ').toLowerCase()}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2 self-start sm:self-auto">
                      <span className="text-[11px] text-app-muted bg-transparent px-2 py-0.5 rounded border border-app-borderDivider">
                        {f.evidence_ids?.length || 0} linked records
                      </span>
                    </div>
                  </div>

                  <h3 className="text-sm font-medium text-app-text mb-1.5">{f.title}</h3>
                  <p className="text-xs text-app-secondary leading-relaxed mb-4">
                    {f.rationale}
                  </p>

                  {/* Actions Bar */}
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      {firstEvidenceId && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleOpenEvidence(firstEvidenceId); }}
                          className="inline-flex items-center text-xs font-medium text-app-text hover:bg-app-surfaceHover px-3 py-1.5 rounded bg-transparent border border-app-borderBtn transition-colors"
                        >
                          <Database className="w-3.5 h-3.5 mr-1.5 text-app-muted" />
                          Audit evidence ({firstEvidenceId})
                          <ChevronRight className="w-3.5 h-3.5 ml-1 text-app-muted" />
                        </button>
                      )}

                      <button
                        onClick={(e) => { e.stopPropagation(); setActiveFinding(f); }}
                        className="inline-flex items-center text-xs font-medium text-app-secondary hover:text-app-text hover:bg-app-surfaceHover px-3 py-1.5 rounded bg-transparent border border-app-borderDivider transition-colors"
                      >
                        <FileSearch className="w-3.5 h-3.5 mr-1.5 text-app-muted" />
                        Full detail
                      </button>
                    </div>

                    <button
                      onClick={(e) => { e.stopPropagation(); onNavigateToEntity(f.entity_id); }}
                      className="text-app-secondary hover:text-app-text text-xs font-normal flex items-center transition-colors"
                    >
                      Investigate {f.entity_id}
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </button>
                  </div>
                </div>

              );
            })}
          </div>
        )}
      </div>

      {activeEvidenceId && (
        <EvidenceModal 
          evidenceId={activeEvidenceId} 
          onClose={() => setActiveEvidenceId(null)} 
        />
      )}

      {activeFinding && (
        <FindingDetailModal
          finding={activeFinding}
          onClose={() => setActiveFinding(null)}
          onSelectEvidence={(evId) => {
            setActiveFinding(null);
            handleOpenEvidence(evId);
          }}
          onNavigateToEntity={(entityId) => {
            setActiveFinding(null);
            onNavigateToEntity(entityId);
          }}
        />
      )}
    </div>
  );
}
