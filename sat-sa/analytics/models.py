"""
models.py — Shared data models for SAT-SA analytics findings.

Every finding must contain:
  finding_id, entity_id, finding_type, severity,
  title, rationale, evidence_ids, supporting_metrics
"""
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Finding:
    finding_id: str
    entity_id: str
    finding_type: str          # e.g. EXECUTION_GAP, NEGATIVE_SPACE, ANOMALY, PEER_DEVIATION, REPEATED_INCIDENT
    severity: str              # CRITICAL, HIGH, MEDIUM, LOW
    title: str
    rationale: str
    evidence_ids: list[str]    # alert_id / case_id / asset_id references
    supporting_metrics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "finding_id": self.finding_id,
            "entity_id": self.entity_id,
            "finding_type": self.finding_type,
            "severity": self.severity,
            "title": self.title,
            "rationale": self.rationale,
            "evidence_ids": self.evidence_ids,
            "supporting_metrics": self.supporting_metrics,
        }
