import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseService } from '../src/db.js';
import { DataValidator, DataIngestionService, DatasetPayload } from '../src/ingestion.js';

test('Database Initialization & Schema Validation', () => {
  // Use in-memory or temp SQLite database
  const tempDbPath = path.resolve(process.cwd(), 'temp_test.db');
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  const dbService = new DatabaseService(tempDbPath);
  const rawDb = dbService.getRawDb();

  // Check tables exist
  const tables = rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const tableNames = tables.map(t => t.name);

  assert.ok(tableNames.includes('entities'), 'entities table must exist');
  assert.ok(tableNames.includes('assets'), 'assets table must exist');
  assert.ok(tableNames.includes('alerts'), 'alerts table must exist');
  assert.ok(tableNames.includes('cases'), 'cases table must exist');

  // Verify initial counts are zero
  const counts = dbService.getCounts();
  assert.equal(counts.entities, 0);
  assert.equal(counts.assets, 0);
  assert.equal(counts.alerts, 0);
  assert.equal(counts.cases, 0);

  dbService.close();
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
});

test('Validation: Rejection of Missing Required Fields & Invalid Types', () => {
  const invalidDataset: DatasetPayload = {
    entities: [
      { entity_id: '', entity_name: 'Invalid Corp', sector: 'Energy' }, // missing id
      { entity_id: 'ENT-01', entity_name: '', sector: 'Banking' } // missing name
    ],
    assets: [
      { asset_id: 'AST-01', entity_id: 'NON_EXISTENT', asset_type: 'SCADA', criticality: 'CRITICAL', expected_telemetry: 'Syslog', last_telemetry: null }, // non-existent entity
      { asset_id: 'AST-02', entity_id: 'ENT-01', asset_type: 'SCADA', criticality: 'UNKNOWN' as any, expected_telemetry: 'Syslog', last_telemetry: 'invalid-date' } // invalid criticality & date
    ]
  };

  const validation = DataValidator.validateDataset(invalidDataset);
  assert.equal(validation.valid, false, 'Validation should fail for invalid dataset');
  assert.ok(validation.errors.length >= 4, 'Should flag all schema violations');

  const errorFields = validation.errors.map(e => e.field);
  assert.ok(errorFields.includes('entity_id'));
  assert.ok(errorFields.includes('entity_name'));
  assert.ok(errorFields.includes('criticality'));
  assert.ok(errorFields.includes('last_telemetry'));
});

test('Validation: Referential Integrity & Cross-Entity Mismatches', () => {
  const mismatchedDataset: DatasetPayload = {
    entities: [
      { entity_id: 'E1', entity_name: 'Corp 1', sector: 'Energy' },
      { entity_id: 'E2', entity_name: 'Corp 2', sector: 'Banking' }
    ],
    assets: [
      { asset_id: 'A1', entity_id: 'E1', asset_type: 'SCADA', criticality: 'CRITICAL', expected_telemetry: 'Syslog', last_telemetry: '2026-09-20T00:00:00Z' }
    ],
    alerts: [
      // Alert claims to be entity E2, but references asset A1 which belongs to entity E1!
      { alert_id: 'ALT-1', timestamp: '2026-09-21T00:00:00Z', entity_id: 'E2', asset_id: 'A1', severity: 'CRITICAL', category: 'Ransomware', status: 'CLOSED' }
    ],
    cases: [
      // Case claims entity E1, but alert ALT-1 has entity E2!
      { case_id: 'CAS-1', alert_id: 'ALT-1', entity_id: 'E1', investigator: 'Analyst-1', opened_at: '2026-09-21T00:05:00Z', investigation_duration: 10, escalated: 0, closed_at: null, closure_reason: null, remediation_status: null }
    ]
  };

  const validation = DataValidator.validateDataset(mismatchedDataset);
  assert.equal(validation.valid, false);

  const errorMessages = validation.errors.map(e => e.message);
  assert.ok(errorMessages.some(m => m.includes("belongs to entity 'E1', not 'E2'")), 'Must catch asset-entity mismatch');
  assert.ok(errorMessages.some(m => m.includes("does not match alert entity_id")), 'Must catch case-entity mismatch');
});

test('Ingestion: JSON Dataset Parsing & Storage', () => {
  const samplePath = path.resolve(process.cwd(), '../data/sample/dataset.json');
  assert.ok(fs.existsSync(samplePath), 'dataset.json must exist');

  const rawJson = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
  const tempDbPath = path.resolve(process.cwd(), 'temp_test_json.db');
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  const dbService = new DatabaseService(tempDbPath);
  const ingestion = new DataIngestionService(dbService);

  const result = ingestion.ingestDataset({
    entities: rawJson.entities,
    assets: rawJson.assets,
    alerts: rawJson.alerts,
    cases: rawJson.cases
  }, true);

  if (!result.success) console.error(result.errors); assert.equal(result.success, true, 'JSON ingestion should succeed');
  assert.equal(result.errors.length, 0);

  const counts = dbService.getCounts();
  assert.equal(counts.entities, 20, 'Should have exactly 20 entities');
  assert.ok(counts.assets >= 350, 'Should have several hundred assets');
  assert.ok(counts.alerts >= 1000, 'Should have at least 1000 alerts');
  assert.ok(counts.cases >= 500, 'Should have several hundred cases');

  dbService.close();
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
});

