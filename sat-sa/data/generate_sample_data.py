"""
Deterministic Sample Data Generator for SAT-SA
Generates 20 CSE entities with assets, alerts, and cases.
Produces realistic operational patterns with CSE-007 exhibiting raw evidence of:
- Critical alerts closed in <10 mins
- Low escalation rate
- Repeated alerts on same assets with missing remediation
- Critical assets with missing/stale telemetry
All without creating risk scores or findings.
"""

import json
import csv
import os
import random
from datetime import datetime, timedelta

# Fix seed for 100% deterministic reproducibility
random.seed(42)

CURRENT_TIME = datetime(2026, 9, 27, 12, 0, 0)

SECTORS = ["Energy", "Banking", "Defence", "Telecom", "Transport", "Healthcare"]
ASSET_TYPES = ["SCADA", "Domain Controller", "Core Switch", "DB Server", "Web App"]
CATEGORIES = ["Ransomware", "Lateral Movement", "Brute Force", "Exfiltration", "Privilege Escalation"]
INVESTIGATORS = ["Analyst-01", "Analyst-02", "Analyst-03", "Analyst-04", "Analyst-05", "Analyst-06", "Analyst-07", "Analyst-08"]

ENTITIES_DATA = [
    {"entity_id": "CSE-001", "entity_name": "Apex State Bank of India", "sector": "Banking"},
    {"entity_id": "CSE-002", "entity_name": "National Thermal Energy Grid", "sector": "Energy"},
    {"entity_id": "CSE-003", "entity_name": "Central Defence Logistics Hub", "sector": "Defence"},
    {"entity_id": "CSE-004", "entity_name": "Bharat Telecom Backbone", "sector": "Telecom"},
    {"entity_id": "CSE-005", "entity_name": "Northern Railways Signalling Corp", "sector": "Transport"},
    {"entity_id": "CSE-006", "entity_name": "Metro Healthcare Infrastructure", "sector": "Healthcare"},
    {"entity_id": "CSE-007", "entity_name": "National Power Transmission Sub-tier A", "sector": "Energy"},
    {"entity_id": "CSE-008", "entity_name": "Union Financial Clearing House", "sector": "Banking"},
    {"entity_id": "CSE-009", "entity_name": "Naval Weapons Research Lab", "sector": "Defence"},
    {"entity_id": "CSE-010", "entity_name": "Coastal Gas Pipelines Ltd", "sector": "Energy"},
    {"entity_id": "CSE-011", "entity_name": "Unified Payments Network", "sector": "Banking"},
    {"entity_id": "CSE-012", "entity_name": "Strategic Satellite Ground Station", "sector": "Defence"},
    {"entity_id": "CSE-013", "entity_name": "National Fiber Optic Core", "sector": "Telecom"},
    {"entity_id": "CSE-014", "entity_name": "Air Traffic Control Western Region", "sector": "Transport"},
    {"entity_id": "CSE-015", "entity_name": "Central Biomedical Registry", "sector": "Healthcare"},
    {"entity_id": "CSE-016", "entity_name": "Hydroelectric Dam Automated Systems", "sector": "Energy"},
    {"entity_id": "CSE-017", "entity_name": "Securities Exchange Depository", "sector": "Banking"},
    {"entity_id": "CSE-018", "entity_name": "Tactical Radio Command", "sector": "Defence"},
    {"entity_id": "CSE-019", "entity_name": "Deepwater Port Terminal Controls", "sector": "Transport"},
    {"entity_id": "CSE-020", "entity_name": "Epidemic Surveillance Network", "sector": "Healthcare"},
]

