import React, { useState, useEffect } from 'react';
import { fetchReport, fetchEntities } from '../../lib/api';
import { FileText, Download, Printer, Shield, AlertTriangle, Building2, Activity, Loader2 } from 'lucide-react';

export function ReportPage({ onInspectEvidence }: { onInspectEvidence: (id: string) => void }) {
  const [entities, setEntities] = useState<any[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<string>('');
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loadingEntities, setLoadingEntities] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingEntities(true);
    fetchEntities()
      .then(res => {
        const list = res.entities || [];
        setEntities(list);
        if (list.length > 0) {
          setSelectedEntity(list[0].entity_id);
        }
      })
      .catch(err => {
        setError(err.message || 'Failed to load entities');
      })
      .finally(() => {
        setLoadingEntities(false);
      });
  }, []);

  useEffect(() => {
    if (!selectedEntity) return;
    setLoading(true);
    fetchReport(selectedEntity)
      .then(res => {
        setReport(res.report || null);
        setError(null);
      })
      .catch(err => {
        setError(err.message || 'Failed to load report');
        setReport(null);
      })
      .finally(() => setLoading(false));
  }, [selectedEntity]);

  const handlePrint = () => {
    const reportEl = document.getElementById('printable-report');
    if (!reportEl) {
      window.print();
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('title', 'Print Preview');
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map(el => el.outerHTML)
      .join('\n');

    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>SAT-SA Official Report - ${report?.entity?.entity_id || selectedEntity}</title>
  ${styles}
  <style>
    @page { margin: 12mm 15mm; size: A4 portrait; }
    html, body {
      background: #ffffff !important;
      color: #000000 !important;
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    #printable-report {
      width: 100% !important;
      max-width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      box-shadow: none !important;
      border: none !important;
    }
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  </style>
</head>
<body class="bg-white text-black p-4">
  ${reportEl.outerHTML}
</body>
</html>`);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        window.print();
      } finally {
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch {}
        }, 1000);
      }
    }, 250);
  };

  const handleCsvExport = () => {
    if (!report) return;

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Type,ID,Severity/Priority,Title/Signal,Evidence\n';

    if (report.risk && Array.isArray(report.risk.findings)) {
      report.risk.findings.forEach((f: any) => {
        const ev = Array.isArray(f.evidence_ids) ? f.evidence_ids.join(' ') : '';
        const title = (f.title || f.finding_id || '').replace(/"/g, '""');
        csvContent += `Finding,${f.finding_id},${f.severity},"${title}","${ev}"\n`;
      });
    }

    if (Array.isArray(report.prioritized_alerts)) {
      report.prioritized_alerts.forEach((a: any) => {
        const ev = Array.isArray(a.evidence_ids) ? a.evidence_ids.join(' ') : '';
        const signal = (a.primary_signal || a.category || '').replace(/"/g, '""');
        csvContent += `Alert,${a.alert_id},${a.priority_level},"${signal}","${ev}"\n`;
      });
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `sat-sa-report-${selectedEntity}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loadingEntities) {
    return (
      <div className="p-8 flex items-center space-x-2 text-app-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Loading entities...</span>
      </div>
    );
  }

  if (!entities.length) {
    return (
      <div className="p-8 text-app-muted">
        No entities available. Please upload a dataset in the Analysis Workflow first.
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20 print:p-0 print:m-0 print:space-y-0 print:w-full">
      {/* Non-printable controls */}
      <div className="print:hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-app-heading flex items-center">
            <FileText className="w-6 h-6 mr-2 text-app-accent" />
            Supervisory Assessment Report
          </h1>
          <p className="text-app-muted mt-1 text-sm">
            Generate printable, auditable offline reports for regulatory compliance.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedEntity}
            onChange={e => setSelectedEntity(e.target.value)}
            className="bg-app-surface2 border border-app-borderBtn text-app-text px-3 py-2 rounded focus:outline-none focus:border-app-accent text-sm"
          >
            {entities.map(e => (
              <option key={e.entity_id} value={e.entity_id}>
                {e.entity_name} ({e.entity_id})
              </option>
            ))}
          </select>
          <button
            onClick={handlePrint}
            disabled={!report}
            className="flex items-center px-4 py-2 bg-app-surface2 border border-app-borderBtn rounded hover:bg-app-borderDivider text-app-text text-sm transition-colors disabled:opacity-50"
          >
            <Printer className="w-4 h-4 mr-2" /> PDF Export
          </button>
          <button
            onClick={handleCsvExport}
            disabled={!report}
            className="flex items-center px-4 py-2 bg-app-surface2 border border-app-borderBtn rounded hover:bg-app-borderDivider text-app-text text-sm transition-colors disabled:opacity-50"
          >
            <Download className="w-4 h-4 mr-2" /> CSV Export
          </button>
        </div>
      </div>

      {loading && (
        <div className="p-6 flex items-center space-x-2 text-app-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Generating supervisory report...</span>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-md text-sm">
          Failed to load report: {error}
        </div>
      )}

      {/* Printable Report Page */}
      {report && !loading && (
        <div id="printable-report" className="bg-white text-black p-8 rounded-lg shadow-sm print:shadow-none print:m-0 print:p-0 print:w-full print:border-none print:text-black">
          <div className="border-b-2 border-black pb-4 mb-6 flex justify-between items-end">
            <div>
              <h2 className="text-3xl font-bold uppercase tracking-tight">SAT-SA Official Report</h2>
              <p className="text-sm text-gray-600 mt-1">
                Generated: {report.generated_at ? new Date(report.generated_at).toLocaleString() : new Date().toLocaleString()}
              </p>
            </div>
            <div className="text-right">
              <p className="font-bold text-xl">{report.entity?.entity_name || selectedEntity}</p>
              <p className="text-gray-600 text-sm">
                ID: {report.entity?.entity_id || selectedEntity} | Sector: {report.entity?.sector || 'Unknown'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-gray-100 p-4 rounded border border-gray-300">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Overall Risk Score</h3>
              <div className="text-5xl font-black">
                {report.risk?.final_risk_score != null
                  ? Number(report.risk.final_risk_score).toFixed(1)
                  : (report.risk?.risk_score != null ? Number(report.risk.risk_score).toFixed(1) : 'N/A')}
              </div>
              <div className="text-sm font-bold mt-2 text-gray-700">
                Risk Level: <span className="uppercase">{report.risk?.risk_level || 'N/A'}</span>
              </div>
            </div>
            <div className="bg-gray-100 p-4 rounded border border-gray-300">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Primary Risk Drivers</h3>
              <ul className="list-disc pl-5 space-y-1">
                {Array.isArray(report.risk?.primary_drivers) && report.risk.primary_drivers.length > 0 ? (
                  report.risk.primary_drivers.map((d: any, i: number) => (
                    <li key={i} className="text-sm font-medium">
                      {typeof d === 'string'
                        ? d
                        : `${d.name || d.component || 'Driver'}: Score ${Number(d.raw_score ?? 0).toFixed(1)} (Weight ${Math.round((d.weight ?? 0) * 100)}%, Contribution +${Number(d.weighted_contribution ?? 0).toFixed(1)})`}
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-gray-500">No primary risk drivers recorded.</li>
                )}
              </ul>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold border-b border-gray-300 pb-2 mb-4">Supervisory Findings</h3>
            {(!report.risk || !Array.isArray(report.risk.findings) || report.risk.findings.length === 0) ? (
              <p className="text-gray-500 text-sm">No findings generated for this entity.</p>
            ) : (
              <div className="space-y-4">
                {report.risk.findings.map((f: any) => (
                  <div key={f.finding_id} className="border border-gray-200 rounded p-4 print:break-inside-avoid print:border-gray-300">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-bold text-sm">{f.title || f.finding_id}</h4>
                      <span className="text-xs font-bold px-2 py-0.5 bg-gray-200 rounded uppercase">
                        {f.severity || 'MEDIUM'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 mb-2 leading-relaxed">{f.rationale}</p>
                    <div className="text-xs text-gray-500 font-mono">
                      Evidence:{' '}
                      {Array.isArray(f.evidence_ids) && f.evidence_ids.length > 0
                        ? f.evidence_ids.join(', ')
                        : 'None'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-lg font-bold border-b border-gray-300 pb-2 mb-4">Priority Alert Queue Sample</h3>
            {(!Array.isArray(report.prioritized_alerts) || report.prioritized_alerts.length === 0) ? (
              <p className="text-gray-500 text-sm">No priority alerts require review.</p>
            ) : (
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="bg-gray-100 border-b-2 border-gray-300">
                    <th className="p-2">Score</th>
                    <th className="p-2">Alert ID</th>
                    <th className="p-2">Level</th>
                    <th className="p-2">Primary Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {report.prioritized_alerts.slice(0, 10).map((a: any) => (
                    <tr key={a.alert_id} className="border-b border-gray-200">
                      <td className="p-2 font-bold">
                        {a.priority_score != null ? Number(a.priority_score).toFixed(1) : 'N/A'}
                      </td>
                      <td className="p-2 font-mono text-xs">{a.alert_id}</td>
                      <td className="p-2 text-xs uppercase font-medium">{a.priority_level}</td>
                      <td className="p-2 text-xs">{a.primary_signal || a.category || 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="mt-12 text-center text-xs text-gray-400 print:block">
            <p>End of SAT-SA Supervisory Assessment Report.</p>
            <p>Generated securely offline under PS-157 supervisory controls.</p>
          </div>
        </div>
      )}
    </div>
  );
}
