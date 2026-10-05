# SAT-SA Data Contract

## Dataset status

The files under `data/sample/` and `acceptance_dataset.json` are **DEMO / SYNTHETIC DATA - NOT REAL CSE DATA**. They are generated with deterministic pseudo-random values for software testing and demonstration. They do not have public-source provenance, a license, or expert-review labels.

A real CSE submission must be authorized by the submitting organization and must document source, collection period, license/usage constraints, and any redaction or aggregation applied before import.

## Supported input shapes

The current importer accepts:

- One JSON object with `entities`, `assets`, `alerts`, and `cases` arrays.
- Separate JSON arrays named with `entities`, `assets`, `alerts`, or `cases`.
- Separate CSV files named for those four tables.
- Canonical SQLite database exports containing the same four tables (adapter to be used for operational import).

All records are normalized into the local SQLite schema. IDs must be stable within the assessment dataset.

## Required fields

- `entities`: `entity_id`, `entity_name`, `sector`
- `assets`: `asset_id`, `entity_id`, `asset_type`, `criticality`, `expected_telemetry`; `last_telemetry` is optional
- `alerts`: `alert_id`, `timestamp`, `entity_id`, `asset_id`, `severity`, `category`, `status`; IP fields are optional
- `cases`: `case_id`, `alert_id`, `entity_id`, `investigator`, `opened_at`, `investigation_duration`, `escalated`; closure and remediation fields are optional

## Assessment periods and multiple CSEs

Multiple CSEs are represented by one row per entity in `entities`, with all related assets, alerts, and cases referencing `entity_id`. A submission should identify its assessment period in the dataset manifest using an ISO start and end timestamp. Records outside that period must be rejected or explicitly classified as out-of-period; the current schema stores record timestamps and is being extended with manifest metadata.

## Privacy and minimization

The supervisory workflow needs metadata and summarized case-management evidence, not raw packet captures, customer content, or full raw logs. IP fields should be pseudonymized where operationally appropriate.

## Provenance checklist

Every non-demo submission should include source organization, source system, collection period, export time, schema version, row counts, redaction method, and authorization/license reference. No current repository dataset satisfies that checklist.

## Expert validation labels

`expert_validation_template.csv` is a headers-only template. A reviewer must independently inspect the finding rationale and evidence before supplying `CONFIRMED` or `NOT_CONFIRMED`, along with `entity_id`, `reviewer_id`, `review_timestamp`, and optional rationale. The application never converts predictions into expert labels and does not display validation metrics while the expert-label table is empty.

`REVIEW_TEMPLATE.csv` is an unlabeled sample export for human annotation only. It contains finding/entity identifiers with all expert fields blank; it is not ground truth and must not be treated as validation evidence until a human reviewer completes it.
