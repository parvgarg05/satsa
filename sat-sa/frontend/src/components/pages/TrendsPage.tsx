import React, { useState, useEffect } from 'react';
import { fetchTrends, fetchEntities } from '../../lib/api';
import { Activity, Info, BarChart2, TrendingUp, AlertTriangle } from 'lucide-react';

export function TrendsPage() {
  const [entities, setEntities] = useState<any[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<string>('ALL');
  const [days, setDays] = useState<number>(30);
  
  const [trends, setTrends] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredTrend, setHoveredTrend] = useState<any | null>(null);

  useEffect(() => {
    fetchEntities().then(res => setEntities(res.entities));
  }, []);

  useEffect(() => {
    setLoading(true);
    const ent = selectedEntity === 'ALL' ? undefined : selectedEntity;
    fetchTrends(ent, days)
      .then(res => {
        setTrends(res);
        setError(null);
      })
      .catch(err => {
        setError(err.message);
        setTrends(null);
      })
      .finally(() => setLoading(false));
  }, [selectedEntity, days]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-app-heading flex items-center">
          <TrendingUp className="w-6 h-6 mr-2 text-app-accent" />
          Temporal Trend Analysis
        </h1>
        <p className="text-app-muted mt-1 text-sm">
          Observe historical trends across critical alerts, findings, and peer behavior.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-app-surface border border-app-borderDivider rounded-lg p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center space-x-2">
          <span className="text-sm text-app-muted">Entity:</span>
          <select 
            value={selectedEntity} 
            onChange={e => setSelectedEntity(e.target.value)}
            className="bg-app-bg border border-app-borderBtn text-app-text px-3 py-1.5 rounded text-sm focus:border-app-accent"
          >
            <option value="ALL">All Entities (Sector View)</option>
            {entities.map(e => <option key={e.entity_id} value={e.entity_id}>{e.entity_name} ({e.entity_id})</option>)}
          </select>
        </div>
        
        <div className="flex items-center space-x-2">
          <span className="text-sm text-app-muted">Time Window:</span>
          <select 
            value={days} 
            onChange={e => setDays(Number(e.target.value))}
            className="bg-app-bg border border-app-borderBtn text-app-text px-3 py-1.5 rounded text-sm focus:border-app-accent"
          >
            <option value={7}>Last 7 Days</option>
            <option value={30}>Last 30 Days</option>
            <option value={90}>Last 90 Days</option>
            <option value={365}>Last 1 Year</option>
          </select>
        </div>

        {/* Explainability & Methodology Info Popover */}
        <div className="relative group inline-flex items-center">
          <button 
            type="button" 
            aria-label="Explainability & Methodology"
            className="p-1.5 rounded-full text-app-muted hover:text-app-accent hover:bg-app-surface2 transition-colors cursor-pointer focus:outline-none"
            title="Explainability & Methodology"
          >
            <Info className="w-4 h-4 text-app-accent" />
          </button>

          {/* Hover Tooltip / Popover */}
          <div className="hidden group-hover:block absolute left-0 sm:left-auto sm:right-0 top-full pt-1.5 z-50 w-80 sm:w-96 pointer-events-auto">
            <div className="bg-app-surface border border-app-borderDivider rounded-lg p-4 shadow-xl text-xs text-app-muted">
              <strong className="text-app-text block mb-1">Explainability & Methodology</strong>
              <p className="mb-1">
                <strong>Source Records:</strong> Underlying SQLite <code>alerts</code> and <code>supervisory_findings</code> tables.
              </p>
              <p className="mb-1">
                <strong>Aggregation:</strong> Date buckets (YYYY-MM-DD) derived natively from timestamp fields. 
                Metrics display strict sums (e.g., Numerator = count of CRITICAL/HIGH alerts; Denominator = total alerts per day bucket).
              </p>
              <p>
                <strong>Peer Group:</strong> If &quot;All Entities&quot; is selected, the baseline represents the full sector aggregate, establishing a median peer curve. 
                No predictive AI is utilized to extrapolate historical data.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-app-muted text-sm p-4">Aggregating temporal data...</div>
      ) : error ? (
        <div className="text-red-400 flex items-center p-4 bg-red-500/10 rounded"><AlertTriangle className="mr-2" />{error}</div>
      ) : (!trends || trends.alert_trends.length === 0) ? (
        <div className="p-12 text-center flex flex-col items-center bg-app-surface border border-app-borderDivider rounded">
          <BarChart2 className="w-10 h-10 text-app-muted opacity-30 mb-3" />
          <p className="text-app-heading font-medium">Insufficient historical data</p>
          <p className="text-app-muted text-sm mt-1 max-w-md">
            The dataset lacks enough alert history in the selected window to produce a meaningful trend. 
            Try expanding the time window.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          
          {/* Trend: Alert Volume */}
          <div className="bg-app-surface border border-app-borderDivider rounded p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <h3 className="font-bold text-app-heading flex items-center">
                <Activity className="w-4 h-4 mr-2 text-app-accent" />
                Critical/High Alert Volume Trend
              </h3>
              {hoveredTrend ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs bg-app-surface2 px-3 py-1 rounded border border-app-borderDivider">
                  <span className="font-mono text-app-text font-semibold">{hoveredTrend.date_bucket}</span>
                  <span className="text-red-400 font-medium">Critical: {hoveredTrend.critical_alerts}</span>
                  <span className="text-orange-400 font-medium">High: {hoveredTrend.high_alerts}</span>
                  <span className="text-app-muted">Other: {hoveredTrend.other_alerts}</span>
                  <span className="text-app-text font-bold">Total: {hoveredTrend.total_alerts}</span>
                </div>
              ) : (
                <span className="text-xs text-app-muted hidden sm:inline">Hover over bars for daily breakdown</span>
              )}
            </div>
            
            <div className="overflow-x-auto">
              <div className="min-w-[650px] h-72 flex items-end space-x-2 pt-20 pb-4">
                {trends.alert_trends.map((t: any, index: number) => {
                  const maxTotal = Math.max(...trends.alert_trends.map((x: any) => Number(x.total_alerts) || 0), 1);
                  const total = Number(t.total_alerts) || 0;
                  const critical = Number(t.critical_alerts) || 0;
                  const high = Number(t.high_alerts) || 0;
                  const other = Number(t.other_alerts ?? Math.max(0, total - critical - high)) || 0;

                  const hTotalPct = Math.max(Math.round((total / maxTotal) * 100), total > 0 ? 3 : 0);
                  const critPct = total > 0 ? (critical / total) * 100 : 0;
                  const highPct = total > 0 ? (high / total) * 100 : 0;
                  const otherPct = total > 0 ? Math.max(0, 100 - critPct - highPct) : 0;

                  const totalBars = trends.alert_trends.length;
                  const labelInterval = totalBars <= 10 ? 1 : totalBars <= 25 ? 3 : totalBars <= 45 ? 5 : totalBars <= 90 ? 10 : 30;
                  const showDateLabel = index === 0 || index === totalBars - 1 || index % labelInterval === 0;

                  return (
                    <div 
                      key={t.date_bucket} 
                      className="flex-1 h-full flex flex-col justify-end items-center group relative min-w-[16px]"
                      onMouseEnter={() => setHoveredTrend({ ...t, critical_alerts: critical, high_alerts: high, other_alerts: other, total_alerts: total })}
                      onMouseLeave={() => setHoveredTrend(null)}
                    >
                      {/* Tooltip (Positioned in upper headroom inside chart so it NEVER gets cut off) */}
                      <div className={`hidden group-hover:block absolute top-1 bg-app-surface border border-app-borderBtn p-2.5 rounded-lg shadow-2xl text-xs z-30 w-36 pointer-events-none ${
                        index < 3 
                          ? 'left-0' 
                          : index >= totalBars - 3 
                            ? 'right-0' 
                            : 'left-1/2 -translate-x-1/2'
                      }`}>
                        <div className="font-semibold text-app-heading pb-1 mb-1.5 border-b border-app-borderDivider font-mono text-[11px]">
                          {t.date_bucket}
                        </div>
                        <div className="space-y-1 text-[11px]">
                          <div className="flex justify-between items-center text-red-400">
                            <span>Critical:</span>
                            <span className="font-mono font-bold">{critical}</span>
                          </div>
                          <div className="flex justify-between items-center text-orange-400">
                            <span>High:</span>
                            <span className="font-mono font-bold">{high}</span>
                          </div>
                          <div className="flex justify-between items-center text-app-muted">
                            <span>Other:</span>
                            <span className="font-mono">{other}</span>
                          </div>
                          <div className="flex justify-between items-center text-app-text font-semibold pt-1 border-t border-app-borderDivider">
                            <span>Total:</span>
                            <span className="font-mono font-bold">{total}</span>
                          </div>
                        </div>
                      </div>

                      {/* Bar Plot Track */}
                      <div className="w-full flex-1 flex flex-col justify-end items-center">
                        <div
                          className="w-full max-w-[28px] rounded-t flex flex-col-reverse justify-start overflow-hidden relative group-hover:opacity-80 transition-all bg-app-surface2"
                          style={{ height: `${hTotalPct}%`, minHeight: total > 0 ? '4px' : '0px' }}
                        >
                          {critPct > 0 && (
                            <div
                              className="w-full bg-red-500/80"
                              style={{ height: `${critPct}%` }}
                            />
                          )}
                          {highPct > 0 && (
                            <div
                              className="w-full bg-orange-500/80"
                              style={{ height: `${highPct}%` }}
                            />
                          )}
                          {otherPct > 0 && (
                            <div
                              className="w-full bg-app-surface2 border-b border-app-borderDivider"
                              style={{ height: `${otherPct}%` }}
                            />
                          )}
                        </div>
                      </div>

                      {/* Date Axis Label (Clean intervals to prevent truncation '08...', with subtle dots for in-between bars) */}
                      {showDateLabel ? (
                        <span className="text-[10px] text-app-muted mt-2 font-mono whitespace-nowrap shrink-0 block text-center" title={t.date_bucket}>
                          {t.date_bucket.substring(5)}
                        </span>
                      ) : (
                        <div className="h-4 flex items-center justify-center mt-2 shrink-0" title={t.date_bucket}>
                          <div className="w-1 h-1 rounded-full bg-app-borderDivider group-hover:bg-app-accent/80 transition-colors" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-center space-x-6 text-sm">
              <div className="flex items-center"><span className="w-3 h-3 bg-red-500/80 rounded mr-2"></span> Critical</div>
              <div className="flex items-center"><span className="w-3 h-3 bg-orange-500/80 rounded mr-2"></span> High</div>
              <div className="flex items-center"><span className="w-3 h-3 bg-app-surface2 rounded border border-app-borderDivider mr-2"></span> Other</div>
            </div>
          </div>
          
          {/* Trend: Findings */}
          <div className="bg-app-surface border border-app-borderDivider rounded p-5">
            <h3 className="font-bold text-app-heading mb-4">Supervisory Finding Generation Trend</h3>
            {trends.finding_trends.length === 0 ? (
              <p className="text-app-muted text-sm text-center py-8">No findings generated in this window.</p>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="bg-app-surface2/50 border-b border-app-borderDivider">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Finding Type</th>
                    <th className="px-4 py-2">Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-borderDivider">
                  {trends.finding_trends.map((ft: any, i: number) => (
                    <tr key={i} className="hover:bg-app-surface2/30">
                      <td className="px-4 py-2 font-mono text-app-muted">{ft.date_bucket}</td>
                      <td className="px-4 py-2 font-medium">{ft.finding_type}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center">
                          <span className="w-8 inline-block">{ft.count}</span>
                          <div className="h-1.5 bg-app-accent/30 rounded w-full max-w-[100px]">
                            <div className="h-full bg-app-accent rounded" style={{ width: `${Math.min(100, ft.count * 10)}%` }}></div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          
        </div>
      )}
    </div>
  );
}
