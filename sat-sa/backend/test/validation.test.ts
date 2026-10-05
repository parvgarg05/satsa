import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseService } from '../src/db.js';

function setup(name: string) {
  const dbPath = path.resolve(process.cwd(), name);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = new DatabaseService(dbPath);
  const rawDb = db.getRawDb();
  rawDb.exec("INSERT INTO entities (entity_id, entity_name, sector) VALUES ('E-1', 'Entity One', 'Energy'), ('E-2', 'Entity Two', 'Banking')");
  const finding = rawDb.prepare(`INSERT INTO supervisory_findings (finding_id, entity_id, finding_type, severity, title, rationale, evidence_ids, supporting_metrics, created_at) VALUES (?, ?, ?, 'HIGH', ?, 'Rationale', '[]', '{}', '2026-09-28T00:00:00Z')`);
  finding.run('F-1', 'E-1', 'EXECUTION_GAP', 'Fast closure');
  finding.run('F-2', 'E-1', 'NEGATIVE_SPACE', 'Missing telemetry');
  finding.run('F-3', 'E-2', 'ANOMALY', 'Outlier');
  return { db, dbPath };
}

test('expert finding labels validate IDs, labels, timestamps, and duplicate rows', () => {
  const { db, dbPath } = setup('temp_test_validation_import.db');
  const result = db.insertExpertFindingLabels([
    { finding_id: 'F-1', entity_id: 'E-1', expert_label: 'CONFIRMED', reviewer_id: 'reviewer-a', review_timestamp: '2026-09-28T10:00:00Z', rationale: 'Reviewed evidence' },
    { finding_id: 'F-1', entity_id: 'E-1', expert_label: 'NOT_CONFIRMED', reviewer_id: 'reviewer-a', review_timestamp: '2026-09-28T10:01:00Z', rationale: 'Duplicate upload row' },
    { finding_id: 'MISSING', entity_id: 'E-1', expert_label: 'CONFIRMED', reviewer_id: 'reviewer-a', review_timestamp: '2026-09-28T10:00:00Z', rationale: '' },
    { finding_id: 'F-2', entity_id: 'E-2', expert_label: 'UNKNOWN', reviewer_id: '', review_timestamp: 'bad-date', rationale: '' }
  ]);
  assert.equal(result.accepted, 1);
  assert.equal(result.rejected, 3);
  assert.ok(result.errors.some(error => error.message.includes('Duplicate finding_id')));
  assert.ok(result.errors.some(error => error.message.includes('does not exist')));
  assert.ok(result.errors.some(error => error.field === 'expert_label'));
  assert.ok(result.errors.some(error => error.field === 'reviewer_id'));
  assert.ok(result.errors.some(error => error.field === 'review_timestamp'));
  assert.equal((db.getRawDb().prepare('SELECT COUNT(*) AS count FROM expert_finding_labels').get() as { count: number }).count, 1);
  assert.ok((db.getRawDb().prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE operation = 'CREATE_EXPERT_FINDING_LABEL'").get() as { count: number }).count >= 1);
  db.close();
  fs.unlinkSync(dbPath);
});

test('validation runs calculate binary metrics, module/entity summaries, and deterministic IDs', () => {
  const { db, dbPath } = setup('temp_test_validation_run.db');
  db.insertExpertFindingLabels([
    { finding_id: 'F-1', entity_id: 'E-1', expert_label: 'CONFIRMED', reviewer_id: 'reviewer-a', review_timestamp: '2026-09-28T10:00:00Z', rationale: 'Confirmed' },
    { finding_id: 'F-2', entity_id: 'E-1', expert_label: 'NOT_CONFIRMED', reviewer_id: 'reviewer-a', review_timestamp: '2026-09-28T10:01:00Z', rationale: 'Not confirmed' },
    { finding_id: 'F-3', entity_id: 'E-2', expert_label: 'CONFIRMED', reviewer_id: 'reviewer-b', review_timestamp: '2026-09-28T10:02:00Z', rationale: 'Confirmed' }
  ]);
  const run1 = db.createValidationRun() as any;
  const run2 = db.createValidationRun() as any;
  assert.equal(run1.validation_run_id, run2.validation_run_id);
  assert.equal(run1.metrics.sample_count, 3);
  assert.equal(run1.metrics.true_positives, 2);
  assert.equal(run1.metrics.false_positives, 1);
  assert.equal(run1.metrics.false_negatives, 0);
  assert.equal(run1.metrics.true_negatives, 0);
  assert.equal(run1.metrics.precision, 2 / 3);
  assert.equal(run1.metrics.recall, 1);
  assert.equal(run1.metrics.f1_score, 0.8);
  assert.equal(run1.metrics.accuracy, null);
  assert.equal(run1.module_metrics.EXECUTION_GAP.sample_count, 1);
  assert.equal(run1.module_metrics.NEGATIVE_SPACE.sample_count, 1);
  assert.equal(run1.module_metrics.ANOMALY.sample_count, 1);
  assert.equal(run1.entity_metrics['E-1'].sample_count, 2);
  assert.equal(run1.entity_metrics['E-2'].sample_count, 1);
  assert.equal((db.getValidationSummary() as any).available, true);
  assert.equal((db.getRawDb().prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE operation = 'CREATE_VALIDATION_RUN'").get() as { count: number }).count, 2);
  db.close();
  fs.unlinkSync(dbPath);
});

test('zero-label validation exposes the required empty state without metrics', () => {
  const { db, dbPath } = setup('temp_test_validation_empty.db');
  const summary = db.getValidationSummary() as any;
  assert.equal(summary.available, false);
  assert.equal(summary.message, 'No expert-labelled validation data available.');
  assert.equal(summary.label_count, 0);
  assert.equal(summary.latest_run, null);
  assert.throws(() => db.createValidationRun(), /No expert-labelled validation data available/);
  db.close();
  fs.unlinkSync(dbPath);
});

test('one-class validation explains the limitation instead of fabricating balanced metrics', () => {
  const { db, dbPath } = setup('temp_test_validation_one_class.db');
  db.insertExpertFindingLabels([
    { finding_id: 'F-1', entity_id: 'E-1', expert_label: 'CONFIRMED', reviewer_id: 'reviewer-a', review_timestamp: '2026-09-28T10:00:00Z', rationale: 'Confirmed' }
  ]);
  const run = db.createValidationRun() as any;
  assert.equal(run.metrics.precision, 1);
  assert.equal(run.metrics.recall, 1);
  assert.equal(run.metrics.f1_score, 1);
  assert.equal(run.metrics.accuracy, null);
  assert.match(run.metrics.one_class_explanation, /Only one expert-label class/);
  db.close();
  fs.unlinkSync(dbPath);
});
