import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseService } from '../src/db.js';
import { DataValidator, DataIngestionService } from '../src/ingestion.js';

test('1. Ingestion: Valid CSV Parsing and Normalization', () => {
  const tempDbPath = path.resolve(process.cwd(), 'temp_test_valid_csv.db');
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  const db = new DatabaseService(tempDbPath);
  const service = new DataIngestionService(db);

  const entitiesCsv = `entity_id,entity_name,sector\nENT-01,Test Bank,Banking\nENT-02,Power Grid,Energy`;
  const assetsCsv = `asset_id,entity_id,asset_type,criticality,expected_telemetry,last_telemetry\nAST-01,ENT-01,Server,CRITICAL,Daily,2026-09-20T00:00:00Z\nAST-02,ENT-02,SCADA,HIGH,Daily,2026-09-21T00:00:00Z`;
  const alertsCsv = `alert_id,timestamp,entity_id,asset_id,severity,category,source_ip,destination_ip,status\nALT-01,2026-09-22T01:00:00Z,ENT-01,AST-01,CRITICAL,Ransomware,10.0.0.1,10.0.0.2,CLOSED\nALT-02,2026-09-22T02:00:00Z,ENT-02,AST-02,HIGH,Malware,10.0.0.3,10.0.0.4,OPEN`;
  const casesCsv = `case_id,alert_id,entity_id,investigator,opened_at,investigation_duration,escalated,closed_at,closure_reason,remediation_status\nCAS-01,ALT-01,ENT-01,Analyst_A,2026-09-22T01:05:00Z,15,true,2026-09-22T01:20:00Z,Remediated,Completed\nCAS-02,ALT-02,ENT-02,Analyst_B,2026-09-22T02:10:00Z,45,0,,,`;

  const result = service.ingestCsvTables({
    entities: entitiesCsv,
    assets: assetsCsv,
    alerts: alertsCsv,
    cases: casesCsv
  }, true);

  assert.equal(result.success, true);
  assert.equal(result.validation_errors.length, 0);
  assert.equal(result.rows_received.total, 8);
  assert.equal(result.rows_accepted.total, 8);
  assert.equal(result.rows_rejected.total, 0);
  assert.equal(result.database_counts.entities, 2);
  assert.equal(result.database_counts.assets, 2);
  assert.equal(result.database_counts.alerts, 2);
  assert.equal(result.database_counts.cases, 2);

  // Check normalized boolean in sqlite
  const rawDb = db.getRawDb();
  const case1 = rawDb.prepare('SELECT escalated FROM cases WHERE case_id = ?').get('CAS-01') as { escalated: number };
  const case2 = rawDb.prepare('SELECT escalated FROM cases WHERE case_id = ?').get('CAS-02') as { escalated: number };
  assert.equal(case1.escalated, 1, 'escalated="true" should normalize to 1');
  assert.equal(case2.escalated, 0, 'escalated="0" should normalize to 0');

  db.close();
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
});

test('2. Ingestion: Valid JSON Dataset', () => {
  const tempDbPath = path.resolve(process.cwd(), 'temp_test_valid_json.db');
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  const db = new DatabaseService(tempDbPath);
  const service = new DataIngestionService(db);

  const validJson = {
    entities: [
      { entity_id: 'E-100', entity_name: 'Metro Transit', sector: 'Transport' }
    ],
    assets: [
      { asset_id: 'A-100', entity_id: 'E-100', asset_type: 'Signalling', criticality: 'CRITICAL' as const, expected_telemetry: 'Hourly', last_telemetry: '2026-09-25T10:00:00Z' }
    ],
    alerts: [
      { alert_id: 'AL-100', timestamp: '2026-09-25T11:00:00Z', entity_id: 'E-100', asset_id: 'A-100', severity: 'CRITICAL' as const, category: 'DDoS', source_ip: null, destination_ip: null, status: 'INVESTIGATING' as const }
    ],
    cases: [
      { case_id: 'C-100', alert_id: 'AL-100', entity_id: 'E-100', investigator: 'Lead_X', opened_at: '2026-09-25T11:05:00Z', investigation_duration: 30, escalated: 1, closed_at: null, closure_reason: null, remediation_status: 'In Progress' as const }
    ]
  };

  const result = service.ingestDataset(validJson, true);

  assert.equal(result.success, true);
  assert.equal(result.rows_received.total, 4);
  assert.equal(result.rows_accepted.total, 4);
  assert.equal(result.rows_rejected.total, 0);
  assert.equal(result.validation_errors.length, 0);
  assert.equal(result.database_counts.entities, 1);
  assert.equal(result.database_counts.assets, 1);
  assert.equal(result.database_counts.alerts, 1);
  assert.equal(result.database_counts.cases, 1);

  db.close();
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
});

