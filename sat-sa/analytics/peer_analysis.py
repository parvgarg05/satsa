"""
=============================================================================
PEER COMPARISON MODULE (Module D)
=============================================================================

Compares each entity's operational security metrics against an appropriate peer group
constructed using sector and entity metadata. Only statistically significant
deviations in supervisory-relevant directions are flagged as findings.

METRICS COMPARED:
-----------------------------------------------------------------------------
1. escalation_rate: Proportion of cases escalated to supervisory tiers.
   (Significantly low rate indicates under-escalation or incident suppression).
2. closure_time: Median investigation duration for closed cases (minutes).
   (Significantly fast closure indicates superficial triage).
3. investigation_duration: Mean investigation duration for closed cases (minutes).
   (Significantly short duration indicates inadequate forensic depth).
4. critical_alert_ratio: Proportion of total alerts classified as CRITICAL.
   (Unusually high ratio indicates either targeting or alert misconfiguration).
5. telemetry_coverage: Proportion of monitored assets with fresh telemetry (<= 7d).
   (Significantly low coverage indicates surveillance blind spots).

PEER GROUP CONSTRUCTION & SMALL GROUP SAFETY RULE:
-----------------------------------------------------------------------------
1. An entity is NEVER compared against itself (self-exclusion is enforced).
2. Sector Peer Group Rule:
   - If an entity's sector contains >= 3 entities total (providing >= 2 peers
     when excluding the entity itself), the entity is compared against its
     specific SECTOR PEER GROUP.
3. Small Peer Group Fallback Rule:
   - If an entity is in a single-member peer group (only 1 entity in sector)
     or a small sector with < 3 total entities, sector-based statistical medians
     are unreliable. The module safely falls back to a CROSS-SECTOR PEER GROUP
     (all other entities in the database excluding itself).
4. Insufficient Total Population:
   - If the entire database contains <= 1 entity, peer comparison is gracefully
     bypassed (returns 0 findings without raising exceptions).
5. Missing Metric Data Safety:
   - If an entity or peer has 0 cases or 0 alerts, metrics safely evaluate to 0.0
     without ZeroDivisionError, and zero-case peers are filtered out of duration
     comparisons to avoid dragging down medians artificially.

DETERMINISTIC THRESHOLDS:
-----------------------------------------------------------------------------
- ESCALATION_DEVIATION_THRESHOLD = 0.08 (8 percentage points below peer median)
- CLOSURE_TIME_RATIO_THRESHOLD = 0.50 (median closure < 50% of peer median)
- DURATION_RATIO_THRESHOLD = 0.50 (mean duration < 50% of peer median)
- TELEMETRY_DEVIATION_THRESHOLD = 0.15 (15 percentage points below peer median)
- CRITICAL_RATIO_HIGH_THRESHOLD = 0.25 (25 percentage points above peer median)
=============================================================================
"""
import sqlite3
import statistics
from datetime import datetime, timezone
from typing import Any
from models import Finding
from config import CONFIG, assessment_reference_timestamp


STALE_DAYS = 7.0

