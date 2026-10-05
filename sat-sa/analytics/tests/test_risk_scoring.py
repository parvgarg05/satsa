"""
tests/test_risk_scoring.py -- Phase 4 tests for risk scoring & explainability.

Run with:
    pytest tests/test_risk_scoring.py -v
"""
import os
import sys
import sqlite3
import tempfile

import pytest

# Allow importing sibling analytics modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import Finding
from risk_scoring import (
    WEIGHTS,
    SEVERITY_POINTS,
    risk_level_from_score,
    _module_score_from_findings,
    score_entities,
    score_entities_from_pipeline,
    EntityRiskResult,
    ComponentScore,
)
from pipeline import run_pipeline


# ── Fixtures ────────────────────────────────────────────────────────────────

DB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../backend/sat_sa.db")
)


@pytest.fixture(scope="session")
def live_db():
    assert os.path.exists(DB_PATH), f"DB not found: {DB_PATH}"
    return DB_PATH


@pytest.fixture(scope="session")
def pipeline_result(live_db):
    """Run full pipeline once; share across session for speed."""
    return run_pipeline(live_db)


def _make_finding(finding_type: str, severity: str, idx: int = 0) -> Finding:
    return Finding(
        finding_id=f"{finding_type}-TEST-{idx:03d}",
        entity_id="TEST-ENT",
        finding_type=finding_type,
        severity=severity,
        title=f"Test {finding_type} {severity}",
        rationale="Test rationale",
        evidence_ids=[f"ALT-TEST-{idx:03d}"],
        supporting_metrics={"test_key": idx},
    )


ENTITY_META = {
    "TEST-ENT": {"entity_name": "Test Entity", "sector": "Test"},
    "SAFE-ENT": {"entity_name": "Safe Entity", "sector": "Test"},
}


# ════════════════════════════════════════════════════════════════════════════
# Weights & Configuration
# ════════════════════════════════════════════════════════════════════════════

class TestWeightsConfig:
    def test_weights_sum_to_one(self):
        """Spec mandates: 30+25+20+15+10 = 100% = 1.0"""
        total = sum(WEIGHTS.values())
        assert abs(total - 1.0) < 1e-9, f"Weights sum to {total}, expected 1.0"

    def test_all_five_modules_covered(self):
        required = {"EXECUTION_GAP", "NEGATIVE_SPACE", "ANOMALY", "PEER_DEVIATION", "REPEATED_INCIDENT"}
        assert set(WEIGHTS.keys()) == required

    def test_individual_weights(self):
        assert abs(WEIGHTS["EXECUTION_GAP"]     - 0.30) < 1e-9
        assert abs(WEIGHTS["NEGATIVE_SPACE"]    - 0.25) < 1e-9
        assert abs(WEIGHTS["ANOMALY"]           - 0.20) < 1e-9
        assert abs(WEIGHTS["PEER_DEVIATION"]    - 0.15) < 1e-9
        assert abs(WEIGHTS["REPEATED_INCIDENT"] - 0.10) < 1e-9

    def test_severity_points_coverage(self):
        for sev in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
            assert sev in SEVERITY_POINTS
            assert 0 < SEVERITY_POINTS[sev] <= 100

    def test_severity_ordering(self):
        """CRITICAL > HIGH > MEDIUM > LOW"""
        assert SEVERITY_POINTS["CRITICAL"] > SEVERITY_POINTS["HIGH"]
        assert SEVERITY_POINTS["HIGH"]     > SEVERITY_POINTS["MEDIUM"]
        assert SEVERITY_POINTS["MEDIUM"]   > SEVERITY_POINTS["LOW"]


# ════════════════════════════════════════════════════════════════════════════
# Risk Level Boundaries
# ════════════════════════════════════════════════════════════════════════════

