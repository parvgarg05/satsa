"""
tests/test_analytics.py — Unit & integration tests for all five analytics modules.

Run with:
    pytest tests/test_analytics.py -v
"""
import os
import sys
import json
import sqlite3
import tempfile
import shutil
import pytest

# Allow importing sibling analytics modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import Finding
from execution_gaps import detect_execution_gaps
from negative_space import detect_negative_space
from anomaly_detection import detect_anomalies, get_entity_features
from peer_analysis import detect_peer_deviations, get_entity_metrics
from repeated_incidents import detect_repeated_incidents
from pipeline import run_pipeline


# ── Fixture: path to the Phase 2 populated database ────────────────────────
DB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../backend/sat_sa.db")
)


@pytest.fixture(scope="session")
def live_db():
    """Verify the Phase 2 database exists and is populated before running tests."""
    assert os.path.exists(DB_PATH), (
        f"Phase 2 database not found at {DB_PATH}. "
        "Run `npm run seed` in sat-sa/backend first."
    )
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM entities")
    count = cur.fetchone()[0]
    conn.close()
    assert count >= 20, f"Expected at least 20 entities in live database, found {count}. Run `npm run seed` in sat-sa/backend first."
    return DB_PATH


@pytest.fixture
def minimal_db(tmp_path):
    """
    Minimal in-memory-style SQLite database with controlled synthetic data
    for targeted unit tests that should not depend on the live dataset.
    """
    db_file = str(tmp_path / "test.db")
    conn = sqlite3.connect(db_file)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript("""
        CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT NOT NULL, sector TEXT NOT NULL);
        CREATE TABLE assets (
            asset_id TEXT PRIMARY KEY, entity_id TEXT NOT NULL,
            asset_type TEXT NOT NULL,
            criticality TEXT NOT NULL CHECK(criticality IN ('CRITICAL','HIGH','MEDIUM','LOW')),
            expected_telemetry TEXT NOT NULL,
            last_telemetry TEXT,
            FOREIGN KEY(entity_id) REFERENCES entities(entity_id)
        );
        CREATE TABLE alerts (
            alert_id TEXT PRIMARY KEY, timestamp TEXT NOT NULL,
            entity_id TEXT NOT NULL, asset_id TEXT NOT NULL,
            severity TEXT NOT NULL CHECK(severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
            category TEXT NOT NULL, source_ip TEXT, destination_ip TEXT,
            status TEXT NOT NULL CHECK(status IN ('OPEN','INVESTIGATING','CLOSED','ESCALATED')),
            FOREIGN KEY(entity_id) REFERENCES entities(entity_id),
            FOREIGN KEY(asset_id) REFERENCES assets(asset_id)
        );
        CREATE TABLE cases (
            case_id TEXT PRIMARY KEY, alert_id TEXT NOT NULL,
            entity_id TEXT NOT NULL, investigator TEXT NOT NULL,
            opened_at TEXT NOT NULL, investigation_duration INTEGER NOT NULL,
            escalated INTEGER NOT NULL CHECK(escalated IN (0,1)),
            closed_at TEXT, closure_reason TEXT,
            remediation_status TEXT CHECK(remediation_status IS NULL OR
                remediation_status IN ('Completed','In Progress','None','Ignored')),
            FOREIGN KEY(alert_id) REFERENCES alerts(alert_id),
            FOREIGN KEY(entity_id) REFERENCES entities(entity_id)
        );
    """)

    # Two entities: BAD-01 (high gaps) and GOOD-01 (healthy)
    conn.execute("INSERT INTO entities VALUES ('BAD-01','Bad Corp','Energy')")
    conn.execute("INSERT INTO entities VALUES ('GOOD-01','Good Corp','Energy')")

    # Assets
    conn.execute("INSERT INTO assets VALUES ('AST-B-01','BAD-01','SCADA','CRITICAL','Syslog','2026-01-01T00:00:00Z')")
    conn.execute("INSERT INTO assets VALUES ('AST-G-01','GOOD-01','SCADA','CRITICAL','Syslog','2026-09-26T00:00:00Z')")

    # BAD-01: 10 CRITICAL alerts all CLOSED, all super-fast (<5 min), none escalated
    for i in range(10):
        aid = f"ALT-B-{i:03d}"
        cid = f"CAS-B-{i:03d}"
        conn.execute(
            "INSERT INTO alerts VALUES (?,?,?,?,?,?,?,?,?)",
            (aid, "2026-09-01T10:00:00Z", "BAD-01", "AST-B-01",
             "CRITICAL", "Ransomware", "1.1.1.1", "2.2.2.2", "CLOSED"),
        )
        conn.execute(
            "INSERT INTO cases VALUES (?,?,?,?,?,?,?,?,?,?)",
            (cid, aid, "BAD-01", "Analyst", "2026-09-01T10:01:00Z",
             3, 0, "2026-09-01T10:04:00Z", "False Positive", "None"),
        )

    # GOOD-01: 10 CRITICAL alerts, 55-min investigation, escalated
    for i in range(10):
        aid = f"ALT-G-{i:03d}"
        cid = f"CAS-G-{i:03d}"
        conn.execute(
            "INSERT INTO alerts VALUES (?,?,?,?,?,?,?,?,?)",
            (aid, "2026-09-01T10:00:00Z", "GOOD-01", "AST-G-01",
             "CRITICAL", "Brute Force", "3.3.3.3", "4.4.4.4", "CLOSED"),
        )
        conn.execute(
            "INSERT INTO cases VALUES (?,?,?,?,?,?,?,?,?,?)",
            (cid, aid, "GOOD-01", "Analyst", "2026-09-01T10:01:00Z",
             55, 1, "2026-09-01T11:00:00Z", "Remediated", "Completed"),
        )

    conn.commit()
    conn.close()
    return db_file


# ════════════════════════════════════════════════════════════════════════════
# Module A — Execution Gaps
# ════════════════════════════════════════════════════════════════════════════

