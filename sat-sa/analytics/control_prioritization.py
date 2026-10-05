"""Transparent control and process prioritization from persisted findings."""
from __future__ import annotations

import json
import hashlib
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone


MODULE_MAP = {
    "EXECUTION_GAP": {
        "control": "Alert triage and closure quality",
        "process": "Incident investigation and escalation",
    },
    "NEGATIVE_SPACE": {
        "control": "Telemetry and monitoring coverage",
        "process": "Monitoring assurance",
    },
    "ANOMALY": {
        "control": "Supervisory behavioral baselining",
        "process": "Supervisory review",
    },
    "PEER_DEVIATION": {
        "control": "Peer benchmark governance",
        "process": "Performance oversight",
    },
    "REPEATED_INCIDENT": {
        "control": "Remediation and root-cause management",
        "process": "Recurring incident remediation",
    },
}

SEVERITY_POINTS = {"CRITICAL": 100.0, "HIGH": 70.0, "MEDIUM": 40.0, "LOW": 15.0}


def prioritize_controls_processes(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT finding_id, entity_id, finding_type, severity, title, evidence_ids FROM supervisory_findings"
        ).fetchall()
        control_groups: dict[str, list[sqlite3.Row]] = defaultdict(list)
        process_groups: dict[str, list[sqlite3.Row]] = defaultdict(list)
        for row in rows:
            mapping = MODULE_MAP.get(row["finding_type"])
            if mapping:
                control_groups[mapping["control"]].append(row)
                process_groups[mapping["process"]].append(row)

        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS control_priorities (
                priority_id TEXT PRIMARY KEY,
                priority_name TEXT NOT NULL,
                priority_score REAL NOT NULL,
                finding_count INTEGER NOT NULL,
                top_severity TEXT NOT NULL,
                finding_ids TEXT NOT NULL,
                evidence_ids TEXT NOT NULL,
                calculated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS process_priorities (
                priority_id TEXT PRIMARY KEY,
                priority_name TEXT NOT NULL,
                priority_score REAL NOT NULL,
                finding_count INTEGER NOT NULL,
                top_severity TEXT NOT NULL,
                finding_ids TEXT NOT NULL,
                evidence_ids TEXT NOT NULL,
                calculated_at TEXT NOT NULL
            );
            DELETE FROM control_priorities;
            DELETE FROM process_priorities;
            """
        )

        calculated_at = datetime.now(timezone.utc).isoformat()
        for table, groups in (("control_priorities", control_groups), ("process_priorities", process_groups)):
            for name, group in groups.items():
                severities = [row["severity"] for row in group]
                top_severity = min(severities, key=lambda value: {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}.get(value, 9))
                score = min(100.0, max(SEVERITY_POINTS.get(value, 0.0) for value in severities) * (0.55 + 0.45 * min(1.0, len(group) / 5.0)))
                finding_ids = [row["finding_id"] for row in group]
                evidence_ids = sorted({evidence for row in group for evidence in json.loads(row["evidence_ids"])})
                priority_id = f"{table[:1].upper()}-{hashlib.sha1(name.encode('utf-8')).hexdigest()[:12]}"
                conn.execute(
                    f"INSERT INTO {table} (priority_id, priority_name, priority_score, finding_count, top_severity, finding_ids, evidence_ids, calculated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (priority_id, name, round(score, 2), len(group), top_severity, json.dumps(finding_ids), json.dumps(evidence_ids), calculated_at),
                )
        conn.commit()
    finally:
        conn.close()