test('Ingestion: CSV Dataset Parsing & Storage', () => {
  const dir = path.resolve(process.cwd(), '../data/sample');
  const entitiesCsv = fs.readFileSync(path.join(dir, 'entities.csv'), 'utf-8');
  const assetsCsv = fs.readFileSync(path.join(dir, 'assets.csv'), 'utf-8');
  const alertsCsv = fs.readFileSync(path.join(dir, 'alerts.csv'), 'utf-8');
  const casesCsv = fs.readFileSync(path.join(dir, 'cases.csv'), 'utf-8');

  const tempDbPath = path.resolve(process.cwd(), 'temp_test_csv.db');
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  const dbService = new DatabaseService(tempDbPath);
  const ingestion = new DataIngestionService(dbService);

  const result = ingestion.ingestCsvTables({
    entities: entitiesCsv,
    assets: assetsCsv,
    alerts: alertsCsv,
    cases: casesCsv
  }, true);

  assert.equal(result.success, true, 'CSV ingestion should succeed');
  assert.equal(result.errors.length, 0);

  const counts = dbService.getCounts();
  assert.equal(counts.entities, 20);
  assert.ok(counts.assets >= 350);
  assert.ok(counts.alerts >= 1000);
  assert.ok(counts.cases >= 500);

  dbService.close();
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
});

test('CSE-007 Raw Evidence Verification', () => {
  const samplePath = path.resolve(process.cwd(), '../data/sample/dataset.json');
  const rawJson = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
  const tempDbPath = path.resolve(process.cwd(), 'temp_test_cse007.db');
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  const dbService = new DatabaseService(tempDbPath);
  const ingestion = new DataIngestionService(dbService);
  ingestion.ingestDataset(rawJson, true);

  const rawDb = dbService.getRawDb();

  // 1. Confirm CSE-007 exists
  const cse007 = rawDb.prepare("SELECT * FROM entities WHERE entity_id = 'CSE-007'").get() as any;
  assert.ok(cse007, 'CSE-007 must exist');
  assert.equal(cse007.sector, 'Energy');

  // 2. Critical alerts closed unusually quickly (< 10 mins)
  const cse007CriticalCases = rawDb.prepare(`
    SELECT c.case_id, c.investigation_duration, c.escalated, c.remediation_status, al.severity
    FROM cases c
    JOIN alerts al ON c.alert_id = al.alert_id
    WHERE c.entity_id = 'CSE-007' AND al.severity = 'CRITICAL' AND al.status = 'CLOSED'
  `).all() as any[];

  assert.ok(cse007CriticalCases.length > 20, 'CSE-007 should have critical closed cases');
  const shortDurations = cse007CriticalCases.filter(c => c.investigation_duration < 10);
  const quickClosureRatio = shortDurations.length / cse007CriticalCases.length;
  assert.ok(quickClosureRatio > 0.70, `CSE-007 quick closure ratio (${(quickClosureRatio * 100).toFixed(1)}%) should be > 70%`);

  // 3. Low escalation rate for CSE-007 critical alerts compared to peer entities
  const cse007Escalations = cse007CriticalCases.filter(c => c.escalated === 1);
  const cse007EscalationRate = cse007Escalations.length / cse007CriticalCases.length;
  assert.ok(cse007EscalationRate < 0.20, `CSE-007 escalation rate (${(cse007EscalationRate * 100).toFixed(1)}%) should be < 20%`);

  // Peer comparison raw check: Check other entities critical escalation rate
  const peerCriticalCases = rawDb.prepare(`
    SELECT c.escalated
    FROM cases c
    JOIN alerts al ON c.alert_id = al.alert_id
    WHERE c.entity_id != 'CSE-007' AND al.severity = 'CRITICAL'
  `).all() as any[];

  const peerEscalations = peerCriticalCases.filter(c => c.escalated === 1);
  const peerEscalationRate = peerEscalations.length / peerCriticalCases.length;
  assert.ok(peerEscalationRate > 0.35, `Peer critical escalation rate (${(peerEscalationRate * 100).toFixed(1)}%) should be > 35%`);

  // 4. Critical assets with missing/stale telemetry (>30 days old)
  const staleAssets = rawDb.prepare(`
    SELECT asset_id, criticality, last_telemetry
    FROM assets
    WHERE entity_id = 'CSE-007' AND criticality = 'CRITICAL'
  `).all() as any[];

  const now = new Date('2026-09-27T12:00:00Z').getTime();
  const missingOrStale = staleAssets.filter(a => {
    if (!a.last_telemetry) return true;
    const diffDays = (now - new Date(a.last_telemetry).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays > 30;
  });
  assert.ok(missingOrStale.length >= 3, 'CSE-007 must have at least 3 critical assets with stale/missing telemetry');

  // 5. Repeated alerts with absent remediation
  const repeatedUnremediated = rawDb.prepare(`
    SELECT al.asset_id, al.category, COUNT(*) as count,
           SUM(CASE WHEN c.remediation_status IN ('None', 'Ignored') THEN 1 ELSE 0 END) as unremediated_count
    FROM alerts al
    JOIN cases c ON al.alert_id = c.alert_id
    WHERE al.entity_id = 'CSE-007'
    GROUP BY al.asset_id, al.category
    HAVING count >= 5
  `).all() as any[];

  assert.ok(repeatedUnremediated.length > 0, 'CSE-007 must have repeated alert clusters');
  assert.ok(repeatedUnremediated[0].unremediated_count >= 5, 'Repeated alerts must have un-remediated status');

  // 6. Confirm NO risk scores or findings exist in database
  const tableNames = (rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(t => t.name);
  assert.ok(!tableNames.includes('findings'), 'Findings table must NOT exist in Phase 2');
  assert.ok(!tableNames.includes('risk_scores'), 'Risk scores table must NOT exist in Phase 2');

  dbService.close();
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
});
