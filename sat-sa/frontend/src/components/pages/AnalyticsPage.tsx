import React from 'react';
import { 
  Target, EyeOff, Activity, AlertTriangle, RefreshCw, Scale 
} from 'lucide-react';

export function AnalyticsPage() {
  const modules = [
    {
      id: 'EXECUTION_GAP',
      name: 'Module A: Execution Gap Detection',
      weight: '30%',
      icon: Target,
      detects: 'Superficial triage practices, "rubber-stamping", unescalated critical incidents, and unusually rapid ticket closures without real investigation.',
      metrics: [
        'Critical alert closure duration (<10 mins vs peer median)',
        'Escalation rate for critical and high severity alerts',
        'Investigation duration distribution percentiles',
        'Remediation outcome ratio (Closed with None vs Fixed)',
      ],
      contribution: 'Generates up to 30.0 risk points. Evaluates severity anchoring (60%) and density (40%) across detected gaps.',
      evidence: 'Alert timestamps, case opened/closed timestamps, investigator IDs, closure reasons, escalation boolean flag.',
    },
    {
      id: 'NEGATIVE_SPACE',
      name: 'Module B: Negative Space Detection',
      weight: '25%',
      icon: EyeOff,
      detects: 'What is absent where telemetry or supervision should exist: silent unmonitored SCADA assets, missing case records, and telemetry blackouts.',
      metrics: [
        'Days since last telemetry timestamp (>7 days stale threshold)',
        'Uninvestigated critical alerts ratio (Alerts lacking Cases)',
        'Expected vs observed telemetry frequency across critical assets',
      ],
      contribution: 'Generates up to 25.0 risk points. Identifies blindspots before attackers exploit silent monitoring gaps.',
      evidence: 'Asset criticality rating, expected telemetry types, last telemetry timestamp, orphaned alerts without case links.',
    },
    {
      id: 'ANOMALY',
      name: 'Module C: Statistical Anomaly Detection (Isolation Forest)',
      weight: '20%',
      icon: Activity,
      detects: 'Multi-dimensional behavioral outliers deviating from sector baselines using unsupervised statistical Isolation Forest.',
      metrics: [
        '7-feature entity vector: alert volume, critical ratio, escalation rate, median duration, average duration, repeat rate, telemetry coverage',
        'Isolation Forest anomaly score (contamination=0.15, n_estimators=200, seed=42)',
      ],
      contribution: 'Generates up to 20.0 risk points. Highlights entities whose collective operational profile diverges from the population.',
      evidence: 'Aggregated cross-entity mathematical feature vectors derived deterministically from SQLite tables.',
    },
    {
      id: 'PEER_DEVIATION',
      name: 'Module D: Cross-Entity Peer Comparison',
      weight: '15%',
      icon: AlertTriangle,
      detects: 'Entities that deviate significantly from their critical infrastructure sector peers across investigation speed, escalation rigor, and alert-to-case conversion.',
      metrics: [
        'Sector-specific z-score deviation on closure duration',
        'Peer relative escalation deficit',
        'Critical alert volume vs sector median',
      ],
      contribution: 'Generates up to 15.0 risk points. Accounts for industry-specific operational realities.',
      evidence: 'Entity sector classification, cross-entity statistical distributions within sector clusters.',
    },
    {
      id: 'REPEATED_INCIDENT',
      name: 'Module E: Repeated Incident Clustering',
      weight: '10%',
      icon: RefreshCw,
      detects: 'Recurring security alerts on the same asset/category closed without proper remediation, indicating superficial triage and unaddressed root causes.',
      metrics: [
        'Alert recurrence frequency on identical assets within sliding 30-day windows',
        'Quick closure followed by recurrence within 48 hours',
        'Closure reason consistency across recurring incidents',
      ],
      contribution: 'Generates up to 10.0 risk points. Penalizes systemic operational negligence.',
      evidence: 'Asset IDs, alert timestamps, category signatures, case remediation status logs.',
    },
  ];

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="border-b border-app-border pb-3">
        <h1 className="text-lg font-semibold text-app-text tracking-tight">Supervisory Risk Methodology</h1>
        <p className="text-xs text-app-secondary mt-0.5">
          Deterministic 5-module mathematical scoring model and explainable supervisory assessment
        </p>
      </div>

      {/* 1. Transparent Mathematical Formula Card */}
      <div className="bg-app-surface rounded-md p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div className="flex items-center space-x-2">
            <Scale className="w-4 h-4 text-app-muted" />
            <h2 className="text-xs font-medium text-app-secondary uppercase tracking-wider">Supervisory risk formula</h2>
          </div>
          <span className="text-[11px] px-2 py-0.5 rounded bg-transparent text-app-muted border border-app-borderDivider">
            Deterministic · Air-gapped verified
          </span>
        </div>

        {/* Formula */}
        <div className="p-3 bg-transparent rounded border border-app-borderDivider font-mono text-xs text-app-text overflow-x-auto">
          Score = 0.30 × Execution_Gap + 0.25 × Negative_Space + 0.20 × Anomaly + 0.15 × Peer_Deviation + 0.10 × Repeated_Incidents
        </div>

        {/* Weights Summary Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 mt-3 text-center">
          <div className="bg-transparent p-3 rounded border border-app-borderDivider">
            <span className="text-xs text-app-muted block font-normal">Execution gap</span>
            <span className="text-base font-semibold text-app-text mt-0.5 block">30%</span>
            <span className="text-[11px] text-app-muted block mt-0.5">Max 30 pts</span>
          </div>

          <div className="bg-transparent p-3 rounded border border-app-borderDivider">
            <span className="text-xs text-app-muted block font-normal">Negative space</span>
            <span className="text-base font-semibold text-app-text mt-0.5 block">25%</span>
            <span className="text-[11px] text-app-muted block mt-0.5">Max 25 pts</span>
          </div>

          <div className="bg-transparent p-3 rounded border border-app-borderDivider">
            <span className="text-xs text-app-muted block font-normal">Anomaly (ML)</span>
            <span className="text-base font-semibold text-app-text mt-0.5 block">20%</span>
            <span className="text-[11px] text-app-muted block mt-0.5">Max 20 pts</span>
          </div>

          <div className="bg-transparent p-3 rounded border border-app-borderDivider">
            <span className="text-xs text-app-muted block font-normal">Peer deviation</span>
            <span className="text-base font-semibold text-app-text mt-0.5 block">15%</span>
            <span className="text-[11px] text-app-muted block mt-0.5">Max 15 pts</span>
          </div>

          <div className="bg-transparent p-3 rounded border border-app-borderDivider">
            <span className="text-xs text-app-muted block font-normal">Repeat incidents</span>
            <span className="text-base font-semibold text-app-text mt-0.5 block">10%</span>
            <span className="text-[11px] text-app-muted block mt-0.5">Max 10 pts</span>
          </div>
        </div>

        {/* Risk Tiers & Weights Sum Note */}
        <div className="mt-4 pt-3 border-t border-app-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="text-app-muted font-normal text-xs">
            Sum of analytical weights = 100% (30 + 25 + 20 + 15 + 10 = 100)
          </div>
          <div className="flex items-center space-x-2 text-xs flex-wrap gap-y-1">
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Low (0–29)</span>
            <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">Medium (30–59)</span>
            <span className="px-2 py-0.5 rounded bg-orange-500/10 text-orange-600 dark:text-orange-400">High (60–79)</span>
            <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400">Critical (80–100)</span>
          </div>
        </div>
      </div>

      {/* 2. Detailed 5 Modules */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium text-app-secondary uppercase tracking-wider">The 5 detection modules</h2>

        {modules.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.id} className="bg-app-surface rounded-md p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 pb-2 border-b border-app-border">
                <div className="flex items-center space-x-2.5">
                  <div className="p-1.5 rounded bg-transparent border border-app-borderDivider text-app-text">
                    <Icon className="w-4 h-4 text-app-muted" />
                  </div>
                  <h3 className="text-sm font-medium text-app-text">{m.name}</h3>
                </div>
                <span className="text-xs font-normal px-2 py-0.5 rounded bg-transparent text-app-secondary border border-app-borderDivider">
                  Weight: {m.weight}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs mt-3">
                <div className="space-y-2.5">
                  <div>
                    <span className="text-[11px] font-medium text-app-muted uppercase tracking-wider block mb-1">What it detects</span>
                    <p className="text-app-text leading-relaxed bg-transparent p-2.5 rounded border border-app-borderDivider">
                      {m.detects}
                    </p>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium text-app-muted uppercase tracking-wider block mb-1">Risk contribution</span>
                    <p className="text-app-secondary">
                      {m.contribution}
                    </p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div>
                    <span className="text-[11px] font-medium text-app-muted uppercase tracking-wider block mb-1">Key metrics evaluated</span>
                    <ul className="list-disc list-inside space-y-1 text-app-text text-xs">
                      {m.metrics.map((met, i) => (
                        <li key={i}>{met}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium text-app-muted uppercase tracking-wider block mb-1">Underlying evidence source</span>
                    <p className="text-app-muted text-xs">
                      {m.evidence}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