class TestRiskLevelBoundaries:
    @pytest.mark.parametrize("score,expected", [
        (0,    "LOW"),
        (1,    "LOW"),
        (29,   "LOW"),
        (29.9, "LOW"),
        (30,   "MEDIUM"),
        (45,   "MEDIUM"),
        (59,   "MEDIUM"),
        (59.9, "MEDIUM"),
        (60,   "HIGH"),
        (70,   "HIGH"),
        (79,   "HIGH"),
        (79.9, "HIGH"),
        (80,   "CRITICAL"),
        (95,   "CRITICAL"),
        (100,  "CRITICAL"),
    ])
    def test_risk_level_thresholds(self, score, expected):
        assert risk_level_from_score(score) == expected, (
            f"score={score} expected {expected}, got {risk_level_from_score(score)}"
        )

    def test_boundary_at_30(self):
        assert risk_level_from_score(29.99) == "LOW"
        assert risk_level_from_score(30.00) == "MEDIUM"

    def test_boundary_at_60(self):
        assert risk_level_from_score(59.99) == "MEDIUM"
        assert risk_level_from_score(60.00) == "HIGH"

    def test_boundary_at_80(self):
        assert risk_level_from_score(79.99) == "HIGH"
        assert risk_level_from_score(80.00) == "CRITICAL"


# ════════════════════════════════════════════════════════════════════════════
# Module Score Calculation
# ════════════════════════════════════════════════════════════════════════════

class TestModuleScoreCalculation:
    def test_empty_findings_returns_zero(self):
        assert _module_score_from_findings([], "EXECUTION_GAP") == 0.0

    def test_single_critical_finding_high_score(self):
        f = _make_finding("EXECUTION_GAP", "CRITICAL")
        score = _module_score_from_findings([f], "EXECUTION_GAP")
        assert score > 50, f"Single CRITICAL should score >50, got {score}"

    def test_single_low_finding_low_score(self):
        f = _make_finding("EXECUTION_GAP", "LOW")
        score = _module_score_from_findings([f], "EXECUTION_GAP")
        assert score < 50, f"Single LOW should score <50, got {score}"

    def test_critical_higher_than_medium(self):
        fc = _make_finding("EXECUTION_GAP", "CRITICAL")
        fm = _make_finding("EXECUTION_GAP", "MEDIUM")
        assert _module_score_from_findings([fc], "EXECUTION_GAP") > \
               _module_score_from_findings([fm], "EXECUTION_GAP")

    def test_more_findings_same_severity_higher_score(self):
        """More findings of same severity -> higher score (up to cap)."""
        f1 = [_make_finding("REPEATED_INCIDENT", "HIGH", i) for i in range(1)]
        f3 = [_make_finding("REPEATED_INCIDENT", "HIGH", i) for i in range(3)]
        assert _module_score_from_findings(f3, "REPEATED_INCIDENT") >= \
               _module_score_from_findings(f1, "REPEATED_INCIDENT")

    def test_score_bounded_zero_to_100(self):
        # Even with many CRITICAL findings, score should not exceed 100
        findings = [_make_finding("EXECUTION_GAP", "CRITICAL", i) for i in range(20)]
        score = _module_score_from_findings(findings, "EXECUTION_GAP")
        assert 0.0 <= score <= 100.0

    def test_deterministic_same_input(self):
        """Same findings list produces the same score every call."""
        findings = [_make_finding("EXECUTION_GAP", "HIGH", i) for i in range(3)]
        s1 = _module_score_from_findings(findings, "EXECUTION_GAP")
        s2 = _module_score_from_findings(findings, "EXECUTION_GAP")
        assert s1 == s2

    def test_order_invariant(self):
        """Score does not depend on list order — deterministic sort used internally."""
        findings = [
            _make_finding("NEGATIVE_SPACE", "CRITICAL", 0),
            _make_finding("NEGATIVE_SPACE", "MEDIUM", 1),
            _make_finding("NEGATIVE_SPACE", "HIGH", 2),
        ]
        s_fwd  = _module_score_from_findings(findings, "NEGATIVE_SPACE")
        s_rev  = _module_score_from_findings(list(reversed(findings)), "NEGATIVE_SPACE")
        assert abs(s_fwd - s_rev) < 1e-9


