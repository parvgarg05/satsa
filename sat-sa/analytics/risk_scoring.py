"""
risk_scoring.py -- Phase 5: Deterministic Explainable Risk Scoring

Consumes supervisory findings and produces a transparent, weighted
entity-level risk score and structured explanation.

Weighting (spec-mandated):
  Execution Gap:      30% (0.30)
  Negative Space:     25% (0.25)
  Anomaly:            20% (0.20)
  Peer Deviation:     15% (0.15)
  Repeated Incidents: 10% (0.10)

Formula:
  final_risk_score = (
      0.30 * execution_gap
      + 0.25 * negative_space
      + 0.20 * anomaly
      + 0.15 * peer_deviation
      + 0.10 * repeated_incidents
  )

Risk Bands:
  0–29   LOW
  30–59  MEDIUM
  60–79  HIGH
  80–100 CRITICAL

Design principles:
  - Fully deterministic: same findings -> exact same score every run
  - No hardcoded entity values or scores
  - Every numeric value in explanations comes from actual findings/metrics
  - Every component normalized to 0–100 before weighting
  - Explicit explanation object detailing raw score, weight, and contribution for all modules
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from models import Finding
from config import CONFIG


# ── Public constants ────────────────────────────────────────────────────────

WEIGHTS: dict[str, float] = {
    key: float(value) for key, value in CONFIG["risk_weights"].items()
}

CANONICAL_KEYS: dict[str, str] = {
    "EXECUTION_GAP":      "execution_gap",
    "NEGATIVE_SPACE":     "negative_space",
    "ANOMALY":            "anomaly",
    "PEER_DEVIATION":     "peer_deviation",
    "REPEATED_INCIDENT":  "repeated_incidents",
}

# Severity -> numeric value used to derive module sub-scores
SEVERITY_POINTS: dict[str, float] = {
    "CRITICAL": 100.0,
    "HIGH":      70.0,
    "MEDIUM":    40.0,
    "LOW":       15.0,
}

# Max findings per module for density saturation
MAX_FINDINGS_FOR_CAP: dict[str, int] = {
    "EXECUTION_GAP":     4,   # 4+ findings -> saturated
    "NEGATIVE_SPACE":    2,   # 2+ stale-telemetry findings -> saturated
    "ANOMALY":           1,   # single anomaly flag is already decisive
    "PEER_DEVIATION":    4,   # 4 peer checks -> saturated
    "REPEATED_INCIDENT": 5,   # 5+ clusters -> saturated
}


def risk_level_from_score(score: float) -> str:
    """Classify 0-100 score into spec-mandated risk tiers."""
    if score >= 80.0:
        return "CRITICAL"
    elif score >= 60.0:
        return "HIGH"
    elif score >= 30.0:
        return "MEDIUM"
    else:
        return "LOW"


# ── Data structures ─────────────────────────────────────────────────────────

@dataclass
class ComponentScore:
    """Score and contribution details for one analytics module."""
    finding_type: str
    weight: float                  # 0.0 - 1.0
    raw_module_score: float        # 0-100 before weighting
    weighted_contribution: float   # raw_module_score * weight  (0-30 for EG, etc.)
    finding_count: int
    top_severity: str
    finding_summaries: list[dict]  # lightweight finding references


@dataclass
class EntityRiskResult:
    """Complete risk result for one entity, ready for Phase 5 API consumption."""
    entity_id: str
    entity_name: str
    sector: str
    risk_score: float                           # 0-100 normalised
    risk_level: str                             # LOW/MEDIUM/HIGH/CRITICAL
    component_scores: dict[str, ComponentScore] # keyed by finding_type
    findings: list[dict]                        # all Finding.to_dict() for this entity
    explanation: dict[str, Any]                 # structured explainability block
    primary_drivers: list[dict] = field(default_factory=list)
    component_weighted_contributions: dict[str, float] = field(default_factory=dict)
    component_raw_scores: dict[str, float] = field(default_factory=dict)

    @property
    def final_risk_score(self) -> float:
        return self.risk_score

    def to_dict(self) -> dict:
        return {
            "entity_id": self.entity_id,
            "entity_name": self.entity_name,
            "sector": self.sector,
            "risk_score": round(self.risk_score, 2),
            "final_risk_score": round(self.risk_score, 2),
            "risk_level": self.risk_level,
            "primary_drivers": self.primary_drivers,
            "component_scores": {
                ft: {
                    "finding_type": cs.finding_type,
                    "weight": cs.weight,
                    "weight_pct": f"{cs.weight*100:.0f}%",
                    "raw_module_score": round(cs.raw_module_score, 2),
                    "weighted_contribution": round(cs.weighted_contribution, 2),
                    "finding_count": cs.finding_count,
                    "top_severity": cs.top_severity,
                    "finding_summaries": cs.finding_summaries,
                }
                for ft, cs in self.component_scores.items()
            },
            "component_weighted_contributions": self.component_weighted_contributions,
            "component_raw_scores": self.component_raw_scores,
            "findings": self.findings,
            "explanation": self.explanation,
        }


# ── Core scoring logic ──────────────────────────────────────────────────────

def _module_score_from_findings(findings: list[Finding], finding_type: str) -> float:
    """
    Compute a 0-100 module sub-score from a list of findings of one type.

    Algorithm:
      1. Map each finding's severity to points.
      2. Blend: 60% max-severity anchor + 40% average-severity.
      3. Scale by density factor: density = min(count, cap) / cap.
      4. Result is strictly bounded to 0-100.

    Deterministic: sorted by finding_id before any processing.
    """
    if not findings:
        return 0.0

    cap = MAX_FINDINGS_FOR_CAP.get(finding_type, 3)
    sorted_findings = sorted(findings, key=lambda f: f.finding_id)

    severity_vals = [SEVERITY_POINTS[f.severity] for f in sorted_findings]
    avg_severity = sum(severity_vals) / len(severity_vals)
    max_severity = max(severity_vals)

    blended_severity = 0.60 * max_severity + 0.40 * avg_severity
    density = min(len(sorted_findings), cap) / cap

    score = blended_severity * (0.55 + 0.45 * density)
    return min(max(score, 0.0), 100.0)


def _build_finding_summary(f: Finding) -> dict:
    """Lightweight reference to a finding for embedding in component_scores."""
    return {
        "finding_id": f.finding_id,
        "title": f.title,
        "severity": f.severity,
        "evidence_count": len(f.evidence_ids),
    }


def _build_explanation(
    entity_id: str,
    entity_name: str,
    risk_score: float,
    risk_level: str,
    component_scores: dict[str, ComponentScore],
    findings_by_type: dict[str, list[Finding]],
    primary_drivers: list[dict],
) -> dict:
    """
    Build a structured, fully traceable explanation block.

    Includes explicit per-component objects:
      {
        "execution_gap": { "raw_score": ..., "weight": 0.30, "contribution": ... },
        "negative_space": { "raw_score": ..., "weight": 0.25, "contribution": ... },
        ...
      }
    along with module_breakdown and plain-English summary.
    """
    explanation_blocks: list[dict] = []

    SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    TYPE_LABELS = {
        "EXECUTION_GAP":     "Execution Gap",
        "NEGATIVE_SPACE":    "Negative Space",
        "ANOMALY":           "Statistical Anomaly",
        "PEER_DEVIATION":    "Peer Comparison Deviation",
        "REPEATED_INCIDENT": "Repeated Incident",
    }

    for finding_type, cs in sorted(
        component_scores.items(),
        key=lambda kv: kv[1].weighted_contribution,
        reverse=True,
    ):
        type_findings = findings_by_type.get(finding_type, [])
        if not type_findings:
            continue

        sorted_findings = sorted(
            type_findings,
            key=lambda f: (SEVERITY_ORDER.get(f.severity, 9), f.finding_id),
        )

        finding_details = []
        for f in sorted_findings:
            detail: dict[str, Any] = {
                "finding_id": f.finding_id,
                "severity": f.severity,
                "title": f.title,
                "what": f.title,
                "why": f.rationale,
                "evidence_ids": f.evidence_ids[:10],
                "evidence_count": len(f.evidence_ids),
                "key_metrics": {},
            }

            m = f.supporting_metrics
            ft = f.finding_type

            if ft == "EXECUTION_GAP":
                if "quick_closure_ratio" in m:
                    detail["key_metrics"] = {
                        "quick_closure_pct": f"{m['quick_closure_ratio']*100:.1f}%",
                        "entity_avg_duration_minutes": m.get("entity_avg_duration_minutes"),
                        "peer_median_duration_minutes": m.get("peer_median_duration_minutes"),
                        "quick_closure_count": m.get("quick_closure_count"),
                        "total_critical_closed": m.get("total_critical_closed"),
                    }
                elif "no_escalation_ratio" in m:
                    detail["key_metrics"] = {
                        "no_escalation_pct": f"{m['no_escalation_ratio']*100:.1f}%",
                        "no_escalation_count": m.get("no_escalation_count"),
                        "total_critical_closed": m.get("total_critical_closed"),
                    }
                elif "short_duration_ratio" in m:
                    detail["key_metrics"] = {
                        "short_duration_pct": f"{m['short_duration_ratio']*100:.1f}%",
                        "short_duration_count": m.get("short_duration_count"),
                        "total_closed_cases": m.get("total_closed_cases"),
                        "threshold_minutes": m.get("threshold_minutes"),
                    }
                elif "unremediated_ratio" in m:
                    detail["key_metrics"] = {
                        "unremediated_pct": f"{m['unremediated_ratio']*100:.1f}%",
                        "unremediated_count": m.get("unremediated_count"),
                        "total_cases_in_cluster": m.get("total_cases_in_cluster"),
                    }

            elif ft == "NEGATIVE_SPACE":
                if "stale_days" in m:
                    detail["key_metrics"] = {
                        "asset_id": m.get("asset_id"),
                        "asset_criticality": m.get("criticality"),
                        "last_telemetry": m.get("last_telemetry"),
                        "stale_days": m.get("stale_days"),
                        "threshold_days": m.get("threshold_days"),
                    }
                elif "missing_investigation_ratio" in m:
                    detail["key_metrics"] = {
                        "uninvestigated_pct": f"{m['missing_investigation_ratio']*100:.1f}%",
                        "uninvestigated_count": m.get("uninvestigated_count"),
                        "total_high_critical_alerts": m.get("total_high_critical_alerts"),
                    }
                elif "activity_ratio_vs_peer" in m:
                    detail["key_metrics"] = {
                        "entity_alert_count": m.get("entity_alert_count"),
                        "peer_mean_alert_count": m.get("peer_mean_alert_count"),
                        "activity_ratio_vs_peer": f"{m['activity_ratio_vs_peer']*100:.1f}%",
                    }

            elif ft == "ANOMALY":
                detail["key_metrics"] = {
                    "anomaly_score": m.get("anomaly_score_normalised"),
                    "top_deviating_features": {
                        k: {
                            "entity_value": round(m["feature_values"][k], 4),
                            "peer_mean": round(m["peer_means"][k], 4),
                            "deviation": round(m["feature_deviations"][k], 4),
                        }
                        for k in sorted(
                            m.get("feature_deviations", {}),
                            key=lambda k_: abs(m["feature_deviations"].get(k_, 0)),
                            reverse=True,
                        )[:4]
                    },
                }

            elif ft == "PEER_DEVIATION":
                if "entity_escalation_rate" in m:
                    detail["key_metrics"] = {
                        "entity_escalation_rate_pct": f"{m['entity_escalation_rate']*100:.1f}%",
                        "peer_median_escalation_pct": f"{m['peer_median_escalation_rate']*100:.1f}%",
                        "deviation_pp": f"{m['deviation_pp']*100:.1f}pp",
                    }
                elif "entity_avg_duration_minutes" in m:
                    detail["key_metrics"] = {
                        "entity_avg_duration_minutes": m.get("entity_avg_duration_minutes"),
                        "peer_median_duration_minutes": m.get("peer_median_duration_minutes"),
                        "duration_ratio_pct": f"{m.get('duration_ratio_vs_peer', 0)*100:.1f}%",
                    }
                elif "entity_telemetry_coverage" in m:
                    detail["key_metrics"] = {
                        "entity_coverage_pct": f"{m['entity_telemetry_coverage']*100:.1f}%",
                        "peer_median_coverage_pct": f"{m['peer_median_telemetry_coverage']*100:.1f}%",
                        "deviation_pp": f"{m['deviation_pp']*100:.1f}pp",
                    }
                elif "entity_critical_alert_ratio" in m:
                    detail["key_metrics"] = {
                        "entity_critical_ratio_pct": f"{m['entity_critical_alert_ratio']*100:.1f}%",
                        "peer_median_critical_pct": f"{m['peer_median_critical_ratio']*100:.1f}%",
                        "deviation_pp": f"{m['deviation_pp']*100:.1f}pp",
                    }

            elif ft == "REPEATED_INCIDENT":
                detail["key_metrics"] = {
                    "asset_id": m.get("asset_id"),
                    "asset_type": m.get("asset_type"),
                    "asset_criticality": m.get("asset_criticality"),
                    "category": m.get("category"),
                    "alert_count": m.get("alert_count"),
                    "unremediated_pct": f"{m.get('unremediated_ratio', 0)*100:.1f}%",
                    "first_seen": m.get("first_seen"),
                    "last_seen": m.get("last_seen"),
                }

            finding_details.append(detail)

        explanation_blocks.append({
            "module": TYPE_LABELS.get(finding_type, finding_type),
            "finding_type": finding_type,
            "weight_pct": f"{WEIGHTS[finding_type]*100:.0f}%",
            "raw_module_score": round(cs.raw_module_score, 2),
            "weighted_contribution": round(cs.weighted_contribution, 2),
            "finding_count": cs.finding_count,
            "top_severity": cs.top_severity,
            "findings": finding_details,
        })

    # Build canonical component calculation blocks
    calc_components: dict[str, dict] = {}
    for ft, cs in component_scores.items():
        key = CANONICAL_KEYS.get(ft, ft.lower())
        calc_components[key] = {
            "raw_score": round(cs.raw_module_score, 2),
            "weight": cs.weight,
            "contribution": round(cs.weighted_contribution, 2),
        }

    # Provide alias for repeated_incident
    if "repeated_incidents" in calc_components:
        calc_components["repeated_incident"] = calc_components["repeated_incidents"]

    res = {
        "entity_id": entity_id,
        "entity_name": entity_name,
        "risk_score": round(risk_score, 2),
        "final_risk_score": round(risk_score, 2),
        "risk_level": risk_level,
        "score_formula": (
            "risk_score = "
            "0.30 * execution_gap + "
            "0.25 * negative_space + "
            "0.20 * anomaly + "
            "0.15 * peer_deviation + "
            "0.10 * repeated_incidents"
        ),
        "primary_drivers": primary_drivers,
        "components": calc_components,
        "module_breakdown": explanation_blocks,
        "summary": _generate_summary(risk_level, explanation_blocks),
    }

    # Merge individual component keys directly at top level for easy access: explanation["execution_gap"], etc.
    res.update(calc_components)
    return res


def _generate_summary(risk_level: str, blocks: list[dict]) -> str:
    """One-paragraph plain-English summary drawn from actual block data."""
    if not blocks:
        return "No supervisory findings detected for this entity."

    top_block = blocks[0]
    parts = [
        f"Overall risk level: {risk_level}.",
        f"The primary driver is {top_block['module']} "
        f"({top_block['weight_pct']} weight, "
        f"contributing {top_block['weighted_contribution']:.1f} points "
        f"from {top_block['finding_count']} finding(s) "
        f"with top severity {top_block['top_severity']}).",
    ]
    if len(blocks) > 1:
        others = [f"{b['module']} ({b['weighted_contribution']:.1f} pts)" for b in blocks[1:3]]
        parts.append(f"Additional contributors: {', '.join(others)}.")
    return " ".join(parts)


# ── Public API ──────────────────────────────────────────────────────────────

def score_entities(
    all_findings: list[Finding],
    entity_metadata: dict[str, dict],  # {entity_id: {entity_name, sector}}
) -> dict[str, EntityRiskResult]:
    """
    Given all findings and entity metadata, compute normalized component scores,
    weighted contributions, final risk score, and explainability for every entity.
    """
    FINDING_TYPES = list(WEIGHTS.keys())
    TYPE_LABELS = {
        "EXECUTION_GAP":     "Execution Gap",
        "NEGATIVE_SPACE":    "Negative Space",
        "ANOMALY":           "Anomaly",
        "PEER_DEVIATION":    "Peer Deviation",
        "REPEATED_INCIDENT": "Repeated Incidents",
    }

    by_entity_type: dict[str, dict[str, list[Finding]]] = {}
    all_entity_ids = set(entity_metadata.keys())

    for eid in all_entity_ids:
        by_entity_type[eid] = {ft: [] for ft in FINDING_TYPES}

    for f in all_findings:
        if f.entity_id in by_entity_type and f.finding_type in FINDING_TYPES:
            by_entity_type[f.entity_id][f.finding_type].append(f)

    results: dict[str, EntityRiskResult] = {}
    SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "": 9}

    for eid in sorted(all_entity_ids):
        type_findings = by_entity_type[eid]
        component_scores: dict[str, ComponentScore] = {}
        weighted_total = 0.0

        for ft in FINDING_TYPES:
            ft_findings = sorted(type_findings[ft], key=lambda f: f.finding_id)
            raw_score = _module_score_from_findings(ft_findings, ft)
            weight = WEIGHTS[ft]
            contribution = raw_score * weight

            top_sev = ""
            if ft_findings:
                top_sev = min(
                    (f.severity for f in ft_findings),
                    key=lambda s: SEVERITY_ORDER.get(s, 9),
                )

            component_scores[ft] = ComponentScore(
                finding_type=ft,
                weight=weight,
                raw_module_score=raw_score,
                weighted_contribution=contribution,
                finding_count=len(ft_findings),
                top_severity=top_sev,
                finding_summaries=[_build_finding_summary(f) for f in ft_findings],
            )
            weighted_total += contribution

        # Final score is the exact weighted sum of the 5 components bounded to 0-100
        risk_score = round(min(max(weighted_total, 0.0), 100.0), 2)
        risk_lvl = risk_level_from_score(risk_score)

        meta = entity_metadata.get(eid, {"entity_name": eid, "sector": "Unknown"})
        all_entity_findings = [
            f.to_dict()
            for ft_list in type_findings.values()
            for f in ft_list
        ]

        # Calculate primary drivers
        sorted_by_contrib = sorted(
            component_scores.items(),
            key=lambda kv: kv[1].weighted_contribution,
            reverse=True,
        )

        primary_drivers = [
            {
                "component": CANONICAL_KEYS.get(ft, ft.lower()),
                "name": TYPE_LABELS.get(ft, ft),
                "raw_score": round(cs.raw_module_score, 2),
                "weight": cs.weight,
                "weighted_contribution": round(cs.weighted_contribution, 2),
                "finding_count": cs.finding_count,
            }
            for ft, cs in sorted_by_contrib
            if cs.weighted_contribution > 0
        ]
        if not primary_drivers and sorted_by_contrib:
            top_ft, top_cs = sorted_by_contrib[0]
            primary_drivers = [
                {
                    "component": CANONICAL_KEYS.get(top_ft, top_ft.lower()),
                    "name": TYPE_LABELS.get(top_ft, top_ft),
                    "raw_score": 0.0,
                    "weight": top_cs.weight,
                    "weighted_contribution": 0.0,
                    "finding_count": 0,
                }
            ]

        component_weighted_contributions = {
            CANONICAL_KEYS.get(ft, ft.lower()): round(cs.weighted_contribution, 2)
            for ft, cs in component_scores.items()
        }
        component_raw_scores = {
            CANONICAL_KEYS.get(ft, ft.lower()): round(cs.raw_module_score, 2)
            for ft, cs in component_scores.items()
        }

        explanation = _build_explanation(
            entity_id=eid,
            entity_name=meta.get("entity_name", eid),
            risk_score=risk_score,
            risk_level=risk_lvl,
            component_scores=component_scores,
            findings_by_type=type_findings,
            primary_drivers=primary_drivers,
        )

        results[eid] = EntityRiskResult(
            entity_id=eid,
            entity_name=meta.get("entity_name", eid),
            sector=meta.get("sector", "Unknown"),
            risk_score=risk_score,
            risk_level=risk_lvl,
            component_scores=component_scores,
            findings=all_entity_findings,
            explanation=explanation,
            primary_drivers=primary_drivers,
            component_weighted_contributions=component_weighted_contributions,
            component_raw_scores=component_raw_scores,
        )

    return results


def score_entities_from_pipeline(pipeline_result: dict, db_path: str) -> dict[str, dict]:
    """
    Convenience wrapper: takes the dict returned by pipeline.run_pipeline()
    and db_path (to fetch entity metadata), returns dict of entity_id -> dict.
    """
    import sqlite3

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT entity_id, entity_name, sector FROM entities")
    entity_metadata: dict[str, dict] = {
        row["entity_id"]: {
            "entity_name": row["entity_name"],
            "sector": row["sector"],
        }
        for row in cur.fetchall()
    }
    conn.close()

    findings: list[Finding] = []
    for fd in pipeline_result.get("all_findings", []):
        findings.append(Finding(
            finding_id=fd["finding_id"],
            entity_id=fd["entity_id"],
            finding_type=fd["finding_type"],
            severity=fd["severity"],
            title=fd["title"],
            rationale=fd["rationale"],
            evidence_ids=fd["evidence_ids"],
            supporting_metrics=fd["supporting_metrics"],
        ))

    scored = score_entities(findings, entity_metadata)
    return {eid: result.to_dict() for eid, result in scored.items()}
