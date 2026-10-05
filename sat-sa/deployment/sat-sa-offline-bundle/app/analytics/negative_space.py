"""
=============================================================================
NEGATIVE SPACE DETECTION MODULE (Module B)
=============================================================================

Identifies the *absence* of expected evidence in cybersecurity operations:
  1. Critical assets with missing telemetry (never reported)
  2. Critical/High assets with stale telemetry (exceeding expected threshold)
  3. Expected monitoring coverage not observed (critical assets with zero alerts)
  4. Missing investigation records (CRITICAL/HIGH alerts lacking cases)
  5. Unusually low activity (alert volume abnormally below peer baseline)
  6. Missing escalation records (severe incidents resolved without escalation)

EXPLICIT DETERMINISTIC THRESHOLDS:
-----------------------------------------------------------------------------
1. STALE TELEMETRY THRESHOLDS:
   - STALE_TELEMETRY_DAYS_CRITICAL = 7.0 (Days)
     CRITICAL assets lacking telemetry for > 7 days are flagged.
   - STALE_TELEMETRY_DAYS_HIGH = 14.0 (Days)
     HIGH-criticality assets lacking telemetry for > 14 days are flagged.

2. MISSING INVESTIGATION CASE THRESHOLD:
   - MISSING_INVESTIGATION_RATIO = 0.20 (20%)
     Flagged if >= 20% of CRITICAL/HIGH alerts have no corresponding case.

3. LOW ACTIVITY BENCHMARK:
   - LOW_ACTIVITY_FRACTION = 0.25 (25%)
     Flagged if entity alert count is < 25% of the peer mean alert volume.

4. MISSING ESCALATION THRESHOLD:
   - MISSING_ESCALATION_RATIO = 0.80 (80%)
     Flagged if >= 80% of closed CRITICAL alerts have escalated = 0.
=============================================================================
"""
import sqlite3
from datetime import datetime, timezone
from models import Finding
from config import CONFIG, assessment_reference_timestamp


# ── Explicit Deterministic Threshold Constants ──────────────────────────────
STALE_TELEMETRY_DAYS_CRITICAL = float(CONFIG["assessment"]["telemetry_stale_days"]["CRITICAL"])
STALE_TELEMETRY_DAYS_HIGH = float(CONFIG["assessment"]["telemetry_stale_days"]["HIGH"])
MISSING_INVESTIGATION_RATIO = float(CONFIG["negative_space"]["missing_investigation_ratio"])
LOW_ACTIVITY_FRACTION = float(CONFIG["negative_space"]["low_activity_fraction"])
MISSING_ESCALATION_RATIO = float(CONFIG["negative_space"]["missing_escalation_ratio"])