# ════════════════════════════════════════════════════════════════════════════
# Score Entity Weighting & Normalization
# ════════════════════════════════════════════════════════════════════════════

class TestScoreEntityWeighting:
    def test_no_findings_returns_zero_score(self):
        result = score_entities([], ENTITY_META)
        assert result["TEST-ENT"].risk_score == 0.0
        assert result["TEST-ENT"].risk_level == "LOW"

    def test_output_contains_all_entities(self):
        result = score_entities([], ENTITY_META)
        assert set(result.keys()) == set(ENTITY_META.keys())

    def test_single_critical_execution_gap_boosts_score(self):
        f = _make_finding("EXECUTION_GAP", "CRITICAL")
        result = score_entities([f], {"TEST-ENT": ENTITY_META["TEST-ENT"],
                                      "SAFE-ENT": ENTITY_META["SAFE-ENT"]})
        # TEST-ENT should score higher than SAFE-ENT (no findings)
        assert result["TEST-ENT"].risk_score > result["SAFE-ENT"].risk_score

    def test_weighted_contribution_sums_to_risk_score(self):
        """Sum of all weighted_contribution values must equal risk_score."""
        findings = [
            _make_finding("EXECUTION_GAP",     "CRITICAL", 0),
            _make_finding("NEGATIVE_SPACE",     "HIGH",     1),
            _make_finding("ANOMALY",            "MEDIUM",   2),
            _make_finding("PEER_DEVIATION",     "LOW",      3),
            _make_finding("REPEATED_INCIDENT",  "HIGH",     4),
        ]
        # All findings belong to TEST-ENT
        meta = {"TEST-ENT": ENTITY_META["TEST-ENT"]}
        result = score_entities(findings, meta)
        entity = result["TEST-ENT"]

        total_contribution = sum(
            cs.weighted_contribution for cs in entity.component_scores.values()
        )
        assert abs(total_contribution - entity.risk_score) < 0.01, (
            f"Sum of contributions {total_contribution:.4f} != risk_score {entity.risk_score:.4f}"
        )

    def test_risk_score_bounded_0_to_100(self):
        findings = [_make_finding("EXECUTION_GAP", "CRITICAL", i) for i in range(100)]
        meta = {"TEST-ENT": ENTITY_META["TEST-ENT"]}
        result = score_entities(findings, meta)
        assert 0.0 <= result["TEST-ENT"].risk_score <= 100.0

    def test_more_severe_findings_give_higher_score(self):
        meta = {"TEST-ENT": ENTITY_META["TEST-ENT"]}
        crit_result = score_entities(
            [_make_finding("EXECUTION_GAP", "CRITICAL")], meta
        )
        low_result = score_entities(
            [_make_finding("EXECUTION_GAP", "LOW")], meta
        )
        assert crit_result["TEST-ENT"].risk_score > low_result["TEST-ENT"].risk_score


# ════════════════════════════════════════════════════════════════════════════
# Deterministic Scoring
# ════════════════════════════════════════════════════════════════════════════

class TestDeterministicScoring:
    def test_same_findings_same_score(self, live_db, pipeline_result):
        """Run pipeline twice; entity_risk must be identical."""
        result2 = run_pipeline(live_db)
        er1 = pipeline_result["entity_risk"]
        er2 = result2["entity_risk"]
        for eid in er1:
            assert er1[eid]["risk_score"] == er2[eid]["risk_score"], (
                f"{eid} risk_score changed between runs"
            )
            assert er1[eid]["risk_level"] == er2[eid]["risk_level"], (
                f"{eid} risk_level changed between runs"
            )

    def test_component_scores_deterministic(self, live_db, pipeline_result):
        result2 = run_pipeline(live_db)
        for eid in pipeline_result["entity_risk"]:
            cs1 = pipeline_result["entity_risk"][eid]["component_scores"]
            cs2 = result2["entity_risk"][eid]["component_scores"]
            for ft in cs1:
                assert cs1[ft]["weighted_contribution"] == cs2[ft]["weighted_contribution"]


