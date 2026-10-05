# LANL Redteam Dataset Analysis

**Analysis date:** 2026-09-28  
**Application status:** No production code, database, or existing synthetic dataset was modified during this analysis.

## Dataset source

The file was supplied in the workspace as a LANL redteam dataset. The repository contains no LANL-specific citation, license text, README, schema document, or official field-definition document. Therefore this report does not assert a formal source citation, license, or semantic interpretation beyond what is directly observable in the file.

The filename supplied by the request was `datasets/external/redteam.txt.gz`. The filesystem currently contains:

`datasets/external/redteam.txt/redteam.txt`

The actual file is plain text, not gzip-compressed. Its first bytes are ASCII text (`31 35 30 38 38 35 2C...`), not the gzip magic bytes `1F 8B`. It was read directly in place; it was not extracted or rewritten.

## File and record profile

| Property | Observed value |
|---|---|
| Actual file | `datasets/external/redteam.txt/redteam.txt` |
| File size | 22,986 bytes |
| Compression | Plain text; not gzip-compressed despite the requested `.gz` name |
| Header row | None observed |
| Delimiter | Comma |
| Line ending | LF (`\\n`) observed |
| Record count | 749 physical/data records |
| Record widths | 749/749 records have exactly 4 fields |
| Blank records | 0 |
| Exact duplicate rows | 34 duplicate occurrences; 715 distinct complete row tuples |
| Sort order | First field is non-decreasing across all records |
| First-field range | Numeric strings from `150885` through `2557047` |

The file begins:

```text
150885,U620@DOM1,C17693,C1003
151036,U748@DOM1,C17693,C305
151648,U748@DOM1,C17693,C728
151993,U6115@DOM1,C17693,C1173
153792,U636@DOM1,C17693,C294
```

The file ends with a row beginning `2557047`.

## Exact schema and observed types

Because there is no header row, columns are identified positionally as `column_1` through `column_4`. Names such as `time`, `user`, or `source_host` are deliberately not treated as proven field names in this report.

| Position | Observed lexical structure | Non-empty | Unique values | Type supported by observation | Examples |
|---|---|---:|---:|---|---|
| `column_1` | ASCII decimal integer string; 6 or 7 digits | 749 | 712 | Integer-like identifier/time value; unit and epoch are not established locally | `150885`, `2557047` |
| `column_2` | `U` followed by digits, `@`, then an alphanumeric token; every row matches `U\\d+@[A-Z]+\\d+` | 749 | 104 | Structured string | `U620@DOM1`, `U8777@C3388` |
| `column_3` | `C` followed by digits; exactly 6 characters in every row | 749 | 4 | Structured string identifier | `C17693`, `C18025`, `C19932`, `C22409` |
| `column_4` | `C` followed by digits; length varies from 2 to 6 characters | 749 | 301 | Structured string identifier | `C1003`, `C305`, `C92` |

Additional observed patterns:

- Every `column_2` value starts with `U` and contains `@`; the prefix before `@` always begins with `U` and the suffix is usually `DOM1`.
- `column_2` suffix counts: `DOM1` occurs 722 times; other observed `C<number>` suffixes account for 27 records.
- Every `column_3` and `column_4` value starts with `C` and is followed only by digits.
- `column_3` has exactly four observed values: `C17693`, `C18025`, `C19932`, and `C22409`.
- No null, empty, quoted, or malformed-width records were observed.
- The 34 duplicates are duplicate raw rows, not necessarily duplicate events; no deduplication has been applied.

## Field descriptions supported by the source

No official LANL documentation is present in this project, and the file has no headers. The only descriptions supportable from the local evidence are positional and structural:

- `column_1` is an integer-like value that is monotonically non-decreasing. It may be a time field in the upstream dataset, but its unit, epoch, timezone, and exact semantics cannot be proven from this repository alone.
- `column_2` is a structured `U...@...` string. It may represent a user/account and associated domain or host, but that meaning is not established by any local documentation.
- `column_3` is one of four `C...` identifiers. It may represent a computer/host/category identifier, but that meaning is not established locally.
- `column_4` is a `C...` identifier with 301 distinct values. It may represent another computer/host/category identifier, but that meaning is not established locally.

