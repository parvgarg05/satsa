import React, { useEffect, useState } from 'react';
import { 
  ArrowLeft, Target, EyeOff, Activity, FileSearch,
  RefreshCw, Database, ChevronRight, Server, ChevronDown, ChevronUp, AlertTriangle 
} from 'lucide-react';
import { fetchEntityDetail } from '../../lib/api';
import type { EntityDetailResponse, Finding } from '../../types/api';
import { EvidenceModal } from '../EvidenceModal';
import { FindingDetailModal } from '../FindingDetailModal';

const RISK_COLORS: Record<string, string> = {
  CRITICAL: '#B85C5C',
  HIGH: '#C8794A',
  MEDIUM: '#C19A4A',
  LOW: '#5FAF83',
};

const MODULE_ICONS: Record<string, any> = {
  EXECUTION_GAP: Target,
  NEGATIVE_SPACE: EyeOff,
  ANOMALY: Activity,
  PEER_DEVIATION: AlertTriangle,
  REPEATED_INCIDENT: RefreshCw
};

interface EntityInvestigationPageProps {
  entityId: string;
  onBack: () => void;
  onInspectEvidence?: (evidenceId: string) => void;
}

export function EntityInvestigationPage({ entityId, onBack, onInspectEvidence }: EntityInvestigationPageProps) {
  const [detail, setDetail] = useState<EntityDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [showFormula, setShowFormula] = useState(false);

  // Filters within entity view
  const [activeModule, setActiveModule] = useState<string>('ALL');
  const [activeSeverity, setActiveSeverity] = useState<string>('ALL');

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setLoading(true);
      try {
        const data = await fetchEntityDetail(entityId);
        if (isMounted) {
          setDetail(data);
          setError(null);
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Failed to load entity details');
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => { isMounted = false; };
  }, [entityId]);

  const handleOpenEvidence = (evId: string) => {
    setSelectedEvidenceId(evId);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-80 text-app-secondary">
        <Activity className="w-5 h-5 animate-spin text-app-muted mb-2" />
        <span className="text-xs text-app-muted">Loading audit records for {entityId}...</span>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-4 bg-app-surface border border-red-500/30 rounded-md text-app-text max-w-4xl mx-auto">
        <h3 className="font-medium text-xs flex items-center mb-1 text-red-400">
          <AlertTriangle className="w-4 h-4 mr-1.5" /> Investigation Data Unavailable
        </h3>
        <p className="text-xs text-app-secondary">{error || 'Entity record not found'}</p>
        <button 
          onClick={onBack} 
          className="mt-3 px-3 py-1.5 bg-transparent hover:bg-app-surface2 text-app-text border border-app-borderBtn text-xs rounded transition"
        >
          ← Back to entities
        </button>
      </div>
    );
  }

  // Filtered findings
  let filteredFindings = detail.findings;
  if (activeModule !== 'ALL') {
    filteredFindings = filteredFindings.filter(f => f.finding_type === activeModule);
  }
  if (activeSeverity !== 'ALL') {
    filteredFindings = filteredFindings.filter(f => f.severity === activeSeverity);
  }

  const riskColor = RISK_COLORS[detail.risk_level] || 'var(--text-primary)';

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* 1. Header & Back Action */}
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center text-xs text-app-secondary hover:text-app-heading mb-2.5 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-1" />
          Back to entities
        </button>

        <div className="bg-app-surface rounded-md p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center space-x-3 mb-1">
              <h1 className="text-xl font-semibold text-app-heading tracking-tight">{detail.entity_id}</h1>
              <span className="text-xs font-medium capitalize" style={{ color: riskColor }}>
                {detail.risk_level.toLowerCase()} risk
              </span>
              <span className="text-xs text-app-secondary">
                {detail.sector} sector
              </span>
            </div>
            <h2 className="text-sm text-app-secondary">{detail.entity_name}</h2>
          </div>

          <div className="text-left sm:text-right sm:border-l sm:border-app-borderDivider sm:pl-5 shrink-0">
            <span className="text-xs text-app-muted uppercase tracking-wider block">Supervisory risk score</span>
            <div className="text-2xl font-mono font-semibold" style={{ color: riskColor }}>
              {detail.risk_score.toFixed(1)}
              <span className="text-xs font-normal text-app-muted"> / 100</span>
            </div>
            <span className="text-xs text-app-muted">{detail.findings.length} findings detected</span>
          </div>
        </div>
      </div>

      {/* 2. Why is this entity flagged? */}
      <div className="bg-app-surface rounded-md p-6">
        <h3 className="text-xs font-medium text-app-secondary uppercase tracking-wider mb-3">
          Why is this entity flagged?
        </h3>
        <p className="text-xs text-app-text leading-relaxed mb-4">
          {detail.explanation.summary}
        </p>

        {/* Collapsible Scoring Methodology */}
        <div className="mt-4 pt-4 border-t border-app-borderDivider">
          <button
            onClick={() => setShowFormula(!showFormula)}
            className="flex items-center text-xs text-app-muted hover:text-app-heading transition-colors"
          >
            <span>Deterministic scoring formula</span>
            {showFormula ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />}
          </button>

          {showFormula && (
            <div className="mt-3 p-4 bg-app-surface2 rounded-md border border-app-borderDivider text-xs text-app-secondary space-y-2">
              <div className="text-app-heading">{detail.explanation.score_formula}</div>
              <p className="text-xs text-app-muted">
                Weights strictly sum to 100%: Execution Gap (30%), Negative Space (25%), Anomaly Detection (20%), Peer Deviation (15%), Repeated Incidents (10%).
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 3. Component Score Breakdown */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium text-app-secondary uppercase tracking-wider">Component score breakdown</h3>
          <span className="text-xs text-app-muted">Click a component to filter signals below</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {Object.values(detail.component_scores).map((comp) => {
            const Icon = MODULE_ICONS[comp.finding_type] || Activity;
            const isSelected = activeModule === comp.finding_type;
            const isDominant = comp.weighted_contribution >= 15;

            return (
              <button
                key={comp.finding_type}
                onClick={() => setActiveModule(isSelected ? 'ALL' : comp.finding_type)}
                className={`p-3 rounded-md border text-left transition-colors relative ${
                  isSelected 
                    ? 'bg-app-surface2 border-app-heading text-app-heading'
                    : 'bg-app-surface border-app-borderDivider hover:bg-app-surface2'
                }`}
              >
                <div className="flex items-center justify-between text-app-muted mb-1">
                  <span className="text-xs font-normal">{comp.weight_pct} weight</span>
                  <Icon className="w-3.5 h-3.5 text-app-muted" />
                </div>
                <div className="text-xs font-medium text-app-heading capitalize truncate mb-1">
                  {comp.finding_type.replace('_', ' ').toLowerCase()}
                  {isDominant && <span className="ml-1 text-[10px] text-app-muted font-normal">(driver)</span>}
                </div>
                <div className="text-base font-semibold text-app-heading">
                  {comp.weighted_contribution.toFixed(1)}
                  <span className="text-xs font-normal text-app-muted ml-1">pts</span>
                </div>
                <div className="text-xs text-app-muted mt-0.5">
                  {comp.finding_count} finding{comp.finding_count !== 1 ? 's' : ''}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. SCADA Assets Telemetry Deficit */}
      {detail.evidence_references && (
        <div className="p-3 bg-app-surface rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center space-x-2">
            <Server className="w-4 h-4 text-app-muted shrink-0" />
            <div>
              <span className="font-medium text-app-heading">Monitored Assets: </span>
              <span className="text-app-secondary">
                {detail.evidence_references.total_assets} total • {detail.evidence_references.total_alerts} security alerts analyzed
              </span>
            </div>
          </div>

          {detail.evidence_references.critical_assets && detail.evidence_references.critical_assets.length > 0 && (
            <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
              <span className="text-app-muted text-xs">SCADA telemetry deficit:</span>
              {detail.evidence_references.critical_assets.map((ast: any) => (
                <button
                  key={ast.asset_id}
                  onClick={() => handleOpenEvidence(ast.asset_id)}
                  className="px-2 py-0.5 rounded bg-transparent hover:bg-app-surface2 border border-app-borderBtn text-xs text-app-text transition-colors"
                  title="Inspect asset evidence record"
                >
                  {ast.asset_id}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. Detected Findings Section */}
      <div className="bg-app-surface rounded-md overflow-hidden mt-4">
        {/* Header & Filter Controls */}
        <div className="p-4 border-b border-app-borderDivider flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-medium text-app-heading uppercase tracking-wider">
              Detected supervisory signals ({filteredFindings.length} of {detail.findings.length})
            </h3>
            <p className="text-xs text-app-muted mt-1">
              Specific behavioral discrepancies and compliance anomalies identified by SAT-SA
            </p>
          </div>

          <div className="flex items-center space-x-3 text-xs">
            {/* Filter by Module */}
            <select
              value={activeModule}
              onChange={(e) => setActiveModule(e.target.value)}
              className="bg-app-surface2 border border-app-borderStrong rounded px-3 py-1.5 text-app-text focus:outline-none focus:border-app-accent transition-colors"
            >
              <option value="ALL">All modules</option>
              <option value="EXECUTION_GAP">Execution gap</option>
              <option value="NEGATIVE_SPACE">Negative space</option>
              <option value="ANOMALY">Statistical anomaly</option>
              <option value="PEER_DEVIATION">Peer deviation</option>
              <option value="REPEATED_INCIDENT">Repeated incidents</option>
            </select>

            {/* Filter by Severity */}
            <select
              value={activeSeverity}
              onChange={(e) => setActiveSeverity(e.target.value)}
              className="bg-app-surface2 border border-app-borderStrong rounded px-3 py-1.5 text-app-text focus:outline-none focus:border-app-accent transition-colors"
            >
              <option value="ALL">All severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>
        </div>

        {/* Findings List */}
        <div className="divide-y divide-app-borderDivider">
          {filteredFindings.map((finding) => {
            const sevColor = RISK_COLORS[finding.severity] || 'var(--text-primary)';
            const Icon = MODULE_ICONS[finding.finding_type] || Activity;

            return (
              <div
                key={finding.finding_id}
                className="p-6 hover:bg-app-surface2 transition-colors cursor-pointer"
                onClick={() => setSelectedFinding(finding)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedFinding(finding); }}
                title="Click to view full finding details"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-2">
                  <div className="flex items-center space-x-3 flex-wrap gap-y-1">
                    <span className="text-xs font-medium capitalize" style={{ color: sevColor }}>
                      {finding.severity.toLowerCase()}
                    </span>
                    <span className="inline-flex items-center text-xs font-medium text-app-text">
                      <Icon className="w-3.5 h-3.5 mr-1.5 text-app-muted" />
                      {finding.finding_type.replace('_', ' ').toLowerCase()}
                    </span>
                    <span className="text-xs font-mono text-app-muted">
                      {finding.finding_id}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2 self-start sm:self-auto">
                    <span className="text-[11px] text-app-muted bg-transparent px-2 py-0.5 rounded border border-app-borderDivider">
                      {finding.evidence_ids.length} linked record{finding.evidence_ids.length !== 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedFinding(finding); }}
                      className="inline-flex items-center text-[11px] font-medium text-app-secondary hover:text-app-text hover:bg-app-surfaceHover px-2 py-0.5 rounded bg-transparent border border-app-borderDivider transition-colors"
                      title="View full finding detail and all evidence IDs"
                    >
                      <FileSearch className="w-3 h-3 mr-1 text-app-muted" />
                      Full detail
                    </button>
                  </div>
                </div>

                <h4 className="text-sm font-medium text-app-heading mb-1.5">{finding.title}</h4>
                <p className="text-xs text-app-secondary leading-relaxed mb-4">
                  {finding.rationale}
                </p>

                {/* Supporting Metrics */}
                {finding.supporting_metrics && Object.keys(finding.supporting_metrics).length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4 text-xs font-mono">
                    {Object.entries(finding.supporting_metrics).map(([key, val]) => (
                      <span key={key} className="px-2 py-1 rounded bg-transparent text-app-muted border border-app-borderDivider">
                        {key.replace(/_/g, ' ')}: <strong className="text-app-text font-normal">{String(val)}</strong>
                      </span>
                    ))}
                  </div>
                )}

                {/* Progressive Evidence Disclosure (Clickable IDs) */}
                {finding.evidence_ids.length > 0 && (
                  <div className="pt-2 border-t border-app-borderDivider">
                    <div className="text-[11px] text-app-muted uppercase tracking-wider mb-2 flex items-center">
                      <Database className="w-3.5 h-3.5 mr-1 text-app-muted" />
                      Traceable SQLite evidence records
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {finding.evidence_ids.slice(0, 12).map((evId) => (
                        <button
                          key={evId}
                          onClick={(e) => { e.stopPropagation(); handleOpenEvidence(evId); }}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-mono rounded bg-transparent hover:bg-app-surfaceHover text-app-text border border-app-borderBtn transition-colors"
                        >
                          <span>{evId}</span>
                          <ChevronRight className="w-3.5 h-3.5 ml-1 text-app-muted" />
                        </button>
                      ))}
                      {finding.evidence_ids.length > 12 && (
                        <span className="text-xs text-app-muted px-2 py-1.5">
                          +{finding.evidence_ids.length - 12} more records
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}


          {filteredFindings.length === 0 && (
            <div className="p-10 text-center text-app-muted text-xs">
              No findings matched the selected module and severity filters.
            </div>
          )}
        </div>
      </div>

      {/* Evidence Modal Drill-down */}
      {selectedEvidenceId && (
        <EvidenceModal 
          evidenceId={selectedEvidenceId} 
          onClose={() => setSelectedEvidenceId(null)} 
        />
      )}

      {/* Finding Detail Modal */}
      {selectedFinding && (
        <FindingDetailModal
          finding={selectedFinding}
          onClose={() => setSelectedFinding(null)}
          onSelectEvidence={(evId) => {
            setSelectedFinding(null);
            handleOpenEvidence(evId);
          }}
        />
      )}
    </div>
  );
}