# ════════════════════════════════════════════════════════════════════════════
# CSE-007 Specific Tests
# ════════════════════════════════════════════════════════════════════════════

class TestCSE007Risk:
    def test_cse007_is_highest_risk_entity(self, pipeline_result):
        risk_scores = {
            eid: er["risk_score"]
            for eid, er in pipeline_result["entity_risk"].items()
        }
        max_eid = max(risk_scores, key=risk_scores.get)
        assert max_eid == "CSE-007", (
            f"Expected CSE-007 to have highest score, but {max_eid} scored "
            f"{risk_scores[max_eid]:.2f} vs CSE-007's {risk_scores['CSE-007']:.2f}"
        )

    def test_cse007_score_is_high_or_critical(self, pipeline_result):
        cse007 = pipeline_result["entity_risk"]["CSE-007"]
        assert cse007["risk_level"] in ("HIGH", "CRITICAL"), (
            f"CSE-007 risk_level should be HIGH or CRITICAL, got {cse007['risk_level']}"
        )
        assert cse007["risk_score"] >= 60, (
            f"CSE-007 risk_score should be >= 60, got {cse007['risk_score']}"
        )

    def test_cse007_score_not_hardcoded(self, pipeline_result):
        """Verify CSE-007's score is computed from findings, not a constant."""
        cse007_er = pipeline_result["entity_risk"]["CSE-007"]
        # The score must equal the sum of weighted contributions
        total_contrib = sum(
            cs["weighted_contribution"]
            for cs in cse007_er["component_scores"].values()
        )
        assert abs(total_contrib - cse007_er["risk_score"]) < 0.05, (
            "CSE-007 score does not match sum of component contributions — may be hardcoded"
        )

    def test_cse007_has_all_five_component_types(self, pipeline_result):
        cse007_er = pipeline_result["entity_risk"]["CSE-007"]
        cs = cse007_er["component_scores"]
        for ft in ("EXECUTION_GAP", "NEGATIVE_SPACE", "ANOMALY", "PEER_DEVIATION", "REPEATED_INCIDENT"):
            assert ft in cs, f"CSE-007 missing component: {ft}"

    def test_cse007_execution_gap_contribution_is_dominant(self, pipeline_result):
        cse007_er = pipeline_result["entity_risk"]["CSE-007"]
        eg_contrib = cse007_er["component_scores"]["EXECUTION_GAP"]["weighted_contribution"]
        # EG has 30% weight and CRITICAL findings -> should be the largest contributor
        all_contribs = [
            cs["weighted_contribution"]
            for cs in cse007_er["component_scores"].values()
        ]
        assert eg_contrib == max(all_contribs), (
            "EXECUTION_GAP should be the largest contributor to CSE-007's score"
        )

    def test_cse007_leads_next_entity_by_significant_margin(self, pipeline_result):
        scores = sorted(
            pipeline_result["entity_risk"].values(),
            key=lambda e: e["risk_score"],
            reverse=True,
        )
        cse007_score = scores[0]["risk_score"]
        second_score = scores[1]["risk_score"]
        assert scores[0]["entity_id"] == "CSE-007"
        assert cse007_score >= second_score * 1.5, (
            f"CSE-007 ({cse007_score:.1f}) should lead second place ({second_score:.1f}) "
            "by at least 50% to demonstrate meaningful separation"
        )


# ════════════════════════════════════════════════════════════════════════════
# Output Structure
# ════════════════════════════════════════════════════════════════════════════