The dataset must not be loaded as alerts, cases, users, assets, or hosts under those names until an authoritative schema source confirms the semantics.

## Available information

The raw file provides:

- 749 ordered four-field records.
- A numeric first value that can support ordering and relative interval analysis once its unit/epoch is confirmed.
- A repeated structured identity-like value in column 2.
- A low-cardinality structured identifier in column 3.
- A higher-cardinality structured identifier in column 4.
- Repeated row patterns and frequency distributions.
- Enough structure for raw-event counts, sequence analysis, identifier co-occurrence, and graph-style relationships after a semantics-confirming adapter.

## Missing information

The file does not contain, as observable columns:

- CSE/entity ID, entity name, sector, organization, or assessment-period metadata.
- Asset type, asset criticality, expected telemetry, or last telemetry timestamp.
- Alert ID, severity, category, status, source IP, destination IP, or disposition.
- Case ID, investigator, opened/closed timestamps, investigation duration, closure reason, or remediation status.
- Escalation flag, escalation event, escalation level, or supervisor identity.
- Investigation record linkage.
- Telemetry heartbeat, expected-vs-observed monitoring record, or sensor status.
- Expert/manual-review label, reviewer, review date, or ground truth.
- Provenance, license, collection description, redaction description, schema version, or source-system metadata.

No missing value should be filled with a synthetic SAT-SA value. No alert, case, asset, escalation, telemetry event, or expert label should be fabricated from this file.

## Comparison with SAT-SA schema

| SAT-SA area | Legitimately available from raw file | Cannot be derived without external schema/context | Assessment |
|---|---|---|---|
| `entities` | None proven. A `C<number>` value can be retained as an opaque identifier only | `entity_name`, sector, organization, CSE relationship | Not directly mappable |
| `assets` | `column_3`/`column_4` can be retained as opaque candidate identifiers | Which column is an asset/host, asset type, criticality, expected telemetry, last telemetry, entity ownership | Candidate raw identifiers only; not a valid SAT-SA asset record |
| `alerts` | A raw event adapter could preserve all four original fields and source row number | Alert identity, severity, category, status, disposition, entity, asset semantics | Not a valid SAT-SA alert without authoritative mapping |
| `cases` | None | Case ID, investigation lifecycle, investigator, duration, closure, remediation | Cannot derive |
| Investigations | None | Case linkage, investigation actions, analyst, outcome, evidence | Cannot derive |
| Escalations | None | Escalation state, level, timestamp, reason, supervisor | Cannot derive |
| Telemetry | None | Expected heartbeat, observed heartbeat, freshness, coverage, sensor status | Cannot derive |
| Expert labels | None | Ground-truth decision, reviewer, severity/category judgment | Cannot derive |

## Possible mapping to SAT-SA

The only defensible first-stage mapping is an **opaque external-event staging table**, not direct insertion into the four SAT-SA operational tables:

```text
lanl_redteam_events
- source_file
- source_row_number
- raw_column_1
- raw_column_2
- raw_column_3
- raw_column_4
- raw_record_hash
- import_batch_id
```

The adapter should preserve the exact raw values and row number, record the source filename and import batch, and avoid assigning SAT-SA semantics until documentation confirms them. If the official source documentation confirms the likely interpretation of `time,user,computer,computer`-style fields, a second mapping layer may expose canonical event fields such as an opaque event time, principal, source endpoint, and destination endpoint. Even then, that would still be event data rather than case-management or supervisory outcome data.

The adapter must also:

1. Verify the file format and compression rather than trusting the filename.
2. Require an explicit schema/version declaration from the source documentation.
3. Preserve duplicate rows and report them; do not silently deduplicate.
4. Preserve the original first-field value until its unit/epoch is confirmed.
5. Store source row numbers and hashes for traceability.
6. Keep the import separate from the existing synthetic `entities`, `assets`, `alerts`, and `cases` tables.
7. Reject semantic mapping when required external metadata is absent.

