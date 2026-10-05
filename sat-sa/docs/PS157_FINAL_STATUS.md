# PS-157 Final Status

**Date:** 2026-09-28  
**Conclusion:** Functional local prototype with verified generic behavior, not 100% PS-157 compliant. Real CSE data, independent expert validation, complete offline artifacts, immutable audit controls, and production ML lifecycle controls remain external or incomplete requirements.

## 1. What was inspected

- `frontend/`: API-backed dashboard, entity ranking, findings, evidence, reports, trends, validation, and workflow pages.
- `backend/src/`: SQLite schema, transactional ingestion, CSV/JSON upload, SQLite export import, routes, report generation, evidence resolution, audit logging, and analytics orchestration.
- `analytics/`: all five supervisory modules, risk scoring, alert prioritization, control/process prioritization, configuration, pipeline persistence, and tests.
- `data/`, seed/generation scripts, sample JSON/CSV, acceptance fixture, and dataset metadata.
- `docs/`, deployment instructions, offline manifest, and air-gap verifier.

The detailed requirement-by-requirement matrix is in [PS157_GAP_ANALYSIS.md](PS157_GAP_ANALYSIS.md).

## 2. Changes made

- Added canonical configuration at `config/analytics_config.json` and loader at `analytics/config.py`.
- Wired anomaly parameters, risk weights, execution thresholds, negative-space thresholds, peer thresholds, and repeated-incident thresholds to configuration.
- Added SQLite database-export ingestion for `.db`, `.sqlite`, and `.sqlite3` uploads.
- Fixed the backend `npm test` script by removing the incompatible `--concurrency=1` option.
- Added peer variance/stddev output and suppressed peer findings when fewer than two comparison peers exist.
- Replaced hardcoded analytics reference timestamps with configured assessment time.
- Added deterministic control/process priority queues and API routes:
  - `GET /api/priorities/controls`
  - `GET /api/priorities/processes`
- Added assessment-period, methodology, and limitation metadata to entity reports.
- Added explicit anomaly attribution-method and limitation metadata.
- Added Dataset A/B independence regression coverage.
- Added `data/README.md` documenting the import contract, provenance requirements, privacy minimization, and synthetic-data status.
- Reconciled README/offline/deployment documentation with actual runtime behavior.
- Removed `curl` from the air-gap verifier; local verification uses Node HTTP only.

No UI redesign was performed.

## 3. Current compliance matrix

| Area | Status | Verification |
|---|---|---|
| CSV and JSON ingestion | 🟢 | Backend ingestion/API tests pass |
| SQLite database-export ingestion | 🟢 | Implemented in `DataIngestionService.readSqliteExport()`; typecheck passes |
| Multi-CSE generic processing | 🟢 | Dataset A/B test uses different entity counts and outputs |
| Validation/normalization | 🟢 | Schema, FK, enum, date, boolean, duration, duplicate, and empty-input tests pass |
| Row-level invalid-record isolation | 🟡 | Errors are reported, but default behavior rejects the whole batch |
| Large datasets | 🟡 | 50 MB buffered upload and SQLite indexes; no production scale benchmark or streaming import |
| Entity/time-period separation | 🟡 | Timestamps and report period are present; no full cohort/version model |
| Execution gaps | 🟢 | Rapid closure, no escalation, short investigations, recurrence, and process inconsistency tested |
| Negative space | 🟡 | Missing/stale telemetry, missing cases, low activity, and escalation absence work; cadence/category expectations are incomplete |
| Anomaly detection | 🟡 | Local IsolationForest works; attribution is explicitly a peer-deviation heuristic |
| Peer comparison | 🟡 | Sector/cross-sector cohorts, medians, deviations, variance/stddev, and insufficient-peer guard exist; no confidence/significance model |
| Repeated incidents | 🟢 | Entity/asset/category remediation clusters are detected and evidenced |
| Entity/alert/control/process prioritization | 🟢 | Entity risk, alert queue, control queue, and process queue are persisted/API-backed |
| Explainability/traceability | 🟢 | Rationale, metrics, evidence IDs, SQLite drill-down, and integrity checks work |
| Immutable auditability | 🟡 | Audit logs and persisted results exist; append-only hashes/signatures/run manifests do not |
| Dashboards/reports/trends/drill-down | 🟢 | API-backed workflow and production frontend build pass |
| Offline/local processing | 🟡 | Runtime is local-only; actual deployment bundle is not checked in |
| Air-gapped verification | 🟡 | Local verifier exists and no external AI/cloud runtime is required; runtime egress enforcement is not comprehensive |
| ML architecture/inference | 🟢 | Local configured IsolationForest inference is implemented |
| ML hardware/training/update lifecycle | 🟡/🔴 | Baseline hardware documentation exists; no persisted model, update, rollback, drift, or production training workflow |
| Expert validation capability | 🟡 | Finding-level `CONFIRMED`/`NOT_CONFIRMED` labels, CSV import, direct evidence-modal review, deterministic validation runs, precision/recall/F1, confusion counts, module/entity summaries, and audit events are implemented |
| Demonstrated expert effectiveness | 🔴 | No expert label dataset or measured result is shipped |
| Real/public data | 🔴 | Current data is synthetic/demo only |
| Architecture/design/data/deployment documentation | 🟢/🟡 | Documents exist and now state limitations; complete offline artifacts and sizing study remain absent |

## 4. Dataset status

The checked-in sample is generated synthetic data, not real CSE data:

**DEMO / SYNTHETIC DATA - NOT REAL CSE DATA**

The generator is deterministic and creates 20 entities across sectors with generated assets, alerts, and cases. The repository contains no public dataset citation, license, collection authority, or real CSE submission. `acceptance_dataset.json` is a test fixture, not validation evidence.

A real authorized/public dataset is still required for effectiveness claims and expert validation.

## 5. Test evidence

- Python analytics/scoring/prioritization/dataset-independence suite: **130 passed**.
- Backend test suite: **30 passed**.
- Frontend production build: **passed**.
- TypeScript/Python diagnostics for changed implementation files: **no errors**.
- Dataset independence: two temporary databases with different entity counts, alert counts, dates, sectors, and behavior produced different pipeline outputs.

The frontend build emits a non-failing large JavaScript chunk warning.

## 6. Commands

```powershell
# Python tests
.\.venv\Scripts\python.exe -m pytest sat-sa/analytics/tests -q

# Backend tests
cd sat-sa/backend
npm test
npm run build

# Frontend build
cd ../frontend
npm run build

# Development servers
cd ../backend
npm run dev

# In a second terminal
cd sat-sa/frontend
npm run dev

# Air-gap verifier, after local dependencies are installed
cd sat-sa
node verify_airgapped.js
```

## 7. Remaining limitations

1. No real/public CSE dataset is available in the repository.
2. No independent expert labels or effectiveness metrics are available; live `expert_finding_labels` and `validation_runs` counts are both zero.
3. Invalid-row reporting is not yet a partial-acceptance ingestion mode.
4. Large-file ingestion is buffered and capped at 50 MB.
5. Negative-space expectations are not fully cadence/category aware.
6. Peer statistics do not yet include confidence/significance testing.
7. IsolationForest attribution is heuristic rather than formal tree contribution analysis.
8. Audit records and ML artifacts are not cryptographically immutable/versioned.
9. The offline deployment directories are placeholders and must be populated on a connected build machine before air-gapped transfer.
10. Hardware requirements are a documented prototype baseline, not a production capacity certification.

These limitations are stated explicitly because PS-157 requires supervisory evidence, not a claim based only on a polished interface or synthetic seed behavior.
