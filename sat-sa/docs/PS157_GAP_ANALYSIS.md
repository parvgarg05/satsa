# PS-157 Independent Implementation Gap Analysis

**Audit date:** 2026-09-28  
**Evidence rule:** Source code, SQLite schema/data, executable tests, and workflow behavior were checked. UI presence and prior status documents were not treated as proof. Synthetic data is not real CSE evidence.

| Requirement | Actual Implementation | Status | Evidence/File | Gap | Required Fix |
|-------------|-----------------------|--------|---------------|-----|--------------|
| 1. Multiple CSE ingestion | JSON/CSV datasets contain multiple entities and foreign-key validation resolves them | 🟢 | `backend/src/ingestion.ts`, `backend/test/ingestion.test.ts` | None for current schema | Retain dataset-independence tests |
| 2. CSV/JSON/database export/API support | Multipart CSV and JSON work; no database-export adapter or source API connector exists | 🟡 | `backend/src/routes.ts`, `backend/src/ingestion.ts` | Database exports and APIs are absent | Add SQLite/SQL export adapter and explicit local/API adapter interface |
| 3. Large datasets across entities/time periods | SQLite indexes and a 50 MB upload limit exist; uploads are buffered in memory | 🟡 | `backend/src/routes.ts`, `backend/src/db.ts` | No streaming/chunking or scale benchmark | Add chunked import/bulk insertion and size tests |
| 4. Validation and normalization | Required fields, dates, enums, FKs, booleans, durations, trimming, and transactions exist | 🟢 | `backend/src/ingestion.ts`, `backend/src/db.ts` | No schema version/provenance manifest | Add version and provenance metadata |
| 5. Invalid-row reporting | Errors identify table/field/record and rejected counts are returned | 🟡 | `backend/src/ingestion.ts`, `backend/src/routes.ts` | One invalid row rejects the full batch | Add row-level accept/reject mode while retaining atomic mode |
| 6. Entity/time-period separation | Entity IDs and timestamps are stored; trends support date buckets and a days filter | 🟡 | `backend/src/db.ts`, `backend/src/routes.ts` | No assessment-period/cohort/version separation | Add dataset manifest and explicit assessment period |
| 7. Detection/investigation/escalation weaknesses | Duration, missing cases, escalation, remediation, and closure fields are analyzed | 🟢 | `analytics/execution_gaps.py`, `analytics/negative_space.py` | Template/KPI checks are limited | Add configurable pattern detectors |
| 8. Execution-gap detection | Fast closure, no escalation, short duration, recurrence, and inconsistent process checks exist | 🟢 | `analytics/execution_gaps.py`, `analytics/tests/test_analytics.py` | Repetitive/template and KPI-gaming checks are incomplete | Add explicit transparent proxy rules |
| 9. Negative-space detection | Stale/missing telemetry, missing cases, low activity, and missing escalation exist | 🟡 | `analytics/negative_space.py` | Expected cadence and absent peer categories are not evaluated | Add cadence/category expectation detectors |
| 10. Anomaly/outlier detection | Local sklearn IsolationForest runs on seven entity features | 🟡 | `analytics/anomaly_detection.py` | Attribution is peer deviation, not model contribution | Add documented attribution and configuration |
| 11. Suspicious operational patterns | Several rule-based suspicious patterns are detected | 🟡 | `analytics/execution_gaps.py`, `analytics/repeated_incidents.py` | No explicit KPI-gaming/template detector | Add data-supported pattern rules and tests |
| 12. Peer comparison/benchmarking | Sector cohorts, fallback cohorts, medians, deviations, and guards exist | 🟡 | `analytics/peer_analysis.py` | No variance, confidence, or significance calculation | Add cohort sufficiency and variance outputs |
| 13. Entity-level risk indicators | Weighted module scores, bands, drivers, and contributions are persisted | 🟢 | `analytics/risk_scoring.py`, `backend/src/db.ts` | None for current model | Keep formula/config synchronized |
| 14. Entity prioritization | Entity risk ranking and filters are API-backed | 🟢 | `backend/src/routes.ts`, `frontend/src/components/pages/EntitiesPage.tsx` | Ranking quality lacks independent validation | Validate ranking against expert labels |
| 15. Control prioritization | No control catalog, control IDs, mappings, or ranking exists | 🔴 | No control model in `backend/src` or `analytics` | Requirement is missing | Add controls, mappings, scores, evidence, and APIs |
| 16. Process prioritization | Execution findings imply process weakness but no process taxonomy/ranking exists | 🟡 | `analytics/execution_gaps.py` | No explicit process ranking | Add process taxonomy and prioritization |
| 17. Alert-sample prioritization | Deterministic queue uses severity, asset, entity risk, behavior, and findings | 🟢 | `analytics/alert_prioritization.py`, `backend/src/db.ts` | Not expert-calibrated/config-driven | Move weights to config and validate |
| 18. Clear rationale | Findings contain plain-English rationale and structured explanations | 🟢 | `analytics/models.py`, `analytics/risk_scoring.py` | Anomaly rationale has attribution limitation | Improve attribution and state limitations |
| 19. Supporting evidence | Findings contain alert/case/asset IDs and metrics | 🟢 | All analytics modules | Some API displays cap evidence lists | Preserve complete stored evidence |
| 20. Traceability | Finding IDs resolve through evidence endpoints to SQLite records | 🟢 | `backend/src/routes.ts`, backend API/E2E tests | No imported-source row provenance | Add ingestion provenance references |
| 21. Auditability | Audit logs and persisted findings/scores exist | 🟡 | `backend/src/db.ts`, `analytics/pipeline.py` | Tables are mutable; no append-only/hash/run manifest | Add immutable audit/run records |
| 22. Explain why flagged | WHAT/WHY/EVIDENCE/contribution fields are returned | 🟢 | `analytics/risk_scoring.py`, `/api/findings`, `/api/evidence` | Model-level attribution remains weak | Add rule/threshold metadata |
| 23. Dashboards | Dashboard uses current API metrics and risk distribution | 🟢 | `backend/src/routes.ts`, `DashboardPage.tsx` | No separate UX audit in this phase | Keep values API-derived |
| 24. Reports | Entity report assembles current risk, findings, and priority alerts | 🟢 | `backend/src/routes.ts`, `ReportPage.tsx` | Missing explicit period/config/limitations fields | Add these report fields |
| 25. Temporal trends | Alert/finding daily buckets and optional day window exist | 🟡 | `backend/src/db.ts`, `TrendsPage.tsx` | No named period or period-over-period analysis | Add period metadata/comparison |
| 26. Cross-entity analysis | Rankings and peer module compare entities | 🟢 | `analytics/peer_analysis.py`, `/api/entities` | Statistical variance gap remains | Add variance outputs |
| 27. Evidence drill-down | Finding -> evidence ID -> underlying record works and is tested | 🟢 | `backend/src/routes.ts`, backend E2E tests | No external-import provenance | Add provenance |
| 28. High-severity rapid closure | Critical cases under ten minutes are detected and evidenced | 🟢 | `analytics/execution_gaps.py` | Threshold hardcoded | Move threshold to config |
| 29. Repeated unremediated alerts | Entity/asset/category clusters and unresolved remediation are detected | 🟢 | `analytics/repeated_incidents.py` | No actual sliding-window rule | Add configurable assessment window |
| 30. Critical alerts without escalation | Closed critical cases with escalated=0 are detected | 🟢 | `analytics/execution_gaps.py`, `negative_space.py` | Threshold hardcoded | Move threshold to config |
| 31. Critical systems with little/no telemetry | Missing and stale critical telemetry is detected | 🟢 | `analytics/negative_space.py`, CSE-007 tests | Fixed-date, not cadence-aware | Add expectation period/cadence |
| 32. Significant peer deviation | Median deviation rules exist | 🟡 | `analytics/peer_analysis.py` | Not statistically significant variance | Add variance/confidence rule |
| 33. Missing monitoring coverage | Telemetry coverage and stale assets are assessed | 🟡 | `negative_space.py`, `peer_analysis.py` | Expected categories/behavior incomplete | Add explicit expectations |
| 34. Repetitive investigations | Short duration and recurrence proxies exist | 🟡 | `execution_gaps.py` | No text/workflow similarity detector | Add only where source fields support it |
| 35. KPI-gaming behavior | Rapid closure/low escalation are proxy signals | 🟡 | `execution_gaps.py` | No explicit KPI-gaming rule/confidence | Add documented proxy rules |
| 36. Inconsistent workloads | Low activity, duration, and escalation comparisons exist | 🟡 | `negative_space.py`, `peer_analysis.py` | Global mean/fixed date weaken baselines | Use sector/time-period baselines |
| 37. Fully offline | Local Node, SQLite, Python, and frontend API path exist | 🟡 | `backend/src/analytics.service.ts`, `README.md` | No complete offline artifact | Build and test bundle |
| 38. Air-gapped | Static local startup/source check exists | 🟡 | `verify_airgapped.js` | No runtime egress/DNS/socket verification | Add runtime network verification |
| 39. No cloud dependency | Runtime code has no cloud service configuration | 🟢 | `backend/src`, `frontend/src`, `analytics` | Unused `axios` remains declared | Remove unused dependency |
| 40. No SaaS dependency | No SaaS endpoint is configured | 🟢 | Runtime source search, `verify_airgapped.js` | Static check is limited | Strengthen automated check |
| 41. No externally hosted AI | Local sklearn only; no external AI calls found | 🟢 | `analytics/anomaly_detection.py` | None found | Preserve local-only policy |
| 42. Local processing | SQLite and local Python subprocess process data | 🟢 | `analytics.service.ts`, `pipeline.py` | None for current workflow | Add run manifest |
| 43. Local model inference | IsolationForest runs locally | 🟢 | `anomaly_detection.py` | No persisted model lifecycle | Add lifecycle metadata |
| 44. Model architecture documented | Features and IsolationForest are documented | 🟡 | `README.md`, `anomaly_detection.py` | README says 200 estimators; code uses 150 | Reconcile config/docs |
| 45. Hardware requirements | No CPU/RAM/storage sizing exists | 🔴 | `deployment/README.md` | Requirement missing | Add tested requirements |
| 46. Offline training/inference | Local fit/inference occurs per analysis run | 🟡 | `anomaly_detection.py` | No distinct training artifact/workflow | Document or implement lifecycle |
| 47. Model update mechanism | No model version/update/rollback/drift process | 🔴 | `anomaly_detection.py` | Requirement missing | Add versioned local update process |
| 48. Explainability controls | Feature values/deviations and rationale are emitted | 🟡 | `anomaly_detection.py`, `risk_scoring.py` | Not true model contribution attribution | Add defined attribution method |
| 49. Auditability controls | Parameters/results are persisted | 🟡 | `pipeline.py`, `db.ts` | No input/model snapshot or hash | Add model/run audit records |
| 50. Expert validation | Finding-level independent labels, deterministic validation runs, precision/recall/F1, confusion counts, module/entity summaries, and audit events are implemented | 🟡 | `backend/src/db.ts`, `backend/src/routes.ts`, `frontend/src/components/pages/ValidationPage.tsx`, `backend/test/validation.test.ts` | Live expert-label count remains zero; no effectiveness result exists until humans import labels | Obtain genuine independent human labels and publish a validation run |
| 51. Effectiveness vs manual sampling | No populated independent validation result exists | 🔴 | Validation workflow reports no labels when empty | Obtain expert labels and publish reproducible metrics |
| 52. Solution architecture | Architecture is documented | 🟢 | `README.md`, `docs/ARCHITECTURE.md` | Must be reconciled after fixes | Update documentation |
| 53. Functional design | API/frontend workflow exists | 🟢 | `frontend/src`, `backend/src/routes.ts` | Some claims exceed implementation | Reconcile docs/UI text |
| 54. Analytics methodology | Modules and formula are documented | 🟡 | `README.md`, `analytics` | Config/model/variance mismatches | Add canonical configuration |
| 55. Data requirements | Core schemas are documented | 🟢 | `PROJECT_SPEC.md`, `docs/DATA_REQUIREMENTS.md` | Missing period/provenance/control fields | Extend data contract |
| 56. Working prototype | Backend, frontend, Python pipeline, and tests run locally | 🟢 | 129 Python tests; 30 direct backend tests | Declared `npm test` rejects `--concurrency=1` | Fix test script |
| 57. Infrastructure requirements | Node/Python prerequisites are documented | 🟡 | `README.md`, `deployment/README.md` | Hardware/offline artifacts incomplete | Add infrastructure matrix |
| 58. Validation methodology | Basic label import/metric formula exists | 🟡 | `db.ts`, `ValidationPage.tsx` | No independent protocol/confusion report | Add schema/protocol/report |
| 59. Deployment/operational requirements | Deployment guide describes connected/offline steps | 🟡 | `deployment/README.md` | Actual wheel/node bundles are absent | Produce and verify bundle |
| 60. Real/public dataset | Generator and acceptance fixture are synthetic | 🔴 | `data/generate_sample_data.py`, `data/sample/dataset.json`, `acceptance_dataset.json` | No source, license, or public/real provenance | Add `data/README.md`; obtain authorized/public data |
| 61. Dataset independence | Analytics query database entities/data, not fixed counts | 🟢 | Analytics modules and generation tests | No dedicated two-dataset end-to-end regression | Add Dataset A/B test |
| 62. CSE-007 independence | Production analytics use arbitrary IDs; generators/tests benchmark CSE-007 | 🟡 | `generate_sample_data.py`, `generate_dataset.ts`, analytics tests | Fixed date and benchmark assumptions remain | Add unrelated dataset regression and remove production assumptions |

