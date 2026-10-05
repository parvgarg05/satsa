import sqlite3
import json
from datetime import datetime, timezone

def prioritize_alerts(db_path: str):
    """
    Calculates deterministic Alert Review Priority scores for manual supervisory sampling.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Read base data
    alerts = cur.execute("SELECT * FROM alerts").fetchall()
    cases = {c["alert_id"]: c for c in cur.execute("SELECT * FROM cases").fetchall()}
    assets = {a["asset_id"]: a for a in cur.execute("SELECT * FROM assets").fetchall()}
    entity_risk = {e["entity_id"]: e for e in cur.execute("SELECT * FROM entity_risk_scores").fetchall()}
    
    findings = cur.execute("SELECT finding_type, evidence_ids FROM supervisory_findings").fetchall()
    
    # Pre-compute alert membership in findings
    # Maps alert_id -> set of finding_types
    alert_findings = {}
    for f in findings:
        ftype = f["finding_type"]
        ev_ids = json.loads(f["evidence_ids"])
        for ev in ev_ids:
            if ev.startswith("ALT-"):
                if ev not in alert_findings:
                    alert_findings[ev] = set()
                alert_findings[ev].add(ftype)

    prioritized_alerts = []

    for alert in alerts:
        a_id = alert["alert_id"]
        e_id = alert["entity_id"]
        ast_id = alert["asset_id"]
        
        severity = alert["severity"]
        
        case = cases.get(a_id)
        asset = assets.get(ast_id)
        e_risk = entity_risk.get(e_id)
        
        reasons = []
        evidence_ids = [a_id]
        if case: evidence_ids.append(case["case_id"])
        if asset: evidence_ids.append(ast_id)
        
        # 1. Base Severity (max 30)
        sev_score = 0
        if severity == "CRITICAL":
            sev_score = 30
            reasons.append("Alert is CRITICAL severity (+30)")
        elif severity == "HIGH":
            sev_score = 20
            reasons.append("Alert is HIGH severity (+20)")
        elif severity == "MEDIUM":
            sev_score = 10
            reasons.append("Alert is MEDIUM severity (+10)")

        # 2. Asset Criticality (max 15)
        ast_score = 0
        if asset:
            acrit = asset["criticality"]
            if acrit == "CRITICAL":
                ast_score = 15
                reasons.append("Target asset is CRITICAL (+15)")
            elif acrit == "HIGH":
                ast_score = 10
                reasons.append("Target asset is HIGH (+10)")
            elif acrit == "MEDIUM":
                ast_score = 5
                reasons.append("Target asset is MEDIUM (+5)")

        # 3. Entity Risk Context (max 20)
        ent_score = 0
        if e_risk:
            f_score = e_risk["final_risk_score"]
            ent_score = round(f_score * 0.2, 1)
            e_level = e_risk["risk_level"]
            reasons.append(f"Entity risk context ({e_level}, score {f_score:.1f}) (+{ent_score})")

        # 4. Behaviour & Findings (max 35)
        beh_score = 0
        
        if not case:
            beh_score += 10
            reasons.append("No investigation case linked (+10)")
        else:
            # Case behavior
            is_critical_or_high = (severity in ["CRITICAL", "HIGH"])
            if is_critical_or_high and case["escalated"] == 0 and alert["status"] == "CLOSED":
                beh_score += 10
                reasons.append(f"{severity} alert closed without escalation (+10)")
                
            if case["remediation_status"] in ["None", "Ignored"]:
                beh_score += 10
                reasons.append(f"Remediation marked as {case['remediation_status']} (+10)")

        # Findings context
        ftypes = alert_findings.get(a_id, set())
        if "EXECUTION_GAP" in ftypes:
            beh_score += 15
            reasons.append("Flagged in Execution Gap analytics (+15)")
        if "REPEATED_INCIDENT" in ftypes:
            beh_score += 10
            reasons.append("Part of a Repeated Incident cluster (+10)")
        if "PEER_DEVIATION" in ftypes or "ANOMALY" in ftypes:
            beh_score += 5
            reasons.append("Entity flagged for operational anomalies (+5)")

        # Cap behavior score at 35
        if beh_score > 35:
            beh_score = 35

        total_score = round(sev_score + ast_score + ent_score + beh_score, 1)
        if total_score > 100: total_score = 100.0

        if total_score >= 80:
            level = "CRITICAL"
        elif total_score >= 60:
            level = "HIGH"
        elif total_score >= 30:
            level = "MEDIUM"
        else:
            level = "LOW"

        # Construct primary signal (shortest summary)
        primary = "Routine Validation"
        if "Execution Gap" in str(reasons):
            primary = "Execution Gap Flagged"
        elif "Repeated Incident" in str(reasons):
            primary = "Repeated Incident Cluster"
        elif "escalation" in str(reasons):
            primary = "Closed without escalation"
        elif "CRITICAL severity" in str(reasons):
            primary = "Critical Priority Alert"
            
        prioritized_alerts.append({
            "alert_id": a_id,
            "entity_id": e_id,
            "priority_score": total_score,
            "priority_level": level,
            "primary_signal": primary,
            "reasons": reasons,
            "evidence_ids": evidence_ids
        })

    # Save to SQLite
    cur.execute("""
        CREATE TABLE IF NOT EXISTS alert_review_priority (
            alert_id TEXT PRIMARY KEY,
            entity_id TEXT NOT NULL,
            priority_score REAL NOT NULL,
            priority_level TEXT NOT NULL,
            primary_signal TEXT NOT NULL,
            reasons TEXT NOT NULL,
            evidence_ids TEXT NOT NULL,
            calculated_at TEXT NOT NULL,
            FOREIGN KEY (alert_id) REFERENCES alerts(alert_id) ON DELETE CASCADE,
            FOREIGN KEY (entity_id) REFERENCES entities(entity_id) ON DELETE CASCADE
        );
    """)
    cur.execute("DELETE FROM alert_review_priority")
    
    now_iso = datetime.now(timezone.utc).isoformat()
    for pa in prioritized_alerts:
        cur.execute("""
            INSERT INTO alert_review_priority
            (alert_id, entity_id, priority_score, priority_level, primary_signal, reasons, evidence_ids, calculated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            pa["alert_id"],
            pa["entity_id"],
            pa["priority_score"],
            pa["priority_level"],
            pa["primary_signal"],
            json.dumps(pa["reasons"]),
            json.dumps(pa["evidence_ids"]),
            now_iso
        ))

    conn.commit()
    conn.close()
    
    return prioritized_alerts

if __name__ == "__main__":
    res = prioritize_alerts("../backend/sat_sa.db")
    print(f"Prioritized {len(res)} alerts.")
