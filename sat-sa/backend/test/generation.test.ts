import test from 'node:test';
import assert from 'node:assert';
import { generateDataset } from '../src/generate_dataset.js';

test('Dataset Generation - Row Counts & Reproducibility', () => {
  const dataset1 = generateDataset(42, new Date('2026-09-28T12:00:00Z'));
  const dataset2 = generateDataset(42, new Date('2026-09-28T12:00:00Z'));

  // Reproducibility
  assert.deepStrictEqual(dataset1, dataset2, 'Generations with the same seed should be identical');

  // Row Counts
  assert.strictEqual(dataset1.entities.length, 20, 'Should have exactly 20 entities');
  assert.ok(dataset1.assets.length > 200, 'Should have hundreds of assets');
  assert.ok(dataset1.alerts.length > 500, 'Should have hundreds of alerts');
  assert.ok(dataset1.cases.length > 400, 'Should have hundreds of cases');
});

test('Dataset Generation - Schema Validity', () => {
  const data = generateDataset(42, new Date('2026-09-28T12:00:00Z'));
  
  // Entity schema
  const e = data.entities[0];
  assert.ok('entity_id' in e && 'entity_name' in e && 'sector' in e, 'Entity schema invalid');
  
  // Asset schema
  const a = data.assets[0];
  assert.ok('asset_id' in a && 'entity_id' in a && 'asset_type' in a && 'criticality' in a, 'Asset schema invalid');
  
  // Alert schema
  const al = data.alerts[0];
  assert.ok('alert_id' in al && 'timestamp' in al && 'severity' in al && 'status' in al, 'Alert schema invalid');
  
  // Case schema
  const c = data.cases[0];
  assert.ok('case_id' in c && 'investigator' in c && 'investigation_duration' in c, 'Case schema invalid');
});

test('Dataset Generation - CSE-007 Behavioral Patterns', () => {
  const data = generateDataset(42, new Date('2026-09-28T12:00:00Z'));
  
  const cse007Assets = data.assets.filter(a => a.entity_id === 'CSE-007');
  const cse007Alerts = data.alerts.filter(a => a.entity_id === 'CSE-007');
  const cse007Cases = data.cases.filter(c => c.entity_id === 'CSE-007');
  
  // Pattern 1: Peer Deviation (High Volume)
  const cse001Alerts = data.alerts.filter(a => a.entity_id === 'CSE-001').length;
  assert.ok(cse007Alerts.length > cse001Alerts * 2, 'CSE-007 should have significantly more alerts than others');

  // Pattern 2: Negative Space
  const staleCritical = cse007Assets.filter(a => {
    if (a.criticality !== 'CRITICAL') return false;
    const daysOld = (new Date('2026-09-27T12:00:00Z').getTime() - new Date(a.last_telemetry!).getTime()) / (1000 * 60 * 60 * 24);
    return daysOld > 30 && a.expected_telemetry === '1 day';
  });
  assert.ok(staleCritical.length > 0, 'CSE-007 should have stale critical assets (Negative Space)');

  // Pattern 3: Execution Gaps (Critical alerts closed very quickly without remediation)
  const execGaps = cse007Cases.filter(c => {
    const alert = cse007Alerts.find(a => a.alert_id === c.alert_id);
    return alert?.severity === 'CRITICAL' && c.investigation_duration < 5 && c.remediation_status === 'None';
  });
  assert.ok(execGaps.length > 0, 'CSE-007 should have execution gaps on critical alerts');

  // Pattern 4: Low Escalation
  const escalations = cse007Cases.filter(c => c.escalated === 1);
  assert.ok(escalations.length / cse007Cases.length < 0.05, 'CSE-007 should have <5% escalation rate');
});
