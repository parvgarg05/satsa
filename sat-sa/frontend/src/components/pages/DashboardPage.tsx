import React, { useEffect, useState } from 'react';
import { 
  AlertTriangle, Activity, ChevronRight 
} from 'lucide-react';
import { 
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer 
} from 'recharts';
import type { DashboardMetrics, EntitySummary } from '../../types/api';
import { fetchEntities, fetchValidationMetrics } from '../../lib/api';

// Muted restrained semantic colors
const RISK_COLORS: Record<string, string> = {
  CRITICAL: '#B85C5C',
  HIGH: '#C8794A',
  MEDIUM: '#C19A4A',
  LOW: '#5FAF83',
};

interface DashboardPageProps {
  metrics: DashboardMetrics | null;
  loading: boolean;
  error: string | null;
  onNavigateToEntity: (entityId: string) => void;
  onNavigateToEntities: () => void;
  onNavigateToFindings: () => void;
  onInspectEvidence?: (evidenceId: string) => void;
}

export function DashboardPage({
  metrics,
  loading,
  error,
  onNavigateToEntity,
  onNavigateToEntities,
  onNavigateToFindings,
  onInspectEvidence,
}: DashboardPageProps) {
  const [topEntities, setTopEntities] = useState<EntitySummary[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [validationSummary, setValidationSummary] = useState<any>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadTopEntities() {
      try {
        setEntitiesLoading(true);
        const res = await fetchEntities({ sort: 'risk_score', order: 'desc' });
        const valRes = await fetchValidationMetrics().catch(e => null);
        if (isMounted) {
          setTopEntities(res.entities.slice(0, 6));
          if (valRes && valRes.available) setValidationSummary(valRes);
        }
      } catch (e) {
        // Fallback silently
      } finally {
        if (isMounted) setEntitiesLoading(false);
      }
    }
    loadTopEntities();
    return () => { isMounted = false; };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-80 text-app-secondary">
        <Activity className="w-5 h-5 animate-spin text-app-muted mb-2" />
        <span className="text-xs text-app-muted">Loading supervisory dashboard...</span>
      </div>
    );
  }

  if (error || !metrics) {
    const isNetworkError = error && (error.includes('fetch') || error.includes('network') || error.includes('connect') || error.includes('Failed to connect'));
    return (
      <div className="space-y-4 max-w-4xl mx-auto">
        <div className="p-6 bg-app-surface rounded-md border border-app-borderDivider">
          <h3 className="font-medium text-sm flex items-center mb-2 text-red-400">
            <AlertTriangle className="w-4 h-4 mr-1.5" />
            {isNetworkError ? 'Backend Unavailable' : 'Dashboard Telemetry Unavailable'}
          </h3>
          <p className="text-xs text-app-secondary leading-relaxed">
            {isNetworkError
              ? 'Cannot reach the SAT-SA backend at localhost:4000. Start the server with npm start in the backend/ directory, then refresh.'
              : (error || 'Unable to retrieve dashboard aggregates from the local backend.')}
          </p>
          {!isNetworkError && (
            <p className="text-xs text-app-muted mt-2">
              If the database is empty, use the <strong className="font-medium text-app-text">Analysis Workflow</strong> page
              (in the sidebar) to upload a dataset and run the pipeline.
            </p>
          )}
        </div>
      </div>
    );
  }

  // Chart data
  const riskPieData = [
    { name: 'CRITICAL', value: metrics.risk_distribution.CRITICAL },
    { name: 'HIGH', value: metrics.risk_distribution.HIGH },
    { name: 'MEDIUM', value: metrics.risk_distribution.MEDIUM },
    { name: 'LOW', value: metrics.risk_distribution.LOW },
  ].filter(d => d.value > 0);

  const totalFindings = 
    metrics.finding_counts_by_type.EXECUTION_GAP +
    metrics.finding_counts_by_type.NEGATIVE_SPACE +
    metrics.finding_counts_by_type.ANOMALY +
    metrics.finding_counts_by_type.PEER_DEVIATION +
    metrics.finding_counts_by_type.REPEATED_INCIDENT;

  const findingsBarData = [
    { name: 'Execution gap', count: metrics.finding_counts_by_type.EXECUTION_GAP },
    { name: 'Negative space', count: metrics.finding_counts_by_type.NEGATIVE_SPACE },
    { name: 'Anomaly', count: metrics.finding_counts_by_type.ANOMALY },
    { name: 'Peer dev', count: metrics.finding_counts_by_type.PEER_DEVIATION },
    { name: 'Repeat incidents', count: metrics.finding_counts_by_type.REPEATED_INCIDENT },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* 1. Header & Overview */}
      <div className="border-b border-app-borderDivider pb-4 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
        <div>
          <h1 className="text-xl font-semibold text-app-heading tracking-tight">Supervisory Dashboard</h1>
          <p className="text-xs text-app-secondary mt-1">
            Operational risk assessment across monitored Critical Sector Entities (CSEs)
          </p>
        </div>
        <div className="text-xs text-app-muted">
          Air-gapped supervisory audit active
        </div>
      </div>

      {/* 2. Key Metrics Summary Strip (Visually merged into page) */}
      {/* 2. Key Metrics Summary Strip */}
      <div className="bg-app-surface rounded-md p-3 divide-y divide-app-borderDivider">
        <div className="grid grid-cols-2 md:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-app-borderDivider py-1">
          <div 
            onClick={onNavigateToEntities}
            className="px-4 py-2 hover:bg-app-surface2 transition-colors cursor-pointer rounded-l-md"
          >
            <div className="text-xs text-app-secondary mb-1">
              Monitored entities
            </div>
            <div className="text-2xl font-semibold text-app-heading">{metrics.total_entities}</div>
            <div className="text-xs text-app-muted mt-1">Cross-sector CSE inventory</div>
          </div>

          <div 
            onClick={onNavigateToEntities}
            className="px-4 py-2 hover:bg-app-surface2 transition-colors cursor-pointer"
          >
            <div className="text-xs text-app-secondary mb-1">
              High / Critical priority
            </div>
            <div className="text-2xl font-semibold" style={{ color: RISK_COLORS.HIGH }}>
              {metrics.high_critical_entities.length}
            </div>
            <div className="text-xs text-app-muted mt-1">Requires audit focus</div>
          </div>

          <div 
            onClick={onNavigateToFindings}
            className="px-4 py-2 hover:bg-app-surface2 transition-colors cursor-pointer"
          >
            <div className="text-xs text-app-secondary mb-1">
              Total findings
            </div>
            <div className="text-2xl font-semibold text-app-heading">{totalFindings}</div>
            <div className="text-xs text-app-muted mt-0.5">5 detection modules</div>
          </div>

          <div 
            onClick={onNavigateToFindings}
            className="px-4 py-2 hover:bg-app-surface2 transition-colors cursor-pointer rounded-r-md"
          >
            <div className="text-xs text-app-secondary mb-1">
              Critical severity
            </div>
            <div className="text-2xl font-semibold" style={{ color: RISK_COLORS.CRITICAL }}>
              {metrics.severity_distribution.CRITICAL}
            </div>
            <div className="text-xs text-app-muted mt-0.5">High compliance impact</div>
          </div>
        </div>

        {/* Secondary Supervisory Metrics Row: Anomaly, Negative Space, Peer Comparison, Telemetry Coverage */}
        <div className="grid grid-cols-2 md:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-app-borderDivider pt-3 mt-1">
          <div className="px-4 py-1">
            <div className="text-[11px] text-app-muted">Anomaly signals</div>
            <div className="text-lg font-semibold text-app-heading">
              {metrics.finding_counts_by_type.ANOMALY}
            </div>
            <div className="text-[11px] text-app-muted">Isolation Forest outliers</div>
          </div>

          <div className="px-4 py-1">
            <div className="text-[11px] text-app-muted">Negative space gaps</div>
            <div className="text-lg font-semibold text-app-heading">
              {metrics.finding_counts_by_type.NEGATIVE_SPACE}
            </div>
            <div className="text-[11px] text-app-muted">Silent telemetry / unlogged cases</div>
          </div>

          <div className="px-4 py-1">
            <div className="text-[11px] text-app-muted">Peer comparison deviations</div>
            <div className="text-lg font-semibold text-app-heading">
              {metrics.finding_counts_by_type.PEER_DEVIATION}
            </div>
            <div className="text-[11px] text-app-muted">Sector-relative variances</div>
          </div>

          <div className="px-4 py-1">
            <div className="text-[11px] text-app-muted">Telemetry coverage</div>
            <div className="text-lg font-semibold text-app-heading">
              {metrics.useful_aggregate_metrics.telemetry_coverage_pct !== undefined 
                ? `${metrics.useful_aggregate_metrics.telemetry_coverage_pct}%` 
                : `${metrics.useful_aggregate_metrics.stale_critical_assets_count} stale`}
            </div>
            <div className="text-[11px] text-app-muted">
              {metrics.useful_aggregate_metrics.stale_critical_assets_count > 0 
                ? `${metrics.useful_aggregate_metrics.stale_critical_assets_count} critical assets stale` 
                : 'All critical assets active'}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Priority Review Panel (Completely Dynamic) */}
      {topEntities.length > 0 ? (
        (() => {
          const topEnt = topEntities[0];
          const topRiskColor = RISK_COLORS[topEnt.risk_level] || 'var(--text-primary)';

          // Extract component contributions dynamically
          const getModuleContribution = (type: string, weight: number): number => {
            if (topEnt.component_weighted_contributions) {
              const val = topEnt.component_weighted_contributions[type.toLowerCase()] ?? 
                          topEnt.component_weighted_contributions[type] ??
                          topEnt.component_weighted_contributions[type.toLowerCase() === 'repeated_incident' ? 'repeated_incidents' : ''];
              if (typeof val === 'number') return val;
            }
            if (topEnt.component_scores) {
              const cs = topEnt.component_scores[type] ?? topEnt.component_scores[type.toLowerCase()];
              if (cs && typeof cs.weighted_contribution === 'number') return cs.weighted_contribution;
              if (cs && typeof cs.raw_module_score === 'number') return cs.raw_module_score * weight;
              if (typeof cs === 'number') return cs * weight;
            }
            return 0;
          };

          const egPts = getModuleContribution('EXECUTION_GAP', 0.30);
          const nsPts = getModuleContribution('NEGATIVE_SPACE', 0.25);
          const anPts = getModuleContribution('ANOMALY', 0.20);
          const pcPts = getModuleContribution('PEER_DEVIATION', 0.15);
          const riPts = getModuleContribution('REPEATED_INCIDENT', 0.10);

          return (
            <div className="bg-app-surface rounded-md p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-app-borderDivider">
                <div>
                  <div className="text-xs font-medium text-app-secondary mb-1.5">
                    Priority review · Highest risk entity
                  </div>

                  <div className="flex items-baseline space-x-2">
                    <h2 className="text-lg font-semibold text-app-heading">
                      {topEnt.entity_id}
                    </h2>
                    <span className="text-sm text-app-secondary">
                      {topEnt.entity_name}
                    </span>
                  </div>

                  <div className="flex items-center space-x-4 mt-2 text-xs text-app-secondary">
                    <span>Sector: <strong className="font-normal text-app-heading">{topEnt.sector}</strong></span>
                    <span>•</span>
                    <span>Risk score: <strong className="text-app-heading">{topEnt.risk_score.toFixed(1)}</strong></span>
                    <span>•</span>
                    <span>
                      Risk level: <span className="font-medium capitalize" style={{ color: topRiskColor }}>{topEnt.risk_level.toLowerCase()}</span>
                    </span>
                    <span>•</span>
                    <span>Findings: <strong className="font-normal text-app-heading">{topEnt.finding_count}</strong></span>
                  </div>
                </div>

                <div className="flex items-center space-x-3 shrink-0 pt-2 sm:pt-0">
                  <button
                    onClick={() => onNavigateToEntity(topEnt.entity_id)}
                    className="inline-flex items-center px-4 py-2 rounded bg-app-btnPrimary text-app-btnPrimaryText hover:bg-app-btnPrimaryHover font-medium text-xs transition-colors"
                  >
                    Investigate entity
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </button>
                  <button
                    onClick={() => onInspectEvidence ? onInspectEvidence(topEnt.entity_id) : onNavigateToEntity(topEnt.entity_id)}
                    className="inline-flex items-center px-4 py-2 rounded bg-transparent text-app-text hover:bg-app-surface2 border border-app-borderBtn text-xs transition-colors"
                  >
                    View evidence
                  </button>
                </div>
              </div>

              {/* Primary Drivers Grid (Dynamic) */}
              <div>
                <div className="text-xs font-medium text-app-muted uppercase tracking-wider mb-4">
                  Primary risk drivers
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-xs divide-y sm:divide-y-0 sm:divide-x divide-app-borderDivider">
                  <div className="sm:pr-4">
                    <div className="text-app-secondary text-xs mb-1">Execution gap</div>
                    <div className="text-sm font-semibold text-app-heading">{egPts.toFixed(1)} pts</div>
                    <div className="text-xs text-app-muted mt-1">Triage duration & escalation deficit</div>
                  </div>

                  <div className="pt-4 sm:pt-0 sm:px-4">
                    <div className="text-app-secondary text-xs mb-1">Negative space</div>
                    <div className="text-sm font-semibold text-app-heading">{nsPts.toFixed(1)} pts</div>
                    <div className="text-xs text-app-muted mt-1">Stale telemetry & unmonitored assets</div>
                  </div>

                  <div className="pt-4 sm:pt-0 sm:px-4">
                    <div className="text-app-secondary text-xs mb-1">Anomaly / Peer</div>
                    <div className="text-sm font-semibold text-app-heading">{(anPts + pcPts).toFixed(1)} pts</div>
                    <div className="text-xs text-app-muted mt-1">Isolation forest & sector deviation</div>
                  </div>

                  <div className="pt-4 sm:pt-0 sm:pl-4">
                    <div className="text-app-secondary text-xs mb-1">Repeated incidents</div>
                    <div className="text-sm font-semibold text-app-heading">{riPts.toFixed(1)} pts</div>
                    <div className="text-xs text-app-muted mt-1">Unresolved recurring alert clusters</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()
      ) : (
        <div className="bg-app-surface rounded-md p-6 text-center text-xs text-app-muted">
          No entity records currently available for priority review.
        </div>
      )}

      {/* 4. Analytics Section (Restrained charts in graphite surfaces) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Risk Distribution */}
        <div className="bg-app-surface rounded-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-medium text-app-secondary uppercase tracking-wider">Risk tier distribution</h3>
            <span className="text-xs text-app-muted">{metrics.total_entities} entities total</span>
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={riskPieData}
                  innerRadius={46}
                  outerRadius={64}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {riskPieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={RISK_COLORS[entry.name] || '#777D85'} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'var(--surface-primary)', 
                    borderColor: 'var(--border-subtle)', 
                    color: 'var(--text-primary)', 
                    borderRadius: '4px', 
                    fontSize: '11px',
                    boxShadow: 'none'
                  }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center flex-wrap gap-4 text-xs mt-4 pt-4 border-t border-app-borderDivider">
            {riskPieData.map(d => (
              <div key={d.name} className="flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: RISK_COLORS[d.name] }} />
                <span className="text-app-secondary">{d.name.toLowerCase()}:</span>
                <span className="text-app-heading font-medium">{d.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Findings by Module */}
        <div className="bg-app-surface rounded-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-medium text-app-secondary uppercase tracking-wider">Findings by module</h3>
            <span className="text-xs text-app-muted">{totalFindings} total</span>
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={findingsBarData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip 
                  cursor={{ fill: 'var(--surface-secondary)' }}
                  contentStyle={{ 
                    backgroundColor: 'var(--surface-primary)', 
                    borderColor: 'var(--border-subtle)', 
                    color: 'var(--text-primary)', 
                    borderRadius: '4px', 
                    fontSize: '11px',
                    boxShadow: 'none'
                  }}
                />
                <Bar dataKey="count" fill="var(--text-secondary)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-between items-center text-xs text-app-muted mt-4 pt-4 border-t border-app-borderDivider">
            <span>
              {totalFindings > 0 
                ? `${metrics.finding_counts_by_type.EXECUTION_GAP + metrics.finding_counts_by_type.REPEATED_INCIDENT} of ${totalFindings} findings from execution gaps & repeated incidents`
                : 'No supervisory findings recorded'}
            </span>
            <button 
              onClick={onNavigateToFindings} 
              className="text-app-heading hover:underline font-medium flex items-center"
            >
              View all <ChevronRight className="w-3 h-3 ml-0.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Validation Precision Widget (Only shown if labels exist) */}
      {validationSummary?.available && validationSummary?.latest_run && (
        <div className="bg-app-surface rounded-md p-6 border border-app-borderSubtle">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-medium text-app-secondary uppercase tracking-wider">Expert Validation Precision</h3>
            <span className="text-xs text-app-muted">{validationSummary.latest_run.expert_label_count} labels analyzed</span>
          </div>
          <div className="flex flex-wrap gap-6">
            <div className="flex flex-col">
              <span className="text-2xl font-bold text-app-heading">
                {validationSummary.latest_run.metrics.overall_precision != null ? (validationSummary.latest_run.metrics.overall_precision * 100).toFixed(1) + '%' : 'N/A'}
              </span>
              <span className="text-xs text-app-muted">System Precision</span>
            </div>
            <div className="flex flex-col">
              <span className="text-2xl font-bold text-app-heading">
                {validationSummary.latest_run.metrics.overall_recall != null ? (validationSummary.latest_run.metrics.overall_recall * 100).toFixed(1) + '%' : 'N/A'}
              </span>
              <span className="text-xs text-app-muted">System Recall</span>
            </div>
            <div className="flex flex-col ml-auto text-right">
              <span className="text-xs text-app-secondary">Methodology: {validationSummary.latest_run.methodology_version}</span>
              <span className="text-xs text-app-secondary">Verified Findings: {validationSummary.latest_run.metrics.true_positives} / {(validationSummary.latest_run.metrics.true_positives || 0) + (validationSummary.latest_run.metrics.false_positives || 0)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 5. Entity Triage & Priority Ranking Table */}
      <div className="bg-transparent overflow-hidden mt-2">
        <div className="py-4 border-b border-app-borderDivider flex items-center justify-between">
          <div>
            <h3 className="text-xs font-medium text-app-heading uppercase tracking-wider">
              Supervisory entity triage & priority ranking
            </h3>
            <p className="text-xs text-app-muted mt-1">
              Rank-ordered entity risk index for manual supervisory oversight
            </p>
          </div>
          <button
            onClick={onNavigateToEntities}
            className="text-app-heading hover:underline text-xs font-medium flex items-center transition-colors"
          >
            <span>View all entities</span>
            <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-transparent text-app-muted uppercase tracking-wider text-[11px] font-medium border-b border-app-borderDivider">
              <tr>
                <th className="px-4 py-3 font-medium">Entity ID</th>
                <th className="px-4 py-3 font-medium">Sector</th>
                <th className="px-4 py-3 font-medium text-right">Risk score</th>
                <th className="px-4 py-3 font-medium text-center">Risk level</th>
                <th className="px-4 py-3 font-medium text-center">Findings</th>
                <th className="px-4 py-3 font-medium text-center">Freshness</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-borderDivider">
              {topEntities.length > 0 ? (
                topEntities.map((ent, idx) => {
                  const isTopRisk = ent.risk_level === 'CRITICAL' || ent.risk_level === 'HIGH';
                  const riskColor = RISK_COLORS[ent.risk_level] || 'var(--text-primary)';
                  const isStale = (ent.component_scores && (
                    (ent.component_scores.NEGATIVE_SPACE?.raw_module_score ?? 0) > 0 ||
                    (ent.component_scores.negative_space ?? 0) > 0
                  ));

                  return (
                    <tr
                      key={ent.entity_id}
                      onClick={() => onNavigateToEntity(ent.entity_id)}
                      className={`hover:bg-app-surface2 transition-colors cursor-pointer ${
                        idx === 0 && isTopRisk ? 'bg-app-surface2/40' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-app-heading text-xs">{ent.entity_id}</span>
                          {idx === 0 && isTopRisk && (
                            <span className="text-[10px] text-app-muted">
                              (highest risk)
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-app-secondary truncate max-w-[240px] mt-0.5">
                          {ent.entity_name}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-app-secondary">
                        {ent.sector}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <span className="font-medium text-xs" style={{ color: riskColor }}>
                          {ent.risk_score.toFixed(1)}
                        </span>
                        <span className="text-xs text-app-muted ml-1">/ 100</span>
                      </td>

                      <td className="px-4 py-3 text-center font-medium capitalize" style={{ color: riskColor }}>
                        {ent.risk_level.toLowerCase()}
                      </td>

                      <td className="px-4 py-3 text-center text-app-heading font-normal">
                        {ent.finding_count}
                      </td>

                      <td className="px-4 py-3 text-center">
                        {isStale ? (
                          <span className="text-xs font-normal" style={{ color: RISK_COLORS.HIGH }}>
                            Telemetry gap
                          </span>
                        ) : (
                          <span className="text-app-muted text-xs">
                            Nominal (&lt;1h)
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onNavigateToEntity(ent.entity_id);
                          }}
                          className="px-3 py-1.5 text-xs font-normal bg-transparent hover:bg-app-surface2 text-app-text border border-app-borderBtn rounded transition-colors"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-app-muted text-xs">
                    {entitiesLoading ? 'Loading entity ranking...' : 'No entities recorded.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
