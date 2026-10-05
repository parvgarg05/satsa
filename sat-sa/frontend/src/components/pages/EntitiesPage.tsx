import React, { useState, useEffect } from 'react';
import { 
  Search, Activity, AlertTriangle 
} from 'lucide-react';
import { fetchEntities } from '../../lib/api';
import type { EntitySummary } from '../../types/api';

const RISK_COLORS: Record<string, string> = {
  CRITICAL: '#B85C5C',
  HIGH: '#C8794A',
  MEDIUM: '#C19A4A',
  LOW: '#5FAF83',
};

const SECTORS = ['ALL', 'Energy', 'Banking', 'Defence', 'Telecom', 'Transport', 'Healthcare'];

interface EntitiesPageProps {
  onSelectEntity: (entityId: string) => void;
}

function getComponentValue(ent: EntitySummary, key: 'EXECUTION_GAP' | 'NEGATIVE_SPACE' | 'ANOMALY' | 'PEER_DEVIATION' | 'REPEATED_INCIDENT'): { raw: number; contrib: number } {
  const lowerKey = key.toLowerCase();
  const lowerAlt = lowerKey === 'repeated_incident' ? 'repeated_incidents' : lowerKey;

  let raw = 0;
  let contrib = 0;

  if (ent.component_scores) {
    const entry = ent.component_scores[key] ?? ent.component_scores[lowerKey] ?? ent.component_scores[lowerAlt];
    if (typeof entry === 'number') {
      raw = entry;
    } else if (entry && typeof entry === 'object') {
      raw = entry.raw_module_score ?? entry.raw_score ?? 0;
      contrib = entry.weighted_contribution ?? entry.contribution ?? 0;
    }
  }

  if (raw === 0 && ent.component_raw_scores) {
    raw = ent.component_raw_scores[lowerKey] ?? ent.component_raw_scores[lowerAlt] ?? ent.component_raw_scores[key] ?? 0;
  }
  if (contrib === 0 && ent.component_weighted_contributions) {
    contrib = ent.component_weighted_contributions[lowerKey] ?? ent.component_weighted_contributions[lowerAlt] ?? ent.component_weighted_contributions[key] ?? 0;
  }

  return { raw, contrib };
}

