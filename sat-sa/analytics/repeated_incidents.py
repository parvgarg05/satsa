"""
repeated_incidents.py — Module E: Repeated Incident Detection (Phase 4E)

Detects recurring security alerts involving:
  - the same entity
  - the same asset
  - the same alert category

Prioritizes repeated incidents where:
  - incidents recur (repeat_count >= MIN_REPEAT_COUNT)
  - remediation is absent or incomplete (unremediated_ratio >= UNREMEDIATED_RATIO_THRESHOLD)

Every finding is deterministically constructed and includes:
  - finding_id: deterministic unique identifier (e.g. RI-CSE-007-AST-007-01-MALWARE)
  - entity_id
  - asset_id, asset_type, criticality
  - category
  - repeat_count / alert_count
  - time_window (first_seen to last_seen, duration span)
  - remediation_status (summary and breakdown)
  - severity (prioritized by asset criticality and recurrence frequency)
  - rationale (explainable supervisory context)
  - evidence_ids (traceable back to original alerts, cases, and asset)
"""
import re
import sqlite3
from datetime import datetime
from models import Finding
from config import CONFIG


MIN_REPEAT_COUNT = int(CONFIG["repeated_incidents"]["minimum_repeat_count"])
UNREMEDIATED_RATIO_THRESHOLD = float(CONFIG["repeated_incidents"]["unremediated_ratio"])


def _slugify(text: str) -> str:
    """Deterministically convert a string into an uppercase alphanumeric slug."""
    clean = re.sub(r"[^A-Za-z0-9]+", "-", str(text).strip()).strip("-")
    return clean.upper() or "UNKNOWN"


def _format_time_window(first_seen: str | None, last_seen: str | None) -> str:
    """Format human-readable time window with span duration if timestamps parse."""
    if not first_seen or not last_seen:
        return "Unknown time window"
    if first_seen == last_seen:
        return f"At {first_seen}"

    try:
        t0 = datetime.fromisoformat(first_seen.replace("Z", "+00:00"))
        t1 = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
        span_hours = round(abs((t1 - t0).total_seconds()) / 3600.0, 1)
        if span_hours >= 48.0:
            span_days = round(span_hours / 24.0, 1)
            return f"{first_seen} to {last_seen} ({span_days} days span)"
        return f"{first_seen} to {last_seen} ({span_hours}h span)"
    except Exception:
        return f"{first_seen} to {last_seen}"