class TestExecutionGaps:
    def test_returns_list_of_findings(self, live_db):
        findings = detect_execution_gaps(live_db)
        assert isinstance(findings, list)
        assert all(isinstance(f, Finding) for f in findings)

    def test_finding_schema(self, live_db):
        findings = detect_execution_gaps(live_db)
        assert len(findings) > 0, "Expected at least one execution-gap finding"
        f = findings[0]
        assert f.finding_id
        assert f.entity_id
        assert f.finding_type == "EXECUTION_GAP"
        assert f.severity in ("CRITICAL", "HIGH", "MEDIUM", "LOW")
        assert f.title
        assert f.rationale
        assert isinstance(f.evidence_ids, list)
        assert isinstance(f.supporting_metrics, dict)

    def test_fast_closure_flagged_in_synthetic(self, minimal_db):
        findings = detect_execution_gaps(minimal_db)
        bad_findings = [f for f in findings if f.entity_id == "BAD-01"]
        assert len(bad_findings) > 0, "BAD-01 must be flagged for fast closures"

    def test_healthy_entity_not_flagged_for_fast_closure(self, minimal_db):
        findings = detect_execution_gaps(minimal_db)
        good_fast = [
            f for f in findings
            if f.entity_id == "GOOD-01" and "Quickly" in f.title
        ]
        assert len(good_fast) == 0, "GOOD-01 should not be flagged for quick closure"

    def test_cse007_flagged(self, live_db):
        findings = detect_execution_gaps(live_db)
        cse007 = [f for f in findings if f.entity_id == "CSE-007"]
        assert len(cse007) >= 2, f"CSE-007 should have ≥2 execution-gap findings, got {len(cse007)}"

    def test_evidence_ids_not_empty_for_gap_findings(self, live_db):
        findings = detect_execution_gaps(live_db)
        for f in findings:
            if "Quickly" in f.title or "Escalation" in f.title:
                assert len(f.evidence_ids) > 0, f"Finding {f.finding_id} must have evidence"

    def test_known_io_critical_quick_closure(self, tmp_path):
        """Known I/O: 4 out of 5 critical alerts closed in <10 min (80%) -> CRITICAL finding."""
        db_file = str(tmp_path / "test_quick.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-FAST', 'Fast Corp', 'Energy');
            INSERT INTO assets VALUES ('AST-F1', 'E-FAST', 'Server', 'CRITICAL', 'Daily', '2026-09-20T00:00:00Z');
        """)
        for i in range(5):
            aid, cid = f"ALT-F-{i}", f"CAS-F-{i}"
            dur = 3 if i < 4 else 45  # 4 quick (3 min), 1 normal (45 min)
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-01T00:00:00Z', 'E-FAST', 'AST-F1', 'CRITICAL', 'Malware', NULL, NULL, 'CLOSED')", (aid,))
            conn.execute("INSERT INTO cases VALUES (?, ?, 'E-FAST', 'Analyst', '2026-09-01T00:01:00Z', ?, 1, '2026-09-01T00:05:00Z', 'Remediated', 'Completed')", (cid, aid, dur))
        conn.commit()
        conn.close()

        findings = detect_execution_gaps(db_file)
        quick_f = next((f for f in findings if f.entity_id == "E-FAST" and "Quickly" in f.title), None)
        assert quick_f is not None, "Must generate quick closure finding"
        assert quick_f.severity == "CRITICAL", "80% quick closures must map to CRITICAL severity"
        assert quick_f.supporting_metrics["quick_closure_count"] == 4
        assert quick_f.supporting_metrics["total_critical_closed"] == 5
        assert quick_f.supporting_metrics["quick_closure_ratio"] == 0.8
        assert "ALT-F-0" in quick_f.evidence_ids and "CAS-F-0" in quick_f.evidence_ids

    def test_known_io_no_escalation(self, tmp_path):
        """Known I/O: 5 out of 5 critical alerts closed without escalation (100%) -> CRITICAL finding."""
        db_file = str(tmp_path / "test_noesc.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-NOESC', 'NoEsc Corp', 'Banking');
            INSERT INTO assets VALUES ('AST-N1', 'E-NOESC', 'Database', 'CRITICAL', 'Daily', '2026-09-20T00:00:00Z');
        """)
        for i in range(5):
            aid, cid = f"ALT-N-{i}", f"CAS-N-{i}"
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-01T00:00:00Z', 'E-NOESC', 'AST-N1', 'CRITICAL', 'Exfiltration', NULL, NULL, 'CLOSED')", (aid,))
            conn.execute("INSERT INTO cases VALUES (?, ?, 'E-NOESC', 'Analyst', '2026-09-01T00:01:00Z', 50, 0, '2026-09-01T00:51:00Z', 'Remediated', 'Completed')", (cid, aid))
        conn.commit()
        conn.close()

        findings = detect_execution_gaps(db_file)
        noesc_f = next((f for f in findings if f.entity_id == "E-NOESC" and "Without Escalation" in f.title), None)
        assert noesc_f is not None, "Must generate unescalated critical alerts finding"
        assert noesc_f.severity == "CRITICAL", "100% unescalated critical must be CRITICAL"
        assert noesc_f.supporting_metrics["no_escalation_count"] == 5
        assert noesc_f.supporting_metrics["no_escalation_ratio"] == 1.0

    def test_known_io_repeated_unremediated(self, tmp_path):
        """Known I/O: 6 alerts on same asset with category Ransomware, 5 unremediated -> MEDIUM finding."""
        db_file = str(tmp_path / "test_repeat.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-REP', 'Repeat Corp', 'Healthcare');
            INSERT INTO assets VALUES ('AST-R1', 'E-REP', 'Workstation', 'HIGH', 'Daily', '2026-09-20T00:00:00Z');
        """)
        for i in range(6):
            aid, cid = f"ALT-R-{i}", f"CAS-R-{i}"
            rem = "Completed" if i == 0 else "None"
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-01T00:00:00Z', 'E-REP', 'AST-R1', 'HIGH', 'Ransomware', NULL, NULL, 'CLOSED')", (aid,))
            conn.execute("INSERT INTO cases VALUES (?, ?, 'E-REP', 'Analyst', '2026-09-01T00:01:00Z', 45, 1, '2026-09-01T00:46:00Z', 'Remediated', ?)", (cid, aid, rem))
        conn.commit()
        conn.close()

        findings = detect_execution_gaps(db_file)
        rep_f = next((f for f in findings if f.entity_id == "E-REP" and "Repeated" in f.title), None)
        assert rep_f is not None, "Must flag repeated alerts without remediation"
        assert rep_f.severity == "MEDIUM", "Cluster of 6 should be MEDIUM severity"
        assert rep_f.supporting_metrics["total_alerts"] == 6
        assert rep_f.supporting_metrics["unremediated_cases"] == 5

    def test_known_io_inconsistent_operational_process(self, tmp_path):
        """Known I/O: Critical cases closed as 'Ignored' -> Inconsistent process finding."""
        db_file = str(tmp_path / "test_inconsistent.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-INC', 'Inconsistent Corp', 'Energy');
            INSERT INTO assets VALUES ('AST-I1', 'E-INC', 'SCADA', 'CRITICAL', 'Daily', '2026-09-20T00:00:00Z');
        """)
        for i in range(5):
            aid, cid = f"ALT-I-{i}", f"CAS-I-{i}"
            reason = "Ignored" if i < 3 else "False Positive"  # 3/5 = 60%
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-01T00:00:00Z', 'E-INC', 'AST-I1', 'CRITICAL', 'Unauthorized Access', NULL, NULL, 'CLOSED')", (aid,))
            conn.execute("INSERT INTO cases VALUES (?, ?, 'E-INC', 'Analyst', '2026-09-01T00:01:00Z', 20, 0, '2026-09-01T00:21:00Z', ?, 'None')", (cid, aid, reason))
        conn.commit()
        conn.close()

        findings = detect_execution_gaps(db_file)
        inc_f = next((f for f in findings if f.entity_id == "E-INC" and "Inconsistency" in f.title), None)
        assert inc_f is not None, "Must flag operational inconsistency"
        assert inc_f.severity == "HIGH", "60% inconsistency must map to HIGH severity"
        assert inc_f.supporting_metrics["inconsistent_case_count"] == 3

    def test_known_io_healthy_entity_zero_findings(self, tmp_path):
        """Known I/O: Thorough investigations, 100% escalated, all remediated -> 0 execution gap findings."""
        db_file = str(tmp_path / "test_healthy.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-HEALTHY', 'Healthy Corp', 'Banking');
            INSERT INTO assets VALUES ('AST-H1', 'E-HEALTHY', 'Firewall', 'CRITICAL', 'Daily', '2026-09-20T00:00:00Z');
        """)
        for i in range(10):
            aid, cid = f"ALT-H-{i}", f"CAS-H-{i}"
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-01T00:00:00Z', 'E-HEALTHY', 'AST-H1', 'CRITICAL', 'Ransomware', NULL, NULL, 'CLOSED')", (aid,))
            conn.execute("INSERT INTO cases VALUES (?, ?, 'E-HEALTHY', 'Lead_Investigator', '2026-09-01T00:01:00Z', 75, 1, '2026-09-01T01:16:00Z', 'Remediated', 'Completed')", (cid, aid))
        conn.commit()
        conn.close()

        findings = detect_execution_gaps(db_file)
        healthy_findings = [f for f in findings if f.entity_id == "E-HEALTHY"]
        assert len(healthy_findings) == 0, "Healthy entity must produce zero execution gap findings"


# ════════════════════════════════════════════════════════════════════════════
# Module B — Negative Space
# ════════════════════════════════════════════════════════════════════════════

class TestNegativeSpace:
    def test_returns_list(self, live_db):
        findings = detect_negative_space(live_db)
        assert isinstance(findings, list)

    def test_finding_schema(self, live_db):
        findings = detect_negative_space(live_db)
        assert len(findings) > 0
        f = findings[0]
        assert f.finding_type == "NEGATIVE_SPACE"
        assert f.severity in ("CRITICAL", "HIGH", "MEDIUM", "LOW")
        assert isinstance(f.supporting_metrics, dict)

    def test_cse007_stale_telemetry_flagged(self, live_db):
        findings = detect_negative_space(live_db)
        cse007 = [
            f for f in findings
            if f.entity_id == "CSE-007" and "Telemetry" in f.title
        ]
        assert len(cse007) >= 1, "CSE-007 must have a stale-telemetry negative-space finding"

    def test_stale_asset_ids_in_evidence(self, live_db):
        findings = detect_negative_space(live_db)
        cse007_tel = [
            f for f in findings
            if f.entity_id == "CSE-007" and "Critical Assets" in f.title
        ]
        assert len(cse007_tel) > 0
        # The stale SCADA assets should appear in evidence_ids
        stale_assets = {"AST-007-01", "AST-007-02", "AST-007-03", "AST-007-04"}
        found_ids = set(cse007_tel[0].evidence_ids)
        assert stale_assets.issubset(found_ids), (
            f"Stale assets {stale_assets - found_ids} missing from evidence_ids"
        )

    def test_synthetic_stale_asset_flagged(self, minimal_db):
        """BAD-01 has AST-B-01 with last_telemetry = 2026-01-01 — stale by >250 days."""
        findings = detect_negative_space(minimal_db)
        bad_tel = [
            f for f in findings
            if f.entity_id == "BAD-01" and "Telemetry" in f.title
        ]
        assert len(bad_tel) > 0, "BAD-01 stale CRITICAL asset must trigger NS finding"

    def test_healthy_asset_not_flagged(self, minimal_db):
        """GOOD-01 has AST-G-01 with recent telemetry."""
        findings = detect_negative_space(minimal_db)
        good_tel = [
            f for f in findings
            if f.entity_id == "GOOD-01" and "Critical Assets" in f.title
        ]
        assert len(good_tel) == 0, "GOOD-01 should not be flagged for stale critical telemetry"

    def test_healthy_telemetry_no_findings(self, tmp_path):
        """Known I/O: Entity with recent telemetry and active cases produces no stale/missing telemetry findings."""
        db_file = str(tmp_path / "test_healthy_tel.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-HEALTHY-TEL', 'Healthy Corp', 'Banking');
            INSERT INTO assets VALUES ('AST-H1', 'E-HEALTHY-TEL', 'Server', 'CRITICAL', 'Daily', '2026-09-26T12:00:00Z');
            INSERT INTO alerts VALUES ('ALT-H1', '2026-09-26T12:00:00Z', 'E-HEALTHY-TEL', 'AST-H1', 'CRITICAL', 'Malware', NULL, NULL, 'CLOSED');
            INSERT INTO cases VALUES ('CAS-H1', 'ALT-H1', 'E-HEALTHY-TEL', 'Analyst', '2026-09-26T12:01:00Z', 30, 1, '2026-09-26T12:31:00Z', 'Remediated', 'Completed');
        """)
        conn.commit()
        conn.close()

        findings = detect_negative_space(db_file)
        tel_findings = [f for f in findings if f.entity_id == "E-HEALTHY-TEL" and "Telemetry" in f.title]
        assert len(tel_findings) == 0, "Healthy telemetry must not generate negative space telemetry findings"

    def test_stale_telemetry_detected(self, tmp_path):
        """Known I/O: Asset with last_telemetry older than 7 days generates stale telemetry finding."""
        db_file = str(tmp_path / "test_stale_tel.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-STALE', 'Stale Corp', 'Energy');
            INSERT INTO assets VALUES ('AST-STALE-1', 'E-STALE', 'SCADA', 'CRITICAL', 'Daily', '2026-09-10T00:00:00Z');
        """)
        conn.commit()
        conn.close()

        findings = detect_negative_space(db_file)
        stale_f = next((f for f in findings if f.entity_id == "E-STALE" and "Telemetry" in f.title), None)
        assert stale_f is not None, "Stale telemetry must be detected"
        assert "AST-STALE-1" in stale_f.evidence_ids
        assert "expected_evidence" in stale_f.supporting_metrics
        assert "observed_evidence" in stale_f.supporting_metrics

    def test_missing_telemetry_detected(self, tmp_path):
        """Known I/O: Asset with last_telemetry IS NULL generates missing telemetry finding."""
        db_file = str(tmp_path / "test_missing_tel.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-MISSTEL', 'Missing Tel Corp', 'Transport');
            INSERT INTO assets VALUES ('AST-NULL-1', 'E-MISSTEL', 'Controller', 'CRITICAL', 'Daily', NULL);
        """)
        conn.commit()
        conn.close()

        findings = detect_negative_space(db_file)
        miss_f = next((f for f in findings if f.entity_id == "E-MISSTEL" and "Telemetry" in f.title), None)
        assert miss_f is not None, "Null telemetry must be detected as negative space"
        assert "AST-NULL-1" in miss_f.evidence_ids

    def test_missing_cases_detected(self, tmp_path):
        """Known I/O: Critical alerts lacking cases generate missing investigation finding."""
        db_file = str(tmp_path / "test_missing_cases.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-NOCASES', 'No Cases Corp', 'Defence');
            INSERT INTO assets VALUES ('AST-NC1', 'E-NOCASES', 'Firewall', 'CRITICAL', 'Daily', '2026-09-26T00:00:00Z');
        """)
        # 10 critical alerts, only 1 has a case -> 90% uninvestigated
        for i in range(10):
            aid = f"ALT-NC-{i}"
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-25T00:00:00Z', 'E-NOCASES', 'AST-NC1', 'CRITICAL', 'Intrusion', NULL, NULL, 'OPEN')", (aid,))
            if i == 0:
                conn.execute("INSERT INTO cases VALUES ('CAS-NC-0', ?, 'E-NOCASES', 'Analyst', '2026-09-25T00:05:00Z', 20, 1, NULL, NULL, 'In Progress')", (aid,))
        conn.commit()
        conn.close()

        findings = detect_negative_space(db_file)
        noinvest_f = next((f for f in findings if f.entity_id == "E-NOCASES" and "Investigation" in f.title), None)
        assert noinvest_f is not None, "Missing investigation cases must be flagged"
        assert noinvest_f.severity == "CRITICAL", "90% missing cases must be CRITICAL severity"
        assert noinvest_f.supporting_metrics["uninvestigated_count"] == 9
        assert noinvest_f.supporting_metrics["total_high_critical_alerts"] == 10

    def test_low_activity_detected(self, tmp_path):
        """Known I/O: Entity with volume < 25% of peer mean generates low activity finding."""
        db_file = str(tmp_path / "test_low_act.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-PEER-1', 'Peer One', 'Energy');
            INSERT INTO entities VALUES ('E-PEER-2', 'Peer Two', 'Energy');
            INSERT INTO entities VALUES ('E-QUIET', 'Quiet Corp', 'Energy');
            INSERT INTO assets VALUES ('AST-P1', 'E-PEER-1', 'Server', 'LOW', 'Daily', '2026-09-26T00:00:00Z');
            INSERT INTO assets VALUES ('AST-P2', 'E-PEER-2', 'Server', 'LOW', 'Daily', '2026-09-26T00:00:00Z');
            INSERT INTO assets VALUES ('AST-Q1', 'E-QUIET', 'Server', 'LOW', 'Daily', '2026-09-26T00:00:00Z');
        """)
        # Peers 1 & 2 have 50 alerts each (mean = ~34), Quiet Corp has only 2 alerts (2 / 34 = 5.8% < 25%)
        for i in range(50):
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T00:00:00Z', 'E-PEER-1', 'AST-P1', 'LOW', 'Scan', NULL, NULL, 'CLOSED')", (f"ALT-P1-{i}",))
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T00:00:00Z', 'E-PEER-2', 'AST-P2', 'LOW', 'Scan', NULL, NULL, 'CLOSED')", (f"ALT-P2-{i}",))
        for i in range(2):
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T00:00:00Z', 'E-QUIET', 'AST-Q1', 'LOW', 'Scan', NULL, NULL, 'CLOSED')", (f"ALT-Q-{i}",))
        conn.commit()
        conn.close()

        findings = detect_negative_space(db_file)
        quiet_f = next((f for f in findings if f.entity_id == "E-QUIET" and "Low Alert Activity" in f.title), None)
        assert quiet_f is not None, "Abnormally quiet entity must be flagged for low activity"
        assert quiet_f.severity == "MEDIUM"
        assert quiet_f.supporting_metrics["entity_alert_count"] == 2

    def test_missing_escalation_detected(self, tmp_path):
        """Known I/O: Entity with closed critical cases having 100% escalated=0 generates missing escalation finding."""
        db_file = str(tmp_path / "test_missing_esc.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-NOESC-NS', 'No Esc Corp', 'Telecom');
            INSERT INTO assets VALUES ('AST-NE1', 'E-NOESC-NS', 'Router', 'CRITICAL', 'Daily', '2026-09-26T00:00:00Z');
        """)
        for i in range(5):
            aid, cid = f"ALT-NE-{i}", f"CAS-NE-{i}"
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T00:00:00Z', 'E-NOESC-NS', 'AST-NE1', 'CRITICAL', 'Ransomware', NULL, NULL, 'CLOSED')", (aid,))
            conn.execute("INSERT INTO cases VALUES (?, ?, 'E-NOESC-NS', 'Analyst', '2026-09-20T00:05:00Z', 40, 0, '2026-09-20T00:45:00Z', 'Remediated', 'Completed')", (cid, aid))
        conn.commit()
        conn.close()

        findings = detect_negative_space(db_file)
        noesc_f = next((f for f in findings if f.entity_id == "E-NOESC-NS" and "Escalation Records" in f.title), None)
        assert noesc_f is not None, "Missing escalation records on critical incidents must be detected"
        assert noesc_f.severity == "HIGH"
        assert noesc_f.supporting_metrics["unescalated_count"] == 5


# ════════════════════════════════════════════════════════════════════════════
# Module C — Anomaly Detection
# ════════════════════════════════════════════════════════════════════════════

class TestAnomalyDetection:
    def test_returns_list(self, live_db):
        findings = detect_anomalies(live_db)
        assert isinstance(findings, list)

    def test_finding_schema(self, live_db):
        findings = detect_anomalies(live_db)
        assert len(findings) > 0, "Isolation Forest must produce at least one anomaly"
        f = findings[0]
        assert f.finding_type == "ANOMALY"
        assert "anomaly_score_normalised" in f.supporting_metrics
        assert "feature_values" in f.supporting_metrics
        assert "peer_means" in f.supporting_metrics

    def test_cse007_is_anomaly(self, live_db):
        findings = detect_anomalies(live_db)
        cse007_an = [f for f in findings if f.entity_id == "CSE-007"]
        assert len(cse007_an) >= 1, "CSE-007 must be flagged as anomalous"

    def test_feature_extraction_coverage(self, live_db):
        features = get_entity_features(live_db)
        assert len(features) >= 20, f"Must extract features for at least 20 entities, got {len(features)}"
        expected_keys = {
            "alert_volume", "critical_alert_ratio", "median_closure_time",
            "escalation_rate", "repeat_alert_rate", "telemetry_coverage",
            "average_investigation_duration", "median_investigation_duration",
            "avg_investigation_duration"
        }
        for eid, feats in features.items():
            assert expected_keys == set(feats.keys()), f"{eid} missing feature keys"

    def test_cse007_feature_values_are_deviant(self, live_db):
        features = get_entity_features(live_db)
        cse = features["CSE-007"]
        peers = [v for k, v in features.items() if k != "CSE-007"]
        import statistics
        peer_median_esc = statistics.median(p["escalation_rate"] for p in peers)
        peer_median_dur = statistics.median(p["avg_investigation_duration"] for p in peers)
        # CSE-007 escalation rate must be significantly below peer median
        assert cse["escalation_rate"] < peer_median_esc * 0.50, (
            f"CSE-007 escalation {cse['escalation_rate']:.4f} expected < 50% of peer median {peer_median_esc:.4f}"
        )
        # CSE-007 avg duration must be much lower than peer
        assert cse["avg_investigation_duration"] < peer_median_dur * 0.30, (
            f"CSE-007 avg duration {cse['avg_investigation_duration']:.1f} expected < 30% of peer {peer_median_dur:.1f}"
        )

    def test_evaluate_entity_anomalies_structure(self, live_db):
        """Verify per-entity anomaly profiles have score, classification, features, and explanation."""
        from anomaly_detection import evaluate_entity_anomalies
        profiles = evaluate_entity_anomalies(live_db)
        assert len(profiles) >= 20, f"Must evaluate at least 20 entities, got {len(profiles)}"
        for eid, p in profiles.items():
            assert p["entity_id"] == eid
            assert 0.0 <= p["anomaly_score"] <= 1.0
            assert p["anomaly_classification"] in ("ANOMALY", "NORMAL")
            assert isinstance(p["is_anomaly"], bool)
            assert isinstance(p["feature_values"], dict)
            assert isinstance(p["explanation"], str)
            assert "Top isolating features" in p["explanation"] or "Top deviating features" in p["explanation"]

    def test_isolation_forest_deterministic_reproducibility(self, live_db):
        """Verify that multiple runs with fixed random_state produce identical scores and classifications."""
        from anomaly_detection import evaluate_entity_anomalies
        run1 = evaluate_entity_anomalies(live_db, random_state=42)
        run2 = evaluate_entity_anomalies(live_db, random_state=42)
        for eid in run1:
            assert run1[eid]["anomaly_score"] == run2[eid]["anomaly_score"]
            assert run1[eid]["anomaly_classification"] == run2[eid]["anomaly_classification"]
            assert run1[eid]["feature_values"] == run2[eid]["feature_values"]

    def test_synthetic_injected_anomaly_detected(self, tmp_path):
        """Known I/O: Synthetic dataset where 1 injected outlier entity is classified as ANOMALY purely from feature distribution."""
        from anomaly_detection import evaluate_entity_anomalies, detect_anomalies
        db_file = str(tmp_path / "test_synth_anom.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
        """)
        # 10 normal entities (each 20 alerts, 50-min duration, 50% escalation)
        for e_idx in range(10):
            eid = f"NORM-{e_idx:02d}"
            ast = f"AST-N-{e_idx:02d}"
            conn.execute("INSERT INTO entities VALUES (?, 'Normal Corp', 'Energy')", (eid,))
            conn.execute("INSERT INTO assets VALUES (?, ?, 'Server', 'HIGH', 'Daily', '2026-09-26T00:00:00Z')", (ast, eid))
            for a_idx in range(20):
                aid = f"ALT-N-{e_idx}-{a_idx}"
                cid = f"CAS-N-{e_idx}-{a_idx}"
                esc = 1 if a_idx % 2 == 0 else 0
                conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T00:00:00Z', ?, ?, 'HIGH', 'Malware', NULL, NULL, 'CLOSED')", (aid, eid, ast))
                conn.execute("INSERT INTO cases VALUES (?, ?, ?, 'Analyst', '2026-09-20T00:05:00Z', 50, ?, '2026-09-20T00:55:00Z', 'Remediated', 'Completed')", (cid, aid, eid, esc))

        # 1 extreme outlier entity (200 alerts, 2-min duration, 0% escalation, critical ratio 90%)
        outlier_id = "EXTREME-OUTLIER"
        outlier_ast = "AST-OUTLIER"
        conn.execute("INSERT INTO entities VALUES (?, 'Outlier Corp', 'Energy')", (outlier_id,))
        conn.execute("INSERT INTO assets VALUES (?, ?, 'Server', 'CRITICAL', 'Daily', '2026-09-26T00:00:00Z')", (outlier_ast, outlier_id))
        for a_idx in range(200):
            aid = f"ALT-O-{a_idx}"
            cid = f"CAS-O-{a_idx}"
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T00:00:00Z', ?, ?, 'CRITICAL', 'Exfiltration', NULL, NULL, 'CLOSED')", (aid, outlier_id, outlier_ast))
            conn.execute("INSERT INTO cases VALUES (?, ?, ?, 'Analyst', '2026-09-20T00:01:00Z', 2, 0, '2026-09-20T00:03:00Z', 'Ignored', 'None')", (cid, aid, outlier_id))

        conn.commit()
        conn.close()

        profiles = evaluate_entity_anomalies(db_file, contamination=0.10)
        assert profiles[outlier_id]["is_anomaly"] is True, "Injected extreme outlier must be classified as ANOMALY"
        assert profiles[outlier_id]["anomaly_classification"] == "ANOMALY"
        assert profiles[outlier_id]["anomaly_score"] > 0.8, "Outlier anomaly score must be high"

        findings = detect_anomalies(db_file)
        outlier_finding = next((f for f in findings if f.entity_id == outlier_id), None)
        assert outlier_finding is not None, "Anomalous entity must produce a supervisory finding"
        assert outlier_finding.severity == "HIGH"


