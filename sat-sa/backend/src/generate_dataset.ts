import fs from 'node:fs';
import path from 'node:path';

class DeterministicRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  // Linear Congruential Generator (LCG)
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  choice<T>(arr: T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }

  probability(p: number): boolean {
    return this.next() < p;
  }

  randomDate(start: Date, end: Date): Date {
    return new Date(start.getTime() + this.next() * (end.getTime() - start.getTime()));
  }
}

const SECTORS = ['Banking', 'Energy', 'Defence', 'Telecom', 'Transport', 'Healthcare'];
const ASSET_TYPES = ['Server', 'Workstation', 'Firewall', 'Router', 'SCADA', 'ICS', 'Database'];
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const CATEGORIES = ['Malware', 'Phishing', 'DDoS', 'Unauthorized Access', 'Data Exfiltration', 'Ransomware', 'Privilege Escalation'];
const STATUSES = ['OPEN', 'INVESTIGATING', 'CLOSED', 'ESCALATED'];
const INVESTIGATORS = ['Analyst_A', 'Analyst_B', 'Analyst_C', 'Analyst_D', 'SOC_Lead'];
const CLOSURE_REASONS = ['True Positive - Remediated', 'False Positive', 'Ignored', 'Duplicate', 'Policy Exception'];
const REMEDIATION_STATUSES = ['Completed', 'In Progress', 'None', 'Ignored'];

