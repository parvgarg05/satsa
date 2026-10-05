"""
=============================================================================
EXECUTION GAP DETECTION MODULE (Module A)
=============================================================================

Detects evidence of improper or deficient SOC alert handling:
  1. Critical alerts closed unusually quickly (< threshold vs peer median)
  2. Critical alerts closed without escalation
  3. Abnormally short investigation durations across all severities
  4. Repeated alerts on the same asset without evidence of remediation
  5. Operational behavior inconsistent with expected process (superficial sign-off or ignored critical incidents)

EXPLICIT DETERMINISTIC THRESHOLDS:
-----------------------------------------------------------------------------
1. QUICK CLOSURE THRESHOLD:
   - QUICK_CLOSURE_MINUTES = 10.0 (Minutes)
     Alerts closed in under 10 minutes are flagged as potentially superficial.
   - QUICK_CLOSURE_RATIO_THRESHOLD = 0.40 (40%)
     If >40% of an entity's closed CRITICAL alerts are quick closures, a finding is generated.
   - Severity Mapping:
     * >= 80% quick closure -> CRITICAL
     * >= 60% quick closure -> HIGH
     * >= 40% quick closure -> MEDIUM

2. NO ESCALATION THRESHOLD (CRITICAL ALERTS):
   - NO_ESCALATION_CRITICAL_RATIO = 0.40 (40%)
     If >40% of an entity's closed CRITICAL alerts were resolved with escalated = 0,
     a finding is generated.
   - Severity Mapping:
     * >= 90% unescalated -> CRITICAL
     * >= 70% unescalated -> HIGH
     * >= 40% unescalated -> MEDIUM

3. ABNORMALLY SHORT DURATION ACROSS ALL SEVERITIES:
   - SHORT_DURATION_MINUTES = 15.0 (Minutes)
     Cases closed in under 15 minutes across all alert severities.
   - SHORT_DURATION_RATIO_THRESHOLD = 0.50 (50%)
     If >50% of an entity's closed cases have investigation duration < 15 min,
     a finding is generated.
   - Severity Mapping:
     * >= 85% short duration -> HIGH
     * >= 65% short duration -> MEDIUM
     * >= 50% short duration -> LOW

4. REPEATED ALERTS WITHOUT REMEDIATION:
   - REPEAT_ALERT_MIN_CLUSTER = 5 (Alerts)
     Minimum alerts on the exact same (asset_id, category) pair.
   - REPEAT_UNREMEDIATED_RATIO_THRESHOLD = 0.70 (70%)
     If >=70% of associated cases have remediation_status in ('None', 'Ignored')
     or closure_reason == 'Ignored'.
   - Severity Mapping:
     * >= 10 alerts in cluster -> HIGH
     * >= 5 alerts in cluster -> MEDIUM

5. OPERATIONAL BEHAVIOR INCONSISTENT WITH EXPECTED PROCESS:
   - PREMATURE_REMEDIATION_MINUTES = 5.0 (Minutes)
     Critical incidents marked as remediation_status == 'Completed' with
     investigation_duration < 5 minutes (physically implausible remediation).
   - INCONSISTENT_PROCESS_RATIO_THRESHOLD = 0.15 (15%)
     If >= 15% of closed CRITICAL/HIGH cases have either:
       a) closure_reason == 'Ignored', or
       b) remediation_status == 'Completed' in < 5 minutes.
   - Severity Mapping:
     * >= 40% inconsistent -> HIGH
     * >= 15% inconsistent -> MEDIUM
=============================================================================
"""
import sqlite3
import statistics
from typing import Any
from models import Finding
from config import CONFIG


# ── Explicit Deterministic Threshold Constants ──────────────────────────────
QUICK_CLOSURE_MINUTES = float(CONFIG["execution_gaps"]["quick_closure_minutes"])
QUICK_CLOSURE_RATIO_THRESHOLD = float(CONFIG["execution_gaps"]["quick_closure_ratio"])

NO_ESCALATION_CRITICAL_RATIO = float(CONFIG["execution_gaps"]["no_escalation_ratio"])

SHORT_DURATION_MINUTES = float(CONFIG["execution_gaps"]["short_duration_minutes"])
SHORT_DURATION_RATIO_THRESHOLD = float(CONFIG["execution_gaps"]["short_duration_ratio"])

REPEAT_ALERT_MIN_CLUSTER = int(CONFIG["execution_gaps"]["repeat_alert_min_cluster"])
REPEAT_UNREMEDIATED_RATIO_THRESHOLD = float(CONFIG["execution_gaps"]["repeat_unremediated_ratio"])