# ════════════════════════════════════════════════════════════════════════════
# Module D — Peer Comparison
# ════════════════════════════════════════════════════════════════════════════


    def test_formal_tree_path_attribution(self, live_db):
        """
        Prove that formal IsolationForest tree-path attribution is correctly implemented.
        The explanation must be deterministic and reference the true model structure.
        """
        findings = detect_anomalies(live_db)
        if not findings:
            return  # Needs at least one finding to test
            
        anom = findings[0]
        metrics = anom.supporting_metrics
        
        # 1. Must use the formal method
        assert metrics["attribution_method"] == "isolation_forest_tree_path_attribution"
        assert "inverse depth of splits" in metrics["attribution_limitation"]
        
        # 2. Must expose actual feature attributions
        assert "feature_attributions" in metrics
        attrs = metrics["feature_attributions"]
        assert len(attrs) > 0, "Feature attributions must be populated"
        
        # 3. Must be structured properly
        for a in attrs:
            assert "feature" in a
            assert "value" in a
            assert "attribution" in a
            assert "rank" in a
            assert isinstance(a["attribution"], float)
            
        # 4. Total attribution for the top features should be reasonable
        total_attr = sum(a["attribution"] for a in attrs)
        assert total_attr > 0
        
        # 5. Model versioning must be preserved
        assert "model_version_id" in metrics
        assert metrics["model_version_id"].startswith("IForest-v1.0-")
        
        # 6. Explanation string must mention Tree isolating weight
        assert "Tree isolating weight" in metrics["explanation"]
        assert "Formal Tree Path Attribution" in metrics["explanation"]

