# SAT-SA: Supervisory Analytics Tool for SOC Assessment
### Smart India Hackathon (SIH 2026) — Problem Statement 157

**SAT-SA** is an air-gapped, offline-first supervisory analytics platform developed for regulatory overseers (e.g., NCIIPC, CERT-In, sector regulators) to audit and evaluate Security Operations Centers (SOCs) across Critical Sector Entities (CSEs).

Rather than functioning as another internal SIEM or SOC dashboard, SAT-SA operates at the **supervisory layer**—evaluating whether entities are conducting genuine investigations, identifying behavioral execution gaps, unmasking unmonitored critical assets, and prioritizing entities for manual audit.

---

## 🔒 100% Offline & Air-Gapped Guarantee

In strict compliance with the SIH PS-157 requirements:
- **Zero Cloud / External AI Calls**: No OpenAI, Anthropic, Gemini, Groq, or external LLM dependencies.
- **Local Deterministic ML**: Local Scikit-Learn `IsolationForest` running locally without network connectivity. Feature attribution is a peer-deviation heuristic, not a formal per-tree contribution.
- **Embedded Database**: Local SQLite via Node.js native `node:sqlite` (zero external DB servers required).
- **Offline Client**: Self-contained React SPA communicating exclusively with the local Express gateway.
- **Air-Gapped Deployment**: Can run fully on an isolated machine with no Internet connection.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      PRESENTATION TIER (Browser :5173)                          │
│   React 18 + Vite + TypeScript + Tailwind CSS + Recharts + Lucide Icons         │
│   • Executive Triage Dashboard       • Supervisory Filter Bar                   │
│   • Priority Review Callout (CSE-007)• Interactive Signal Explorer              │
│   • CSE-007 Investigation View       • SQLite Evidence Modal Drill-Down         │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ HTTP REST (/api/*)
┌────────────────────────────────────────▼────────────────────────────────────────┐
│                   APPLICATION GATEWAY TIER (Node.js :4000)                      │
│   Node.js Express + TypeScript + Native node:sqlite                             │
│   • POST /api/upload          - Dataset validation & atomic transactional ingest│
│   • POST /api/analyze         - Orchestrates Python analytics pipeline          │
│   • GET  /api/dashboard       - Executive metrics & risk distribution           │
│   • GET  /api/entities        - Filtered/sorted CSE risk rankings               │
│   • GET  /api/entities/:id    - Entity investigation & mathematical formula     │
│   • GET  /api/findings        - Signal findings filtered by severity/module     │
│   • GET  /api/evidence/:id    - Underlying SQLite record resolution             │
│   • sat_sa.db                 - Entities, Assets, Alerts, Cases SQLite store    │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ Subprocess / Microservice
┌────────────────────────────────────────▼────────────────────────────────────────┐
│                   ANALYTICS ENGINE TIER (Python Virtualenv)                     │
│   Python 3.10+ • Pandas • NumPy • Scikit-Learn (Isolation Forest)               │
│   • Module A: Execution Gap Detection                                           │
│   • Module B: Negative Space Detection                                          │
│   • Module C: Statistical Anomaly Detection (Isolation Forest)                 │
│   • Module D: Cross-Entity Peer Comparison                                      │
│   • Module E: Repeated Incident Cluster Detection                               │
│   • Risk Scoring: Deterministic 5-Module Weighted Blend (0-100)                 │
│   • Explainability Contract: Traceable plain-English rationale & evidence IDs   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧠 The 5 Supervisory Analytics Modules

SAT-SA extracts supervisory signals from operational alert and case management data across 5 distinct disciplines:

### 1. Module A: Execution Gap Detection (Weight: 30%)
Identifies discrepancies between reported SOC activity and realistic operational practices:
- **Fast Critical Closures**: Alerts closed in under 10 minutes with average entity duration significantly below peer median, indicating superficial "rubber-stamping" without investigation.
- **Unescalated Critical Alerts**: Critical-severity alerts resolved without supervisor escalation.
- **Short Investigations**: Cases closed with investigation duration far below baseline for the incident complexity.
- **Repeated Alerts Closed Without Action**: Identical category/asset alerts closed with `Remediation: None`.

### 2. Module B: Negative Space Detection (Weight: 25%)
Detects **what is absent** where telemetry or monitoring should exist:
- **Stale / Missing Critical Asset Telemetry**: High-criticality assets (e.g., SCADA, OT switches) with expired or missing telemetry timestamps (>7 days stale).
- **Missing Investigation Cases**: High-severity alerts that lack a corresponding case management record.
- **Telemetry Blackouts / Low Activity**: Active operational entities displaying unexpectedly zero or minimal telemetry relative to peer entity baselines.

### 3. Module C: Statistical Anomaly Detection (Weight: 20%)
Applies unsupervised machine learning using Scikit-Learn's `IsolationForest` (parameters are defined in `config/analytics_config.json`):
- Features vector per entity:
  1. `alert_volume` (total alert count)
  2. `critical_alert_ratio` (proportion of alerts that are CRITICAL)
  3. `escalation_rate` (percentage of cases escalated)
  4. `median_investigation_duration` (typical time spent per case)
  5. `repeat_alert_rate` (frequency of recurring asset-category alerts)
  6. `telemetry_coverage` (ratio of assets reporting fresh telemetry)
  7. `average_investigation_duration` (mean time per incident)
- Flags statistical outliers that deviate multi-dimensionally from the collective population.

### 4. Module D: Cross-Entity Peer Comparison (Weight: 15%)
Compares entity performance against sector and cross-sector medians:
- Evaluates statistical variance in escalation rates, closure duration, and telemetry coverage.
- Flags entities whose key SOC metrics diverge significantly (e.g., escalation rate >8 percentage points below peer median).

### 5. Module E: Repeated Incident Detection (Weight: 10%)
Identifies systemic failure to remediate recurring security problems:
- Clusters alerts sharing identical `(entity_id, asset_id, category)`.
- Flags clusters where $\ge 60\%$ of incidents were closed with remediation marked `None` or left unaddressed.

---

## ⚖️ Risk Scoring Methodology & Limitations

### Formula
Final supervisory risk is calculated deterministically on a 0–100 normalized scale:

$$\text{Risk Score} = 0.30 \cdot S_{\text{EG}} + 0.25 \cdot S_{\text{NS}} + 0.20 \cdot S_{\text{ANOM}} + 0.15 \cdot S_{\text{PEER}} + 0.10 \cdot S_{\text{RI}}$$

Where each module score $S_i \in [0, 100]$ is computed using a blended severity and finding density metric:
$$S_i = \left(0.60 \times \text{Max Severity Points} + 0.40 \times \text{Avg Severity Points}\right) \times \left(0.55 + 0.45 \times \min\left(1, \frac{\text{Count}}{\text{Cap}}\right)\right)$$

### Risk Bands
| Score Range | Risk Level | Supervisory Recommended Action |
|---|---|---|
| **0 – 29** | **LOW** | Routine periodic monitoring |
| **30 – 59** | **MEDIUM** | Standard audit review; review repeated alerts |
| **60 – 79** | **HIGH** | Priority supervisor audit; investigate execution gaps |
| **80 – 100** | **CRITICAL** | Immediate regulatory intervention; on-site inspection |

### Explainability Contract
For every detected signal, SAT-SA answers 4 audit questions:
1. **WHAT** was detected? (Title & module)
2. **WHY** was it flagged? (Plain-English rationale with comparative metrics)
3. **WHAT EVIDENCE** supports it? (Exact SQLite `alert_id`, `case_id`, or `asset_id` list)
4. **HOW MUCH** did it contribute? (Raw module score and weighted contribution to entity risk)

### Known Limitations
- **Threshold Sensitivity**: Hardcoded minimum durations (e.g., 10 minutes for fast closures) reflect typical enterprise SOC practices but may require per-sector calibration in live deployment.
- **Population Size**: Peer comparison and Isolation Forest require a minimum of ~10–15 entities to establish reliable medians; with very small cohorts, rule-based modules (A & B) provide the primary signal.
- **Adversarial Adaptation**: Over time, entity SOC analysts could artificially delay closing tickets to defeat duration checks; multi-module triangulation (correlating duration with escalation and repeated alerts) mitigates this risk.

---

## 📊 Dataset Specification & Ingestion

### Synthetic & Representative Dataset
The checked-in dataset is deterministic synthetic demonstration data generated with reproducible pseudo-random seed (`seed=42`). It is **DEMO / SYNTHETIC DATA - NOT REAL CSE DATA** and has no public-source provenance or expert validation labels:
- **20 CSE Entities** across 6 critical infrastructure sectors:
  - Energy (Power grids, pipelines)
  - Banking & Financial Services
  - Defence Infrastructure
  - Telecommunications
  - Transport (Railways, Air Traffic Control)
  - Healthcare Infrastructure

### Benchmark Entity: CSE-007 (National Power Transmission Sub-tier A)
CSE-007 contains deliberate, realistic supervisory anomalies:
- **85.5% Critical Alerts Closed in <10 Minutes** (mean 6.9m vs peer median 56.0m) without escalation.
- **4 Critical SCADA Assets** (`AST-007-01` through `AST-007-04`) with last telemetry missing for 36–52 days.
- **Flagged as Statistical Outlier** by Isolation Forest ML.
- **Result**: Ranks #1 with Score **75.5 HIGH** (over 2x higher than #2 ranked CSE-004 at 30.6).

### Ingesting Real CSE Data
In production, regulators ingest real CSE logs through:
1. **REST API**: `POST /api/upload` accepts standard JSON datasets or multipart CSV tables (`entities.csv`, `assets.csv`, `alerts.csv`, `cases.csv`).
2. **Atomic Verification**: Validates ISO dates, referential foreign keys (alerts map to valid assets/entities; cases map to alerts), and rejects malformed inputs with 400 Bad Request before database commit.
3. **Immediate Analysis**: Ingestion automatically triggers the analytics pipeline, recalculating risk scores and audit trails in real time.

---

## 🚀 Quickstart & Reproduction Guide

### Prerequisites
- **Node.js**: v20+ or v24 (v24.16.0 tested, utilizes built-in `node:sqlite`)
- **Python**: v3.10+ (v3.14 tested with virtual environment)
- **Git**

### 1. Clone & Setup Python Virtual Environment
```bash
# From repository root
python -m venv .venv

# Activate virtual environment
# Windows (PowerShell):
.\.venv\Scripts\Activate.ps1
# Linux / macOS:
source .venv/bin/activate

# Install analytics dependencies
pip install -r sat-sa/analytics/requirements.txt
```

### 2. Seed SQLite Database & Install Backend
```bash
cd sat-sa/backend
npm install
npm run seed
```
*Output: Seeds `sat_sa.db` with 20 entities, 392 assets, 1474 alerts, and 1313 cases.*

### 3. Run Backend Tests (Node)
```bash
# Inside sat-sa/backend
npm test
```
*Output: 16 tests pass (6 Data Layer tests + 10 REST API integration tests).*

### 4. Run Analytics Tests (Python)
```bash
# From repository root (with .venv active)
pytest sat-sa/analytics/tests -v
```
*Output: 95 tests pass (34 Analytics tests + 61 Risk Scoring tests).*

### 5. Build & Launch Application

**Terminal 1 — Backend API Gateway:**
```bash
cd sat-sa/backend
npm run dev
# Starts backend at http://localhost:4000
```

**Terminal 2 — Frontend UI:**
```bash
cd sat-sa/frontend
npm install
npm run dev
# Starts UI at http://localhost:5173
```

Visit **`http://localhost:5173`** in your browser.

---

## 🎯 2-Minute Demo Script for Evaluators

1. **Dashboard Overview (`http://localhost:5173`)**:
   - Point out the **Air-Gapped Local Operation** indicator badge in the header.
   - Review the 4 executive metric cards: 20 CSEs monitored, 1 High/Critical entity, sector average risk.
   - Note the **Risk Tier Distribution** and **Findings by Module** charts.

2. **Supervisory Prioritization**:
   - Direct attention to the **Priority Review Card**: surfaces `CSE-007 (National Power Transmission Sub-tier A)` as the #1 immediate audit candidate with a risk score of **75.5 HIGH**.
   - Review the key signals displayed on the card: 85.5% fast closures, 4 stale SCADA assets, Isolation Forest anomaly.

3. **Filter Controls**:
   - Filter by Sector (`Energy`) or Risk Level (`HIGH`) in the Entity Prioritization table to see responsive querying via `/api/entities`.
   - Filter the Supervisory Signals Explorer by module (`Negative Space` or `Execution Gap`).

4. **Entity Investigation Drill-Down**:
   - Click **"Inspect CSE-007 Evidence Drill-Down"** (or click CSE-007 in the ranking table).
   - Review the **Plain-English Assessment Explanation** and the transparent mathematical formula.
   - Observe the 5 component score cards (Execution Gap 26.9 pts, Negative Space 19.4 pts, Anomaly 14.0 pts, Peer Deviation 4.5 pts, Repeated Incidents 9.5 pts).

5. **Traceable SQLite Evidence Drill-Down**:
   - Scroll to finding **"Critical Alerts Closed Unusually Quickly"**.
   - Click evidence chip **`ALT-00440`**:
     - Opens the Evidence Modal.
     - Fetches live from SQLite via `/api/evidence/ALT-00440`.
     - Displays the exact underlying Alert (`CRITICAL`), associated Case (`CAS-00383`, duration 5 mins, Escalated: NO), and Asset.
   - Click asset chip **`AST-007-01`**:
     - Inspects the underlying SCADA asset record with last telemetry missing since August 2026.
   - Click **"Copy JSON"** to demonstrate auditor export capability.

---

## 📁 Repository Structure

```
PS0157/
├── sat-sa/
│   ├── analytics/                # Python supervisory analytics & ML engine
│   │   ├── anomaly_detection.py  # Isolation Forest ML implementation
│   │   ├── execution_gaps.py     # Module A detection
│   │   ├── negative_space.py     # Module B detection
│   │   ├── peer_analysis.py      # Module D cross-entity peer deviations
│   │   ├── repeated_incidents.py # Module E recurrence clusters
│   │   ├── risk_scoring.py       # Deterministic 0-100 scoring & explainability
│   │   ├── pipeline.py           # Pipeline runner & orchestrator
│   │   ├── requirements.txt      # Python dependencies
│   │   └── tests/                # 95 Pytest unit & integration tests
│   ├── backend/                  # Node.js Express REST API & SQLite store
│   │   ├── src/
│   │   │   ├── index.ts          # Express server setup & health checks
│   │   │   ├── routes.ts         # 8 REST endpoints (/upload, /dashboard, /entities, etc.)
│   │   │   ├── db.ts             # SQLite schema (node:sqlite) & query helpers
│   │   │   ├── ingestion.ts      # Data validation & atomic transactional ingestion
│   │   │   ├── analytics.service.ts # Python pipeline bridge & results cache
│   │   │   └── seed.ts           # Database populator from dataset.json
│   │   ├── test/                 # 16 Node integration tests
│   │   └── package.json
│   ├── frontend/                 # React 18 / Vite TypeScript UI
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── Dashboard.tsx    # Executive triage & filterable tables
│   │   │   │   ├── EntityDetail.tsx # Investigation drill-down view
│   │   │   │   └── EvidenceModal.tsx# Underlying SQLite evidence inspector
│   │   │   ├── lib/api.ts        # Type-safe API client
│   │   │   ├── types/api.ts      # Shared schema types
│   │   │   └── App.tsx           # Layout, header badges, navigation
│   │   ├── vite.config.ts
│   │   └── package.json
│   ├── data/
│   │   ├── generate_sample_data.py # Deterministic dataset generator
│   │   └── sample/               # Representative dataset (JSON & CSV)
│   ├── docs/
│   │   └── ARCHITECTURE.md       # Comprehensive system architecture
│   ├── PROJECT_SPEC.md           # SIH PS-157 project specifications
│   ├── IMPLEMENTATION_STATUS.md  # Detailed phase-by-phase completion log
│   └── README.md
├── README.md                     # Root overview
└── .venv/                        # Python virtual environment
```

---

## 🏆 SIH PS-157 Verification Summary

| Evaluation Criteria | SAT-SA Implementation | Test Verification |
|---|---|---|
| **Offline-first Architecture** | Purely local execution; zero cloud APIs or LLMs; local SQLite store | Air-gapped verified |
| **Supervisory Focus** | Focuses on oversight signals (rubber-stamping, unmonitored assets, repeat failures) | Modules A–E tested |
| **Deterministic Risk Scoring** | Multi-module weighted sum strictly bounded [0, 100]; 4 risk tiers | 61 Pytest tests |
| **Audit Traceability** | Every finding links directly to underlying SQLite alert/case/asset IDs | Tested in `test/api.test.ts` |
| **Representative Dataset** | 20 CSEs across 6 critical sectors with natural operational behaviors | Generated & seeded |
| **Target Benchmark (CSE-007)** | Ranked #1 (75.5 HIGH) through genuine multi-signal convergence | E2E verified |
| **Test Coverage** | 111 passing tests across Node data/API layers and Python analytics | 111 / 111 PASS (0 failures) |