export function generateDataset(seedValue: number = 42, anchorDate: Date = new Date()) {
  const rng = new DeterministicRandom(seedValue);
  const now = anchorDate;
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const entities = [];
  for (let i = 1; i <= 20; i++) {
    const idNum = i.toString().padStart(3, '0');
    entities.push({
      entity_id: `CSE-${idNum}`,
      entity_name: `Entity ${idNum}`,
      sector: i === 7 ? 'Energy' : rng.choice(SECTORS)
    });
  }
  // Hardcode a few specific names to match prior sample if needed, but simple names are fine.
  entities[6].entity_name = 'National Power Transmission Sub-tier A'; // CSE-007

  const assets = [];
  const alerts = [];
  const cases = [];

  let alertCounter = 1;
  let caseCounter = 1;

  for (const entity of entities) {
    const isCSE007 = entity.entity_id === 'CSE-007';
    const numAssets = isCSE007 ? 30 : rng.nextInt(10, 25);
    
    const entityAssets = [];
    const forcedStaleAssets = ['AST-007-01', 'AST-007-02', 'AST-007-03', 'AST-007-04'];

    for (let a = 1; a <= numAssets; a++) {
      const assetId = `AST-${entity.entity_id.split('-')[1]}-${a.toString().padStart(2, '0')}`;
      let criticality = rng.choice(SEVERITIES);
      let assetType = rng.choice(ASSET_TYPES);
      
      let expected_telemetry = rng.choice(['1 hour', '1 day', '1 week']);
      let last_telemetry_date = rng.randomDate(ninetyDaysAgo, now);
      
      // Pattern: CSE-007 Negative Space (Critical assets missing telemetry)
      // Force specific IDs for tests
      if (isCSE007 && forcedStaleAssets.includes(assetId)) {
        criticality = 'CRITICAL';
        expected_telemetry = '1 day';
        last_telemetry_date = new Date(now.getTime() - rng.nextInt(35, 60) * 24 * 60 * 60 * 1000); // 35-60 days ago
      } else {
        // Normal assets are relatively recent
        last_telemetry_date = new Date(now.getTime() - rng.nextInt(0, 2) * 24 * 60 * 60 * 1000); 
      }

      const asset = {
        asset_id: assetId,
        entity_id: entity.entity_id,
        asset_type: assetType,
        criticality,
        expected_telemetry,
        last_telemetry: last_telemetry_date.toISOString()
      };
      assets.push(asset);
      entityAssets.push(asset);
    }

    // Alerts & Cases
    // Pattern: CSE-007 Peer Deviation (Very high volume)
    const numAlerts = isCSE007 ? rng.nextInt(200, 250) : rng.nextInt(20, 80);

    // Pattern: CSE-007 Repeated Incidents
    const repeatedAsset = entityAssets.find(a => a.asset_id === 'AST-007-01') || entityAssets[0];
    const repeatedCategory = 'Malware'; // Fixed category for repeat

    for (let al = 1; al <= numAlerts; al++) {
      const isRepeatedIncident = isCSE007 && rng.probability(0.25); // 25% of alerts are this exact repeat pattern
      
      const asset = isRepeatedIncident ? repeatedAsset : rng.choice(entityAssets);
      const category = isRepeatedIncident ? repeatedCategory : rng.choice(CATEGORIES);
      let severity = rng.choice(SEVERITIES);
      
      if (isCSE007 && rng.probability(0.4)) {
        severity = 'CRITICAL'; // CSE-007 has very high criticals
      }

      const alertDate = rng.randomDate(ninetyDaysAgo, now);
      
      const alertId = `ALT-${alertCounter.toString().padStart(5, '0')}`;
      alertCounter++;

      alerts.push({
        alert_id: alertId,
        timestamp: alertDate.toISOString(),
        entity_id: entity.entity_id,
        asset_id: asset.asset_id,
        severity,
        category,
        source_ip: `192.168.${rng.nextInt(1, 255)}.${rng.nextInt(1, 255)}`,
        destination_ip: `10.0.${rng.nextInt(1, 255)}.${rng.nextInt(1, 255)}`,
        status: 'CLOSED' // Simplifying, mostly closed for historical analysis
      });

      // Almost all alerts have cases
      if (rng.probability(0.9)) {
        const caseId = `CAS-${caseCounter.toString().padStart(5, '0')}`;
        caseCounter++;
        
        let investigation_duration = rng.nextInt(30, 300); // normal 30m - 5h
        let closure_reason = rng.choice(CLOSURE_REASONS);
        let remediation_status = rng.choice(REMEDIATION_STATUSES);
        let escalated = rng.probability(0.1) ? 1 : 0; // normal 10%

        if (!isCSE007 && severity === 'CRITICAL' && rng.probability(0.6)) {
          escalated = 1;
        }

        // Pattern: CSE-007 Execution Gaps (Critical alerts closed in < 5 mins without remediation)
        // Ensure average duration is very low for CSE-007 by making ALL cases short, and criticals extremely short
        if (isCSE007) {
          if (severity === 'CRITICAL' && rng.probability(0.95)) {
            investigation_duration = rng.nextInt(1, 4); // 1-4 minutes
            closure_reason = 'Ignored';
            remediation_status = 'None';
          } else {
            investigation_duration = rng.nextInt(10, 45); // Still lower than peers
          }
        }

        // Pattern: CSE-007 Low Escalation
        if (isCSE007) {
          escalated = rng.probability(0.01) ? 1 : 0; // basically never escalated
        }

        cases.push({
          case_id: caseId,
          alert_id: alertId,
          entity_id: entity.entity_id,
          investigator: rng.choice(INVESTIGATORS),
          opened_at: alertDate.toISOString(),
          investigation_duration,
          escalated,
          closed_at: new Date(alertDate.getTime() + investigation_duration * 60000).toISOString(),
          closure_reason,
          remediation_status
        });
      }
    }
  }

  return {
    metadata: {
      title: "SAT-SA Representative SOC Assessment Dataset",
      generated_at: now.toISOString(),
      entities_count: entities.length,
      assets_count: assets.length,
      alerts_count: alerts.length,
      cases_count: cases.length,
      description: "Representative multi-entity SOC telemetry for supervisory audit"
    },
    entities,
    assets,
    alerts,
    cases
  };
}

import { fileURLToPath } from 'url';

if (process.argv[1] && __filename === process.argv[1]) {
  const data = generateDataset(42);
  const outPath = path.resolve(process.cwd(), '../data/sample/dataset.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Generated representative dataset at: ${outPath}`);
  console.log(`Entities: ${data.entities.length}, Assets: ${data.assets.length}, Alerts: ${data.alerts.length}, Cases: ${data.cases.length}`);
}
