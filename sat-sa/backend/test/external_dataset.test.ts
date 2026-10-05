import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseService } from '../src/db.js';
import { ExternalDatasetService } from '../src/external.js';

const sourcePath = path.resolve(process.cwd(), '../datasets/external/redteam.txt/redteam.txt');

function tempDb(name: string) {
  const dbPath = path.resolve(process.cwd(), name);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  return dbPath;
}

test('LANL adapter preserves exact schema, count, duplicates, provenance, and isolation', () => {
  const source = fs.readFileSync(sourcePath);
  const dbPath = tempDb('temp_test_external_lanl.db');
  const db = new DatabaseService(dbPath);
  const service = new ExternalDatasetService(db);

  const summary = service.ingestLanlRedteam(source, 'redteam.txt.gz');
  assert.equal(summary.record_count, 749);
  assert.equal(summary.duplicate_count, 34);
  assert.equal(summary.schema, 'column_1,column_2,column_3,column_4');
  assert.equal(summary.schema_version, 'positional-v1');
  assert.equal(summary.source_file, 'redteam.txt.gz');
  assert.equal(summary.provenance.original_content_preserved, true);
  assert.equal(summary.provenance.synthetic_sat_sa_fields_created, false);
  assert.equal(summary.provenance.acquisition_date, null);
  assert.equal(summary.field_mapping.length, 4);
  assert.ok(summary.field_mapping.every(mapping => mapping.mapping_type === 'NOT_AVAILABLE'));
  assert.ok(summary.field_mapping.every(mapping => mapping.sat_sa_field === null));
  assert.match(summary.dataset_id, /^LANL-REDTEAM-[A-F0-9]{16}$/);

  const rawDb = db.getRawDb();
  const importRow = rawDb.prepare('SELECT raw_content, record_count, duplicate_count, provenance FROM external_dataset_imports WHERE dataset_id = ?').get(summary.dataset_id) as { raw_content: Uint8Array; record_count: number; duplicate_count: number; provenance: string };
  assert.equal(Buffer.from(importRow.raw_content).equals(source), true);
  assert.equal(importRow.record_count, 749);
  assert.equal(importRow.duplicate_count, 34);
  assert.equal(JSON.parse(importRow.provenance).synthetic_sat_sa_fields_created, false);

  const eventCount = (rawDb.prepare('SELECT COUNT(*) AS count FROM external_redteam_events WHERE dataset_id = ?').get(summary.dataset_id) as { count: number }).count;
  const duplicateRows = (rawDb.prepare('SELECT COUNT(*) AS count FROM external_redteam_events WHERE dataset_id = ? AND duplicate_of_event_id IS NOT NULL').get(summary.dataset_id) as { count: number }).count;
  assert.equal(eventCount, 749);
  assert.equal(duplicateRows, 34);
  const first = service.getEvent(summary.dataset_id, `LANL-RT-${summary.source_sha256.slice(0, 16).toUpperCase()}-0001`);
  assert.deepEqual(first && [first.source_row_number, first.column_1, first.column_2, first.column_3, first.column_4], [1, '150885', 'U620@DOM1', 'C17693', 'C1003']);
  assert.equal(first?.raw_record, '150885,U620@DOM1,C17693,C1003');
  assert.equal(first?.duplicate_of_event_id, null);

  const tableNames = (rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(row => row.name);
  assert.ok(tableNames.includes('external_dataset_imports'));
  assert.ok(tableNames.includes('external_redteam_events'));
  const eventColumns = (rawDb.prepare('PRAGMA table_info(external_redteam_events)').all() as Array<{ name: string }>).map(column => column.name);
  assert.deepEqual(eventColumns, [
    'dataset_id', 'event_id', 'source_row_number', 'raw_record', 'raw_record_sha256',
    'column_1', 'column_2', 'column_3', 'column_4', 'duplicate_of_event_id'
  ]);
  assert.equal(eventColumns.includes('severity'), false);
  assert.equal(eventColumns.includes('case_id'), false);
  assert.equal(eventColumns.includes('escalated'), false);
  assert.equal((rawDb.prepare('SELECT COUNT(*) AS count FROM entities').get() as { count: number }).count, 0);
  assert.equal((rawDb.prepare('SELECT COUNT(*) AS count FROM alerts').get() as { count: number }).count, 0);
  assert.equal((rawDb.prepare('SELECT COUNT(*) AS count FROM cases').get() as { count: number }).count, 0);

  db.clearAll();
  assert.equal((rawDb.prepare('SELECT COUNT(*) AS count FROM external_redteam_events').get() as { count: number }).count, 749);
  db.close();
  fs.unlinkSync(dbPath);
});

test('LANL event IDs are deterministic and re-ingestion is idempotent', () => {
  const source = fs.readFileSync(sourcePath);
  const firstDbPath = tempDb('temp_test_external_lanl_a.db');
  const secondDbPath = tempDb('temp_test_external_lanl_b.db');
  const firstDb = new DatabaseService(firstDbPath);
  const secondDb = new DatabaseService(secondDbPath);
  const firstSummary = new ExternalDatasetService(firstDb).ingestLanlRedteam(source, 'redteam.txt');
  const secondService = new ExternalDatasetService(secondDb);
  const secondSummary = secondService.ingestLanlRedteam(source, 'redteam.txt');
  secondService.ingestLanlRedteam(source, 'redteam.txt');

  assert.equal(firstSummary.dataset_id, secondSummary.dataset_id);
  assert.equal(firstSummary.source_sha256, secondSummary.source_sha256);
  const firstEvent = firstDb.getRawDb().prepare('SELECT event_id, raw_record_sha256 FROM external_redteam_events ORDER BY source_row_number LIMIT 1').get() as { event_id: string; raw_record_sha256: string };
  const secondEvent = secondDb.getRawDb().prepare('SELECT event_id, raw_record_sha256 FROM external_redteam_events ORDER BY source_row_number LIMIT 1').get() as { event_id: string; raw_record_sha256: string };
  assert.deepEqual(firstEvent, secondEvent);
  assert.equal((secondDb.getRawDb().prepare('SELECT COUNT(*) AS count FROM external_dataset_imports').get() as { count: number }).count, 1);
  assert.equal((secondDb.getRawDb().prepare('SELECT COUNT(*) AS count FROM external_redteam_events').get() as { count: number }).count, 749);

  firstDb.close();
  secondDb.close();
  fs.unlinkSync(firstDbPath);
  fs.unlinkSync(secondDbPath);
});
