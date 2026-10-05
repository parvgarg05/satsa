# IMPLEMENTATION STATUS: SAT-SA
## Supervisory Analytics Tool for SOC Assessment (SIH 2026 PS 157)

Last Updated: Phase 2 Completed

---

### Phase Status Matrix

| Phase | Description | Status | Verification & Deliverables |
|---|---|---|---|
| **PHASE 1** | Project setup + architecture | **COMPLETED** | Folder skeleton, dependencies verified, architecture docs, initial scaffolding for Frontend, Backend, Analytics |
| **PHASE 2** | Data schemas + ingestion + representative dataset | **COMPLETED** | SQLite schema (`entities`, `assets`, `alerts`, `cases`), strict validation, CSV/JSON loaders, 20 CSE dataset with CSE-007 raw evidence patterns |
| **PHASE 3** | Supervisory analytics engine | PENDING | 5 core modules (Execution Gaps, Negative Space, Isolation Forest Anomaly, Peer Analysis, Repeated Incidents) |
| **PHASE 4** | Risk scoring + explainability | PENDING | 0-100 deterministic risk scorer, 4-tier risk bands, explainability breakdown, evidence mapping |
| **PHASE 5** | Node/Express API | PENDING | REST API endpoints, SQLite database integration, microservice proxy to FastAPI |
| **PHASE 6** | React dashboard | PENDING | Dashboard overview, charts (Recharts), entity table, entity detail view, finding modal & evidence drawer |
| **PHASE 7** | End-to-end integration | PENDING | Full workflow: upload -> analyze -> score -> prioritize -> explain -> drill down |
| **PHASE 8** | Demo scenario + UI polish | PENDING | CSE-007 showcase, dark mode SOC theme, responsive layout, loading states |
| **PHASE 9** | Testing + README + documentation | PENDING | Unit tests (pytest + node test), architectural runbook, offline guarantee |
| **PHASE 10**| SIH submission material | PENDING | Executive summary, presentation slides outline, demo script |

---

### Phase 2 Detailed Deliverables & Verifications

#### 1. SQLite Schema Architecture (`sat-sa/backend/src/db.ts`)
- **Tables Created**: `entities`, `assets`, `alerts`, `cases` with `PRAGMA foreign_keys = ON` and `WAL` journal mode.
- **Constraints & Enums**: Check constraints on `criticality`, `severity`, `status`, `remediation_status`, `escalated`, and non-negative `investigation_duration`.
- **Query Indexes**: Created multi-column indexes for fast relational lookups (`entity_id`, `asset_id`, `alert_id`, `criticality`, `severity`, `timestamp`, `escalated`).

#### 2. Deterministic Representative Dataset (`sat-sa/data/sample/`)
- Generated across both JSON (`dataset.json`, `entities.json`, `assets.json`, `alerts.json`, `cases.json`) and CSV formats:
  - **Entities:** 20 CSEs across 6 critical sectors (Banking, Energy, Defence, Telecom, Transport, Healthcare).
  - **Assets:** 392 assets (SCADA, Domain Controllers, Core Switches, DB Servers, Web Apps).
  - **Alerts:** 1,474 alerts across 5 threat categories.
  - **Cases:** 1,313 investigation cases.

#### 3. Ingestion & Validation Engine (`sat-sa/backend/src/ingestion.ts`)
- Strict type validation, mandatory field checks, and ISO timestamp parsing.
- Cross-table referential integrity (validates entity exists, asset belongs to entity, case matches alert).
- Informative error reporting with precise row numbers, fields, and offending values.
- Transactional atomicity: rollback on failure, no silent discards.

#### 4. Raw Evidence Profile Verification (CSE-007)
- **Entity**: `CSE-007` (National Power Transmission Sub-tier A - Energy Sector).
- **Execution Gaps**: 85.5% (47/55) of critical alerts closed in <10 minutes (Average: 6.93 min vs Peer Average: 68.18 min).
- **Escalation Discrepancy**: 1.8% (1/55) escalation rate on critical alerts vs 52.6% (61/116) across peer entities.
- **Negative Space**: 4 critical SCADA assets with telemetry expired >30 days (last seen August 2026).
- **Repeated Incidents**: 4 distinct clusters of repeated Ransomware/Lateral Movement alerts on `AST-007-01` and `AST-007-02` with 100% unremediated status (`remediation_status` = `None` or `Ignored`).
- **Purity Check**: Zero hardcoded risk scores or pre-computed findings exist in raw database tables.

#### 5. Automated Tests Suite (`sat-sa/backend/test/data_layer.test.ts`)
- 6 unit & integration tests passing (`100% pass rate`, duration ~500ms):
  - Database schema initialization
  - Missing field & type rejection validation
  - Cross-entity referential integrity validation
  - Full JSON dataset parsing & ingestion
  - Full CSV dataset parsing & ingestion
  - CSE-007 raw evidence pattern verification