def detect_repeated_incidents(db_path: str) -> list[Finding]:
    """
    Detects repeated incident clusters across entities and assets where remediation
    is absent or incomplete.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Aggregate alert clusters by (entity_id, asset_id, category)
    cur.execute("""
        SELECT
            al.entity_id,
            al.asset_id,
            al.category,
            COUNT(DISTINCT al.alert_id)                                 AS alert_count,
            COUNT(DISTINCT c.case_id)                                   AS case_count,
            SUM(CASE WHEN c.remediation_status IN ('None', 'Ignored')
                     THEN 1 ELSE 0 END)                                 AS unaddressed_cases,
            SUM(CASE WHEN c.remediation_status = 'In Progress'
                     THEN 1 ELSE 0 END)                                 AS in_progress_cases,
            SUM(CASE WHEN c.remediation_status = 'Completed'
                     THEN 1 ELSE 0 END)                                 AS remediated_cases,
            GROUP_CONCAT(DISTINCT al.alert_id)                          AS alert_ids_concat,
            GROUP_CONCAT(DISTINCT c.case_id)                            AS case_ids_concat,
            MIN(al.timestamp)                                           AS first_seen,
            MAX(al.timestamp)                                           AS last_seen
        FROM alerts al
        LEFT JOIN cases c ON al.alert_id = c.alert_id
        WHERE al.asset_id IS NOT NULL AND al.category IS NOT NULL
        GROUP BY al.entity_id, al.asset_id, al.category
        HAVING alert_count >= ?
        ORDER BY al.entity_id, alert_count DESC, al.asset_id, al.category
    """, (MIN_REPEAT_COUNT,))

    clusters = cur.fetchall()

    # Fetch asset metadata for evidence and criticality context
    cur.execute("SELECT asset_id, asset_type, criticality FROM assets")
    asset_info: dict[str, dict] = {
        r["asset_id"]: {"asset_type": r["asset_type"], "criticality": r["criticality"]}
        for r in cur.fetchall()
    }

    conn.close()

    findings: list[Finding] = []

    for cl in clusters:
        eid = cl["entity_id"]
        asset_id = cl["asset_id"]
        category = cl["category"]
        alert_count = cl["alert_count"]
        case_count = cl["case_count"] or 0
        unaddressed = cl["unaddressed_cases"] or 0
        in_progress = cl["in_progress_cases"] or 0
        remediated = cl["remediated_cases"] or 0

        # Unremediated encompasses absent ('None'/'Ignored') and incomplete ('In Progress') remediation
        unremediated = unaddressed + in_progress

        if case_count == 0:
            # If alerts recurred but zero cases were opened, remediation is completely absent
            unrem_ratio = 1.0
        else:
            unrem_ratio = unremediated / case_count

        # Prioritize repeated incidents where remediation is absent or incomplete
        if unrem_ratio < UNREMEDIATED_RATIO_THRESHOLD:
            continue  # Adequately remediated cluster — not flagged as a supervisory gap

        # Extract linked alert and case evidence IDs
        alert_ids = [a for a in (cl["alert_ids_concat"] or "").split(",") if a]
        case_ids = [c for c in (cl["case_ids_concat"] or "").split(",") if c]
        evidence_ids = [asset_id] + alert_ids + case_ids

        asset_meta = asset_info.get(asset_id, {})
        asset_type = asset_meta.get("asset_type", "Unknown")
        criticality = asset_meta.get("criticality", "Unknown")

        # Deterministic severity calculation:
        # Prioritize high repeat volumes and critical infrastructure
        if criticality == "CRITICAL" and alert_count >= 10:
            sev = "CRITICAL"
        elif criticality in ("CRITICAL", "HIGH") and alert_count >= 5:
            sev = "HIGH"
        elif alert_count >= 8:
            sev = "HIGH"
        else:
            sev = "MEDIUM"

        # Deterministic finding ID
        asset_slug = _slugify(asset_id)
        cat_slug = _slugify(category)
        finding_id = f"RI-{eid}-{asset_slug}-{cat_slug}"

        # Human-readable remediation summary
        if remediated == 0:
            remediation_summary = f"Absent ({unremediated}/{case_count} cases unresolved, 0 completed)"
        else:
            remediation_summary = f"Incomplete ({unremediated}/{case_count} cases unresolved, {remediated} completed)"

        time_window_str = _format_time_window(cl["first_seen"], cl["last_seen"])

        rationale = (
            f"Asset {asset_id} ({asset_type}, {criticality} criticality) has experienced "
            f"{alert_count} recurring '{category}' alerts between {cl['first_seen']} and {cl['last_seen']} "
            f"({time_window_str}). Remediation is {remediation_summary.lower()} with "
            f"{unrem_ratio*100:.1f}% of associated cases unresolved. "
            f"Recurrent incidents of the same category on the same asset without effective remediation "
            f"indicate persistent root-cause vulnerabilities and inadequate supervisory follow-through."
        )

        findings.append(Finding(
            finding_id=finding_id,
            entity_id=eid,
            finding_type="REPEATED_INCIDENT",
            severity=sev,
            title=f"Repeated {category} Incidents on {asset_id} Without Remediation",
            rationale=rationale,
            evidence_ids=evidence_ids,
            supporting_metrics={
                "entity_id": eid,
                "asset_id": asset_id,
                "asset_type": asset_type,
                "asset_criticality": criticality,
                "category": category,
                "repeat_count": alert_count,
                "alert_count": alert_count,
                "case_count": case_count,
                "unremediated_cases": unremediated,
                "remediated_cases": remediated,
                "unaddressed_cases": unaddressed,
                "in_progress_cases": in_progress,
                "unremediated_ratio": round(unrem_ratio, 4),
                "remediation_status": remediation_summary,
                "time_window": time_window_str,
                "first_seen": cl["first_seen"],
                "last_seen": cl["last_seen"],
                "time_window_start": cl["first_seen"],
                "time_window_end": cl["last_seen"],
            },
        ))

    return findings


if __name__ == "__main__":
    import sys
    db = sys.argv[1] if len(sys.argv) > 1 else "../backend/sat_sa.db"
    results = detect_repeated_incidents(db)
    print(f"Detected {len(results)} repeated incident findings.")
    for r in results[:10]:
        print(f"[{r.severity}] {r.finding_id}: {r.title}")
        print(f"  Repeats: {r.supporting_metrics['repeat_count']}, Remediation: {r.supporting_metrics['remediation_status']}")