PREMATURE_REMEDIATION_MINUTES = float(CONFIG["execution_gaps"]["premature_remediation_minutes"])
INCONSISTENT_PROCESS_RATIO_THRESHOLD = float(CONFIG["execution_gaps"]["inconsistent_process_ratio"])


def _severity_from_ratio(ratio: float, thresholds: list[tuple[float, str]]) -> str:
    """Map a ratio to a severity label using ordered thresholds (highest first)."""
    for threshold, label in thresholds:
        if ratio >= threshold:
            return label
    return "LOW"


def detect_execution_gaps(db_path: str) -> list[Finding]:
    """
    Run all execution-gap sub-detectors against the SQLite database.
    Operates generically on arbitrary uploaded data.
    Returns a list of deterministic Finding objects.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    findings: list[Finding] = []

    # ── 1. Compute peer median closure time for critical alerts ─────────────
    cur.execute("""
        SELECT c.investigation_duration
        FROM cases c
        JOIN alerts al ON c.alert_id = al.alert_id
        WHERE al.severity = 'CRITICAL'
          AND al.status = 'CLOSED'
          AND c.investigation_duration IS NOT NULL
    """)
    all_critical_durations = [row["investigation_duration"] for row in cur.fetchall()]
    peer_median = statistics.median(all_critical_durations) if all_critical_durations else 60.0

    # ── 2. Per-entity analysis across all entities in the database ───────────
    cur.execute("SELECT entity_id FROM entities ORDER BY entity_id")
    entities = [row["entity_id"] for row in cur.fetchall()]

    for eid in entities:
        _check_entity_execution_gaps(cur, eid, peer_median, findings)

    conn.close()
    
    return findings


def _check_entity_execution_gaps(
    cur: sqlite3.Cursor,
    eid: str,
    peer_median_duration: float,
    findings: list[Finding],
) -> None:
    """Analyze all 5 execution gap sub-checks for a specific entity."""

    # Fetch closed critical alerts and associated cases
    cur.execute("""
        SELECT al.alert_id, al.asset_id, al.category, c.case_id, c.investigation_duration, c.escalated,
               c.closure_reason, c.remediation_status
        FROM alerts al
        JOIN cases c ON al.alert_id = c.alert_id
        WHERE al.entity_id = ?
          AND al.severity = 'CRITICAL'
          AND al.status = 'CLOSED'
        ORDER BY al.alert_id
    """, (eid,))
    critical_closed = cur.fetchall()

    # ─────────────────────────────────────────────────────────────────────────
    # Sub-check 1: Critical Alerts Closed Unusually Quickly
    # ─────────────────────────────────────────────────────────────────────────
    if len(critical_closed) >= 3:
        quick = [r for r in critical_closed if r["investigation_duration"] < QUICK_CLOSURE_MINUTES]
        ratio = len(quick) / len(critical_closed)

        if ratio > QUICK_CLOSURE_RATIO_THRESHOLD:
            avg_duration = statistics.mean(r["investigation_duration"] for r in critical_closed)
            severity = _severity_from_ratio(ratio, [(0.80, "CRITICAL"), (0.60, "HIGH"), (0.40, "MEDIUM")])
            evidence_ids = []
            for r in quick:
                evidence_ids.append(r["alert_id"])
                if r["case_id"]:
                    evidence_ids.append(r["case_id"])

            findings.append(Finding(
                finding_id=f"EG-FAST-{eid}",
                entity_id=eid,
                finding_type="EXECUTION_GAP",
                severity=severity,
                title="Critical Alerts Closed Unusually Quickly",
                rationale=(
                    f"{ratio*100:.1f}% of critical alerts ({len(quick)}/{len(critical_closed)}) "
                    f"were closed in under {int(QUICK_CLOSURE_MINUTES)} minutes. "
                    f"Peer median closure time is {peer_median_duration:.1f} minutes. "
                    f"Entity average: {avg_duration:.1f} minutes. "
                    "This pattern indicates superficial or premature closure without proper investigation."
                ),
                evidence_ids=evidence_ids,
                supporting_metrics={
                    "quick_closure_count": len(quick),
                    "total_critical_closed": len(critical_closed),
                    "quick_closure_ratio": round(ratio, 4),
                    "entity_avg_duration_minutes": round(avg_duration, 2),
                    "peer_median_duration_minutes": round(peer_median_duration, 2),
                    "threshold_minutes": QUICK_CLOSURE_MINUTES,
                },
            ))

    # ─────────────────────────────────────────────────────────────────────────
    # Sub-check 2: Critical Alerts Closed Without Escalation
    # ─────────────────────────────────────────────────────────────────────────
    if len(critical_closed) >= 3:
        not_escalated = [r for r in critical_closed if r["escalated"] == 0]
        no_esc_ratio = len(not_escalated) / len(critical_closed)

        if no_esc_ratio > NO_ESCALATION_CRITICAL_RATIO:
            severity = _severity_from_ratio(no_esc_ratio, [(0.90, "CRITICAL"), (0.70, "HIGH"), (0.40, "MEDIUM")])
            evidence_ids = []
            for r in not_escalated:
                evidence_ids.append(r["alert_id"])
                if r["case_id"]:
                    evidence_ids.append(r["case_id"])

            findings.append(Finding(
                finding_id=f"EG-NOESC-{eid}",
                entity_id=eid,
                finding_type="EXECUTION_GAP",
                severity=severity,
                title="Critical Alerts Closed Without Escalation",
                rationale=(
                    f"{no_esc_ratio*100:.1f}% of critical alerts ({len(not_escalated)}/{len(critical_closed)}) "
                    f"were closed without escalation. Critical-severity alerts are expected to follow "
                    "formal escalation protocols per operational SOC baseline procedures."
                ),
                evidence_ids=evidence_ids,
                supporting_metrics={
                    "no_escalation_count": len(not_escalated),
                    "total_critical_closed": len(critical_closed),
                    "no_escalation_ratio": round(no_esc_ratio, 4),
                    "threshold_ratio": NO_ESCALATION_CRITICAL_RATIO,
                },
            ))

    # ─────────────────────────────────────────────────────────────────────────
    # Sub-check 3: Abnormally Short Investigation Durations Across All Severities
    # ─────────────────────────────────────────────────────────────────────────
    cur.execute("""
        SELECT c.case_id, al.alert_id, c.investigation_duration, al.severity
        FROM cases c
        JOIN alerts al ON c.alert_id = al.alert_id
        WHERE al.entity_id = ?
          AND al.status = 'CLOSED'
          AND c.investigation_duration IS NOT NULL
        ORDER BY c.case_id
    """, (eid,))
    all_closed = cur.fetchall()

    if len(all_closed) >= 5:
        short = [r for r in all_closed if r["investigation_duration"] < SHORT_DURATION_MINUTES]
        short_ratio = len(short) / len(all_closed)

        if short_ratio > SHORT_DURATION_RATIO_THRESHOLD:
            severity = _severity_from_ratio(short_ratio, [(0.85, "HIGH"), (0.65, "MEDIUM"), (0.50, "LOW")])
            evidence_ids = []
            for r in short[:40]:  # Cap evidence list for readability
                evidence_ids.append(r["case_id"])
                evidence_ids.append(r["alert_id"])

            findings.append(Finding(
                finding_id=f"EG-SHORT-{eid}",
                entity_id=eid,
                finding_type="EXECUTION_GAP",
                severity=severity,
                title="Abnormally Short Investigation Durations Across All Severities",
                rationale=(
                    f"{short_ratio*100:.1f}% of closed cases ({len(short)}/{len(all_closed)}) "
                    f"had investigation durations under {int(SHORT_DURATION_MINUTES)} minutes, "
                    "indicating systemic under-investigation across all alert severities."
                ),
                evidence_ids=evidence_ids,
                supporting_metrics={
                    "short_duration_count": len(short),
                    "total_closed_cases": len(all_closed),
                    "short_duration_ratio": round(short_ratio, 4),
                    "threshold_minutes": SHORT_DURATION_MINUTES,
                },
            ))

    # ─────────────────────────────────────────────────────────────────────────
    # Sub-check 4: Repeated Alerts Without Evidence of Remediation
    # ─────────────────────────────────────────────────────────────────────────
    cur.execute("""
        SELECT al.asset_id, al.category,
               COUNT(*) as alert_count,
               COUNT(c.case_id) as case_count,
               SUM(CASE WHEN c.remediation_status IN ('None','Ignored') OR c.closure_reason = 'Ignored' THEN 1 ELSE 0 END) as unremediated
        FROM alerts al
        LEFT JOIN cases c ON al.alert_id = c.alert_id
        WHERE al.entity_id = ?
        GROUP BY al.asset_id, al.category
        HAVING alert_count >= ?
        ORDER BY alert_count DESC
    """, (eid, REPEAT_ALERT_MIN_CLUSTER))
    clusters = cur.fetchall()

    for cluster in clusters:
        case_count = cluster["case_count"]
        unrem_count = cluster["unremediated"]
        unrem_ratio = (unrem_count / case_count) if case_count > 0 else 0.0

        if cluster["alert_count"] >= REPEAT_ALERT_MIN_CLUSTER and unrem_ratio >= REPEAT_UNREMEDIATED_RATIO_THRESHOLD:
            cur.execute("""
                SELECT al.alert_id, c.case_id
                FROM alerts al
                LEFT JOIN cases c ON al.alert_id = c.alert_id
                WHERE al.entity_id = ? AND al.asset_id = ? AND al.category = ?
                ORDER BY al.timestamp DESC
                LIMIT 30
            """, (eid, cluster["asset_id"], cluster["category"]))
            rows = cur.fetchall()
            ev_ids = []
            for r in rows:
                ev_ids.append(r["alert_id"])
                if r["case_id"]:
                    ev_ids.append(r["case_id"])

            findings.append(Finding(
                finding_id=f"EG-REPEAT-{eid}-{cluster['asset_id']}-{cluster['category'].replace(' ', '_')}",
                entity_id=eid,
                finding_type="EXECUTION_GAP",
                severity="HIGH" if cluster["alert_count"] >= 10 else "MEDIUM",
                title=f"Repeated {cluster['category']} Alerts on Same Asset Without Remediation",
                rationale=(
                    f"Asset {cluster['asset_id']} has generated {cluster['alert_count']} "
                    f"'{cluster['category']}' alerts. {unrem_ratio*100:.0f}% of associated cases "
                    f"({unrem_count}/{case_count}) show no remediation "
                    "('None' or 'Ignored'). Recurrence without remediation suggests root cause unaddressed."
                ),
                evidence_ids=ev_ids,
                supporting_metrics={
                    "asset_id": cluster["asset_id"],
                    "category": cluster["category"],
                    "total_alerts": cluster["alert_count"],
                    "unremediated_cases": unrem_count,
                    "total_cases": case_count,
                    "unremediated_ratio": round(unrem_ratio, 4),
                    "threshold_ratio": REPEAT_UNREMEDIATED_RATIO_THRESHOLD,
                },
            ))

    # ─────────────────────────────────────────────────────────────────────────
    # Sub-check 5: Operational Behavior Inconsistent With Expected Process
    # ─────────────────────────────────────────────────────────────────────────
    cur.execute("""
        SELECT al.alert_id, al.severity, c.case_id, c.investigation_duration, c.closure_reason, c.remediation_status
        FROM alerts al
        JOIN cases c ON al.alert_id = c.alert_id
        WHERE al.entity_id = ?
          AND al.severity IN ('CRITICAL', 'HIGH')
          AND al.status = 'CLOSED'
        ORDER BY al.alert_id
    """, (eid,))
    crit_high_cases = cur.fetchall()

    if len(crit_high_cases) >= 3:
        inconsistent = [
            r for r in crit_high_cases
            if (r["closure_reason"] == 'Ignored' or r["remediation_status"] == 'Ignored')
            or (r["severity"] == 'CRITICAL' and r["remediation_status"] == 'Completed' and r["investigation_duration"] < PREMATURE_REMEDIATION_MINUTES)
        ]
        inconsistent_ratio = len(inconsistent) / len(crit_high_cases)

        if inconsistent_ratio >= INCONSISTENT_PROCESS_RATIO_THRESHOLD:
            severity = "HIGH" if inconsistent_ratio >= 0.40 else "MEDIUM"
            ev_ids = []
            for r in inconsistent:
                ev_ids.append(r["alert_id"])
                if r["case_id"]:
                    ev_ids.append(r["case_id"])

            findings.append(Finding(
                finding_id=f"EG-INCONSISTENT-{eid}",
                entity_id=eid,
                finding_type="EXECUTION_GAP",
                severity=severity,
                title="Operational Process Inconsistency: Premature Closure or Remediation Bypass",
                rationale=(
                    f"{inconsistent_ratio*100:.1f}% of high/critical cases ({len(inconsistent)}/{len(crit_high_cases)}) "
                    "exhibited handling inconsistent with standard operational cybersecurity procedures, "
                    f"including cases closed as 'Ignored' or marked 'Completed' in under {int(PREMATURE_REMEDIATION_MINUTES)} minutes. "
                    "This demonstrates procedural non-compliance in critical incident response."
                ),
                evidence_ids=ev_ids,
                supporting_metrics={
                    "inconsistent_case_count": len(inconsistent),
                    "total_critical_high_cases": len(crit_high_cases),
                    "inconsistency_ratio": round(inconsistent_ratio, 4),
                    "threshold_ratio": INCONSISTENT_PROCESS_RATIO_THRESHOLD,
                },
            ))
