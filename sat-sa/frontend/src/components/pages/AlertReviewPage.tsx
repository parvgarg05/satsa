import React, { useState, useEffect } from 'react';
import { FileSearch, Search, Filter, AlertTriangle, ArrowUpRight, Clock, ShieldAlert } from 'lucide-react';
import { fetchAlertPriorities } from '../../lib/api';

interface AlertPriorityRow {
  alert_id: string;
  entity_id: string;
  severity: string;
  priority_score: number;
  priority_level: string;
  primary_signal: string;
  reasons: string[];
  evidence_ids: string[];
  status: string;
  asset_id: string;
}

export function AlertReviewPage({ onInspectEvidence }: { onInspectEvidence: (id: string) => void }) {
  const [alerts, setAlerts] = useState<AlertPriorityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [limit, setLimit] = useState<number>(25);
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [priorityFilter, setPriorityFilter] = useState('ALL');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetchAlertPriorities({
          limit,
          severity: severityFilter,
          priority_level: priorityFilter
        });
        setAlerts(res.alerts);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to load alert priorities');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [limit, severityFilter, priorityFilter]);

  const getPriorityColor = (level: string) => {
    switch (level) {
      case 'CRITICAL': return 'text-red-400 bg-red-400/10 border-red-400/20';
      case 'HIGH': return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
      case 'MEDIUM': return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
      default: return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
    }
  };

  const getSeverityBadge = (sev: string) => {
    switch (sev) {
      case 'CRITICAL': return 'bg-red-500/20 text-red-400';
      case 'HIGH': return 'bg-orange-500/20 text-orange-400';
      case 'MEDIUM': return 'bg-yellow-500/20 text-yellow-400';
      default: return 'bg-blue-500/20 text-blue-400';
    }
  };

  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-app-heading flex items-center">
          <FileSearch className="w-6 h-6 mr-2 text-app-accent" />
          Alert Review Queue
        </h1>
        <p className="text-app-muted mt-1 text-sm">
          Prioritized alert samples for supervisory manual review.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-app-surface border border-app-borderDivider rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-app-muted" />
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="bg-app-bg border border-app-borderBtn text-app-text text-sm rounded px-3 py-1.5 focus:outline-none focus:border-app-accent transition-colors"
            >
              <option value="ALL">All Priorities</option>
              <option value="CRITICAL">Critical Priority</option>
              <option value="HIGH">High Priority</option>
              <option value="MEDIUM">Medium Priority</option>
              <option value="LOW">Low Priority</option>
            </select>
          </div>

          <div className="flex items-center space-x-2">
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="bg-app-bg border border-app-borderBtn text-app-text text-sm rounded px-3 py-1.5 focus:outline-none focus:border-app-accent transition-colors"
            >
              <option value="ALL">All Severities</option>
              <option value="CRITICAL">Critical Alerts</option>
              <option value="HIGH">High Alerts</option>
              <option value="MEDIUM">Medium Alerts</option>
              <option value="LOW">Low Alerts</option>
            </select>
          </div>
        </div>

        <div className="flex items-center space-x-3 text-sm">
          <span className="text-app-muted">Review Sample Size:</span>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="bg-app-bg border border-app-borderBtn text-app-text rounded px-2 py-1 focus:outline-none focus:border-app-accent"
          >
            <option value={10}>Top 10</option>
            <option value={25}>Top 25</option>
            <option value={50}>Top 50</option>
            <option value={100}>Top 100</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-app-surface border border-app-borderDivider rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-app-muted text-sm">Calculating review priorities...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-400 text-sm flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 mr-2" />
            {error}
          </div>
        ) : alerts.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center">
            <ShieldAlert className="w-10 h-10 text-app-muted mb-3 opacity-20" />
            <p className="text-app-heading font-medium">No alerts in queue</p>
            <p className="text-app-muted text-sm mt-1">Try adjusting your filters or run the analysis pipeline.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-app-muted uppercase bg-app-surface2/50 border-b border-app-borderDivider">
                <tr>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Alert ID</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Severity</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Primary Signal</th>
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-borderDivider">
                {alerts.map((row) => (
                  <React.Fragment key={row.alert_id}>
                    <tr 
                      className="hover:bg-app-surface2/30 cursor-pointer transition-colors group"
                      onClick={() => setExpandedRow(expandedRow === row.alert_id ? null : row.alert_id)}
                    >
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border ${getPriorityColor(row.priority_level)}`}>
                          {row.priority_level}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-app-accent">{row.alert_id}</td>
                      <td className="px-4 py-3 font-medium text-app-heading">{row.entity_id}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${getSeverityBadge(row.severity)}`}>
                          {row.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono">{row.priority_score.toFixed(1)}</td>
                      <td className="px-4 py-3 text-app-text truncate max-w-[200px]">{row.primary_signal}</td>
                      <td className="px-4 py-3 text-app-muted font-mono">{row.asset_id}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-app-muted px-2 py-1 bg-app-surface2 rounded">
                          {row.status}
                        </span>
                      </td>
                    </tr>
                    
                    {/* Expanded Detail Row */}
                    {expandedRow === row.alert_id && (
                      <tr className="bg-app-bg border-b-2 border-app-borderDivider">
                        <td colSpan={8} className="px-6 py-6">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            
                            {/* Left: Why it was prioritized */}
                            <div>
                              <h4 className="text-sm font-semibold text-app-heading mb-3 flex items-center">
                                Why This Alert Was Prioritized
                              </h4>
                              <div className="bg-app-surface2 rounded border border-app-borderDivider overflow-hidden">
                                <ul className="divide-y divide-app-borderDivider">
                                  {row.reasons.map((r, i) => {
                                    const parts = r.split('(+');
                                    return (
                                      <li key={i} className="px-4 py-2 flex justify-between text-sm">
                                        <span className="text-app-text">{parts[0]}</span>
                                        {parts[1] && (
                                          <span className="text-app-accent font-mono font-medium">+{parts[1].replace(')', '')}</span>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                                <div className="px-4 py-3 bg-app-surface border-t border-app-borderDivider flex justify-between items-center">
                                  <span className="font-bold text-app-heading">TOTAL REVIEW PRIORITY</span>
                                  <span className="font-mono text-lg font-bold text-app-accent">{row.priority_score.toFixed(1)}</span>
                                </div>
                              </div>
                            </div>
                            
                            {/* Right: Evidence links */}
                            <div>
                              <h4 className="text-sm font-semibold text-app-heading mb-3">Supporting Evidence</h4>
                              <div className="flex flex-wrap gap-2">
                                {row.evidence_ids.map(evId => (
                                  <button
                                    key={evId}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onInspectEvidence(evId);
                                    }}
                                    className="flex items-center px-3 py-1.5 bg-app-surface2 hover:bg-app-borderBtn border border-app-borderDivider rounded text-sm text-app-text transition-colors"
                                  >
                                    <FileSearch className="w-4 h-4 mr-1.5 text-app-muted" />
                                    <span className="font-mono">{evId}</span>
                                    <ArrowUpRight className="w-3 h-3 ml-1 text-app-muted" />
                                  </button>
                                ))}
                              </div>
                              <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded text-sm text-blue-400">
                                <p className="flex items-start">
                                  <Clock className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
                                  <span>This alert is recommended for manual supervisory review due to concurrent high-risk signals.</span>
                                </p>
                              </div>
                            </div>
                            
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