## Dataset conclusion

The current repository uses deterministic synthetic/demo data generated by `data/generate_sample_data.py` and `backend/src/generate_dataset.ts`, plus test data in `acceptance_dataset.json`. No public source, license, collection authority, or real CSE submission is present. It must be labelled **DEMO / SYNTHETIC DATA — NOT REAL CSE DATA**.

## Verification performed

- Python analytics suite: 129 tests passed.
- Backend test files run directly without the package script's incompatible `--concurrency=1` option: 30 tests passed.
- The declared `npm test` script fails before tests because the installed Node/tsx invocation rejects `--concurrency=1`.
- No implementation files were changed before this audit document.

## Post-audit implementation updates

The following gaps were addressed after the audit was recorded: canonical configuration was added and wired into analytics; SQLite database-export ingestion was added; the backend test command was repaired; peer variance/stddev and insufficient-peer handling were added; configured assessment timestamps replaced detector-local dates; deterministic control/process priority queues and API routes were added; report period/methodology metadata was added; Dataset A/B independence coverage was added; synthetic-data/provenance and offline documentation were corrected; and the air-gap verifier was made Windows-safe and local-only.

The following findings remain open by design: real/public CSE data, independent expert labels and effectiveness measurements, production-scale streaming benchmarks, row-level partial acceptance, full cadence/category negative-space expectations, formal IsolationForest attribution, statistical confidence testing, immutable cryptographic audit records, ML model update/rollback lifecycle, and a populated offline deployment bundle.