def generate_dataset():
    entities = ENTITIES_DATA
    assets = []
    alerts = []
    cases = []

    asset_counter = 1
    alert_counter = 1
    case_counter = 1

    # Map for easy lookup
    entity_assets = {e["entity_id"]: [] for e in entities}

    # 1. Generate Assets for each entity (18-24 per entity -> ~400 assets total)
    for ent in entities:
        eid = ent["entity_id"]
        is_cse007 = (eid == "CSE-007")
        num_assets = 22 if is_cse007 else random.randint(18, 22)

        for i in range(num_assets):
            aid = f"AST-{eid[4:]}-{i+1:02d}"
            
            # Specific distribution for sectors
            if ent["sector"] == "Energy":
                atype = "SCADA" if i < 8 else random.choice(["Domain Controller", "Core Switch", "DB Server", "Web App"])
            elif ent["sector"] == "Banking":
                atype = "DB Server" if i < 8 else random.choice(["Domain Controller", "Core Switch", "Web App"])
            else:
                atype = random.choice(ASSET_TYPES)

            # Criticality
            if i < 6:
                criticality = "CRITICAL"
            elif i < 12:
                criticality = "HIGH"
            elif i < 18:
                criticality = "MEDIUM"
            else:
                criticality = "LOW"

            exp_telemetry = "Syslog, EDR" if criticality in ["CRITICAL", "HIGH"] else "Syslog"

            # Telemetry timeliness (Negative Space)
            if is_cse007 and criticality == "CRITICAL" and i in [0, 1, 2, 3]:
                # CSE-007 has 4 critical assets with completely stale / missing telemetry (35-50 days old)
                last_tel = (CURRENT_TIME - timedelta(days=random.randint(35, 55))).isoformat() + "Z"
            elif not is_cse007 and random.random() < 0.05 and criticality != "CRITICAL":
                # Occasional slight lag for non-critical assets in other entities
                last_tel = (CURRENT_TIME - timedelta(days=random.randint(4, 8))).isoformat() + "Z"
            else:
                # Fresh telemetry within last 2 to 18 hours
                last_tel = (CURRENT_TIME - timedelta(hours=random.randint(1, 18))).isoformat() + "Z"

            asset_rec = {
                "asset_id": aid,
                "entity_id": eid,
                "asset_type": atype,
                "criticality": criticality,
                "expected_telemetry": exp_telemetry,
                "last_telemetry": last_tel
            }
            assets.append(asset_rec)
            entity_assets[eid].append(asset_rec)
            asset_counter += 1

    # 2. Generate Alerts & Cases
    # We want at least 1400 alerts and ~700-800 cases
    for ent in entities:
        eid = ent["entity_id"]
        is_cse007 = (eid == "CSE-007")
        asts = entity_assets[eid]
        critical_assets = [a for a in asts if a["criticality"] == "CRITICAL"]
        other_assets = [a for a in asts if a["criticality"] != "CRITICAL"]

        # Alert count: CSE-007 has ~110 alerts, others ~65-80 alerts
        num_alerts = 110 if is_cse007 else random.randint(65, 80)

        for j in range(num_alerts):
            al_id = f"ALT-{alert_counter:05d}"
            alert_counter += 1

            # Timestamp within past 30 days
            alert_dt = CURRENT_TIME - timedelta(days=random.randint(1, 28), hours=random.randint(0, 23), minutes=random.randint(0, 59))
            alert_timestamp = alert_dt.isoformat() + "Z"

            if is_cse007:
                # CSE-007 characteristics:
                # High ratio of CRITICAL alerts (e.g. 50% critical)
                if j < 55:
                    sev = "CRITICAL"
                    # Repeated incidents: heavily targeted on AST-007-01 and AST-007-02
                    chosen_asset = critical_assets[0] if j % 2 == 0 else critical_assets[1]
                    cat = "Ransomware" if j % 3 == 0 else "Lateral Movement"
                else:
                    sev = random.choice(["HIGH", "MEDIUM", "LOW"])
                    chosen_asset = random.choice(asts)
                    cat = random.choice(CATEGORIES)
                
                status = "CLOSED" if j < 95 else random.choice(["OPEN", "INVESTIGATING"])
            else:
                # Normal entities: ~15-20% critical alerts, spread across assets
                sev_weights = [0.15, 0.35, 0.35, 0.15]
                sev = random.choices(["CRITICAL", "HIGH", "MEDIUM", "LOW"], weights=sev_weights)[0]
                chosen_asset = random.choice(critical_assets) if (sev == "CRITICAL" and critical_assets) else random.choice(asts)
                cat = random.choice(CATEGORIES)
                status = random.choice(["CLOSED", "CLOSED", "CLOSED", "INVESTIGATING", "OPEN"])

            src_ip = f"192.168.{random.randint(1, 100)}.{random.randint(1, 254)}"
            dst_ip = f"10.0.{random.randint(1, 20)}.{random.randint(1, 254)}"

            alert_rec = {
                "alert_id": al_id,
                "timestamp": alert_timestamp,
                "entity_id": eid,
                "asset_id": chosen_asset["asset_id"],
                "severity": sev,
                "category": cat,
                "source_ip": src_ip,
                "destination_ip": dst_ip,
                "status": status
            }
            alerts.append(alert_rec)

            # Generate Case if status is not 'OPEN' or with 70% probability
            # All closed alerts have cases; some open/investigating also have cases
            should_have_case = (status in ["CLOSED", "INVESTIGATING", "ESCALATED"]) or (random.random() < 0.4)

            if should_have_case:
                cid = f"CAS-{case_counter:05d}"
                case_counter += 1

                opened_dt = alert_dt + timedelta(minutes=random.randint(1, 15))
                opened_at = opened_dt.isoformat() + "Z"

                if is_cse007:
                    # CSE-007 EXECUTION GAPS:
                    # 1. Unusually fast closure duration for critical alerts (e.g. 2-8 minutes!)
                    # 2. Very low escalation rate (~7% vs peers ~45%)
                    # 3. Closure reason often False Positive without remediation
                    # 4. Remediation status = None or Ignored
                    if sev == "CRITICAL":
                        # 85% closed in <= 8 minutes!
                        if random.random() < 0.85:
                            duration = random.randint(2, 7)
                        else:
                            duration = random.randint(15, 30)
                        
                        # Low escalation
                        escalated = 1 if random.random() < 0.08 else 0
                        closure_reason = "False Positive" if random.random() < 0.8 else "Benign"
                        remediation = "None" if random.random() < 0.75 else "Ignored"
                    else:
                        duration = random.randint(5, 25)
                        escalated = 1 if random.random() < 0.05 else 0
                        closure_reason = random.choice(["False Positive", "Duplicate", "Benign"])
                        remediation = random.choice(["None", "Ignored"])
                else:
                    # Normal peer entities:
                    # Normal investigation: 35 to 90 minutes for critical, 20-50 for high/medium
                    if sev == "CRITICAL":
                        duration = random.randint(35, 95)
                        escalated = 1 if random.random() < 0.50 else 0
                        closure_reason = random.choice(["Remediated", "Remediated", "False Positive"])
                        remediation = "Completed" if closure_reason == "Remediated" else "None"
                    elif sev == "HIGH":
                        duration = random.randint(25, 60)
                        escalated = 1 if random.random() < 0.25 else 0
                        closure_reason = random.choice(["Remediated", "False Positive", "Benign"])
                        remediation = "Completed" if closure_reason == "Remediated" else "None"
                    else:
                        duration = random.randint(15, 45)
                        escalated = 0
                        closure_reason = random.choice(["False Positive", "Benign", "Duplicate"])
                        remediation = "None"

                if status == "CLOSED":
                    closed_dt = opened_dt + timedelta(minutes=duration)
                    closed_at = closed_dt.isoformat() + "Z"
                else:
                    closed_at = None
                    closure_reason = None
                    remediation = "In Progress"

                case_rec = {
                    "case_id": cid,
                    "alert_id": al_id,
                    "entity_id": eid,
                    "investigator": random.choice(INVESTIGATORS),
                    "opened_at": opened_at,
                    "investigation_duration": duration,
                    "escalated": escalated,
                    "closed_at": closed_at,
                    "closure_reason": closure_reason,
                    "remediation_status": remediation
                }
                cases.append(case_rec)

    return entities, assets, alerts, cases