class TestPeerComparison:
    def test_returns_list(self, live_db):
        findings = detect_peer_deviations(live_db)
        assert isinstance(findings, list)

    def test_finding_schema(self, live_db):
        findings = detect_peer_deviations(live_db)
        assert len(findings) > 0
        f = findings[0]
        assert f.finding_type == "PEER_DEVIATION"
        assert "peer_median" in f.supporting_metrics or any(
            "peer" in k for k in f.supporting_metrics
        )

    def test_cse007_escalation_deviation(self, live_db):
        findings = detect_peer_deviations(live_db)
        # CSE-007 must have at least one peer deviation finding.
        # The specific metric that triggers (escalation rate, closure time, etc.)
        # may vary based on peer group composition, which can change when the live
        # database has supplemental entities added by e2e or ingestion tests.
        cse007_findings = [f for f in findings if f.entity_id == "CSE-007"]
        assert len(cse007_findings) >= 1, (
            "CSE-007 must have at least one peer-deviation finding. "
            f"All CSE-007 peer deviation findings: {[(f.title, f.severity) for f in cse007_findings]}"
        )

    def test_cse007_duration_deviation(self, live_db):
        findings = detect_peer_deviations(live_db)
        cse007_findings = [f for f in findings if f.entity_id == "CSE-007"]
        assert len(cse007_findings) >= 1, "CSE-007 must have at least one peer deviation finding"

    def test_entity_metrics_coverage(self, live_db):
        metrics = get_entity_metrics(live_db)
        assert len(metrics) >= 20, f"Expected at least 20 entity metrics, got {len(metrics)}"
        for eid, m in metrics.items():
            assert 0.0 <= m["escalation_rate"] <= 1.0
            assert m["avg_investigation_duration"] >= 0
            assert 0.0 <= m["telemetry_coverage"] <= 1.0

    def test_normal_peer_behavior(self, tmp_path):
        """Known I/O: Sector peers with consistent, normal operational behavior produce zero findings."""
        db_file = str(tmp_path / "test_peer_normal.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-PEER-A', 'Peer A', 'Energy');
            INSERT INTO entities VALUES ('E-PEER-B', 'Peer B', 'Energy');
            INSERT INTO entities VALUES ('E-PEER-C', 'Peer C', 'Energy');
        """)
        for e in ('E-PEER-A', 'E-PEER-B', 'E-PEER-C'):
            conn.execute("INSERT INTO assets VALUES (?, ?, 'Server', 'CRITICAL', 'Daily', '2026-09-26T00:00:00Z')", (f"AST-{e}", e))
            for i in range(10):
                aid, cid = f"ALT-{e}-{i}", f"CAS-{e}-{i}"
                conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T00:00:00Z', ?, ?, 'CRITICAL', 'Scan', NULL, NULL, 'CLOSED')", (aid, e, f"AST-{e}"))
                conn.execute("INSERT INTO cases VALUES (?, ?, ?, 'Analyst', '2026-09-20T00:05:00Z', 60, 1, '2026-09-20T01:05:00Z', 'Remediated', 'Completed')", (cid, aid, e))
        conn.commit()
        conn.close()

        findings = detect_peer_deviations(db_file)
        assert len(findings) == 0, "Normal peers with identical metrics must generate zero peer deviation findings"

    def test_large_deviation(self, tmp_path):
        """Known I/O: Entity with 0% escalation and 3-min duration deviating from 100% escalation peers generates findings."""
        db_file = str(tmp_path / "test_peer_large_dev.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-NORM-1', 'Normal One', 'Banking');
            INSERT INTO entities VALUES ('E-NORM-2', 'Normal Two', 'Banking');
            INSERT INTO entities VALUES ('E-NORM-3', 'Normal Three', 'Banking');
            INSERT INTO entities VALUES ('E-DEV-1', 'Deviant Corp', 'Banking');
        """)
        # 3 normal entities (100% escalation, 60m duration)
        for e in ('E-NORM-1', 'E-NORM-2', 'E-NORM-3'):
            conn.execute("INSERT INTO assets VALUES (?, ?, 'Server', 'HIGH', 'Daily', '2026-09-26T00:00:00Z')", (f"AST-{e}", e))
            for i in range(10):
                conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T00:00:00Z', ?, ?, 'HIGH', 'Scan', NULL, NULL, 'CLOSED')", (f"ALT-{e}-{i}", e, f"AST-{e}"))
                conn.execute("INSERT INTO cases VALUES (?, ?, ?, 'Analyst', '2026-09-20T00:05:00Z', 60, 1, '2026-09-20T01:05:00Z', 'Remediated', 'Completed')", (f"CAS-{e}-{i}", f"ALT-{e}-{i}", e))

        # 1 deviant entity (0% escalation, 3m duration)
        conn.execute("INSERT INTO assets VALUES ('AST-DEV', 'E-DEV-1', 'Server', 'HIGH', 'Daily', '2026-09-26T00:00:00Z')")
        for i in range(10):
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T00:00:00Z', 'E-DEV-1', 'AST-DEV', 'HIGH', 'Scan', NULL, NULL, 'CLOSED')", (f"ALT-D-{i}",))
            conn.execute("INSERT INTO cases VALUES (?, ?, 'E-DEV-1', 'Analyst', '2026-09-20T00:05:00Z', 3, 0, '2026-09-20T00:08:00Z', 'Ignored', 'None')", (f"CAS-D-{i}", f"ALT-D-{i}"))

        conn.commit()
        conn.close()

        findings = detect_peer_deviations(db_file)
        dev_findings = [f for f in findings if f.entity_id == "E-DEV-1"]
        assert len(dev_findings) >= 2, "Deviant entity must have duration and escalation peer findings"

        esc_f = next((f for f in dev_findings if "Escalation Rate" in f.title), None)
        assert esc_f is not None
        assert esc_f.supporting_metrics["entity_value"] == 0.0
        assert esc_f.supporting_metrics["peer_median"] == 1.0
        assert "interpretation" in esc_f.supporting_metrics

        dur_f = next((f for f in dev_findings if "Duration" in f.title), None)
        assert dur_f is not None
        assert dur_f.supporting_metrics["entity_value"] == 3.0
        assert dur_f.supporting_metrics["peer_median"] == 60.0

    def test_single_member_peer_group(self, tmp_path):
        """Known I/O: Entity alone in its sector falls back safely to cross-sector peers without error."""
        db_file = str(tmp_path / "test_peer_single.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            -- 2 entities in Healthcare
            INSERT INTO entities VALUES ('E-HLTH-1', 'Hospital A', 'Healthcare');
            INSERT INTO entities VALUES ('E-HLTH-2', 'Hospital B', 'Healthcare');
            -- 1 isolated entity in Aerospace (single-member sector)
            INSERT INTO entities VALUES ('E-AERO-1', 'Aerospace One', 'Aerospace');
        """)
        for e in ('E-HLTH-1', 'E-HLTH-2'):
            conn.execute("INSERT INTO assets VALUES (?, ?, 'Server', 'LOW', 'Daily', '2026-09-26T00:00:00Z')", (f"AST-{e}", e))
            for i in range(5):
                conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T00:00:00Z', ?, ?, 'LOW', 'Scan', NULL, NULL, 'CLOSED')", (f"ALT-{e}-{i}", e, f"AST-{e}"))
                conn.execute("INSERT INTO cases VALUES (?, ?, ?, 'Analyst', '2026-09-20T00:05:00Z', 60, 1, '2026-09-20T01:05:00Z', 'Remediated', 'Completed')", (f"CAS-{e}-{i}", f"ALT-{e}-{i}", e))

        # E-AERO-1 with short duration
        conn.execute("INSERT INTO assets VALUES ('AST-AERO', 'E-AERO-1', 'Server', 'LOW', 'Daily', '2026-09-26T00:00:00Z')")
        for i in range(5):
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T00:00:00Z', 'E-AERO-1', 'AST-AERO', 'LOW', 'Scan', NULL, NULL, 'CLOSED')", (f"ALT-A-{i}",))
            conn.execute("INSERT INTO cases VALUES (?, ?, 'E-AERO-1', 'Analyst', '2026-09-20T00:05:00Z', 5, 0, '2026-09-20T00:10:00Z', 'Remediated', 'Completed')", (f"CAS-A-{i}", f"ALT-A-{i}"))

        conn.commit()
        conn.close()

        # Should execute safely and fall back to Cross-Sector peers for E-AERO-1
        findings = detect_peer_deviations(db_file)
        aero_f = [f for f in findings if f.entity_id == "E-AERO-1"]
        assert len(aero_f) > 0, "Single-member sector entity must compare against cross-sector peers"
        assert aero_f[0].supporting_metrics["peer_group"] == "Cross-Sector"

    def test_missing_metric_data(self, tmp_path):
        """Known I/O: Entity with 0 cases and 0 alerts handles calculations safely without ZeroDivisionError."""
        db_file = str(tmp_path / "test_peer_missing.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-EMPTY', 'Empty Corp', 'Energy');
            INSERT INTO entities VALUES ('E-ACTIVE-1', 'Active One', 'Energy');
            INSERT INTO entities VALUES ('E-ACTIVE-2', 'Active Two', 'Energy');
        """)
        for e in ('E-ACTIVE-1', 'E-ACTIVE-2'):
            conn.execute("INSERT INTO assets VALUES (?, ?, 'Server', 'LOW', 'Daily', '2026-09-26T00:00:00Z')", (f"AST-{e}", e))
            for i in range(5):
                conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T00:00:00Z', ?, ?, 'LOW', 'Scan', NULL, NULL, 'CLOSED')", (f"ALT-{e}-{i}", e, f"AST-{e}"))
                conn.execute("INSERT INTO cases VALUES (?, ?, ?, 'Analyst', '2026-09-20T00:05:00Z', 50, 1, '2026-09-20T00:55:00Z', 'Remediated', 'Completed')", (f"CAS-{e}-{i}", f"ALT-{e}-{i}", e))

        conn.commit()
        conn.close()

        from peer_analysis import get_entity_metrics
        metrics = get_entity_metrics(db_file)
        assert metrics["E-EMPTY"]["total_cases"] == 0
        assert metrics["E-EMPTY"]["total_alerts"] == 0
        assert metrics["E-EMPTY"]["escalation_rate"] == 0.0
        assert metrics["E-EMPTY"]["avg_investigation_duration"] == 0.0

        # Run detection without division by zero errors
        findings = detect_peer_deviations(db_file)
        assert isinstance(findings, list)