class TestOutputStructure:
    def test_entity_risk_output_schema(self, pipeline_result):
        required = {
            "entity_id", "entity_name", "sector", "risk_score", "risk_level",
            "component_scores", "findings", "explanation",
        }
        for eid, er in pipeline_result["entity_risk"].items():
            missing = required - set(er.keys())
            assert not missing, f"{eid} missing fields: {missing}"

    def test_component_scores_schema(self, pipeline_result):
        cs_required = {
            "finding_type", "weight", "weight_pct", "raw_module_score",
            "weighted_contribution", "finding_count", "top_severity", "finding_summaries"
        }
        for eid, er in pipeline_result["entity_risk"].items():
            for ft, cs in er["component_scores"].items():
                missing = cs_required - set(cs.keys())
                assert not missing, f"{eid}/{ft} component missing: {missing}"

    def test_explanation_schema(self, pipeline_result):
        exp_required = {
            "entity_id", "entity_name", "risk_score", "risk_level",
            "score_formula", "module_breakdown", "summary"
        }
        for eid, er in pipeline_result["entity_risk"].items():
            exp = er["explanation"]
            missing = exp_required - set(exp.keys())
            assert not missing, f"{eid} explanation missing: {missing}"

    def test_explanation_entity_id_matches(self, pipeline_result):
        for eid, er in pipeline_result["entity_risk"].items():
            assert er["explanation"]["entity_id"] == eid

    def test_explanation_risk_score_matches(self, pipeline_result):
        for eid, er in pipeline_result["entity_risk"].items():
            assert er["explanation"]["risk_score"] == er["risk_score"], (
                f"{eid}: explanation.risk_score != risk_score"
            )

    def test_explanation_risk_level_matches(self, pipeline_result):
        for eid, er in pipeline_result["entity_risk"].items():
            assert er["explanation"]["risk_level"] == er["risk_level"]

    def test_score_formula_present(self, pipeline_result):
        for eid, er in pipeline_result["entity_risk"].items():
            formula = er["explanation"]["score_formula"]
            assert "0.30" in formula and "0.25" in formula, (
                f"{eid}: score_formula should mention 0.30 and 0.25 weights"
            )

    def test_module_breakdown_has_finding_details(self, pipeline_result):
        """Any entity with findings should have non-empty module_breakdown."""
        for eid, er in pipeline_result["entity_risk"].items():
            if er["findings"]:
                assert len(er["explanation"]["module_breakdown"]) > 0, (
                    f"{eid} has findings but empty module_breakdown"
                )

    def test_no_hardcoded_values_in_component_weights(self, pipeline_result):
        """All weight_pct values in output should match WEIGHTS constants."""
        for eid, er in pipeline_result["entity_risk"].items():
            for ft, cs in er["component_scores"].items():
                expected_pct = f"{WEIGHTS[ft]*100:.0f}%"
                assert cs["weight_pct"] == expected_pct, (
                    f"{eid}/{ft}: weight_pct {cs['weight_pct']} != {expected_pct}"
                )

    def test_no_risk_fields_in_raw_findings(self, pipeline_result):
        """Phase 3 findings must remain clean — no risk_ fields added."""
        for f in pipeline_result["all_findings"]:
            assert "risk_score" not in f
            assert "risk_level" not in f
            assert "risk_contribution" not in f


# ════════════════════════════════════════════════════════════════════════════
# Explainability / Evidence Traceability
# ════════════════════════════════════════════════════════════════════════════