def save_dataset(output_dir):
    os.makedirs(output_dir, exist_ok=True)
    entities, assets, alerts, cases = generate_dataset()

    print(f"Generated:")
    print(f"- Entities: {len(entities)}")
    print(f"- Assets:   {len(assets)}")
    print(f"- Alerts:   {len(alerts)}")
    print(f"- Cases:    {len(cases)}")

    # 1. Save JSON files
    with open(os.path.join(output_dir, "entities.json"), "w", encoding="utf-8") as f:
        json.dump(entities, f, indent=2)

    with open(os.path.join(output_dir, "assets.json"), "w", encoding="utf-8") as f:
        json.dump(assets, f, indent=2)

    with open(os.path.join(output_dir, "alerts.json"), "w", encoding="utf-8") as f:
        json.dump(alerts, f, indent=2)

    with open(os.path.join(output_dir, "cases.json"), "w", encoding="utf-8") as f:
        json.dump(cases, f, indent=2)

    # Combined dataset JSON
    combined = {
        "metadata": {
            "title": "SAT-SA Representative SOC Assessment Dataset",
            "generated_at": CURRENT_TIME.isoformat() + "Z",
            "entities_count": len(entities),
            "assets_count": len(assets),
            "alerts_count": len(alerts),
            "cases_count": len(cases),
            "description": "Representative multi-entity SOC telemetry for supervisory audit"
        },
        "entities": entities,
        "assets": assets,
        "alerts": alerts,
        "cases": cases
    }
    with open(os.path.join(output_dir, "dataset.json"), "w", encoding="utf-8") as f:
        json.dump(combined, f, indent=2)

    # 2. Save CSV files
    def write_csv(filepath, rows, fieldnames):
        with open(filepath, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

    write_csv(os.path.join(output_dir, "entities.csv"), entities, ["entity_id", "entity_name", "sector"])
    write_csv(os.path.join(output_dir, "assets.csv"), assets, ["asset_id", "entity_id", "asset_type", "criticality", "expected_telemetry", "last_telemetry"])
    write_csv(os.path.join(output_dir, "alerts.csv"), alerts, ["alert_id", "timestamp", "entity_id", "asset_id", "severity", "category", "source_ip", "destination_ip", "status"])
    write_csv(os.path.join(output_dir, "cases.csv"), cases, ["case_id", "alert_id", "entity_id", "investigator", "opened_at", "investigation_duration", "escalated", "closed_at", "closure_reason", "remediation_status"])

    print(f"Successfully saved all files to: {output_dir}")

if __name__ == "__main__":
    target_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "sample"))
    save_dataset(target_dir)