export function EntitiesPage({ onSelectEntity }: EntitiesPageProps) {
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter and sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [sectorFilter, setSectorFilter] = useState('ALL');
  const [riskLevelFilter, setRiskLevelFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<'risk_score_desc' | 'risk_score_asc' | 'finding_count_desc' | 'name_asc'>('risk_score_desc');

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setLoading(true);
      try {
        let sort = 'risk_score';
        let order = 'desc';

        if (sortBy === 'risk_score_asc') {
          sort = 'risk_score';
          order = 'asc';
        } else if (sortBy === 'finding_count_desc') {
          sort = 'finding_count';
          order = 'desc';
        } else if (sortBy === 'name_asc') {
          sort = 'entity_name';
          order = 'asc';
        }

        const res = await fetchEntities({
          sector: sectorFilter,
          risk_level: riskLevelFilter,
          sort,
          order,
        });

        if (isMounted) {
          setEntities(res.entities);
          setError(null);
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Failed to fetch entities list');
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => { isMounted = false; };
  }, [sectorFilter, riskLevelFilter, sortBy]);

  // Client-side text search on entity ID or name
  const filteredEntities = entities.filter(ent => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return ent.entity_id.toLowerCase().includes(q) || ent.entity_name.toLowerCase().includes(q);
  });

  return (
      <div className="space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-app-borderDivider pb-4">
        <div>
          <h1 className="text-lg font-semibold text-app-heading tracking-tight">Monitored Entities</h1>
          <p className="text-xs text-app-secondary mt-1">
            Cross-sector entity inventory and deterministic supervisory risk scores
          </p>
        </div>
        <div className="text-xs text-app-muted">
          Showing <span className="font-medium text-app-heading">{filteredEntities.length}</span> entities
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div className="bg-app-surface rounded-md p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-app-muted absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search by ID or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-app-surface2 border border-app-borderStrong rounded px-3 pl-9 py-2 text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent transition-colors"
            />
          </div>

          {/* Sector */}
          <div>
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="w-full bg-app-surface2 border border-app-borderStrong rounded px-3 py-2 text-app-text focus:outline-none focus:border-app-accent transition-colors"
            >
              <option value="ALL">All Sectors</option>
              {SECTORS.filter(s => s !== 'ALL').map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Risk Level */}
          <div>
            <select
              value={riskLevelFilter}
              onChange={(e) => setRiskLevelFilter(e.target.value)}
              className="w-full bg-app-surface2 border border-app-borderStrong rounded px-3 py-2 text-app-text focus:outline-none focus:border-app-accent transition-colors"
            >
              <option value="ALL">All Risk Tiers</option>
              <option value="CRITICAL">Critical (80–100)</option>
              <option value="HIGH">High (60–79)</option>
              <option value="MEDIUM">Medium (30–59)</option>
              <option value="LOW">Low (0–29)</option>
            </select>
          </div>

          {/* Sort By */}
          <div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full bg-app-surface2 border border-app-borderStrong rounded px-3 py-2 text-app-text focus:outline-none focus:border-app-accent transition-colors"
            >
              <option value="risk_score_desc">Risk score (highest first)</option>
              <option value="risk_score_asc">Risk score (lowest first)</option>
              <option value="finding_count_desc">Findings count (highest)</option>
              <option value="name_asc">Entity name (A–Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-transparent overflow-hidden mt-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-app-secondary">
            <Activity className="w-5 h-5 animate-spin text-app-muted mb-2" />
            <span className="text-xs text-app-muted">Loading entity inventory...</span>
          </div>
        ) : error ? (
          <div className="p-6 text-center text-red-400 text-xs">
            <AlertTriangle className="w-4 h-4 mx-auto mb-1.5" />
            {error.includes('fetch') || error.includes('network') || error.includes('connect')
              ? 'Cannot connect to backend. Ensure the SAT-SA server is running on port 4000.'
              : error}
          </div>
        ) : filteredEntities.length === 0 && entities.length === 0 ? (
          <div className="p-10 flex flex-col items-center text-center">
            <AlertTriangle className="w-6 h-6 text-app-muted mb-3" />
            <p className="text-sm font-medium text-app-text mb-1">No entities found</p>
            <p className="text-xs text-app-secondary mb-3 max-w-sm leading-relaxed">
              No entities have been loaded into the database. Upload a dataset with entity records
              and run the analytics pipeline via the Analysis Workflow page.
            </p>
            <p className="text-xs text-app-muted">→ Use the <strong className="font-medium text-app-text">Analysis Workflow</strong> in the sidebar</p>
          </div>
        ) : filteredEntities.length === 0 ? (
          <div className="p-10 text-center text-app-muted text-xs">
            No entities match the selected criteria. Try adjusting your sector, risk level, or search query.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-transparent text-app-muted uppercase tracking-wider text-[11px] font-medium border-b border-app-borderDivider">
                <tr>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Sector</th>
                  <th className="px-4 py-3 font-medium text-right">Risk score</th>
                  <th className="px-4 py-3 font-medium text-center">Risk level</th>
                  <th className="px-3 py-3 font-medium text-right" title="Execution gap (30% weight)">Execution gap</th>
                  <th className="px-3 py-3 font-medium text-right" title="Negative space (25% weight)">Negative space</th>
                  <th className="px-3 py-3 font-medium text-right" title="Isolation Forest anomaly (20% weight)">Anomaly</th>
                  <th className="px-3 py-3 font-medium text-right" title="Cross-entity peer deviation (15% weight)">Peer dev</th>
                  <th className="px-3 py-3 font-medium text-right" title="Repeated incident clustering (10% weight)">Repeat inc</th>
                  <th className="px-4 py-3 font-medium text-center">Findings</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-borderDivider">
                {filteredEntities.map((ent, idx) => {
                  const isTopRisk = ent.risk_level === 'CRITICAL' || ent.risk_level === 'HIGH';
                  const riskColor = RISK_COLORS[ent.risk_level] || 'var(--text-primary)';
                  const eg = getComponentValue(ent, 'EXECUTION_GAP');
                  const ns = getComponentValue(ent, 'NEGATIVE_SPACE');
                  const an = getComponentValue(ent, 'ANOMALY');
                  const pc = getComponentValue(ent, 'PEER_DEVIATION');
                  const ri = getComponentValue(ent, 'REPEATED_INCIDENT');

                  return (
                    <tr
                      key={ent.entity_id}
                      onClick={() => onSelectEntity(ent.entity_id)}
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
                        <div className="text-xs text-app-secondary truncate max-w-[220px] mt-0.5">
                          {ent.entity_name}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-app-secondary">
                        {ent.sector}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <span className="font-mono font-medium text-xs" style={{ color: riskColor }}>
                          {ent.risk_score.toFixed(1)}
                        </span>
                        <span className="text-xs text-app-muted ml-1">/ 100</span>
                      </td>

                      <td className="px-4 py-3 text-center font-medium capitalize" style={{ color: riskColor }}>
                        {ent.risk_level.toLowerCase()}
                      </td>

                      {/* Execution gap */}
                      <td className="px-3 py-3 text-right font-mono text-app-text">
                        <span>{eg.contrib.toFixed(1)}</span>
                        <span className="text-[10px] text-app-muted ml-0.5">pts</span>
                      </td>

                      {/* Negative space */}
                      <td className="px-3 py-3 text-right font-mono text-app-text">
                        <span>{ns.contrib.toFixed(1)}</span>
                        <span className="text-[10px] text-app-muted ml-0.5">pts</span>
                      </td>

                      {/* Anomaly */}
                      <td className="px-3 py-3 text-right font-mono text-app-text">
                        <span>{an.contrib.toFixed(1)}</span>
                        <span className="text-[10px] text-app-muted ml-0.5">pts</span>
                      </td>

                      {/* Peer deviation */}
                      <td className="px-3 py-3 text-right font-mono text-app-text">
                        <span>{pc.contrib.toFixed(1)}</span>
                        <span className="text-[10px] text-app-muted ml-0.5">pts</span>
                      </td>

                      {/* Repeated incidents */}
                      <td className="px-3 py-3 text-right font-mono text-app-text">
                        <span>{ri.contrib.toFixed(1)}</span>
                        <span className="text-[10px] text-app-muted ml-0.5">pts</span>
                      </td>

                      <td className="px-4 py-3 text-center text-app-heading font-normal">
                        {ent.finding_count}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectEntity(ent.entity_id);
                          }}
                          className="px-3 py-1.5 text-xs font-normal bg-transparent hover:bg-app-surface2 text-app-text border border-app-borderBtn rounded transition-colors"
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
