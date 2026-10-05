import pytest
import os
from alert_prioritization import prioritize_alerts
import sqlite3

@pytest.fixture(scope="session")
def live_db():
    db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../backend/sat_sa.db"))
    return db_path

def test_alert_prioritization_runs(live_db):
    """Verify that prioritization runs and writes to the database."""
    prioritized = prioritize_alerts(live_db)
    
    assert len(prioritized) > 0, "Should prioritize at least some alerts"
    
    # Check that scores are bounded
    for p in prioritized:
        assert 0 <= p["priority_score"] <= 100, f"Score out of bounds: {p['priority_score']}"
        assert p["priority_level"] in ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
        assert len(p["reasons"]) > 0
        assert len(p["evidence_ids"]) > 0

def test_alert_prioritization_database_persistence(live_db):
    prioritize_alerts(live_db)
    
    conn = sqlite3.connect(live_db)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM alert_review_priority").fetchall()
    conn.close()
    
    assert len(rows) > 0
    # verify schema
    row = rows[0]
    assert "alert_id" in row.keys()
    assert "entity_id" in row.keys()
    assert "priority_score" in row.keys()
    assert "priority_level" in row.keys()
    assert "primary_signal" in row.keys()
    assert "reasons" in row.keys()
    assert "evidence_ids" in row.keys()

def test_critical_alerts_prioritized_higher_than_low(live_db):
    prioritized = prioritize_alerts(live_db)
    
    crit_scores = [p["priority_score"] for p in prioritized if "CRITICAL severity" in str(p["reasons"])]
    low_scores = [p["priority_score"] for p in prioritized if "Alert is LOW" in str(p["reasons"])]
    
    if crit_scores and low_scores:
        assert (sum(crit_scores)/len(crit_scores)) > (sum(low_scores)/len(low_scores)), "Critical alerts should average higher scores than low severity alerts"
