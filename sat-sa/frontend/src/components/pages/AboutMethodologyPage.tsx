import React from 'react';
import { 
  Shield, Database, AlertCircle, CheckCircle2, Lock, Scale, Layers
} from 'lucide-react';

export function AboutMethodologyPage() {
  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="border-b border-app-border pb-3">
        <h1 className="text-lg font-semibold text-app-text tracking-tight">About SAT-SA & Regulatory Scope</h1>
        <p className="text-xs text-app-secondary mt-0.5">
          Smart India Hackathon (SIH 2026) — Problem Statement 157 Technical Reference & Architecture
        </p>
      </div>

      {/* 1. Purpose */}
      <div className="bg-app-surface rounded-md p-4 space-y-2">
        <div className="flex items-center space-x-2">
          <Shield className="w-4 h-4 text-app-muted" />
          <h2 className="text-xs font-medium text-app-secondary uppercase tracking-wider">Purpose</h2>
        </div>
        <p className="text-xs text-app-text leading-relaxed bg-transparent p-3 rounded border border-app-borderDivider">
          SAT-SA (Supervisory Analytics Tool for SOC Assessment) is built for national cyber regulatory authorities (such as CERT-In and NCIIPC) to perform independent, data-driven oversight over Critical Sector Entities (CSEs). It assesses whether entities actively detect and remediate threats or merely rubber-stamp alert queues.
        </p>
      </div>

      {/* 2. Supervisory Scope vs. Entity SIEM */}
      <div className="bg-app-surface rounded-md p-4 space-y-2.5">
        <div className="flex items-center space-x-2">
          <Layers className="w-4 h-4 text-app-muted" />
          <h2 className="text-xs font-medium text-app-secondary uppercase tracking-wider">Supervisory Scope</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div className="p-3 bg-transparent rounded border border-app-borderDivider">
            <span className="font-medium text-app-text block mb-1">Entity-Level SOC (SIEM)</span>
            <p className="text-xs text-app-secondary leading-relaxed">
              Focuses on packet inspection, internal log correlation, malware detection, and initial ticket triage inside a single organization.
            </p>
          </div>
          <div className="p-3 bg-transparent rounded border border-app-borderDivider">
            <span className="font-medium text-app-text block mb-1">Supervisory Oversight (SAT-SA)</span>
            <p className="text-xs text-app-secondary leading-relaxed">
              Audits triage quality, detects negative space (unmonitored assets), evaluates peer variance across sectors, and flags chronic incident recurrence.
            </p>
          </div>
        </div>
      </div>

      {/* 3. Dataset Design & Benchmark Entity */}
      <div className="bg-app-surface rounded-md p-4 space-y-2.5">
        <div className="flex items-center space-x-2">
          <Database className="w-4 h-4 text-app-muted" />
          <h2 className="text-xs font-medium text-app-secondary uppercase tracking-wider">Dataset Design</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          <div className="p-3 bg-transparent rounded border border-app-borderDivider">
            <span className="font-medium text-app-text block mb-1">Cross-Sector Inventory (20 CSEs)</span>
            <p className="text-xs text-app-secondary leading-relaxed">
              20 entities distributed across 6 vital critical sectors: Energy, Banking, Defence, Telecom, Transport, and Healthcare. Seeded deterministically (<code className="font-mono text-app-text">seed=42</code>).
            </p>
          </div>
          <div className="p-3 bg-transparent rounded border border-app-borderDivider">
            <span className="font-medium text-app-text block mb-1">Benchmark Methodology</span>
            <p className="text-xs text-app-secondary leading-relaxed">
              Detects realistic failure modes: 85.5% fast closures (&lt;10 min), 4 unmonitored SCADA telemetry gaps, and 6 repeated unresolved incident clusters (Score: 75.5 HIGH).
            </p>
          </div>
        </div>
      </div>

      {/* 4. Methodology & Deterministic Reproducibility */}
      <div className="bg-app-surface rounded-md p-4 space-y-2.5">
        <div className="flex items-center space-x-2">
          <Scale className="w-4 h-4 text-app-muted" />
          <h2 className="text-xs font-medium text-app-secondary uppercase tracking-wider">Methodology & Reproducibility</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
          <div className="p-3 bg-transparent rounded border border-app-borderDivider">
            <span className="font-medium text-app-text block mb-1">Deterministic Scoring</span>
            <p className="text-xs text-app-secondary leading-relaxed">
              Scoring strictly follows fixed mathematical weights summing to 100%. Two identical runs against the database produce identical risk scores.
            </p>
          </div>
          <div className="p-3 bg-transparent rounded border border-app-borderDivider">
            <span className="font-medium text-app-text block mb-1">Air-Gapped Operation</span>
            <p className="text-xs text-app-secondary leading-relaxed">
              Zero external network or cloud AI dependencies. All analytics and SQLite storage run entirely on local offline compute.
            </p>
          </div>
          <div className="p-3 bg-transparent rounded border border-app-borderDivider">
            <span className="font-medium text-app-text block mb-1">Full Traceability</span>
            <p className="text-xs text-app-secondary leading-relaxed">
              Every supervisory finding links directly to underlying SQLite records (<code className="font-mono text-app-text">ALT-*</code>, <code className="font-mono text-app-text">CAS-*</code>, <code className="font-mono text-app-text">AST-*</code>).
            </p>
          </div>
        </div>
      </div>

      {/* 5. Known Limitations & Sector Calibration */}
      <div className="bg-app-surface rounded-md p-4 space-y-2.5">
        <div className="flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 text-app-muted" />
          <h2 className="text-xs font-medium text-app-secondary uppercase tracking-wider">Limitations & Production Calibration</h2>
        </div>
        <div className="space-y-2.5 text-xs">
          <div className="p-3 bg-transparent rounded border border-app-borderDivider">
            <span className="font-medium text-app-text block mb-1">Threshold Customization</span>
            <p className="text-xs text-app-secondary leading-relaxed">
              Triage thresholds (e.g. 10-minute rapid closure) represent standard SOC benchmarks. In production, supervisory regulators can calibrate thresholds per sector vertical or entity scale.
            </p>
          </div>
          <div className="p-3 bg-transparent rounded border border-app-borderDivider">
            <span className="font-medium text-app-text block mb-1">Sample Cohort Sizes</span>
            <p className="text-xs text-app-secondary leading-relaxed">
              Statistical peer models operate optimally with cohorts of 10+ entities per sector. For smaller sector cohorts, rule-based modules (Execution Gap and Negative Space) provide primary risk evidence.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