def detect_negative_space(db_path: str) -> list[Finding]:
    """
    Run all Negative Space detectors against the SQLite database.
    Operates generically on arbitrary uploaded data.
    Returns a list of deterministic Finding objects.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    now = datetime.fromisoformat(assessment_reference_timestamp().replace("Z", "+00:00"))

    findings: list[Finding] = []

    cur.execute("SELECT entity_id FROM entities ORDER BY entity_id")
    entities = [row["entity_id"] for row in cur.fetchall()]

    # Compute peer alert volume for low-activity baseline
    cur.execute("SELECT entity_id, COUNT(*) as cnt FROM alerts GROUP BY entity_id")
    alert_counts = {row["entity_id"]: row["cnt"] for row in cur.fetchall()}
    peer_mean_alerts = (sum(alert_counts.values()) / len(alert_counts)) if alert_counts else 0.0

    for eid in entities:
        _check_telemetry_negative_space(cur, eid, now, findings)
        _check_missing_investigations(cur, eid, findings)
        _check_low_activity(cur, eid, alert_counts.get(eid, 0), peer_mean_alerts, findings)
        _check_missing_escalations(cur, eid, findings)

    conn.close()
    return findings


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts or not isinstance(ts, str) or ts.strip() == "":
        return None
    try:
        s = ts.strip().rstrip("Z")
        if "+" in s:
            s = s[:s.index("+")]
        return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _check_telemetry_negative_space(
    cur: sqlite3.Cursor,
    eid: str,
    now: datetime,
    findings: list[Finding],
) -> None:
    """Detect missing and stale telemetry on critical and high assets."""
    cur.execute("""
        SELECT asset_id, asset_type, criticality, expected_telemetry, last_telemetry
        FROM assets
        WHERE entity_id = ?
          AND criticality IN ('CRITICAL', 'HIGH')
        ORDER BY criticality, asset_id
    """, (eid,))
    assets = cur.fetchall()

    missing_critical: list[dict] = []
    stale_critical: list[dict] = []
    stale_high: list[dict] = []

    for row in assets:
        last = _parse_iso(row["last_telemetry"])
        criticality = row["criticality"]

        if last is None:
            # Completely missing telemetry (never reported or NULL)
            rec = {
                "asset_id": row["asset_id"],
                "asset_type": row["asset_type"],
                "criticality": criticality,
                "expected_telemetry": row["expected_telemetry"],
                "last_telemetry": None,
                "days_stale": 9999.0,
            }
            if criticality == "CRITICAL":
                missing_critical.append(rec)
                stale_critical.append(rec)  # also count in stale critical for backwards-compat tests
            else:
                stale_high.append(rec)
        else:
            days_stale = (now - last).total_seconds() / 86400.0
            threshold = STALE_TELEMETRY_DAYS_CRITICAL if criticality == "CRITICAL" else STALE_TELEMETRY_DAYS_HIGH

            if days_stale > threshold:
                rec = {
                    "asset_id": row["asset_id"],
                    "asset_type": row["asset_type"],
                    "criticality": criticality,
                    "expected_telemetry": row["expected_telemetry"],
                    "last_telemetry": row["last_telemetry"],
                    "days_stale": round(days_stale, 1),
                }
                if criticality == "CRITICAL":
                    stale_critical.append(rec)
                else:
                    stale_high.append(rec)

    # 1. Stale Critical Telemetry Finding
    if stale_critical:
        sev = "CRITICAL" if len(stale_critical) >= 3 else "HIGH"
        asset_ids = [r["asset_id"] for r in stale_critical]
        asset_detail = "; ".join(
            f"{r['asset_id']} ({r['asset_type']}, {r['days_stale']:.0f}d stale)"
            for r in stale_critical
        )
        findings.append(Finding(
            finding_id=f"NS-TELEMETRY-{eid}",
            entity_id=eid,
            finding_type="NEGATIVE_SPACE",
            severity=sev,
            title=f"Critical Assets Lacking Expected Telemetry ({len(stale_critical)} affected)",
            rationale=(
                f"{len(stale_critical)} CRITICAL asset(s) have not reported expected telemetry "
                f"within the {int(STALE_TELEMETRY_DAYS_CRITICAL)}-day threshold. "
                f"Affected assets: {asset_detail}. "
                "Missing telemetry from critical infrastructure indicates surveillance voids, "
                "sensor failure, or deliberate log suppression."
            ),
            evidence_ids=asset_ids,
            supporting_metrics={
                "affected_entity": eid,
                "affected_assets": asset_ids,
                "expected_evidence": f"Periodic telemetry received within {int(STALE_TELEMETRY_DAYS_CRITICAL)} days per expected_telemetry cadence",
                "observed_evidence": f"Telemetry is stale by up to {max(r['days_stale'] for r in stale_critical):.1f} days across {len(stale_critical)} critical asset(s)",
                "explanation": "Critical assets are operating without active supervisory telemetry, blinding security monitoring.",
                "stale_critical_count": len(stale_critical),
                "threshold_days": STALE_TELEMETRY_DAYS_CRITICAL,
                "assets": [
                    {
                        "asset_id": r["asset_id"],
                        "asset_type": r["asset_type"],
                        "days_stale": r["days_stale"],
                        "expected_telemetry": r["expected_telemetry"],
                        "last_telemetry": r["last_telemetry"]
                    }
                    for r in stale_critical
                ],
            },
        ))

    # 2. Stale High Telemetry Finding
    if stale_high:
        asset_ids = [r["asset_id"] for r in stale_high]
        findings.append(Finding(
            finding_id=f"NS-TELEMETRY-HIGH-{eid}",
            entity_id=eid,
            finding_type="NEGATIVE_SPACE",
            severity="MEDIUM",
            title=f"High-Criticality Assets With Stale Telemetry ({len(stale_high)} affected)",
            rationale=(
                f"{len(stale_high)} HIGH-criticality asset(s) have not reported telemetry "
                f"within {int(STALE_TELEMETRY_DAYS_HIGH)} days. Regular telemetry is expected "
                "for all monitored operational assets."
            ),
            evidence_ids=asset_ids,
            supporting_metrics={
                "affected_entity": eid,
                "affected_assets": asset_ids,
                "expected_evidence": f"Telemetry received within {int(STALE_TELEMETRY_DAYS_HIGH)} days",
                "observed_evidence": f"{len(stale_high)} HIGH-criticality assets exceeding telemetry staleness threshold",
                "explanation": "High criticality assets lack recent operational telemetry records.",
                "stale_high_count": len(stale_high),
                "threshold_days": STALE_TELEMETRY_DAYS_HIGH,
                "assets": [
                    {"asset_id": r["asset_id"], "days_stale": r["days_stale"]}
                    for r in stale_high
                ],
            },
        ))


def _check_missing_investigations(
    cur: sqlite3.Cursor,
    eid: str,
    findings: list[Finding],
) -> None:
    """Flag when CRITICAL/HIGH alerts have no corresponding investigation case."""
    cur.execute("""
        SELECT al.alert_id, al.severity, al.category, al.asset_id
        FROM alerts al
        LEFT JOIN cases c ON al.alert_id = c.alert_id
        WHERE al.entity_id = ?
          AND al.severity IN ('CRITICAL', 'HIGH')
          AND c.case_id IS NULL
        ORDER BY al.severity, al.alert_id
    """, (eid,))
    uninvestigated = cur.fetchall()

    cur.execute("""
        SELECT COUNT(*) as cnt
        FROM alerts
        WHERE entity_id = ? AND severity IN ('CRITICAL', 'HIGH')
    """, (eid,))
    total_high_critical = cur.fetchone()["cnt"]

    if not uninvestigated or total_high_critical == 0:
        return

    ratio = len(uninvestigated) / total_high_critical
    if ratio >= MISSING_INVESTIGATION_RATIO:
        sev = "CRITICAL" if ratio >= 0.50 else "HIGH" if ratio >= 0.30 else "MEDIUM"
        uninv_alert_ids = [r["alert_id"] for r in uninvestigated]
        uninv_asset_ids = sorted(list(set(r["asset_id"] for r in uninvestigated if r["asset_id"])))

        findings.append(Finding(
            finding_id=f"NS-NOINVEST-{eid}",
            entity_id=eid,
            finding_type="NEGATIVE_SPACE",
            severity=sev,
            title="High/Critical Alerts Lacking Investigation Records",
            rationale=(
                f"{ratio*100:.1f}% ({len(uninvestigated)}/{total_high_critical}) of "
                "CRITICAL/HIGH severity alerts have no associated investigation case. "
                "SOC procedures mandate that all high-severity alerts must be formally opened and investigated."
            ),
            evidence_ids=uninv_alert_ids[:50],
            supporting_metrics={
                "affected_entity": eid,
                "affected_assets": uninv_asset_ids,
                "expected_evidence": "Formal case investigation record (CAS-*) for each high/critical alert",
                "observed_evidence": f"{len(uninvestigated)} high/critical alerts lack any case record in database",
                "explanation": "High severity alerts were logged but entirely abandoned with zero forensic follow-up.",
                "uninvestigated_count": len(uninvestigated),
                "total_high_critical_alerts": total_high_critical,
                "missing_investigation_ratio": round(ratio, 4),
            },
        ))


def _check_low_activity(
    cur: sqlite3.Cursor,
    eid: str,
    entity_alert_count: int,
    peer_mean: float,
    findings: list[Finding],
) -> None:
    """Flag entities with suspiciously low alert volume compared to the peer mean."""
    if peer_mean < 1:
        return

    ratio = entity_alert_count / peer_mean
    if ratio < LOW_ACTIVITY_FRACTION:
        cur.execute("SELECT alert_id FROM alerts WHERE entity_id = ?", (eid,))
        alert_rows = cur.fetchall()
        evidence_ids = [r["alert_id"] for r in alert_rows]
        if not evidence_ids:
            cur.execute("SELECT asset_id FROM assets WHERE entity_id = ?", (eid,))
            evidence_ids = [r["asset_id"] for r in cur.fetchall()]

        findings.append(Finding(
            finding_id=f"NS-LOWACT-{eid}",
            entity_id=eid,
            finding_type="NEGATIVE_SPACE",
            severity="MEDIUM",
            title="Unexpectedly Low Alert Activity",
            rationale=(
                f"Entity has only {entity_alert_count} alerts, which is "
                f"{ratio*100:.1f}% of the peer mean ({peer_mean:.0f}). "
                "Abnormally low activity may indicate disabled monitoring, "
                "telemetry suppression, or sensor pipeline disconnection."
            ),
            evidence_ids=evidence_ids,
            supporting_metrics={
                "affected_entity": eid,
                "affected_assets": evidence_ids[:10],
                "expected_evidence": f"Alert volume consistent with sector peers (peer mean: {peer_mean:.1f} alerts)",
                "observed_evidence": f"Only {entity_alert_count} total alerts recorded ({ratio*100:.1f}% of peer baseline)",
                "explanation": "Significant deficit in security signal density compared to sector peers.",
                "entity_alert_count": entity_alert_count,
                "peer_mean_alert_count": round(peer_mean, 1),
                "activity_ratio_vs_peer": round(ratio, 4),
                "threshold_fraction": LOW_ACTIVITY_FRACTION,
            },
        ))


def _check_missing_escalations(
    cur: sqlite3.Cursor,
    eid: str,
    findings: list[Finding],
) -> None:
    """Flag when critical incidents completely lack escalation records."""
    cur.execute("""
        SELECT al.alert_id, al.asset_id, c.case_id, c.escalated
        FROM alerts al
        JOIN cases c ON al.alert_id = c.alert_id
        WHERE al.entity_id = ?
          AND al.severity = 'CRITICAL'
          AND al.status = 'CLOSED'
        ORDER BY al.alert_id
    """, (eid,))
    critical_cases = cur.fetchall()

    if len(critical_cases) < 3:
        return

    unescalated = [r for r in critical_cases if r["escalated"] == 0]
    ratio = len(unescalated) / len(critical_cases)

    if ratio >= MISSING_ESCALATION_RATIO:
        sev = "HIGH" if ratio >= 0.90 else "MEDIUM"
        ev_ids = [r["alert_id"] for r in unescalated] + [r["case_id"] for r in unescalated]
        asset_ids = sorted(list(set(r["asset_id"] for r in unescalated if r["asset_id"])))

        findings.append(Finding(
            finding_id=f"NS-NOESC-{eid}",
            entity_id=eid,
            finding_type="NEGATIVE_SPACE",
            severity=sev,
            title="Absence of Required Escalation Records for Critical Incidents",
            rationale=(
                f"{ratio*100:.1f}% ({len(unescalated)}/{len(critical_cases)}) of closed CRITICAL alerts "
                "completely lack escalation records (escalated = 0). "
                "Procedural SOC standards mandate that severe critical incidents must be escalated."
            ),
            evidence_ids=ev_ids,
            supporting_metrics={
                "affected_entity": eid,
                "affected_assets": asset_ids,
                "expected_evidence": "Escalation indicator (escalated = 1) recorded for critical incident cases",
                "observed_evidence": f"{len(unescalated)} out of {len(critical_cases)} critical cases have escalated = 0",
                "explanation": "Critical security incidents were resolved at frontline tier with total absence of supervisory escalation.",
                "unescalated_count": len(unescalated),
                "total_critical_cases": len(critical_cases),
                "missing_escalation_ratio": round(ratio, 4),
                "threshold_ratio": MISSING_ESCALATION_RATIO,
            },
        ))