# Threshold constants
ESCALATION_DEVIATION_THRESHOLD = float(CONFIG["peer_comparison"]["escalation_deviation"])
CLOSURE_TIME_RATIO_THRESHOLD = float(CONFIG["peer_comparison"]["closure_time_ratio"])
DURATION_RATIO_THRESHOLD = float(CONFIG["peer_comparison"]["duration_ratio"])
TELEMETRY_DEVIATION_THRESHOLD = float(CONFIG["peer_comparison"]["telemetry_deviation"])
CRITICAL_RATIO_HIGH_THRESHOLD = float(CONFIG["peer_comparison"]["critical_ratio_deviation"])


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts or not isinstance(ts, str) or ts.strip() == "":
        return None
    try:
        s = ts.strip().rstrip("Z")
        if "+" in s:
            s = s[: s.index("+")]
        return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _compute_entity_metrics(db_path: str) -> dict[str, dict[str, Any]]:
    """
    Extract deterministic operational metrics for every entity.
    Safely handles entities with missing alerts, cases, or assets.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    now = datetime.fromisoformat(assessment_reference_timestamp().replace("Z", "+00:00"))

    cur.execute("SELECT entity_id, entity_name, sector FROM entities ORDER BY entity_id")
    entities = cur.fetchall()

    metrics: dict[str, dict[str, Any]] = {}

    for row in entities:
        eid = row["entity_id"]
        sector = row["sector"] or "Unknown"

        # 1. Escalation rate
        cur.execute(
            "SELECT COUNT(*) as total, SUM(escalated) as esc FROM cases WHERE entity_id = ?",
            (eid,),
        )
        case_row = cur.fetchone()
        total_cases = case_row["total"] or 0
        esc_cases = case_row["esc"] or 0
        escalation_rate = float(esc_cases / total_cases) if total_cases > 0 else 0.0

        # 2 & 3. Closure time (median) and average investigation duration
        cur.execute(
            "SELECT investigation_duration FROM cases WHERE entity_id = ? AND investigation_duration IS NOT NULL",
            (eid,),
        )
        durations = [float(r["investigation_duration"]) for r in cur.fetchall()]
        median_closure_time = float(statistics.median(durations)) if durations else 0.0
        avg_dur = float(statistics.mean(durations)) if durations else 0.0

        # 4. Critical alert ratio
        cur.execute("SELECT COUNT(*) as total FROM alerts WHERE entity_id = ?", (eid,))
        total_alerts = cur.fetchone()["total"] or 0
        cur.execute(
            "SELECT COUNT(*) as cnt FROM alerts WHERE entity_id = ? AND severity = 'CRITICAL'",
            (eid,),
        )
        crit_count = cur.fetchone()["cnt"] or 0
        crit_ratio = float(crit_count / total_alerts) if total_alerts > 0 else 0.0

        # 5. Telemetry coverage
        cur.execute("SELECT asset_id, last_telemetry FROM assets WHERE entity_id = ?", (eid,))
        asset_rows = cur.fetchall()
        total_assets = len(asset_rows)
        fresh_assets = 0
        for ar in asset_rows:
            parsed = _parse_iso(ar["last_telemetry"])
            if parsed and (now - parsed).total_seconds() / 86400.0 <= STALE_DAYS:
                fresh_assets += 1
        telemetry_coverage = float(fresh_assets / total_assets) if total_assets > 0 else 0.0

        metrics[eid] = {
            "entity_id": eid,
            "sector": sector,
            "escalation_rate": round(escalation_rate, 4),
            "closure_time": round(median_closure_time, 2),
            "avg_investigation_duration": round(avg_dur, 2),
            "investigation_duration": round(avg_dur, 2),
            "critical_alert_ratio": round(crit_ratio, 4),
            "telemetry_coverage": round(telemetry_coverage, 4),
            "total_cases": total_cases,
            "total_alerts": total_alerts,
            "total_assets": total_assets,
        }

    conn.close()
    return metrics


def detect_peer_deviations(db_path: str) -> list[Finding]:
    """
    Run peer comparison across all entities in the database.
    Constructs peer groups safely (sector peers with cross-sector fallback).
    Calculates entity value, peer median, deviation, and interpretation for each comparison.
    """
    entity_metrics = _compute_entity_metrics(db_path)
    entity_ids = sorted(entity_metrics.keys())

    # Need at least 2 entities to perform peer comparison
    if len(entity_ids) < 2:
        return []

    # Map sector to entity IDs
    sector_map: dict[str, list[str]] = {}
    for eid, m in entity_metrics.items():
        sector_map.setdefault(m["sector"], []).append(eid)

    findings: list[Finding] = []

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    for eid in entity_ids:
        m = entity_metrics[eid]
        entity_sector = m["sector"]

        # Peer selection rule:
        # If entity's sector has >= 3 entities (giving >= 2 peers after excluding itself), use sector peers.
        # Otherwise, fall back safely to cross-sector peers.
        sector_peers = [e for e in sector_map.get(entity_sector, []) if e != eid]
        if len(sector_peers) >= 2:
            peer_ids = sector_peers
            peer_group_type = f"Sector ({entity_sector})"
        else:
            peer_ids = [e for e in entity_ids if e != eid]
            peer_group_type = "Cross-Sector"

        if len(peer_ids) < 2:
            continue

        peer_count = len(peer_ids)

        def get_peer_statistics(metric_key: str, filter_zero_cases = False) -> tuple[float, float]:
            if filter_zero_cases:
                vals = [entity_metrics[p][metric_key] for p in peer_ids if entity_metrics[p]["total_cases"] > 0]
                if not vals:
                    vals = [entity_metrics[p][metric_key] for p in peer_ids]
            else:
                vals = [entity_metrics[p][metric_key] for p in peer_ids]
            if not vals:
                return 0.0, 0.0
            return float(statistics.median(vals)), float(statistics.pvariance(vals))

        def get_peer_median(metric_key: str, filter_zero_cases = False) -> float:
            return get_peer_statistics(metric_key, filter_zero_cases)[0]

        # ── 1. Escalation Rate Comparison ──
        esc_median = get_peer_median("escalation_rate")
        _, esc_variance = get_peer_statistics("escalation_rate")
        esc_deviation = round(esc_median - m["escalation_rate"], 4)
        if esc_deviation > ESCALATION_DEVIATION_THRESHOLD and m["total_cases"] >= 5:
            sev = "CRITICAL" if esc_deviation > 0.40 else "HIGH" if esc_deviation > 0.30 else "MEDIUM"
            interpretation = (
                f"Entity escalation rate is {esc_deviation*100:.1f} percentage points below {peer_group_type} "
                f"peer median ({m['escalation_rate']*100:.1f}% vs {esc_median*100:.1f}% across {peer_count} peers). "
                "Persistently low escalation rate indicates potential incident suppression or failure to escalate severe threats."
            )

            cur.execute("SELECT case_id FROM cases WHERE entity_id = ? AND escalated = 0 LIMIT 25", (eid,))
            ev_ids = [r["case_id"] for r in cur.fetchall()]

            findings.append(Finding(
                finding_id=f"PEER-ESC-{eid}",
                entity_id=eid,
                finding_type="PEER_DEVIATION",
                severity=sev,
                title="Significantly Low Escalation Rate Compared to Peers",
                rationale=interpretation,
                evidence_ids=ev_ids,
                supporting_metrics={
                    "entity_value": m["escalation_rate"],
                    "peer_median": round(esc_median, 4),
                    "deviation": esc_deviation,
                    "interpretation": interpretation,
                    "peer_group": peer_group_type,
                    "peer_count": peer_count
                }
            ))

        # ── 2. Closure Time Comparison ──
        ct_median = get_peer_median("closure_time", True)
        _, ct_variance = get_peer_statistics("closure_time", True)
        if ct_median > 0 and m["closure_time"] > 0:
            ct_ratio = m["closure_time"] / ct_median
            if ct_ratio < CLOSURE_TIME_RATIO_THRESHOLD and m["total_cases"] >= 5:
                sev = "HIGH" if ct_ratio < 0.25 else "MEDIUM"
                interpretation = (
                    f"Entity median closure time ({m['closure_time']} mins) is unusually fast "
                    f"({ct_ratio*100:.1f}% of {peer_group_type} peer median {ct_median} mins across {peer_count} peers). "
                    "Unusually fast closures may indicate superficial triage or automated closure without investigation."
                )

                cur.execute("SELECT case_id FROM cases WHERE entity_id = ? AND investigation_duration < ? LIMIT 25", (eid, ct_median))
                ev_ids = [r["case_id"] for r in cur.fetchall()]

                findings.append(Finding(
                    finding_id=f"PEER-CLO-{eid}",
                    entity_id=eid,
                    finding_type="PEER_DEVIATION",
                    severity=sev,
                    title="Suspiciously Fast Incident Closure Times",
                    rationale=interpretation,
                    evidence_ids=ev_ids,
                    supporting_metrics={
                        "entity_value": m["closure_time"],
                        "peer_median": round(ct_median, 4),
                        "deviation": round(ct_ratio, 4),
                        "interpretation": interpretation,
                        "peer_group": peer_group_type,
                        "peer_count": peer_count
                    }
                ))

        # ── 3. Investigation Duration Comparison ──
        dur_median = get_peer_median("investigation_duration", True)
        _, dur_variance = get_peer_statistics("investigation_duration", True)
        if dur_median > 0 and m["investigation_duration"] > 0:
            dur_ratio = m["investigation_duration"] / dur_median
            if dur_ratio < DURATION_RATIO_THRESHOLD and m["total_cases"] >= 5:
                sev = "HIGH" if dur_ratio < 0.25 else "MEDIUM"
                interpretation = (
                    f"Entity mean investigation duration ({round(m['investigation_duration'], 1)} mins) is significantly shorter "
                    f"than {peer_group_type} peer median ({dur_median} mins across {peer_count} peers). "
                    "Short investigation durations suggest inadequate forensic depth or insufficient resource allocation per incident."
                )

                cur.execute("SELECT case_id FROM cases WHERE entity_id = ? AND investigation_duration < ? LIMIT 25", (eid, dur_median))
                ev_ids = [r["case_id"] for r in cur.fetchall()]

                findings.append(Finding(
                    finding_id=f"PEER-DUR-{eid}",
                    entity_id=eid,
                    finding_type="PEER_DEVIATION",
                    severity=sev,
                    title="Superficial Investigation Durations",
                    rationale=interpretation,
                    evidence_ids=ev_ids,
                    supporting_metrics={
                        "entity_value": m["investigation_duration"],
                        "peer_median": round(dur_median, 4),
                        "deviation": round(dur_ratio, 4),
                        "interpretation": interpretation,
                        "peer_group": peer_group_type,
                        "peer_count": peer_count
                    }
                ))

        # ── 4. Critical Alert Ratio Comparison ───────────────────────────────
        # 4. Telemetry Coverage Comparison
        stale_median = get_peer_median("telemetry_coverage")
        _, stale_variance = get_peer_statistics("telemetry_coverage")
        stale_deviation = round(stale_median - m["telemetry_coverage"], 4)
        if stale_deviation > TELEMETRY_DEVIATION_THRESHOLD and m["total_assets"] >= 5:
            sev = "HIGH" if stale_deviation > 0.30 else "MEDIUM"
            interpretation = (
                f"Entity telemetry coverage is {stale_deviation*100:.1f} percentage points below {peer_group_type} "
                f"peer median ({m['telemetry_coverage']*100:.1f}% vs {stale_median*100:.1f}% across {peer_count} peers). "
                "Low active telemetry indicates missing sensor coverage or disconnected assets."
            )

            cur.execute("SELECT MAX(last_telemetry) FROM assets WHERE last_telemetry IS NOT NULL")
            max_date_row = cur.fetchone()
            anchor_date = max_date_row[0] if max_date_row and max_date_row[0] else datetime.utcnow().isoformat()
            
            cur.execute("""
                SELECT asset_id FROM assets WHERE entity_id = ? AND (last_telemetry IS NULL OR julianday(?) - julianday(last_telemetry) > 7)
                LIMIT 25
            """, (eid, anchor_date))
            ev_ids = [r["asset_id"] for r in cur.fetchall()]

            findings.append(Finding(
                finding_id=f"PEER-TEL-{eid}",
                entity_id=eid,
                finding_type="PEER_DEVIATION",
                severity=sev,
                title="Significantly Low Telemetry Coverage Compared to Peers",
                rationale=interpretation,
                evidence_ids=ev_ids,
                supporting_metrics={
                    "entity_value": m["telemetry_coverage"],
                    "peer_median": round(stale_median, 4),
                    "deviation": stale_deviation,
                    "interpretation": interpretation,
                    "peer_group": peer_group_type,
                    "peer_count": peer_count
                }
            ))

        crit_median = get_peer_median("critical_alert_ratio")
        _, crit_variance = get_peer_statistics("critical_alert_ratio")
        crit_deviation = round(m["critical_alert_ratio"] - crit_median, 4)
        if crit_deviation > CRITICAL_RATIO_HIGH_THRESHOLD and m["total_alerts"] >= 20:
            interpretation = (
                f"Critical alerts represent {m['critical_alert_ratio']*100:.1f}% of total alerts, "
                f"{crit_deviation*100:.1f} percentage points above {peer_group_type} peer median "
                f"({crit_median*100:.1f}% across {peer_count} peers). "
                "Disproportionate critical alert volume indicates potential targeted attacks or aggressive alert configuration."
            )

            cur.execute("SELECT alert_id FROM alerts WHERE entity_id = ? AND severity = 'CRITICAL' LIMIT 25", (eid,))
            ev_ids = [r["alert_id"] for r in cur.fetchall()]

            findings.append(Finding(
                finding_id=f"PEER-CRIT-{eid}",
                entity_id=eid,
                finding_type="PEER_DEVIATION",
                severity="MEDIUM",
                title="Unusually High Critical Alert Ratio Compared to Peers",
                rationale=interpretation,
                evidence_ids=ev_ids,
                supporting_metrics={
                    "entity_value": m["critical_alert_ratio"],
                    "peer_median": round(crit_median, 4),
                    "deviation": crit_deviation,
                    "interpretation": interpretation,
                    "entity_critical_alert_ratio": m["critical_alert_ratio"],
                    "peer_median_critical_ratio": round(crit_median, 4),
                    "deviation_pp": crit_deviation,
                    "peer_group": peer_group_type,
                    "peer_count": peer_count,
                    "peer_variance": round(crit_variance, 6),
                    "peer_stddev": round(crit_variance ** 0.5, 6),
                    "total_alerts": m["total_alerts"],
                },
            ))

    conn.close()
    return findings


def get_entity_metrics(db_path: str) -> dict[str, dict]:
    """Public accessor for entity metrics (used by pipeline and tests)."""
    return _compute_entity_metrics(db_path)