## Expert validation workflow

The validation workflow now operates on `finding_id` rather than converting alert priorities or SAT-SA predictions into labels. Accepted human labels are `CONFIRMED` and `NOT_CONFIRMED`, with required entity, reviewer, timestamp, and optional rationale. Invalid rows are reported, validation runs are deterministic and auditable, and metrics remain hidden when no genuine labels are present. The repository still contains **zero genuine expert labels** and therefore makes no effectiveness claim.

## LANL/redteam external dataset

`datasets/external/redteam.txt/redteam.txt` is now supported through an isolated external-event staging adapter. It is an external realistic cybersecurity event dataset, but it is **not real CSE supervisory data** and must not be treated as such. The adapter preserves the four positional source fields, raw content, source hash, dataset ID, row/event IDs, duplicate relationships, provenance, and source-row traceability in separate external tables.

LANL/redteam is used to demonstrate dataset adaptability, provenance, deterministic staging, duplicate handling, and raw-event traceability only. It does not independently validate most PS-157 supervisory analytics because it lacks CSE metadata, asset criticality/telemetry, alerts/dispositions, cases, investigations, escalations, remediation, and expert labels. Unsupported supervisory modules therefore return the explicit not-applicable message rather than fabricated findings.

## Three-limitation closure update

- **Public/external data:** The LANL/redteam adapter now records source file, source hash, dataset ID, acquisition-date status, row/event IDs, raw bytes, duplicate relationships, provenance, and a four-row `NOT_AVAILABLE` field-mapping report. It remains isolated from synthetic CSE tables and is not real CSE supervisory data.
- **Expert validation:** Finding-level labels, direct human review controls, CSV import/export, blank review template export, deterministic validation runs, module/entity summaries, and audit events are implemented. The live `expert_finding_labels` and `validation_runs` counts remain zero; no effectiveness claim is made.
- **Deployment portability:** Bundle creation now records OS, architecture, Node major, Python major/minor, dependency metadata, and target-specific compatibility. Windows/Linux launchers and a verifier are provided. The bundle is target-specific, not universal.
