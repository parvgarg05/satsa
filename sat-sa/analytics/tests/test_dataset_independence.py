import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline import run_pipeline


SCHEMA = """
CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT NOT NULL, sector TEXT NOT NULL);
CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, asset_type TEXT NOT NULL, criticality TEXT NOT NULL, expected_telemetry TEXT NOT NULL, last_telemetry TEXT);
CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, entity_id TEXT NOT NULL, asset_id TEXT NOT NULL, severity TEXT NOT NULL, category TEXT NOT NULL, source_ip TEXT, destination_ip TEXT, status TEXT NOT NULL);
CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT NOT NULL, entity_id TEXT NOT NULL, investigator TEXT NOT NULL, opened_at TEXT NOT NULL, investigation_duration INTEGER NOT NULL, escalated INTEGER NOT NULL, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
"""


def make_dataset(path, entity_count, alert_count, duration, date):
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    for index in range(entity_count):
        entity_id = f"DATA-{index + 1:02d}"
        conn.execute("INSERT INTO entities VALUES (?, ?, ?)", (entity_id, f"Dataset Entity {index + 1}", "Energy" if index % 2 == 0 else "Banking"))
        conn.execute("INSERT INTO assets VALUES (?, ?, ?, ?, ?, ?)", (f"AST-{index + 1:02d}", entity_id, "Server", "CRITICAL", "Daily", date))

    for index in range(alert_count):
        entity_index = index % entity_count
        entity_id = f"DATA-{entity_index + 1:02d}"
        alert_id = f"ALT-{index + 1:03d}"
        case_id = f"CAS-{index + 1:03d}"
        conn.execute("INSERT INTO alerts VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'CLOSED')", (alert_id, date, entity_id, f"AST-{entity_index + 1:02d}", "CRITICAL" if index % 2 == 0 else "LOW", "Ransomware" if index % 3 == 0 else "Scan"))
        conn.execute("INSERT INTO cases VALUES (?, ?, ?, 'Reviewer', ?, ?, ?, ?, ?, ?)", (case_id, alert_id, entity_id, date, duration, 0 if duration < 10 else 1, date, "Ignored" if duration < 10 else "Remediated", "None" if duration < 10 else "Completed"))
    conn.commit()
    conn.close()


def test_pipeline_outputs_change_for_different_datasets(tmp_path):
    dataset_a = str(tmp_path / "dataset_a.db")
    dataset_b = str(tmp_path / "dataset_b.db")
    make_dataset(dataset_a, entity_count=3, alert_count=18, duration=4, date="2026-01-01T00:00:00Z")
    make_dataset(dataset_b, entity_count=5, alert_count=7, duration=90, date="2026-08-01T00:00:00Z")

    result_a = run_pipeline(dataset_a)
    result_b = run_pipeline(dataset_b)

    assert result_a["dataset_version"] != result_b["dataset_version"]
    assert result_a["entities_analyzed"] == 3
    assert result_b["entities_analyzed"] == 5
    assert result_a["total_findings"] != result_b["total_findings"] or result_a["entity_risk"] != result_b["entity_risk"]
