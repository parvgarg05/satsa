# PROJECT SPECIFICATION: SAT-SA
## Supervisory Analytics Tool for SOC Assessment
### SIH 2026 Problem Statement 157

---

### 1. Objective & Scope
SAT-SA is an offline-first supervisory analytics prototype designed to help supervisors audit and evaluate Security Operations Center (SOC) alert and case-management data from multiple Critical Sector Entities (CSEs). 

It empowers supervisors to:
1. Ingest multi-entity SOC alert and case-management logs (CSV/JSON).
2. Validate and normalize the operational schemas.
3. Apply 5 supervisory analytics modules to detect systemic operational vulnerabilities.
4. Calculate explainable, deterministic risk scores for each entity.
5. Prioritize entities for manual audit and regulatory scrutiny.
6. Provide verifiable, immutable evidence drill-downs down to raw alert/case/asset records.

> **Evaluation Focus:** Polished, genuinely functional vertical slice (50–60%) with full end-to-end functionality without cloud, external AI, or LLM dependencies.

---

### 2. Architecture & Data Flow
```
[ User Browser ]
       │
       ▼
[ React + Vite + Tailwind + Recharts ] (Frontend UI on :5173)
       │ HTTP / REST
       ▼
[ Node.js + Express + TypeScript ] (API Gateway & SQLite Orchestrator on :4000)
       │
       ├──────────────────────────────┐
       ▼                              ▼
[ SQLite Database ]        [ Python Analytics Microservice ]
(Persistent audit trail,   (Pandas, NumPy, Scikit-Learn, FastAPI on :8000)
 alerts, cases, entities)   - Execution Gaps Engine
                            - Negative Space Detector
                            - Isolation Forest Anomaly Engine
                            - Peer Comparison Engine
                            - Repeated Incident Engine
                            - Deterministic Risk Scorer
```

---

### 3. Core Schemas
1. **ENTITIES:**
   - `entity_id` (str, Primary Key)
   - `entity_name` (str)
   - `sector` (str: Banking, Energy, Defence, Telecom, Transport, Healthcare)

2. **ASSETS:**
   - `asset_id` (str, Primary Key)
   - `entity_id` (str, Foreign Key)
   - `asset_type` (str: SCADA, Domain Controller, Core Switch, DB Server, Web App)
   - `criticality` (str: CRITICAL, HIGH, MEDIUM, LOW)
   - `expected_telemetry` (str: Syslog, EDR, NetFlow, AuthLogs)
   - `last_telemetry` (ISO timestamp)

3. **ALERTS:**
   - `alert_id` (str, Primary Key)
   - `timestamp` (ISO timestamp)
   - `entity_id` (str, Foreign Key)
   - `asset_id` (str, Foreign Key)
   - `severity` (str: CRITICAL, HIGH, MEDIUM, LOW)
   - `category` (str: Ransomware, Lateral Movement, Brute Force, Exfiltration, Privilege Escalation)
   - `source_ip` (str)
   - `destination_ip` (str)
   - `status` (str: OPEN, INVESTIGATING, CLOSED, ESCALATED)

4. **CASES:**
   - `case_id` (str, Primary Key)
   - `alert_id` (str, Foreign Key)
   - `entity_id` (str, Foreign Key)
   - `investigator` (str)
   - `opened_at` (ISO timestamp)
   - `investigation_duration` (int, in minutes)
   - `escalated` (boolean: True / False)
   - `closed_at` (ISO timestamp)
   - `closure_reason` (str: False Positive, Benign, Remediated, Suppressed, Duplicate)
   - `remediation_status` (str: Completed, In Progress, None, Ignored)

---

### 4. Core Supervisory Analytics Modules
1. **Module A: Execution Gap Detection**
   - Critical alerts closed unusually quickly (< 10 minutes vs peer median).
   - Critical alerts closed without escalation.
   - Extremely short investigation durations.
   - Repeated alerts without evidence of remediation.
   
2. **Module B: Negative Space Detection**
   - Missing telemetry on critical assets (last telemetry timestamp expired or missing).
   - Expected monitoring coverage not observed for active assets.
   - Missing investigation records for high-severity alerts.
   - Unusually low activity (potential telemetry blackout or suppression).

3. **Module C: Anomaly Detection**
   - Local scikit-learn `IsolationForest`.
   - Feature vector per entity: `alert_volume`, `critical_alert_ratio`, `median_closure_time`, `escalation_rate`, `repeat_alert_rate`, `telemetry_coverage`, `average_investigation_duration`.
   - Transparent feature contribution attribution (no black box).

4. **Module D: Peer Comparison**
   - Cross-entity peer comparison within and across critical sectors.
   - Metrics: escalation rate, closure duration, investigation time, telemetry coverage.
   - Quantified deviation: Entity Value vs Peer Median with statistical variance.

5. **Module E: Repeated Incident Detection**
   - Clusters of alerts sharing `(entity_id, asset_id, category)`.
   - Recurring incidents where remediation is marked `None` or `Ignored`.

---

### 5. Risk Scoring & Explainability
- Deterministic formula:
  $$\text{Score} = (0.30 \times S_{\text{execution}}) + (0.25 \times S_{\text{negative}}) + (0.20 \times S_{\text{anomaly}}) + (0.15 \times S_{\text{peer}}) + (0.10 \times S_{\text{repeat}})$$
- Risk bands:
  - `0 - 29`: **LOW**
  - `30 - 59`: **MEDIUM**
  - `60 - 79`: **HIGH**
  - `80 - 100`: **CRITICAL**
- Explainability contract for every finding:
  - **WHAT** was detected?
  - **WHY** was it flagged?
  - **WHAT EVIDENCE** supports it (specific Alert/Case/Asset IDs)?
  - **HOW MUCH** did it contribute to the overall entity risk score?

---

### 6. Primary Demo Benchmark
- **CSE-007 (National Power Grid Sub-tier A)**:
  - Heavy execution gaps: 80%+ critical alerts closed in <10 mins without escalation.
  - Negative space: Key SCADA assets lacking expected telemetry.
  - Isolation Forest flagged as high anomaly.
  - Overall Score: Critical / High (80+).
- Other entities (CSE-001 to CSE-020): Realistic distribution across Low, Medium, and High risk.