class TestExplainability:
    def test_cse007_explanation_mentions_quick_closure(self, pipeline_result):
        """The explanation for CSE-007 must surface the quick-closure metric."""
        cse007_er = pipeline_result["entity_risk"]["CSE-007"]
        breakdown = cse007_er["explanation"]["module_breakdown"]
        eg_block = next((b for b in breakdown if b["finding_type"] == "EXECUTION_GAP"), None)
        assert eg_block is not None
        # At least one finding detail must have quick_closure_pct in key_metrics
        has_closure = any(
            "quick_closure_pct" in fd.get("key_metrics", {})
            for fd in eg_block["findings"]
        )
        assert has_closure, "CSE-007 explanation must surface quick_closure_pct metric"

    def test_cse007_explanation_stale_telemetry_assets(self, pipeline_result):
        """NS block for CSE-007 must reference stale asset IDs."""
        cse007_er = pipeline_result["entity_risk"]["CSE-007"]
        breakdown = cse007_er["explanation"]["module_breakdown"]
        ns_block = next((b for b in breakdown if b["finding_type"] == "NEGATIVE_SPACE"), None)
        assert ns_block is not None
        all_evidence = []
        for fd in ns_block["findings"]:
            all_evidence.extend(fd.get("evidence_ids", []))
        stale_assets = {"AST-007-01", "AST-007-02", "AST-007-03", "AST-007-04"}
        assert stale_assets.issubset(set(all_evidence)), (
            f"Stale assets not all in NS evidence: {stale_assets - set(all_evidence)}"
        )

    def test_cse007_anomaly_score_in_explanation(self, pipeline_result):
        """ANOMALY block must include the actual anomaly_score value."""
        cse007_er = pipeline_result["entity_risk"]["CSE-007"]
        breakdown = cse007_er["explanation"]["module_breakdown"]
        an_block = next((b for b in breakdown if b["finding_type"] == "ANOMALY"), None)
        assert an_block is not None
        has_score = any(
            "anomaly_score" in fd.get("key_metrics", {})
            for fd in an_block["findings"]
        )
        assert has_score, "ANOMALY block must include anomaly_score key metric"

    def test_evidence_ids_not_invented(self, pipeline_result):
        """Every evidence_id in explanation findings must exist in all_findings."""
        # Build set of all real evidence ids from Phase 3 findings
        all_evidence_ids: set[str] = set()
        for f in pipeline_result["all_findings"]:
            all_evidence_ids.update(f["evidence_ids"])

        # Traverse explanation finding details for entities that have findings
        for eid, er in pipeline_result["entity_risk"].items():
            for block in er["explanation"]["module_breakdown"]:
                for fd in block["findings"]:
                    for ev_id in fd.get("evidence_ids", []):
                        assert ev_id in all_evidence_ids, (
                            f"{eid}: evidence_id '{ev_id}' in explanation not in raw findings"
                        )

    def test_summary_is_non_empty_for_entities_with_findings(self, pipeline_result):
        for eid, er in pipeline_result["entity_risk"].items():
            if er["findings"]:
                assert er["explanation"]["summary"], f"{eid}: empty summary despite having findings"

    def test_cse007_summary_mentions_risk_level(self, pipeline_result):
        cse007_er = pipeline_result["entity_risk"]["CSE-007"]
        summary = cse007_er["explanation"]["summary"]
        risk_level = cse007_er["risk_level"]
        assert risk_level in summary, (
            f"Summary for CSE-007 must mention its risk level '{risk_level}': {summary}"
        )


# ════════════════════════════════════════════════════════════════════════════
# Phase 5: Deterministic Explainable Risk Scoring Verification
# ════════════════════════════════════════════════════════════════════════════

