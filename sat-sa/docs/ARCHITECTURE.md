# SAT-SA Architecture & System Design
### Smart India Hackathon (SIH 2026) — Problem Statement 157

---

## 1. High-Level Architectural Topology

SAT-SA implements a strictly **offline-first, air-gapped supervisory architecture** designed to run without internet access, external SaaS providers, or cloud AI services:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PRESENTATION TIER (Browser Client)                       │
│  React 18 • Vite • TypeScript • Tailwind CSS • Recharts • Lucide React      │
│  - App Layout with Air-Gapped / Offline status indicator                    │
│  - Executive Dashboard: Metric cards, Risk Distribution, Finding Bar Charts │
│  - Priority Review Card: Surfaces CSE-007 as #1 immediate audit candidate   │
│  - Filterable Entity Leaderboard: Sector, Risk Level, and Sort by score     │
│  - Supervisory Signals Explorer: Severity and Module filter toggles         │
│  - Entity Investigation View: Formula breakdown, 5 component score cards    │
│  - Evidence Modal: Drill-down to raw SQLite alert/case/asset audit records  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP / REST (JSON)
                                       │ Port: 5173 -> 4000
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                  APPLICATION GATEWAY TIER (Node.js Express)                 │
│  Node.js (v24) • Express • TypeScript • Native node:sqlite                   │
│                                                                             │
│  Controllers & Routers (src/routes.ts):                                     │
│  - POST /api/upload       : Multipart/JSON validation & atomic ingestion    │
│  - POST /api/analyze      : Triggers Python supervisory pipeline            │
│  - GET  /api/dashboard    : Executive aggregates, risk tiers, top findings  │
│  - GET  /api/entities     : Filterable & sortable entity summary list       │
│  - GET  /api/entities/:id : Entity detail, component scores & explanation   │
│  - GET  /api/findings     : All findings filtered by severity / module      │
│  - GET  /api/findings/:id : Finding detail, rationale & evidence ID list    │
│  - GET  /api/evidence/:id : Resolves raw Alert, Case, Asset from SQLite     │
│                                                                             │
│  Services:                                                                  │
│  - DatabaseService (src/db.ts): SQLite wrapper using native node:sqlite     │
│  - DataValidator (src/ingestion.ts): Schema & referential foreign-key check │
│  - DataIngestionService (src/ingestion.ts): Atomic transactional ingestion  │
│  - AnalyticsService (src/analytics.service.ts): Process bridge & cache      │
│                                                                             │
│  Database Store: sat_sa.db (Entities, Assets, Alerts, Cases, 9 indexes)    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Subprocess IPC / CLI
                                       │ Python Executable + pipeline.py
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                 ANALYTICS INTELLIGENCE TIER (Python Engine)                 │
│  Python 3.10+ • Pandas • NumPy • Scikit-Learn (Isolation Forest)            │
│                                                                             │
│  Detection Modules:                                                         │
│  - Module A: execution_gaps.py    (Fast closures, unescalated criticals)    │
│  - Module B: negative_space.py    (Stale telemetry on SCADA, missing cases) │
│  - Module C: anomaly_detection.py (Isolation Forest 7-feature outlier model)│
│  - Module D: peer_analysis.py     (Cross-entity median divergence analysis) │
│  - Module E: repeated_incidents.py(Recurring alert clusters with no fix)    │
│                                                                             │
│  Orchestration & Scoring:                                                   │
│  - risk_scoring.py : Deterministic weighted formula & structured explanation│
│  - pipeline.py     : Orchestrates Modules A–E and generates JSON artifact   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Tier Details & Responsibilities

### A. Presentation Tier (`sat-sa/frontend`)
- **Technology:** React 18, Vite 6, TypeScript, Tailwind CSS, Recharts.
- **Key Components:**
  - `src/App.tsx`: Top-level application shell, air-gapped status bar, API connectivity monitor, navigation state manager.
  - `src/components/Dashboard.tsx`: Executive supervisory view with KPI cards, risk distribution pie chart, finding counts bar chart, priority CSE-007 review card, filterable entity ranking table, and signal findings explorer.
  - `src/components/EntityDetail.tsx`: Deep-dive investigation view detailing entity background, plain-English rationale, mathematical formula breakdown, component score cards, and interactive finding lists with evidence buttons.
  - `src/components/EvidenceModal.tsx`: Forensic audit modal that displays the exact underlying SQLite database rows for any referenced alert, investigation case, or critical asset.

