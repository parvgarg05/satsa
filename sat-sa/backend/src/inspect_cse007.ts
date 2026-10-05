import { DatabaseService } from './db.js';

const db = new DatabaseService();
const raw = db.getRawDb();

console.log('=== SAT-SA DATABASE ROW COUNTS ===');
const counts = db.getCounts();
console.log(`- Entities: ${counts.entities}`);
console.log(`- Assets:   ${counts.assets}`);
console.log(`- Alerts:   ${counts.alerts}`);
console.log(`- Cases:    ${counts.cases}`);

console.log('\n=== CSE-007 EVIDENCE PROFILE ===');
const entity = raw.prepare("SELECT * FROM entities WHERE entity_id = 'CSE-007'").get();
console.log('Entity Info:', JSON.stringify(entity));

const criticalStats = raw.prepare(`
  SELECT 
    COUNT(*) as total_critical_closed,
    SUM(CASE WHEN c.investigation_duration < 10 THEN 1 ELSE 0 END) as closed_under_10m,
    ROUND(AVG(c.investigation_duration), 2) as avg_duration,
    SUM(c.escalated) as escalated_count
  FROM cases c
  JOIN alerts al ON c.alert_id = al.alert_id
  WHERE c.entity_id = 'CSE-007' AND al.severity = 'CRITICAL' AND al.status = 'CLOSED'
`).get() as any;

const quickRatio = ((criticalStats.closed_under_10m / criticalStats.total_critical_closed) * 100).toFixed(1);
const escRate = ((criticalStats.escalated_count / criticalStats.total_critical_closed) * 100).toFixed(1);

console.log(`- Critical Alerts Closed: ${criticalStats.total_critical_closed}`);
console.log(`- Critical Closed Under 10 Mins: ${criticalStats.closed_under_10m} (${quickRatio}%)`);
console.log(`- Average Investigation Duration: ${criticalStats.avg_duration} minutes`);
console.log(`- Escalated Critical Alerts: ${criticalStats.escalated_count} (${escRate}%)`);

const peerStats = raw.prepare(`
  SELECT 
    COUNT(*) as peer_total_critical,
    SUM(c.escalated) as peer_escalated,
    ROUND(AVG(c.investigation_duration), 2) as peer_avg_duration
  FROM cases c
  JOIN alerts al ON c.alert_id = al.alert_id
  WHERE c.entity_id != 'CSE-007' AND al.severity = 'CRITICAL' AND al.status = 'CLOSED'
`).get() as any;

const peerEscRate = ((peerStats.peer_escalated / peerStats.peer_total_critical) * 100).toFixed(1);
console.log(`- Peer Average Duration: ${peerStats.peer_avg_duration} minutes`);
console.log(`- Peer Escalation Rate: ${peerStats.peer_escalated}/${peerStats.peer_total_critical} (${peerEscRate}%)`);

const staleAssets = raw.prepare(`
  SELECT asset_id, asset_type, criticality, expected_telemetry, last_telemetry
  FROM assets
  WHERE entity_id = 'CSE-007' AND criticality = 'CRITICAL' AND last_telemetry < '2026-09-01'
`).all();
console.log(`\n- Critical Assets with Stale Telemetry (>30 days expired): ${staleAssets.length}`);
for (const a of staleAssets as any[]) {
  console.log(`  * ${a.asset_id} (${a.asset_type}) - Telemetry: ${a.expected_telemetry} | Last seen: ${a.last_telemetry}`);
}

const repeats = raw.prepare(`
  SELECT al.asset_id, al.category, COUNT(*) as alert_count,
         SUM(CASE WHEN c.remediation_status IN ('None', 'Ignored') THEN 1 ELSE 0 END) as unremediated
  FROM alerts al
  JOIN cases c ON al.alert_id = c.alert_id
  WHERE al.entity_id = 'CSE-007'
  GROUP BY al.asset_id, al.category
  HAVING alert_count >= 5
`).all();

console.log(`\n- Repeated Incident Clusters:`);
for (const r of repeats as any[]) {
  console.log(`  * Asset: ${r.asset_id} | Category: ${r.category} | Alert Count: ${r.alert_count} | Unremediated: ${r.unremediated}`);
}

db.close();