test('3. Ingestion: Missing Columns Rejection', () => {
  const tempDbPath = path.resolve(process.cwd(), 'temp_test_missing_cols.db');
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  const db = new DatabaseService(tempDbPath);
  const service = new DataIngestionService(db);

  // CSV missing 'sector' column in entities header
  const badEntitiesCsv = `entity_id,entity_name\nENT-99,Missing Sector Corp`;
  const resultCsv = service.ingestCsvTables({ entities: badEntitiesCsv });

  assert.equal(resultCsv.success, false);
  assert.ok(resultCsv.validation_errors.some(e => e.field === 'sector' && e.message.includes('Missing required column')));
  assert.equal(resultCsv.rows_accepted.total, 0);
  assert.equal(resultCsv.rows_rejected.entities, 1);

  // JSON missing required field
  const badJson = {
    entities: [{ entity_id: 'ENT-99', entity_name: '', sector: 'Energy' }] // missing entity_name
  };
  const resultJson = service.ingestDataset(badJson);
  assert.equal(resultJson.success, false);
  assert.ok(resultJson.validation_errors.some(e => e.field === 'entity_name'));

  db.close();
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
});

test('4. Ingestion: Malformed Values Rejection (Timestamps, Criticality, Durations, Booleans)', () => {
  const tempDbPath = path.resolve(process.cwd(), 'temp_test_malformed.db');
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  const db = new DatabaseService(tempDbPath);
  const service = new DataIngestionService(db);

  const malformedDataset = {
    entities: [
      { entity_id: 'ENT-M', entity_name: 'Malformed Inc', sector: 'Defence' }
    ],
    assets: [
      // Invalid criticality and invalid last_telemetry date
      { asset_id: 'AST-M1', entity_id: 'ENT-M', asset_type: 'Server', criticality: 'URGENT' as any, expected_telemetry: 'Daily', last_telemetry: 'not-a-valid-date' }
    ],
    alerts: [
      // Invalid timestamp and invalid status
      { alert_id: 'ALT-M1', timestamp: 'invalid-iso-timestamp', entity_id: 'ENT-M', asset_id: 'AST-M1', severity: 'EXTREME' as any, category: 'Malware', source_ip: null, destination_ip: null, status: 'PENDING' as any }
    ],
    cases: [
      // Invalid duration (< 0), invalid boolean for escalated ('maybe'), invalid opened_at
      { case_id: 'CAS-M1', alert_id: 'ALT-M1', entity_id: 'ENT-M', investigator: 'Inv', opened_at: 'bad-date', investigation_duration: -10, escalated: 'maybe' as any, closed_at: null, closure_reason: null, remediation_status: null }
    ]
  };

  const result = service.ingestDataset(malformedDataset);

  assert.equal(result.success, false);
  assert.equal(result.rows_accepted.total, 0);

  const fields = result.validation_errors.map(e => e.field);
  assert.ok(fields.includes('criticality'), 'Should reject invalid criticality');
  assert.ok(fields.includes('last_telemetry'), 'Should reject invalid last_telemetry');
  assert.ok(fields.includes('timestamp'), 'Should reject invalid alert timestamp');
  assert.ok(fields.includes('severity'), 'Should reject invalid severity');
  assert.ok(fields.includes('status'), 'Should reject invalid alert status');
  assert.ok(fields.includes('opened_at'), 'Should reject invalid opened_at');
  assert.ok(fields.includes('investigation_duration'), 'Should reject negative duration');
  assert.ok(fields.includes('escalated'), 'Should reject non-boolean escalated');

  db.close();
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
});