### B. Application Gateway Tier (`sat-sa/backend`)
- **Technology:** Node.js v24.16.0, Express 4.21, TypeScript, native `node:sqlite`.
- **Database Engine (`src/db.ts`):**
  - Uses Node.js v24's built-in `node:sqlite` (`DatabaseSync`), requiring zero external native compilation or binary dependencies.
  - Schema defines 4 primary tables: `entities`, `assets`, `alerts`, `cases`, reinforced with foreign keys, check constraints, and 9 performance indexes.
- **Ingestion & Validation Engine (`src/ingestion.ts`):**
  - Implements strict validation on date formats, field presence, enum domains (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`), and referential integrity (ensuring every case references an existing alert; every alert references an existing asset and entity).
  - Guarantees ACID atomic inserts using SQLite transactions (`BEGIN TRANSACTION` / `COMMIT` / `ROLLBACK`).
- **Analytics Bridge (`src/analytics.service.ts`):**
  - Bridges the Node.js backend to the Python analytics pipeline via subprocess execution.
  - Caches pipeline results in `analytics_cache.json` and in-memory for microsecond response times on subsequent requests.
- **REST Router (`src/routes.ts`):**
  - Exposes 8 structured REST endpoints supporting query parameters for filtering and sorting.

### C. Analytics Engine Tier (`sat-sa/analytics`)
- **Technology:** Python 3.10+, Pandas, NumPy, Scikit-Learn.
- **Detection Disciplines:**
  - **Module A (`execution_gaps.py`)**: Identifies superficial SOC behavior (critical alerts closed in <10m, critical alerts unescalated, short investigations, repeated alerts closed without remediation).
  - **Module B (`negative_space.py`)**: Identifies absent evidence (critical SCADA assets with last telemetry >7 days old, missing cases for critical alerts, low activity blackouts).
  - **Module C (`anomaly_detection.py`)**: Unsupervised `IsolationForest` (200 estimators, contamination=0.15, seed=42) assessing an entity feature vector against peer entity distributions.
  - **Module D (`peer_analysis.py`)**: Evaluates entity divergence against peer sector medians across escalation rate, closure duration, and telemetry coverage.
  - **Module E (`repeated_incidents.py`)**: Groups alerts by `(entity_id, asset_id, category)` and flags recurrence where $\ge 60\%$ are unremediated.
- **Risk Scoring & Explainability (`risk_scoring.py`):**
  - Computes deterministic composite score (0–100) using transparent weights:
    $$\text{Score} = 0.30 \cdot S_{\text{EG}} + 0.25 \cdot S_{\text{NS}} + 0.20 \cdot S_{\text{ANOM}} + 0.15 \cdot S_{\text{PEER}} + 0.10 \cdot S_{\text{RI}}$$
  - Constructs structured, human-readable explanations detailing *why* the entity was flagged and linking each finding to verified evidence IDs.

---

## 3. Data Flow & Forensic Audit Trail

The supervisory workflow follows an unbroken forensic chain of custody:

```
Raw Alert/Case Telemetry (SQLite)
      │
      ▼
Data Normalization & Referential Validation
      │
      ▼
Supervisory Analytics Engine (Modules A–E)
      │
      ▼
Deterministic Risk Scoring & Explainability Engine
      │
      ▼
Prioritized Entity Leaderboard (CSE-007 at Rank #1)
      │
      ▼
Supervisor Entity Investigation View
      │
      ▼
Finding Rationale (Why Flagged: e.g., 85.5% fast closures)
      │
      ▼
Underlying Evidence Trace (Alert ALT-00440 / Asset AST-007-01 in SQLite)
```

Every risk score is directly traceable back to raw database rows, satisfying regulatory standards for evidence defense.

---

## 4. Air-Gapped & Security Considerations

1. **Air-Gap Verification**: All system components (Node, SQLite, Python virtual environment, Vite frontend) run completely locally on `localhost`. Zero outbound sockets are opened.
2. **Deterministic Reproducibility**: Random states for ML algorithms are explicitly seeded (`random_state=42`), guaranteeing that two runs on the same dataset produce identical findings and scores.
3. **Audit Immutability**: All analytical conclusions preserve the source record keys (`evidence_ids`), allowing supervisors to export verified audit packages for legal or compliance proceedings.
