import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { DatabaseService } from '../src/db.js';
import { AnalyticsService } from '../src/analytics.service.js';
import { AssessmentService } from '../src/assessment.service.js';
import { DataIngestionService } from '../src/ingestion.js';
import { createApiRouter } from '../src/routes.js';

test('Assessment Isolation: Complete isolation between Dataset A and Dataset B', async () => {
  const testDir = path.resolve(process.cwd(), 'temp_test_assessments');
  const defaultDbPath = path.resolve(testDir, 'sat_sa_test_default.db');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const assessmentService = new AssessmentService(defaultDbPath, path.resolve(testDir, 'assessments'));

  // 1. Initial baseline assessment check
  assert.equal(assessmentService.getActiveAssessmentId(), 'ASM-DEFAULT');
  const initialList = assessmentService.listAssessments();
  assert.equal(initialList.length, 1);
  assert.equal(initialList[0].assessment_id, 'ASM-DEFAULT');
  assert.equal(initialList[0].is_active, true);

  // 2. Create Assessment A and ingest Dataset A
  const assessmentA = assessmentService.createAssessment('Assessment A - Q1 2026', 'Quarter 1 Audit', 'ASM-TEST-A');
  assert.equal(assessmentA.assessment_id, 'ASM-TEST-A');
  assert.equal(assessmentService.getActiveAssessmentId(), 'ASM-TEST-A');

  const dbA = assessmentService.getDbForAssessment('ASM-TEST-A');
  const ingestionA = new DataIngestionService(dbA);

  const datasetA = {
    entities: [
      { entity_id: 'ENT-A1', entity_name: 'Bank Alpha One', sector: 'Banking' },
      { entity_id: 'ENT-A2', entity_name: 'Bank Alpha Two', sector: 'Banking' }
    ],
    assets: [
      {
        asset_id: 'AST-A1',
        entity_id: 'ENT-A1',
        asset_type: 'Database',
        criticality: 'CRITICAL' as const,
        expected_telemetry: 'syslog',
        last_telemetry: new Date().toISOString()
      },
      {
        asset_id: 'AST-A2',
        entity_id: 'ENT-A2',
        asset_type: 'Server',
        criticality: 'HIGH' as const,
        expected_telemetry: 'edr',
        last_telemetry: new Date().toISOString()
      }
    ],
    alerts: [
      {
        alert_id: 'ALT-A1',
        timestamp: new Date().toISOString(),
        entity_id: 'ENT-A1',
        asset_id: 'AST-A1',
        severity: 'CRITICAL' as const,
        category: 'Malware',
        status: 'OPEN' as const
      },
      {
        alert_id: 'ALT-A2',
        timestamp: new Date().toISOString(),
        entity_id: 'ENT-A2',
        asset_id: 'AST-A2',
        severity: 'HIGH' as const,
        category: 'Exfiltration',
        status: 'OPEN' as const
      }
    ],
    cases: [
      {
        case_id: 'CAS-A1',
        alert_id: 'ALT-A1',
        entity_id: 'ENT-A1',
        investigator: 'Analyst A',
        opened_at: new Date().toISOString(),
        investigation_duration: 30,
        escalated: 1
      },
      {
        case_id: 'CAS-A2',
        alert_id: 'ALT-A2',
        entity_id: 'ENT-A2',
        investigator: 'Analyst A',
        opened_at: new Date().toISOString(),
        investigation_duration: 45,
        escalated: 0
      }
    ]
  };

  const resA = ingestionA.ingestDataset(datasetA, true);
  assert.equal(resA.success, true);
  const countsA = dbA.getCounts();
  assert.equal(countsA.entities, 2);
  assert.equal(countsA.assets, 2);
  assert.equal(countsA.alerts, 2);
  assert.equal(countsA.cases, 2);

  // 3. Create Assessment B and ingest completely different Dataset B
  const assessmentB = assessmentService.createAssessment('Assessment B - Q2 2026', 'Quarter 2 Audit', 'ASM-TEST-B');
  assert.equal(assessmentB.assessment_id, 'ASM-TEST-B');
  assert.equal(assessmentService.getActiveAssessmentId(), 'ASM-TEST-B');

  const dbB = assessmentService.getDbForAssessment('ASM-TEST-B');
  const ingestionB = new DataIngestionService(dbB);

  const datasetB = {
    entities: [
      { entity_id: 'ENT-B1', entity_name: 'Energy Beta 1', sector: 'Energy' },
      { entity_id: 'ENT-B2', entity_name: 'Energy Beta 2', sector: 'Energy' },
      { entity_id: 'ENT-B3', entity_name: 'Energy Beta 3', sector: 'Energy' },
      { entity_id: 'ENT-B4', entity_name: 'Energy Beta 4', sector: 'Energy' }
    ],
    assets: [
      {
        asset_id: 'AST-B1',
        entity_id: 'ENT-B1',
        asset_type: 'SCADA',
        criticality: 'CRITICAL' as const,
        expected_telemetry: 'modbus',
        last_telemetry: new Date().toISOString()
      }
    ],
    alerts: [
      {
        alert_id: 'ALT-B1',
        timestamp: new Date().toISOString(),
        entity_id: 'ENT-B1',
        asset_id: 'AST-B1',
        severity: 'CRITICAL' as const,
        category: 'Brute Force',
        status: 'OPEN' as const
      }
    ],
    cases: [
      {
        case_id: 'CAS-B1',
        alert_id: 'ALT-B1',
        entity_id: 'ENT-B1',
        investigator: 'Analyst B',
        opened_at: new Date().toISOString(),
        investigation_duration: 15,
        escalated: 0
      }
    ]
  };

  const resB = ingestionB.ingestDataset(datasetB, true);
  assert.equal(resB.success, true);

  // 4. Verify ZERO data leakage in Database B:
  const countsB = dbB.getCounts();
  assert.equal(countsB.entities, 4, 'Assessment B must have exactly 4 entities');
  assert.equal(countsB.assets, 1, 'Assessment B must have exactly 1 asset');
  assert.equal(countsB.alerts, 1, 'Assessment B must have exactly 1 alert');
  assert.equal(countsB.cases, 1, 'Assessment B must have exactly 1 case');

  // Verify none of Dataset A's entities exist in Assessment B
  assert.equal(dbB.getEntity('ENT-A1'), null, 'Dataset A entity ENT-A1 must NOT exist in Assessment B');
  assert.equal(dbB.getEntity('ENT-A2'), null, 'Dataset A entity ENT-A2 must NOT exist in Assessment B');
  assert.equal(dbB.getAlert('ALT-A1'), null, 'Dataset A alert ALT-A1 must NOT exist in Assessment B');

  // 5. Switch back to Assessment A and verify ZERO data leakage from Dataset B:
  assessmentService.setActiveAssessment('ASM-TEST-A');
  assert.equal(assessmentService.getActiveAssessmentId(), 'ASM-TEST-A');

  const countsA_after = dbA.getCounts();
  assert.equal(countsA_after.entities, 2, 'Assessment A must still have exactly 2 entities');
  assert.equal(countsA_after.assets, 2, 'Assessment A must still have exactly 2 assets');
  assert.equal(countsA_after.alerts, 2, 'Assessment A must still have exactly 2 alerts');
  assert.equal(countsA_after.cases, 2, 'Assessment A must still have exactly 2 cases');

  // Verify none of Dataset B's entities exist in Assessment A
  assert.equal(dbA.getEntity('ENT-B1'), null, 'Dataset B entity ENT-B1 must NOT exist in Assessment A');
  assert.equal(dbA.getEntity('ENT-B2'), null, 'Dataset B entity ENT-B2 must NOT exist in Assessment A');
  assert.equal(dbA.getAlert('ALT-B1'), null, 'Dataset B alert ALT-B1 must NOT exist in Assessment A');

  // 6. Test REST API endpoints with Assessment Isolation
  const app = express();
  app.use(express.json());
  const defaultDb = new DatabaseService(defaultDbPath);
  const defaultAnalytics = AnalyticsService.getInstance(path.resolve(testDir, 'cache_default.json'));
  app.use('/api', createApiRouter(defaultDb, defaultAnalytics, assessmentService));

  const server = app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  try {
    // A. List assessments endpoint
    const listRes = await fetch(`${baseUrl}/assessments`);
    const listData = await listRes.json();
    assert.equal(listData.success, true);
    assert.equal(listData.active_assessment_id, 'ASM-TEST-A');
    assert.equal(listData.assessments.length, 3); // DEFAULT, TEST-A, TEST-B

    // B. Dashboard query for Assessment A
    const dashResA = await fetch(`${baseUrl}/dashboard`);
    const dashDataA = await dashResA.json();
    assert.equal(dashDataA.success, true);
    assert.equal(dashDataA.assessment_id, 'ASM-TEST-A');
    assert.equal(dashDataA.total_entities, 2, 'Dashboard A must show 2 entities');
    assert.equal(dashDataA.useful_aggregate_metrics.total_alerts, 2, 'Dashboard A must show 2 alerts');

    // C. Dashboard query using explicit X-Assessment-Id header for Assessment B
    const dashResB = await fetch(`${baseUrl}/dashboard`, {
      headers: { 'X-Assessment-Id': 'ASM-TEST-B' }
    });
    const dashDataB = await dashResB.json();
    assert.equal(dashDataB.success, true);
    assert.equal(dashDataB.assessment_id, 'ASM-TEST-B');
    assert.equal(dashDataB.total_entities, 4, 'Dashboard B must show 4 entities');
    assert.equal(dashDataB.useful_aggregate_metrics.total_alerts, 1, 'Dashboard B must show 1 alert');

    // D. Switch active assessment via API to Assessment B
    const activateRes = await fetch(`${baseUrl}/assessments/ASM-TEST-B/activate`, { method: 'POST' });
    const activateData = await activateRes.json();
    assert.equal(activateData.success, true);
    assert.equal(activateData.active_assessment_id, 'ASM-TEST-B');

    // E. Default Dashboard query now immediately returns Assessment B
    const dashResActiveB = await fetch(`${baseUrl}/dashboard`);
    const dashDataActiveB = await dashResActiveB.json();
    assert.equal(dashDataActiveB.assessment_id, 'ASM-TEST-B');
    assert.equal(dashDataActiveB.total_entities, 4);

    // F. Test deletion rules: cannot delete active assessment or default assessment
    const delActiveRes = await fetch(`${baseUrl}/assessments/ASM-TEST-B`, { method: 'DELETE' });
    assert.equal(delActiveRes.status, 400);

    const delDefaultRes = await fetch(`${baseUrl}/assessments/ASM-DEFAULT`, { method: 'DELETE' });
    assert.equal(delDefaultRes.status, 400);

    // G. Switch to default and delete Assessment A
    await fetch(`${baseUrl}/assessments/ASM-DEFAULT/activate`, { method: 'POST' });
    const delResA = await fetch(`${baseUrl}/assessments/ASM-TEST-A`, { method: 'DELETE' });
    const delDataA = await delResA.json();
    assert.equal(delDataA.success, true);

    const listAfterDel = await (await fetch(`${baseUrl}/assessments`)).json();
    assert.equal(listAfterDel.assessments.find((a: any) => a.assessment_id === 'ASM-TEST-A'), undefined);
  } finally {
    server.close();
    defaultDb.close();
    try {
      dbA.close();
      dbB.close();
    } catch {}
    if (fs.existsSync(testDir)) {
      try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
    }
  }
});
