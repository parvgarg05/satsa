"""
pipeline.py -- SAT-SA Supervisory Analytics Pipeline

Orchestrates all five analytics modules against the SQLite database,
then applies Phase 4 risk scoring and explainability.

Usage:
    python pipeline.py [--db-path PATH] [--output-json PATH]
"""
import sys
import json
import sqlite3
import argparse
import time
from datetime import datetime, timezone

from models import Finding
from execution_gaps import detect_execution_gaps
from negative_space import detect_negative_space
from anomaly_detection import detect_anomalies, evaluate_entity_anomalies
from peer_analysis import detect_peer_deviations
from repeated_incidents import detect_repeated_incidents
from risk_scoring import score_entities, risk_level_from_score
from alert_prioritization import prioritize_alerts
from control_prioritization import prioritize_controls_processes


def _load_entity_metadata(db_path: str) -> dict[str, dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT entity_id, entity_name, sector FROM entities")
    meta = {
        row["entity_id"]: {"entity_name": row["entity_name"], "sector": row["sector"]}
        for row in cur.fetchall()
    }
    conn.close()
    return meta


def run_pipeline(db_path: str) -> dict:
    run_start = time.time()
    print(f"[pipeline] Starting analytics pipeline against: {db_path}")

    print("[pipeline]  Module A: Execution Gap Detection ...")
    eg_findings = detect_execution_gaps(db_path)
    print(f"             -> {len(eg_findings)} findings")

    print("[pipeline]  Module B: Negative Space Detection ...")
    ns_findings = detect_negative_space(db_path)
    print(f"             -> {len(ns_findings)} findings")

    print("[pipeline]  Module C: Anomaly Detection (Isolation Forest) ...")
    an_findings = detect_anomalies(db_path)
    print(f"             -> {len(an_findings)} findings")

    print("[pipeline]  Module D: Peer Comparison ...")
    pc_findings = detect_peer_deviations(db_path)
    print(f"             -> {len(pc_findings)} findings")

    print("[pipeline]  Module E: Repeated Incident Detection ...")
    ri_findings = detect_repeated_incidents(db_path)
    print(f"             -> {len(ri_findings)} findings")

    all_findings: list[Finding] = (
        eg_findings + ns_findings + an_findings + pc_findings + ri_findings
    )
    total = len(all_findings)
    print(f"[pipeline] Total findings: {total}")

    # Phase 4: Risk scoring
    print("[pipeline]  Phase 4: Risk Scoring & Explainability ...")
    entity_metadata = _load_entity_metadata(db_path)
    scored = score_entities(all_findings, entity_metadata)
    print(f"             -> {len(scored)} entities scored")

    # Organise raw findings by entity and type (for backward-compat consumers)
    by_entity: dict[str, list[dict]] = {}
    for f in all_findings:
        by_entity.setdefault(f.entity_id, []).append(f.to_dict())

    by_type: dict[str, list[dict]] = {}
    for f in all_findings:
        by_type.setdefault(f.finding_type, []).append(f.to_dict())

    elapsed = round(time.time() - run_start, 3)
    now_iso = datetime.now(timezone.utc).isoformat()
    high_risk_entities = sum(1 for r in scored.values() if r.risk_level == "HIGH")
    critical_entities = sum(1 for r in scored.values() if r.risk_level == "CRITICAL")

    dataset_ver = "v1.0"
    try:
        c_conn = sqlite3.connect(db_path)
        c_cur = c_conn.cursor()
        c_cur.execute("SELECT (SELECT COUNT(*) FROM entities), (SELECT COUNT(*) FROM assets), (SELECT COUNT(*) FROM alerts), (SELECT COUNT(*) FROM cases)")
        c_row = c_cur.fetchone()
        if c_row:
            dataset_ver = f"v{c_row[0]}.{c_row[1]}.{c_row[2]}.{c_row[3]}"
        c_conn.close()
    except Exception:
        pass

    result = {
        "run_timestamp": now_iso,
        "analysis_timestamp": now_iso,
        "db_path": db_path,
        "elapsed_seconds": elapsed,
        "total_findings": total,
        "findings_generated": total,
        "entities_analyzed": len(scored),
        "high_risk_entities": high_risk_entities,
        "critical_entities": critical_entities,
        "dataset_version": dataset_ver,
        "module_counts": {
            "EXECUTION_GAP": len(eg_findings),
            "NEGATIVE_SPACE": len(ns_findings),
            "ANOMALY": len(an_findings),
            "PEER_DEVIATION": len(pc_findings),
            "REPEATED_INCIDENT": len(ri_findings),
        },
        # Raw findings (Phase 3 shape — preserved for Phase 3 tests)
        "findings_by_entity": by_entity,
        "findings_by_type": by_type,
        "all_findings": [f.to_dict() for f in all_findings],
        # Phase 4 additions
        "entity_risk": {eid: r.to_dict() for eid, r in scored.items()},
        "entity_anomalies": evaluate_entity_anomalies(db_path),
    }

    # Persist findings to SQLite supervisory_findings table
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS supervisory_findings (
                finding_id TEXT PRIMARY KEY,
                entity_id TEXT NOT NULL,
                finding_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                title TEXT NOT NULL,
                rationale TEXT NOT NULL,
                evidence_ids TEXT NOT NULL,
                supporting_metrics TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (entity_id) REFERENCES entities(entity_id) ON DELETE CASCADE
            );
        """)
        cur.execute("DELETE FROM supervisory_findings")
        now_iso = datetime.now(timezone.utc).isoformat()
        for f in all_findings:
            cur.execute("""
                INSERT OR REPLACE INTO supervisory_findings 
                (finding_id, entity_id, finding_type, severity, title, rationale, evidence_ids, supporting_metrics, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                f.finding_id,
                f.entity_id,
                f.finding_type,
                f.severity,
                f.title,
                f.rationale,
                json.dumps(f.evidence_ids),
                json.dumps(f.supporting_metrics),
                now_iso
            ))

        # Persist entity risk scores and complete explainability to SQLite
        cur.execute("""
            CREATE TABLE IF NOT EXISTS entity_risk_scores (
                entity_id TEXT PRIMARY KEY,
                entity_name TEXT NOT NULL,
                sector TEXT NOT NULL,
                final_risk_score REAL NOT NULL,
                risk_level TEXT NOT NULL,
                component_scores TEXT NOT NULL,
                component_weighted_contributions TEXT NOT NULL,
                primary_drivers TEXT NOT NULL,
                explanation TEXT NOT NULL,
                calculated_at TEXT NOT NULL,
                FOREIGN KEY (entity_id) REFERENCES entities(entity_id) ON DELETE CASCADE
            );
        """)
        cur.execute("DELETE FROM entity_risk_scores")
        for eid, r in scored.items():
            r_dict = r.to_dict()
            cur.execute("""
                INSERT OR REPLACE INTO entity_risk_scores
                (entity_id, entity_name, sector, final_risk_score, risk_level, component_scores, component_weighted_contributions, primary_drivers, explanation, calculated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                eid,
                r_dict["entity_name"],
                r_dict["sector"],
                r_dict["final_risk_score"],
                r_dict["risk_level"],
                json.dumps(r_dict["component_scores"]),
                json.dumps(r_dict["component_weighted_contributions"]),
                json.dumps(r_dict["primary_drivers"]),
                json.dumps(r_dict["explanation"]),
                now_iso,
            ))

        conn.commit()
        conn.close()
        
        # Phase 11: Alert Review Prioritization
        print("[pipeline]  Module F: Alert Prioritization ...")
        prioritized = prioritize_alerts(db_path)
        print(f"             -> {len(prioritized)} alerts prioritized")
        prioritize_controls_processes(db_path)
        print("             -> control and process priorities persisted")
        
    except Exception as e:
        print(f"[pipeline] Note: Findings/Scores table sync: {e}")

    print(f"[pipeline] Pipeline complete in {elapsed}s")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="SAT-SA Analytics Pipeline")
    parser.add_argument(
        "--db-path",
        default="../backend/sat_sa.db",
        help="Path to the SQLite database (default: ../backend/sat_sa.db)",
    )
    parser.add_argument(
        "--output-json",
        default=None,
        help="If provided, write the full results JSON to this path.",
    )
    args = parser.parse_args()

    result = run_pipeline(args.db_path)

    if args.output_json:
        with open(args.output_json, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=2)
        print(f"[pipeline] Full results written to {args.output_json}")
    else:
        print("\n=== PIPELINE SUMMARY ===")
        print(f"Total findings : {result['total_findings']}")
        for mtype, cnt in result["module_counts"].items():
            print(f"  {mtype:<22} {cnt}")

        print("\n=== ENTITY RISK SCORES (sorted by score desc) ===")
        risk_rows = [
            (eid, er["risk_score"], er["risk_level"])
            for eid, er in result["entity_risk"].items()
        ]
        for eid, score, level in sorted(risk_rows, key=lambda r: r[1], reverse=True):
            findings_count = len(result["findings_by_entity"].get(eid, []))
            print(f"  {eid}  score={score:5.1f}  level={level:<8}  findings={findings_count}")


if __name__ == "__main__":
    main()
