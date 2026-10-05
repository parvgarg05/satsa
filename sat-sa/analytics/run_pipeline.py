"""Quick runner -- invoke from repository root as:
   python sat-sa/analytics/run_pipeline.py
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

from pipeline import run_pipeline

DB = os.path.join(os.path.dirname(__file__), "..", "backend", "sat_sa.db")
result = run_pipeline(os.path.normpath(DB))

print("\n=== PIPELINE SUMMARY ===")
print(f"Total findings : {result['total_findings']}")
for mtype, cnt in result["module_counts"].items():
    print(f"  {mtype:<25} {cnt}")

print("\n=== ENTITY RISK SCORES (sorted by score desc) ===")
risk_rows = [
    (eid, er["risk_score"], er["risk_level"])
    for eid, er in result["entity_risk"].items()
]
for eid, score, level in sorted(risk_rows, key=lambda r: r[1], reverse=True):
    findings_count = len(result["findings_by_entity"].get(eid, []))
    print(f"  {eid}  score={score:5.1f}  level={level:<8}  findings={findings_count}")
