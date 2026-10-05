import { test } from 'node:test';
import * as assert from 'node:assert';
import { DatabaseService } from '../src/db';

test('Audit Integrity Hash Chain', () => {
  const db = new DatabaseService(':memory:');
  
  // Log 3 items
  db.logAudit('TEST_OP_1', { data: 1 });
  db.logAudit('TEST_OP_2', { data: 2 });
  db.logAudit('TEST_OP_3', { data: 3 });

  // Verify
  const result = db.verifyAuditIntegrity();
  assert.equal(result.valid, true, 'Audit chain should be valid');

  // Tamper
  const rawDb = db.getRawDb();
  rawDb.exec(`UPDATE audit_logs SET details = '{"data":999}' WHERE operation = 'TEST_OP_2'`);

  // Verify should fail
  const failedResult = db.verifyAuditIntegrity();
  assert.equal(failedResult.valid, false, 'Tampered audit chain should fail');
  assert.ok(failedResult.errors.length > 0);
  assert.ok(failedResult.errors[0].includes('Hash mismatch'));
});