class TestPhase5RiskScoring:
    def test_weighted_formula_exact_calculation(self):
        """
        Verify exact formula:
        0.30 * execution_gap + 0.25 * negative_space + 0.20 * anomaly
        + 0.15 * peer_deviation + 0.10 * repeated_incidents
        """
        findings = [
            _make_finding("EXECUTION_GAP", "CRITICAL", 0),
            _make_finding("NEGATIVE_SPACE", "HIGH", 1),
            _make_finding("ANOMALY", "MEDIUM", 2),
            _make_finding("PEER_DEVIATION", "LOW", 3),
            _make_finding("REPEATED_INCIDENT", "CRITICAL", 4),
        ]
        meta = {"TEST-ENT": {"entity_name": "Test Co", "sector": "Power"}}
        scored = score_entities(findings, meta)
        ent = scored["TEST-ENT"]

        eg_score = ent.component_scores["EXECUTION_GAP"].raw_module_score
        ns_score = ent.component_scores["NEGATIVE_SPACE"].raw_module_score
        an_score = ent.component_scores["ANOMALY"].raw_module_score
        pc_score = ent.component_scores["PEER_DEVIATION"].raw_module_score
        ri_score = ent.component_scores["REPEATED_INCIDENT"].raw_module_score

        for score in (eg_score, ns_score, an_score, pc_score, ri_score):
            assert 0.0 <= score <= 100.0, f"Component score {score} outside [0, 100]"

        expected_final = round(
            0.30 * eg_score +
            0.25 * ns_score +
            0.20 * an_score +
            0.15 * pc_score +
            0.10 * ri_score,
            2
        )
        assert abs(ent.risk_score - expected_final) < 0.01, (
            f"Calculated risk_score {ent.risk_score} != expected {expected_final}"
        )
        assert ent.final_risk_score == ent.risk_score

    def test_explanation_object_structure(self, pipeline_result):
        """
        Spec mandates explanation object such as:
        {
          "execution_gap": { "raw_score": ..., "weight": 0.30, "contribution": ... }
        }
        """
        for eid, er in pipeline_result["entity_risk"].items():
            exp = er["explanation"]
            for comp_key, expected_weight in [
                ("execution_gap", 0.30),
                ("negative_space", 0.25),
                ("anomaly", 0.20),
                ("peer_deviation", 0.15),
                ("repeated_incidents", 0.10),
            ]:
                assert comp_key in exp, f"{eid} explanation missing {comp_key}"
                comp_obj = exp[comp_key]
                assert "raw_score" in comp_obj
                assert "weight" in comp_obj
                assert "contribution" in comp_obj
                assert abs(comp_obj["weight"] - expected_weight) < 1e-6
                expected_contrib = round(comp_obj["raw_score"] * expected_weight, 2)
                assert abs(comp_obj["contribution"] - expected_contrib) < 0.05

    def test_stored_entity_fields(self, pipeline_result):
        """
        For every entity store:
        entity_id, component scores, component weighted contributions,
        final risk score, risk level, primary drivers.
        """
        for eid, er in pipeline_result["entity_risk"].items():
            assert er["entity_id"] == eid
            assert "component_scores" in er
            assert "component_weighted_contributions" in er
            assert "final_risk_score" in er
            assert "risk_level" in er
            assert "primary_drivers" in er
            assert isinstance(er["primary_drivers"], list)
            assert len(er["primary_drivers"]) > 0

    def test_risk_tiers_exhaustive(self):
        """
        Risk tiers:
        0–29 LOW
        30–59 MEDIUM
        60–79 HIGH
        80–100 CRITICAL
        """
        assert risk_level_from_score(0.0) == "LOW"
        assert risk_level_from_score(15.5) == "LOW"
        assert risk_level_from_score(29.0) == "LOW"
        assert risk_level_from_score(29.99) == "LOW"
        assert risk_level_from_score(30.0) == "MEDIUM"
        assert risk_level_from_score(45.0) == "MEDIUM"
        assert risk_level_from_score(59.99) == "MEDIUM"
        assert risk_level_from_score(60.0) == "HIGH"
        assert risk_level_from_score(70.0) == "HIGH"
        assert risk_level_from_score(79.99) == "HIGH"
        assert risk_level_from_score(80.0) == "CRITICAL"
        assert risk_level_from_score(90.5) == "CRITICAL"
        assert risk_level_from_score(100.0) == "CRITICAL"

    def test_primary_drivers_ordering(self, pipeline_result):
        """Primary drivers must be sorted by weighted contribution descending."""
        for eid, er in pipeline_result["entity_risk"].items():
            drivers = er["primary_drivers"]
            if len(drivers) > 1:
                for i in range(len(drivers) - 1):
                    assert drivers[i]["weighted_contribution"] >= drivers[i + 1]["weighted_contribution"]

