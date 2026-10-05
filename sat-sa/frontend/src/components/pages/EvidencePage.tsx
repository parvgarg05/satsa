import React, { useState, useEffect } from 'react';
import { 
  Database, Search, ChevronRight, Activity, AlertTriangle 
} from 'lucide-react';
import { fetchFindings } from '../../lib/api';
import type { Finding } from '../../types/api';
import { EvidenceModal } from '../EvidenceModal';

interface EvidenceRecordRow {
  evidence_id: string;
  type: 'Alert' | 'Case' | 'Asset' | 'Finding';
  entity_id: string;
  finding_title: string;
  source: string;
}

interface EvidencePageProps {
  initialEvidenceId?: string | null;
  onNavigateToEntity?: (entityId: string) => void;
}

export function EvidencePage({ initialEvidenceId, onNavigateToEntity }: EvidencePageProps) {
  const [evidenceList, setEvidenceList] = useState<EvidenceRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'Alert' | 'Case' | 'Asset'>('ALL');
  const [entityFilter, setEntityFilter] = useState('ALL');

  // Direct lookup input
  const [directIdInput, setDirectIdInput] = useState('');

  // Active modal
  const [activeEvidenceId, setActiveEvidenceId] = useState<string | null>(initialEvidenceId || null);

  useEffect(() => {
    let isMounted = true;
    async function loadEvidenceIndex() {
      setLoading(true);
      try {
        const res = await fetchFindings();
        const recordsMap = new Map<string, EvidenceRecordRow>();

        for (const f of res.findings) {
          for (const evId of f.evidence_ids || []) {
            if (!recordsMap.has(evId)) {
              let type: 'Alert' | 'Case' | 'Asset' = 'Alert';
              if (evId.startsWith('AST-')) type = 'Asset';
              else if (evId.startsWith('CAS-')) type = 'Case';

              recordsMap.set(evId, {
                evidence_id: evId,
                type,
                entity_id: f.entity_id,
                finding_title: f.title,
                source: 'sat_sa.db (Local SQLite)',
              });
            }
          }
        }

        const sorted = Array.from(recordsMap.values()).sort((a, b) => {
          const cmp = a.entity_id.localeCompare(b.entity_id);
          if (cmp !== 0) return cmp;
          return a.evidence_id.localeCompare(b.evidence_id);
        });

        if (isMounted) {
          setEvidenceList(sorted);
          setError(null);
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Failed to index evidence records');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadEvidenceIndex();
    return () => { isMounted = false; };
  }, []);

  // Filtered rows
  const filteredRows = evidenceList.filter(row => {
    if (typeFilter !== 'ALL' && row.type !== typeFilter) return false;
    if (entityFilter !== 'ALL' && row.entity_id !== entityFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return row.evidence_id.toLowerCase().includes(q) || 
             row.entity_id.toLowerCase().includes(q) || 
             row.finding_title.toLowerCase().includes(q);
    }
    return true;
  });

  const uniqueEntities = ['ALL', ...Array.from(new Set(evidenceList.map(r => r.entity_id))).sort()];

  const handleDirectLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (directIdInput.trim()) {
      setActiveEvidenceId(directIdInput.trim().toUpperCase());
    }
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-app-borderDivider pb-4">
        <div>
          <h1 className="text-lg font-semibold text-app-text tracking-tight">Evidence Data Explorer</h1>
          <p className="text-xs text-app-secondary mt-1">
            Traceable SQLite forensic records linking regulatory conclusions to raw database tables
          </p>
        </div>
        <div className="text-xs text-app-muted">
          Showing <span className="font-medium text-app-text">{filteredRows.length}</span> linked records
        </div>
      </div>

      {/* Direct ID Lookup & Filter Controls */}
      <div className="bg-app-surface rounded-md p-4 space-y-4">
        {/* Direct Query Form */}
        <form onSubmit={handleDirectLookup} className="flex gap-2">
          <div className="relative flex-1">
            <Database className="w-4 h-4 text-app-muted absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Direct ID lookup (e.g. ALT-00440, AST-007-01, CAS-00383)..."
              value={directIdInput}
              onChange={(e) => setDirectIdInput(e.target.value)}
              className="w-full bg-app-surface2 border border-app-borderStrong rounded px-3 pl-9 py-2 text-xs text-app-text font-mono placeholder:text-app-muted focus:outline-none focus:border-app-accent transition-colors"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-app-text text-app-bg font-medium text-xs rounded hover:opacity-90 transition-opacity shrink-0"
          >
            Inspect record
          </button>
        </form>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs pt-4 border-t border-app-borderDivider">
          {/* Search Query in List */}
          <div className="relative">
            <Search className="w-4 h-4 text-app-muted absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search evidence table..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-app-surface2 border border-app-borderStrong rounded px-3 pl-9 py-2 text-app-text placeholder:text-app-muted focus:outline-none focus:border-app-accent transition-colors"
            />
          </div>

          {/* Record Type */}
          <div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="w-full bg-app-surface2 border border-app-borderStrong rounded px-3 py-2 text-app-text focus:outline-none focus:border-app-accent transition-colors"
            >
              <option value="ALL">All evidence types</option>
              <option value="Alert">Alerts (ALT-*)</option>
              <option value="Case">Cases (CAS-*)</option>
              <option value="Asset">Assets (AST-*)</option>
            </select>
          </div>

          {/* Entity Filter */}
          <div>
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="w-full bg-app-surface2 border border-app-borderStrong rounded px-3 py-2 text-app-text focus:outline-none focus:border-app-accent transition-colors"
            >
              {uniqueEntities.map(ent => (
                <option key={ent} value={ent}>{ent === 'ALL' ? 'All entities' : ent}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Evidence Table */}
      <div className="bg-transparent overflow-hidden mt-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-app-secondary">
            <Activity className="w-5 h-5 animate-spin text-app-muted mb-2" />
            <span className="text-xs text-app-muted">Indexing SQLite evidence records...</span>
          </div>
        ) : error ? (
          <div className="p-6 text-center text-red-500 text-xs">
            <AlertTriangle className="w-4 h-4 mx-auto mb-1.5" />
            {error}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-10 text-center text-app-muted text-xs">
            No evidence records matched your criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-transparent text-app-muted uppercase tracking-wider text-[11px] font-medium border-b border-app-borderDivider">
                <tr>
                  <th className="px-4 py-3 font-medium">Evidence ID</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Associated finding</th>
                  <th className="px-4 py-3 font-medium">Source store</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-borderDivider">
                {filteredRows.slice(0, 100).map((row) => {
                  return (
                    <tr
                      key={row.evidence_id}
                      onClick={() => setActiveEvidenceId(row.evidence_id)}
                      className="hover:bg-app-surface2 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3 font-mono font-medium text-app-text">
                        {row.evidence_id}
                      </td>

                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded bg-transparent border border-app-borderDivider text-xs text-app-secondary">
                          {row.type}
                        </span>
                      </td>

                      <td className="px-4 py-3 font-mono text-app-text">
                        {row.entity_id}
                      </td>

                      <td className="px-4 py-3 text-app-secondary truncate max-w-[280px]">
                        {row.finding_title}
                      </td>

                      <td className="px-4 py-3 text-app-muted font-mono text-[11px]">
                        {row.source}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveEvidenceId(row.evidence_id);
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

      {activeEvidenceId && (
        <EvidenceModal 
          evidenceId={activeEvidenceId} 
          onClose={() => setActiveEvidenceId(null)} 
        />
      )}
    </div>
  );
}