## Legitimate use by SAT-SA analytics modules

| Module/capability | Legitimate use of this dataset alone |
|---|---|
| Execution-gap detection | Not suitable. No closure, investigation, escalation, or remediation outcome exists |
| Negative-space detection | Not suitable for telemetry/monitoring absence. Absence of a redteam row does not prove absence of monitoring or expected alerts |
| IsolationForest/anomaly analysis | Potentially suitable only for a separate raw-event anomaly experiment after semantics and time units are confirmed; not valid as the current entity-level SAT-SA risk feature vector |
| Peer comparison | Not suitable. No CSE, sector, or defensible peer cohort exists |
| Repeated-incident analysis | Limited raw recurrence/co-occurrence analysis may be possible; remediation-based repeated-incident findings are not possible |
| Alert prioritization | Not suitable. No severity, alert disposition, asset criticality, or review outcome exists |
| Entity risk scoring | Not suitable. Required module scores and entity identity are unavailable |
| Evidence traceability | Raw row-number/source-file traceability is possible in a staging adapter; current SAT-SA evidence IDs cannot be fabricated |
| Reporting/trends | Raw record frequency and sequence reports are possible after time semantics are confirmed; PS-157 supervisory reports are not supported by this file alone |

## PS-157 requirements that cannot be validated with this dataset alone

This dataset cannot independently validate:

- Multiple CSE supervisory assessment coverage.
- Entity risk prioritization.
- Case/investigation quality.
- Escalation weaknesses or escalation workload.
- Fast closure or closure-without-escalation behavior.
- Repeated incidents without remediation.
- Missing investigation records.
- Missing telemetry or expected monitoring coverage.
- Sector peer benchmarking.
- Control/process prioritization.
- Alert-sample prioritization for manual review.
- Explainability of a supervisory finding tied to alert/case/asset records.
- Expert/manual-review precision, recall, F1, or effectiveness.
- CSE assessment-period provenance or operational data quality.

It may support a separate event-level behavioral analysis, but such an analysis must not be presented as validation of the SAT-SA supervisory modules without the missing case-management, asset, telemetry, entity, and expert-label data.

## Recommended adapter design

Implement a non-production adapter in a separate ingestion boundary:

1. `LanlRedteamReader`: detects plain text versus gzip, validates four fields and row width, counts duplicates, and streams rows.
2. `LanlRedteamRawEvent` model: stores the four opaque fields plus source row, file hash, import batch, and provenance.
3. `LanlRedteamSchemaManifest`: requires the authoritative source URL/citation, license, schema version, time unit/epoch, and semantic mapping before any canonical projection.
4. `LanlRedteamStagingRepository`: writes only to a separate staging table, never to SAT-SA `alerts`/`cases` by default.
5. `LanlRedteamProjection`: opt-in and documented; only maps fields confirmed by authoritative documentation, leaving unsupported SAT-SA fields null or rejecting the projection.
6. Adapter tests: exact 749-record fixture check, four-column check, duplicate reporting, monotonic-order check, malformed-row rejection, no synthetic-field generation, and provenance/evidence preservation.

The adapter should not replace `data/sample/dataset.json` or alter the existing synthetic seed workflow.

## Final recommendation

**A. USE DIRECTLY:** No. The raw file must not be inserted directly into the current SAT-SA `entities`, `assets`, `alerts`, or `cases` schema because its semantics and required supervisory fields are not established.

**B. USE THROUGH ADAPTER:** Yes, for a separate opaque raw-event staging/import path, subject to authoritative LANL schema documentation, provenance/license recording, confirmed time semantics, and strict source-row traceability.

**C. NOT SUITABLE FOR A PARTICULAR PS-157 REQUIREMENT:** It is not sufficient by itself for execution-gap detection, negative-space telemetry analysis, investigation/escalation analysis, peer/CSE risk scoring, alert prioritization, remediation analysis, or expert-validation effectiveness metrics. It may provide supplemental event-level behavioral evidence only after an adapter and only with those limitations stated.