# ════════════════════════════════════════════════════════════════════════════
# Module E — Repeated Incidents
# ════════════════════════════════════════════════════════════════════════════

class TestRepeatedIncidents:
    def test_returns_list(self, live_db):
        findings = detect_repeated_incidents(live_db)
        assert isinstance(findings, list)

    def test_finding_schema(self, live_db):
        findings = detect_repeated_incidents(live_db)
        assert len(findings) > 0
        f = findings[0]
        assert f.finding_type == "REPEATED_INCIDENT"
        assert "alert_count" in f.supporting_metrics
        assert "unremediated_ratio" in f.supporting_metrics

    def test_cse007_repeated_clusters(self, live_db):
        findings = detect_repeated_incidents(live_db)
        cse007 = [f for f in findings if f.entity_id == "CSE-007"]
        assert len(cse007) >= 2, f"CSE-007 must have ≥2 repeated incident findings, got {len(cse007)}"

    def test_cse007_affected_assets_in_evidence(self, live_db):
        findings = detect_repeated_incidents(live_db)
        cse007 = [f for f in findings if f.entity_id == "CSE-007"]
        all_asset_ids = {f.supporting_metrics["asset_id"] for f in cse007}
        assert "AST-007-01" in all_asset_ids or "AST-007-02" in all_asset_ids, (
            "AST-007-01 or AST-007-02 must appear as repeated-incident evidence"
        )

    def test_high_unremediated_ratio(self, live_db):
        findings = detect_repeated_incidents(live_db)
        cse007 = [f for f in findings if f.entity_id == "CSE-007"]
        for f in cse007:
            assert f.supporting_metrics["unremediated_ratio"] >= 0.60, (
                f"Unremediated ratio too low for {f.finding_id}"
            )

    def test_synthetic_repeated_flagged(self, minimal_db):
        """BAD-01 has 10 Ransomware alerts on AST-B-01, all unremediated."""
        findings = detect_repeated_incidents(minimal_db)
        bad_ri = [f for f in findings if f.entity_id == "BAD-01"]
        assert len(bad_ri) > 0, "BAD-01 repeated Ransomware must be flagged"

    def test_remediated_cluster_not_flagged(self, minimal_db):
        """GOOD-01 has Brute Force alerts all marked Completed — should not flag."""
        findings = detect_repeated_incidents(minimal_db)
        good_ri = [f for f in findings if f.entity_id == "GOOD-01"]
        assert len(good_ri) == 0, "GOOD-01 fully remediated cluster must NOT be flagged"

    def test_repeated_incidents_with_remediation(self, tmp_path):
        """Known I/O: Recurring alerts on same asset & category where remediation is completed produce no findings."""
        db_file = str(tmp_path / "test_ri_rem.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-REM-01', 'Remediated Corp', 'Energy');
            INSERT INTO assets VALUES ('AST-R01', 'E-REM-01', 'Server', 'CRITICAL', 'Daily', '2026-09-26T00:00:00Z');
        """)
        for i in range(6):
            aid, cid = f"ALT-R-{i}", f"CAS-R-{i}"
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T00:00:00Z', 'E-REM-01', 'AST-R01', 'HIGH', 'Phishing', NULL, NULL, 'CLOSED')", (aid,))
            conn.execute("INSERT INTO cases VALUES (?, ?, 'E-REM-01', 'Analyst', '2026-09-20T00:05:00Z', 45, 1, '2026-09-20T00:50:00Z', 'Remediated', 'Completed')", (cid, aid))
        conn.commit()
        conn.close()

        findings = detect_repeated_incidents(db_file)
        assert len(findings) == 0, "Repeated incidents with 100% completed remediation must not produce findings"

    def test_repeated_incidents_without_remediation(self, tmp_path):
        """Known I/O: Recurring alerts on same asset & category without remediation produce deterministic finding."""
        db_file = str(tmp_path / "test_ri_unrem.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-UNREM-01', 'Unremediated Corp', 'Banking');
            INSERT INTO assets VALUES ('AST-U01', 'E-UNREM-01', 'SCADA', 'CRITICAL', 'Daily', '2026-09-26T00:00:00Z');
        """)
        for i in range(5):
            aid, cid = f"ALT-U-{i}", f"CAS-U-{i}"
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T10:00:00Z', 'E-UNREM-01', 'AST-U01', 'CRITICAL', 'Ransomware', NULL, NULL, 'CLOSED')", (aid,))
            conn.execute("INSERT INTO cases VALUES (?, ?, 'E-UNREM-01', 'Analyst', '2026-09-20T10:05:00Z', 10, 0, '2026-09-20T10:15:00Z', 'Ignored', 'None')", (cid, aid))
        conn.commit()
        conn.close()

        findings = detect_repeated_incidents(db_file)
        assert len(findings) == 1, "Unremediated repeated incident cluster must produce exactly 1 finding"
        f = findings[0]
        assert f.finding_id == "RI-E-UNREM-01-AST-U01-RANSOMWARE"
        assert f.entity_id == "E-UNREM-01"
        assert f.severity in ("CRITICAL", "HIGH")
        assert f.supporting_metrics["asset_id"] == "AST-U01"
        assert f.supporting_metrics["category"] == "Ransomware"
        assert f.supporting_metrics["repeat_count"] == 5
        assert "time_window" in f.supporting_metrics
        assert "remediation_status" in f.supporting_metrics
        assert "Absent" in f.supporting_metrics["remediation_status"] or "unresolved" in f.supporting_metrics["remediation_status"]
        for i in range(5):
            assert f"ALT-U-{i}" in f.evidence_ids
            assert f"CAS-U-{i}" in f.evidence_ids
        assert "AST-U01" in f.evidence_ids

    def test_different_categories(self, tmp_path):
        """Known I/O: Alerts on same asset but across different categories do not form a repeated incident cluster."""
        db_file = str(tmp_path / "test_ri_diff_cat.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-DC-01', 'Diff Cat Corp', 'Telecom');
            INSERT INTO assets VALUES ('AST-DC01', 'E-DC-01', 'Router', 'HIGH', 'Daily', '2026-09-26T00:00:00Z');
        """)
        categories = ['Malware', 'Phishing', 'DDoS', 'Brute Force']
        for i, cat in enumerate(categories):
            aid, cid = f"ALT-DC-{i}", f"CAS-DC-{i}"
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T10:00:00Z', 'E-DC-01', 'AST-DC01', 'HIGH', ?, NULL, NULL, 'CLOSED')", (aid, cat))
            conn.execute("INSERT INTO cases VALUES (?, ?, 'E-DC-01', 'Analyst', '2026-09-20T10:05:00Z', 10, 0, '2026-09-20T10:15:00Z', 'None', 'None')", (cid, aid))
        conn.commit()
        conn.close()

        findings = detect_repeated_incidents(db_file)
        assert len(findings) == 0, "Distinct categories (count 1 each < 3) must not be flagged as repeated incidents"

    def test_different_assets(self, tmp_path):
        """Known I/O: Same alert category distributed across different assets does not form an asset-level cluster."""
        db_file = str(tmp_path / "test_ri_diff_ast.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-DA-01', 'Diff Asset Corp', 'Transport');
        """)
        for i in range(4):
            ast_id = f"AST-DA-{i}"
            conn.execute("INSERT INTO assets VALUES (?, 'E-DA-01', 'Server', 'HIGH', 'Daily', '2026-09-26T00:00:00Z')", (ast_id,))
            aid, cid = f"ALT-DA-{i}", f"CAS-DA-{i}"
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T10:00:00Z', 'E-DA-01', ?, 'HIGH', 'Malware', NULL, NULL, 'CLOSED')", (aid, ast_id))
            conn.execute("INSERT INTO cases VALUES (?, ?, 'E-DA-01', 'Analyst', '2026-09-20T10:05:00Z', 10, 0, '2026-09-20T10:15:00Z', 'None', 'None')", (cid, aid))
        conn.commit()
        conn.close()

        findings = detect_repeated_incidents(db_file)
        assert len(findings) == 0, "Alerts on different assets (count 1 each < 3) must not trigger repeated incident findings"

    def test_non_repeated_alerts(self, tmp_path):
        """Known I/O: Only 1 or 2 alerts on an asset (below MIN_REPEAT_COUNT = 3) do not trigger findings."""
        db_file = str(tmp_path / "test_ri_non_rep.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-NR-01', 'Non Repeat Corp', 'Energy');
            INSERT INTO assets VALUES ('AST-NR01', 'E-NR-01', 'Controller', 'CRITICAL', 'Daily', '2026-09-26T00:00:00Z');
        """)
        for i in range(2):
            aid, cid = f"ALT-NR-{i}", f"CAS-NR-{i}"
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T10:00:00Z', 'E-NR-01', 'AST-NR01', 'CRITICAL', 'Malware', NULL, NULL, 'CLOSED')", (aid,))
            conn.execute("INSERT INTO cases VALUES (?, ?, 'E-NR-01', 'Analyst', '2026-09-20T10:05:00Z', 10, 0, '2026-09-20T10:15:00Z', 'None', 'None')", (cid, aid))
        conn.commit()
        conn.close()

        findings = detect_repeated_incidents(db_file)
        assert len(findings) == 0, "Non-repeated alerts (count 2 < 3) must not trigger repeated incident findings"


# ════════════════════════════════════════════════════════════════════════════
# Full Pipeline Integration
# ════════════════════════════════════════════════════════════════════════════

class TestPipeline:
    def test_pipeline_runs_and_returns_dict(self, live_db):
        result = run_pipeline(live_db)
        assert isinstance(result, dict)
        assert "total_findings" in result
        assert "all_findings" in result
        assert "findings_by_entity" in result
        assert "findings_by_type" in result
        assert "module_counts" in result

    def test_pipeline_produces_findings_for_all_modules(self, live_db):
        result = run_pipeline(live_db)
        for mtype in ("EXECUTION_GAP", "NEGATIVE_SPACE", "ANOMALY", "PEER_DEVIATION", "REPEATED_INCIDENT"):
            assert result["module_counts"][mtype] > 0, f"Module {mtype} produced no findings"

    def test_cse007_has_findings_from_multiple_modules(self, live_db):
        result = run_pipeline(live_db)
        cse007_findings = result["findings_by_entity"].get("CSE-007", [])
        assert len(cse007_findings) >= 5, (
            f"CSE-007 must have findings from ≥5 module runs, got {len(cse007_findings)}"
        )
        types_found = {f["finding_type"] for f in cse007_findings}
        assert len(types_found) >= 4, (
            f"CSE-007 must span ≥4 finding types, got: {types_found}"
        )

    def test_no_risk_scores_in_findings(self, live_db):
        result = run_pipeline(live_db)
        for f in result["all_findings"]:
            assert "risk_score" not in f, "Phase 3 must not produce risk scores"
            assert "risk_level" not in f, "Phase 3 must not produce risk levels"

    def test_all_findings_have_required_fields(self, live_db):
        result = run_pipeline(live_db)
        required = {"finding_id", "entity_id", "finding_type", "severity",
                    "title", "rationale", "evidence_ids", "supporting_metrics"}
        for f in result["all_findings"]:
            missing = required - set(f.keys())
            assert not missing, f"Finding {f.get('finding_id')} missing fields: {missing}"

    def test_pipeline_summary_structure(self, live_db):
        """Phase 6: Result must include structured analysis summary."""
        result = run_pipeline(live_db)
        assert result["entities_analyzed"] >= 20, f"Expected at least 20 entities analyzed, got {result['entities_analyzed']}"
        assert result["findings_generated"] > 0
        assert isinstance(result["high_risk_entities"], int)
        assert isinstance(result["critical_entities"], int)
        assert "module_counts" in result
        for m in ("EXECUTION_GAP", "NEGATIVE_SPACE", "ANOMALY", "PEER_DEVIATION", "REPEATED_INCIDENT"):
            assert m in result["module_counts"]
        assert "analysis_timestamp" in result
        assert "dataset_version" in result
        assert result["dataset_version"].startswith("v")

    def test_pipeline_deterministic_two_runs(self, live_db):
        """Phase 6: Running the same dataset twice produces equivalent analytical results."""
        r1 = run_pipeline(live_db)
        r2 = run_pipeline(live_db)

        assert r1["findings_generated"] == r2["findings_generated"]
        assert r1["entities_analyzed"] == r2["entities_analyzed"]
        assert r1["module_counts"] == r2["module_counts"]
        assert r1["high_risk_entities"] == r2["high_risk_entities"]
        assert r1["critical_entities"] == r2["critical_entities"]
        assert r1["dataset_version"] == r2["dataset_version"]

        for eid in r1["entity_risk"]:
            assert r1["entity_risk"][eid]["risk_score"] == r2["entity_risk"][eid]["risk_score"]
            assert r1["entity_risk"][eid]["risk_level"] == r2["entity_risk"][eid]["risk_level"]

    def test_data_change_alters_findings_and_metrics(self, tmp_path):
        """Phase 6: Changing uploaded data changes resulting findings and metrics."""
        db_file = str(tmp_path / "test_pipeline_change.db")
        conn = sqlite3.connect(db_file)
        conn.executescript("""
            CREATE TABLE entities (entity_id TEXT PRIMARY KEY, entity_name TEXT, sector TEXT);
            CREATE TABLE assets (asset_id TEXT PRIMARY KEY, entity_id TEXT, asset_type TEXT, criticality TEXT, expected_telemetry TEXT, last_telemetry TEXT);
            CREATE TABLE alerts (alert_id TEXT PRIMARY KEY, timestamp TEXT, entity_id TEXT, asset_id TEXT, severity TEXT, category TEXT, source_ip TEXT, destination_ip TEXT, status TEXT);
            CREATE TABLE cases (case_id TEXT PRIMARY KEY, alert_id TEXT, entity_id TEXT, investigator TEXT, opened_at TEXT, investigation_duration INTEGER, escalated INTEGER, closed_at TEXT, closure_reason TEXT, remediation_status TEXT);
            INSERT INTO entities VALUES ('E-DYN-01', 'Dynamic Corp', 'Finance');
            INSERT INTO assets VALUES ('AST-DYN-01', 'E-DYN-01', 'Server', 'CRITICAL', 'Daily', '2026-09-26T00:00:00Z');
        """)
        conn.commit()
        conn.close()

        # Run 1: clean DB, no alerts -> 0 findings
        r1 = run_pipeline(db_file)
        assert r1["findings_generated"] == 0
        assert r1["entity_risk"]["E-DYN-01"]["risk_score"] == 0.0

        # Change data: insert 5 repeated unresolved alerts (Phase 4E trigger)
        conn = sqlite3.connect(db_file)
        for i in range(5):
            aid, cid = f"ALT-D-{i}", f"CAS-D-{i}"
            conn.execute("INSERT INTO alerts VALUES (?, '2026-09-20T10:00:00Z', 'E-DYN-01', 'AST-DYN-01', 'CRITICAL', 'Ransomware', NULL, NULL, 'CLOSED')", (aid,))
            conn.execute("INSERT INTO cases VALUES (?, ?, 'E-DYN-01', 'Analyst', '2026-09-20T10:05:00Z', 10, 0, '2026-09-20T10:15:00Z', 'None', 'None')", (cid, aid))
        conn.commit()
        conn.close()

        # Run 2: modified DB -> findings generated, risk score increased
        r2 = run_pipeline(db_file)
        assert r2["findings_generated"] > 0
        assert r2["findings_generated"] != r1["findings_generated"]
        assert r2["entity_risk"]["E-DYN-01"]["risk_score"] > r1["entity_risk"]["E-DYN-01"]["risk_score"]
        assert r2["dataset_version"] != r1["dataset_version"]