test('5. Ingestion: Broken Foreign Keys & Cross-Entity Mismatches', () => {
  const tempDbPath = path.resolve(process.cwd(), 'temp_test_fk.db');
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  const db = new DatabaseService(tempDbPath);
  const service = new DataIngestionService(db);

  const brokenFkDataset = {
    entities: [
      { entity_id: 'ENT-A', entity_name: 'Alpha Corp', sector: 'Telecom' },
      { entity_id: 'ENT-B', entity_name: 'Beta Corp', sector: 'Banking' }
    ],
    assets: [
      // References non-existent entity
      { asset_id: 'AST-GHOST', entity_id: 'ENT-NON_EXISTENT', asset_type: 'Router', criticality: 'LOW' as const, expected_telemetry: 'Daily', last_telemetry: null },
      { asset_id: 'AST-A', entity_id: 'ENT-A', asset_type: 'Router', criticality: 'LOW' as const, expected_telemetry: 'Daily', last_telemetry: null }
    ],
    alerts: [
      // Alert claims entity ENT-B, but references asset AST-A which belongs to ENT-A
      { alert_id: 'ALT-1', timestamp: '2026-09-26T00:00:00Z', entity_id: 'ENT-B', asset_id: 'AST-A', severity: 'LOW' as const, category: 'Scan', source_ip: null, destination_ip: null, status: 'CLOSED' as const },
      // Alert references non-existent asset
      { alert_id: 'ALT-2', timestamp: '2026-09-26T00:00:00Z', entity_id: 'ENT-A', asset_id: 'AST-MISSING', severity: 'LOW' as const, category: 'Scan', source_ip: null, destination_ip: null, status: 'CLOSED' as const }
    ],
    cases: [
      // Case claims entity ENT-A, but alert ALT-1 has entity ENT-B
      { case_id: 'CAS-1', alert_id: 'ALT-1', entity_id: 'ENT-A', investigator: 'Analyst', opened_at: '2026-09-26T00:10:00Z', investigation_duration: 10, escalated: 0, closed_at: null, closure_reason: null, remediation_status: null }
    ]
  };

  const result = service.ingestDataset(brokenFkDataset);

  assert.equal(result.success, false);
  const msgs = result.validation_errors.map(e => e.message);

  assert.ok(msgs.some(m => m.includes("Referenced entity_id 'ENT-NON_EXISTENT' does not exist")));
  assert.ok(msgs.some(m => m.includes("belongs to entity 'ENT-A', not 'ENT-B'")));
  assert.ok(msgs.some(m => m.includes("Referenced asset_id 'AST-MISSING' does not exist")));
  assert.ok(msgs.some(m => m.includes("does not match alert entity_id")));

  db.close();
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
});

test('6. Ingestion: Duplicate IDs Rejection', () => {
  const tempDbPath = path.resolve(process.cwd(), 'temp_test_dup.db');
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  const db = new DatabaseService(tempDbPath);
  const service = new DataIngestionService(db);

  const duplicateDataset = {
    entities: [
      { entity_id: 'ENT-DUP', entity_name: 'Original Entity', sector: 'Energy' },
      { entity_id: 'ENT-DUP', entity_name: 'Duplicate Entity', sector: 'Energy' }
    ],
    assets: [
      { asset_id: 'AST-DUP', entity_id: 'ENT-DUP', asset_type: 'SCADA', criticality: 'HIGH' as const, expected_telemetry: 'Daily', last_telemetry: null },
      { asset_id: 'AST-DUP', entity_id: 'ENT-DUP', asset_type: 'PLC', criticality: 'HIGH' as const, expected_telemetry: 'Daily', last_telemetry: null }
    ],
    alerts: [
      { alert_id: 'ALT-DUP', timestamp: '2026-09-26T12:00:00Z', entity_id: 'ENT-DUP', asset_id: 'AST-DUP', severity: 'HIGH' as const, category: 'Scan', source_ip: null, destination_ip: null, status: 'OPEN' as const },
      { alert_id: 'ALT-DUP', timestamp: '2026-09-26T12:05:00Z', entity_id: 'ENT-DUP', asset_id: 'AST-DUP', severity: 'HIGH' as const, category: 'Scan', source_ip: null, destination_ip: null, status: 'OPEN' as const }
    ],
    cases: [
      { case_id: 'CAS-DUP', alert_id: 'ALT-DUP', entity_id: 'ENT-DUP', investigator: 'Inv', opened_at: '2026-09-26T12:10:00Z', investigation_duration: 10, escalated: 0, closed_at: null, closure_reason: null, remediation_status: null },
      { case_id: 'CAS-DUP', alert_id: 'ALT-DUP', entity_id: 'ENT-DUP', investigator: 'Inv', opened_at: '2026-09-26T12:10:00Z', investigation_duration: 10, escalated: 0, closed_at: null, closure_reason: null, remediation_status: null }
    ]
  };

  const result = service.ingestDataset(duplicateDataset);

  assert.equal(result.success, false);
  const dupMsgs = result.validation_errors.map(e => e.message);
  assert.ok(dupMsgs.some(m => m.includes('Duplicate entity_id: ENT-DUP')));
  assert.ok(dupMsgs.some(m => m.includes('Duplicate asset_id: AST-DUP')));
  assert.ok(dupMsgs.some(m => m.includes('Duplicate alert_id: ALT-DUP')));
  assert.ok(dupMsgs.some(m => m.includes('Duplicate case_id: CAS-DUP')));

  db.close();
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
});

test('7. Ingestion: Empty Files and Empty Datasets Rejection', () => {
  const tempDbPath = path.resolve(process.cwd(), 'temp_test_empty.db');
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

  const db = new DatabaseService(tempDbPath);
  const service = new DataIngestionService(db);

  // 1. Completely empty CSV string
  const resEmptyCsv = service.ingestCsvTables({ entities: '' });
  assert.equal(resEmptyCsv.success, false);
  assert.ok(resEmptyCsv.validation_errors.some(e => e.message.includes('empty or contains no records')));

  // 2. CSV with only whitespace
  const resWhitespaceCsv = service.ingestCsvTables({ entities: '   \n  \r\n  ' });
  assert.equal(resWhitespaceCsv.success, false);
  assert.ok(resWhitespaceCsv.validation_errors.some(e => e.message.includes('empty or contains no records')));

  // 3. CSV with header only, 0 data rows
  const resHeaderOnlyCsv = service.ingestCsvTables({ entities: 'entity_id,entity_name,sector\n' });
  assert.equal(resHeaderOnlyCsv.success, false);
  assert.ok(resHeaderOnlyCsv.validation_errors.some(e => e.message.includes('empty or contains no records')));

  // 4. Empty JSON object
  const resEmptyJson = service.ingestDataset({});
  assert.equal(resEmptyJson.success, false);
  assert.ok(resEmptyJson.validation_errors.some(e => e.message.includes('empty or contains no records')));

  // 5. Empty arrays
  const resEmptyArrays = service.ingestDataset({ entities: [], assets: [], alerts: [], cases: [] });
  assert.equal(resEmptyArrays.success, false);
  assert.ok(resEmptyArrays.validation_errors.some(e => e.message.includes('empty or contains no records')));

  db.close();
  if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
});
