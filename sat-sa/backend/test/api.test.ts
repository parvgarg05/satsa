import test from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { app, dbService, analyticsService } from '../src/index.js';
import { DataIngestionService } from '../src/ingestion.js';

let server: Server;
let baseUrl: string;

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });

  // Ensure default assessment is active
  await fetch(`${baseUrl}/api/assessments/ASM-DEFAULT/activate`, { method: 'POST' });

  // Ensure sample data is present if db was cleared
  const counts = dbService.getCounts();
  if (counts.entities < 20) {
    const samplePath = path.resolve(process.cwd(), '../data/sample/dataset.json');
    if (fs.existsSync(samplePath)) {
      const rawJson = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
      const ingestion = new DataIngestionService(dbService);
      ingestion.ingestDataset(rawJson, true);
    }
  }

  // Ensure analytics cache is primed
  await analyticsService.getOrRunAnalysis(dbService.getDbPath());
});

test.after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

test('1. Health Endpoint: GET /api/health', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'ok');
  assert.equal(data.service, 'sat-sa-backend');
  assert.equal(data.database, 'sqlite-connected');
  assert.ok(data.db_counts.entities >= 20);
});

test('2. Dashboard Endpoint: GET /api/dashboard', async () => {
  const res = await fetch(`${baseUrl}/api/dashboard`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.ok(data.total_entities >= 20, `Expected >= 20 total_entities, got ${data.total_entities}`);

  // Risk distribution
  assert.ok(data.risk_distribution);
  assert.ok(typeof data.risk_distribution.CRITICAL === 'number');
  assert.ok(typeof data.risk_distribution.HIGH === 'number');
  assert.ok(typeof data.risk_distribution.MEDIUM === 'number');
  assert.ok(typeof data.risk_distribution.LOW === 'number');

  // High / Critical entities list
  assert.ok(Array.isArray(data.high_critical_entities));
  assert.ok(data.high_critical_entities.length >= 1, 'Should include at least CSE-007');
  const cse007InHigh = data.high_critical_entities.find((e: any) => e.entity_id === 'CSE-007');
  assert.ok(cse007InHigh, 'CSE-007 must be in high/critical list');
  assert.ok(['HIGH', 'CRITICAL'].includes(cse007InHigh.risk_level));
  assert.ok(cse007InHigh.risk_score >= 60);

  // Finding counts by type
  assert.ok(data.finding_counts_by_type);
  assert.ok(data.finding_counts_by_type.EXECUTION_GAP >= 10);
  assert.ok(data.finding_counts_by_type.NEGATIVE_SPACE >= 1);
  assert.ok(data.finding_counts_by_type.ANOMALY >= 1);
  assert.ok(data.finding_counts_by_type.PEER_DEVIATION >= 1);
  assert.ok(data.finding_counts_by_type.REPEATED_INCIDENT >= 10);

  // Severity distribution
  assert.ok(data.severity_distribution);
  assert.ok(data.severity_distribution.CRITICAL > 0);
  assert.ok(data.severity_distribution.HIGH > 0);
  assert.ok(data.severity_distribution.MEDIUM > 0);

  // Aggregate metrics
  assert.ok(data.useful_aggregate_metrics);
  assert.ok((data.useful_aggregate_metrics.total_entities ?? data.total_entities) >= 20);
  assert.ok(data.useful_aggregate_metrics.total_alerts >= 1000);
  assert.ok(data.useful_aggregate_metrics.total_cases >= 1000);
  assert.ok(data.useful_aggregate_metrics.total_assets >= 300);
  assert.ok(data.useful_aggregate_metrics.average_risk_score > 0);
});

test('3. Entities List Endpoint: GET /api/entities', async () => {
  const res = await fetch(`${baseUrl}/api/entities`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.ok(data.count >= 20, `Expected >= 20 entities, got ${data.count}`);
  assert.ok(data.entities.length >= 20, `Expected >= 20 entities array, got ${data.entities.length}`);

  // First entity must be highest risk (CSE-007)
  assert.equal(data.entities[0].entity_id, 'CSE-007');
  assert.ok(data.entities[0].risk_score > data.entities[1].risk_score, 'CSE-007 must have strictly higher score than second place');

  // Verify structure of entity summary
  const ent = data.entities[0];
  assert.ok(ent.entity_id);
  assert.ok(ent.entity_name);
  assert.ok(ent.sector);
  assert.ok(typeof ent.risk_score === 'number');
  assert.ok(ent.risk_level);
  assert.ok(typeof ent.finding_count === 'number');
  assert.ok(ent.top_severity);
  assert.ok(ent.component_scores);

  // Test sector filter
  const energyRes = await fetch(`${baseUrl}/api/entities?sector=Energy`);
  const energyData = await energyRes.json();
  assert.ok(energyData.count > 0);
  for (const e of energyData.entities) {
    assert.equal(e.sector.toLowerCase(), 'energy');
  }

  // Test risk level filter
  const lowRes = await fetch(`${baseUrl}/api/entities?risk_level=LOW`);
  const lowData = await lowRes.json();
  assert.ok(lowData.count >= 1);
  for (const e of lowData.entities) {
    assert.equal(e.risk_level, 'LOW');
  }
});

test('4. Entity Detail: GET /api/entities/CSE-007', async () => {
  const res = await fetch(`${baseUrl}/api/entities/CSE-007`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.equal(data.entity_id, 'CSE-007');
  assert.equal(data.entity_name, 'National Power Transmission Sub-tier A');
  assert.equal(data.sector, 'Energy');
  assert.ok(['HIGH', 'CRITICAL'].includes(data.risk_level));
  assert.ok(data.risk_score >= 60, `Score expected >= 60, got ${data.risk_score}`);

  // Component scores must contain all 5 modules
  assert.ok(data.component_scores.EXECUTION_GAP);
  assert.ok(data.component_scores.NEGATIVE_SPACE);
  assert.ok(data.component_scores.ANOMALY);
  assert.ok(data.component_scores.PEER_DEVIATION);
  assert.ok(data.component_scores.REPEATED_INCIDENT);

  // Findings list must be non-empty and specific to CSE-007
  assert.ok(Array.isArray(data.findings));
  assert.ok(data.findings.length >= 10);
  for (const f of data.findings) {
    assert.equal(f.entity_id, 'CSE-007');
  }

  // Explanation must be present and contain formula and summary
  assert.ok(data.explanation);
  assert.equal(data.explanation.entity_id, 'CSE-007');
  assert.ok(data.explanation.score_formula.includes('0.30'));
  assert.ok(data.explanation.summary.includes(data.risk_level));
  assert.ok(Array.isArray(data.explanation.module_breakdown));

  // Evidence references
  assert.ok(data.evidence_references);
  assert.ok(data.evidence_references.total_assets > 0);
  assert.ok(data.evidence_references.total_alerts > 0);
  assert.ok(Array.isArray(data.evidence_references.critical_assets));
});

test('5. Entity Detail: GET /api/entities/NON_EXISTENT returns 404', async () => {
  const res = await fetch(`${baseUrl}/api/entities/NON_EXISTENT_999`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.success, false);
  assert.ok(data.error);
});

test('6. Findings List: GET /api/findings', async () => {
  const res = await fetch(`${baseUrl}/api/findings`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.ok(data.count >= 10);
  assert.equal(data.findings.length, data.count);

  const first = data.findings[0];
  assert.ok(first.finding_id);
  assert.ok(first.entity_id);
  assert.ok(first.finding_type);
  assert.ok(first.severity);
  assert.ok(first.title);
  assert.ok(first.rationale);
  assert.ok(Array.isArray(first.evidence_ids));

  // Filter by entity_id
  const cseRes = await fetch(`${baseUrl}/api/findings?entity_id=CSE-007`);
  const cseData = await cseRes.json();
  assert.ok(cseData.count >= 10);
  for (const f of cseData.findings) {
    assert.equal(f.entity_id, 'CSE-007');
  }

  // Filter by severity
  const critRes = await fetch(`${baseUrl}/api/findings?severity=CRITICAL`);
  const critData = await critRes.json();
  assert.ok(critData.count > 0);
  for (const f of critData.findings) {
    assert.equal(f.severity, 'CRITICAL');
  }
});

test('7. Finding Detail: GET /api/findings/:id', async () => {
  // First fetch a valid finding ID
  const listRes = await fetch(`${baseUrl}/api/findings?entity_id=CSE-007`);
  const listData = await listRes.json();
  const sampleFinding = listData.findings[0];

  const res = await fetch(`${baseUrl}/api/findings/${sampleFinding.finding_id}`);
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.equal(data.finding_id, sampleFinding.finding_id);
  assert.equal(data.entity_id, 'CSE-007');
  assert.ok(data.title);
  assert.ok(data.rationale);
  assert.ok(Array.isArray(data.evidence_ids));

  // 404 for invalid finding
  const badRes = await fetch(`${baseUrl}/api/findings/NOT_A_REAL_FINDING`);
  assert.equal(badRes.status, 404);
});

test('8. Evidence Drill-Down: Alert, Case, Asset, and Finding Lookups', async () => {
  // Test alert lookup
  const alertRes = await fetch(`${baseUrl}/api/evidence/ALT-00440`);
  assert.equal(alertRes.status, 200);
  const alertData = await alertRes.json();
  assert.equal(alertData.success, true);
  assert.equal(alertData.evidence_type, 'alert');
  assert.equal(alertData.alert.alert_id, 'ALT-00440');
  assert.equal(alertData.alert.entity_id, 'CSE-007');

  // Test case lookup
  const caseRes = await fetch(`${baseUrl}/api/evidence/CAS-00386`);
  assert.equal(caseRes.status, 200);
  const caseData = await caseRes.json();
  assert.equal(caseData.success, true);
  assert.equal(caseData.evidence_type, 'case');
  assert.equal(caseData.case.case_id, 'CAS-00386');

  // Test asset lookup
  const assetRes = await fetch(`${baseUrl}/api/evidence/AST-007-01`);
  assert.equal(assetRes.status, 200);
  const assetData = await assetRes.json();
  assert.equal(assetData.success, true);
  assert.equal(assetData.evidence_type, 'asset');
  assert.equal(assetData.asset.asset_id, 'AST-007-01');
  assert.equal(assetData.asset.entity_id, 'CSE-007');
  assert.ok(Array.isArray(assetData.recent_alerts));

  // Test finding drilldown lookup
  const listRes = await fetch(`${baseUrl}/api/findings?entity_id=CSE-007`);
  const listData = await listRes.json();
  const egFinding = listData.findings.find((f: any) => f.evidence_ids.length > 0);
  assert.ok(egFinding);

  const findingEvRes = await fetch(`${baseUrl}/api/evidence/${egFinding.finding_id}`);
  assert.equal(findingEvRes.status, 200);
  const findingEvData = await findingEvRes.json();
  assert.equal(findingEvData.success, true);
  assert.equal(findingEvData.evidence_type, 'finding_drilldown');
  assert.ok(findingEvData.evidence_records);

  // Test 404 on non-existent evidence ID
  const notFoundRes = await fetch(`${baseUrl}/api/evidence/NON_EXISTENT_EVIDENCE_999`);
  assert.equal(notFoundRes.status, 404);
  const notFoundData = await notFoundRes.json();
  assert.equal(notFoundData.success, false);
});

test('9. Pipeline Execution: POST /api/analyze', async () => {
  const res = await fetch(`${baseUrl}/api/analyze`, { method: 'POST' });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.ok(data.timestamp);
  assert.ok(data.total_findings >= 10);
  assert.ok(data.total_entities_scored >= 20, `Expected >= 20 entities scored, got ${data.total_entities_scored}`);
  assert.ok(data.module_counts.EXECUTION_GAP > 0);

  // Phase 6 structured analysis summary fields
  assert.ok(data.entities_analyzed >= 20, `Expected >= 20 entities analyzed, got ${data.entities_analyzed}`);
  assert.ok(typeof data.findings_generated === 'number' && data.findings_generated >= 10);
  assert.ok(typeof data.high_risk_entities === 'number');
  assert.ok(typeof data.critical_entities === 'number');
  assert.ok(data.analysis_timestamp);
  assert.ok(data.dataset_version);
  assert.ok(data.dataset_version.startsWith('v'));
  assert.ok(data.module_counts.NEGATIVE_SPACE !== undefined);
  assert.ok(data.module_counts.ANOMALY !== undefined);
  assert.ok(data.module_counts.PEER_DEVIATION !== undefined);
  assert.ok(data.module_counts.REPEATED_INCIDENT !== undefined);
});

test('10. Ingestion & Upload Validation: POST /api/upload', async () => {
  // 1. Invalid upload (missing columns/values) should be rejected with 400
  const invalidRes = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entities: [{ entity_id: '', entity_name: '', sector: '' }]
    })
  });
  assert.equal(invalidRes.status, 400);
  const invalidData = await invalidRes.json();
  assert.equal(invalidData.success, false);
  assert.ok(invalidData.validation_errors && invalidData.validation_errors.length > 0);
  assert.ok(invalidData.rows_received);
  assert.ok(invalidData.rows_rejected);
  assert.equal(invalidData.rows_accepted.total, 0);
  assert.ok(invalidData.database_counts);

  // 2. Empty upload should be rejected with 400
  const emptyRes = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(emptyRes.status, 400);
  const emptyData = await emptyRes.json();
  assert.equal(emptyData.success, false);
  assert.ok(emptyData.validation_errors.some((e: any) => e.message.includes('No valid dataset') || e.message.includes('empty')));

  // 3. Broken Foreign Keys should be rejected with 400
  const brokenFkRes = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entities: [{ entity_id: 'ENT-API-1', entity_name: 'Corp 1', sector: 'Energy' }],
      assets: [{ asset_id: 'AST-API-1', entity_id: 'ENT-NON_EXISTENT', asset_type: 'Server', criticality: 'LOW', expected_telemetry: 'Daily', last_telemetry: null }]
    })
  });
  assert.equal(brokenFkRes.status, 400);
  const brokenFkData = await brokenFkRes.json();
  assert.equal(brokenFkData.success, false);
  assert.ok(brokenFkData.validation_errors.some((e: any) => e.field === 'entity_id'));

  // 4. Duplicate IDs should be rejected with 400
  const dupRes = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entities: [
        { entity_id: 'ENT-DUP-API', entity_name: 'Corp A', sector: 'Energy' },
        { entity_id: 'ENT-DUP-API', entity_name: 'Corp B', sector: 'Energy' }
      ]
    })
  });
  assert.equal(dupRes.status, 400);
  const dupData = await dupRes.json();
  assert.equal(dupData.success, false);
  assert.ok(dupData.validation_errors.some((e: any) => e.message.includes('Duplicate entity_id')));

  // 5. Malformed values should be rejected with 400
  const malformedRes = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entities: [{ entity_id: 'ENT-MAL-API', entity_name: 'Corp A', sector: 'Energy' }],
      assets: [{ asset_id: 'AST-MAL-API', entity_id: 'ENT-MAL-API', asset_type: 'Server', criticality: 'SUPER_HIGH', expected_telemetry: 'Daily', last_telemetry: null }]
    })
  });
  assert.equal(malformedRes.status, 400);
  const malformedData = await malformedRes.json();
  assert.equal(malformedData.success, false);
  assert.ok(malformedData.validation_errors.some((e: any) => e.field === 'criticality'));
});

test('11. Phase 6 End-to-End Pipeline: Deterministic Execution & Metric Changes on Upload', async () => {
  // Step A: Deterministic execution — running /api/analyze twice on the same data
  const run1Res = await fetch(`${baseUrl}/api/analyze`, { method: 'POST' });
  assert.equal(run1Res.status, 200);
  const run1 = await run1Res.json();

  const run2Res = await fetch(`${baseUrl}/api/analyze`, { method: 'POST' });
  assert.equal(run2Res.status, 200);
  const run2 = await run2Res.json();

  assert.equal(run1.entities_analyzed, run2.entities_analyzed);
  assert.equal(run1.findings_generated, run2.findings_generated);
  assert.equal(run1.high_risk_entities, run2.high_risk_entities);
  assert.equal(run1.critical_entities, run2.critical_entities);
  assert.deepEqual(run1.module_counts, run2.module_counts);
  assert.equal(run1.dataset_version, run2.dataset_version);

  // Step B: Verify that changing the uploaded data changes the resulting dashboard metrics
  const dashBeforeRes = await fetch(`${baseUrl}/api/dashboard`);
  assert.equal(dashBeforeRes.status, 200);
  const dashBefore = await dashBeforeRes.json();

  // Ingest an additional alert and case for CSE-001
  const newAlertId = `ALT-NEW-TEST-${Date.now()}`;
  const newCaseId = `CAS-NEW-TEST-${Date.now()}`;
  const uploadRes = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      alerts: [{
        alert_id: newAlertId,
        timestamp: '2026-09-27T10:00:00.000Z',
        entity_id: 'CSE-001',
        asset_id: 'AST-001-01',
        severity: 'LOW',
        category: 'Port Scan',
        source_ip: '10.0.0.99',
        destination_ip: '10.0.0.1',
        status: 'CLOSED'
      }],
      cases: [{
        case_id: newCaseId,
        alert_id: newAlertId,
        entity_id: 'CSE-001',
        investigator: 'Test Analyst',
        opened_at: '2026-09-27T10:05:00.000Z',
        investigation_duration: 30,
        escalated: 1,
        closed_at: '2026-09-27T10:35:00.000Z',
        closure_reason: 'Resolved',
        remediation_status: 'Completed'
      }]
    })
  });
  assert.equal(uploadRes.status, 200);

  // Trigger analysis pipeline
  const analyzeAfterRes = await fetch(`${baseUrl}/api/analyze`, { method: 'POST' });
  assert.equal(analyzeAfterRes.status, 200);
  const analyzeAfter = await analyzeAfterRes.json();

  // Fetch updated dashboard
  const dashAfterRes = await fetch(`${baseUrl}/api/dashboard`);
  assert.equal(dashAfterRes.status, 200);
  const dashAfter = await dashAfterRes.json();

  // Confirm total alerts count changed in dashboard
  assert.equal(
    dashAfter.useful_aggregate_metrics.total_alerts,
    dashBefore.useful_aggregate_metrics.total_alerts + 1
  );
  assert.notEqual(analyzeAfter.dataset_version, run1.dataset_version);
});

// ─── Phase 8: Evidence Traceability Tests ───────────────────────────────────

test('12. Evidence Integrity Check: GET /api/evidence/integrity', async () => {
  const res = await fetch(`${baseUrl}/api/evidence/integrity`);
  assert.equal(res.status, 200);
  const data = await res.json();

  // Shape checks
  assert.equal(data.success, true);
  assert.ok(typeof data.total_findings === 'number');
  assert.ok(typeof data.total_references === 'number');
  assert.ok(typeof data.valid_references === 'number');
  assert.ok(typeof data.broken_references === 'number');
  assert.ok(typeof data.integrity_passed === 'boolean');
  assert.ok(Array.isArray(data.broken_details));

  // All evidence references must resolve — no broken links allowed
  assert.equal(data.integrity_passed, true,
    `Evidence integrity failed: ${data.broken_references} broken reference(s). Details: ${JSON.stringify(data.broken_details)}`
  );
  assert.equal(data.broken_references, 0);
  assert.equal(data.broken_details.length, 0);
  assert.equal(data.valid_references, data.total_references);
});

test('13. Finding → Evidence → Source Record Traceability', async () => {
  // Fetch CSE-007 findings (known to have many evidence IDs)
  const findingsRes = await fetch(`${baseUrl}/api/findings?entity_id=CSE-007`);
  assert.equal(findingsRes.status, 200);
  const findingsData = await findingsRes.json();
  assert.ok(findingsData.count > 0, 'Must have CSE-007 findings to trace');

  // At least some findings must carry evidence_ids
  const findingsWithEvidence = findingsData.findings.filter((f: any) =>
    Array.isArray(f.evidence_ids) && f.evidence_ids.length > 0
  );
  assert.ok(findingsWithEvidence.length > 0, 'At least some findings must have evidence_ids populated');

  // Verify each evidence ID resolves to a real source record
  for (const finding of findingsWithEvidence.slice(0, 5)) { // sample first 5 to keep test fast
    for (const evId of finding.evidence_ids.slice(0, 3)) {
      const evRes = await fetch(`${baseUrl}/api/evidence/${encodeURIComponent(evId)}`);
      assert.equal(evRes.status, 200,
        `Finding ${finding.finding_id}: evidence_id '${evId}' returned HTTP ${evRes.status} — broken reference`
      );
      const evData = await evRes.json();
      assert.equal(evData.success, true, `Evidence ${evId}: success was not true`);
      assert.ok(
        ['alert', 'case', 'asset', 'finding_drilldown'].includes(evData.evidence_type),
        `Evidence ${evId} has unexpected evidence_type: ${evData.evidence_type}`
      );

      // Verify the source record field is present
      if (evData.evidence_type === 'alert') {
        assert.ok(evData.alert?.alert_id, `Alert evidence ${evId} missing alert.alert_id`);
      } else if (evData.evidence_type === 'case') {
        assert.ok(evData.case?.case_id, `Case evidence ${evId} missing case.case_id`);
      } else if (evData.evidence_type === 'asset') {
        assert.ok(evData.asset?.asset_id, `Asset evidence ${evId} missing asset.asset_id`);
        assert.ok(Array.isArray(evData.recent_alerts), `Asset evidence ${evId} missing recent_alerts array`);
      }
    }
  }
});

test('14. Broken Reference Detection: 404 + broken_reference flag on non-existent IDs', async () => {
  const fakeIds = [
    'ALT-99999999',
    'CAS-99999999',
    'AST-FAKE-999',
    'NON_EXISTENT_EVIDENCE_XYZ',
  ];

  for (const fakeId of fakeIds) {
    const res = await fetch(`${baseUrl}/api/evidence/${encodeURIComponent(fakeId)}`);
    assert.equal(res.status, 404,
      `Expected 404 for non-existent evidence '${fakeId}', got ${res.status}`
    );
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.broken_reference, true,
      `Expected broken_reference:true for '${fakeId}', got: ${JSON.stringify(data)}`
    );
    assert.ok(data.error || data.message, 'Broken reference response must include error or message');
  }
});

test('15. Temporal Trends: GET /api/trends returns numeric alert and finding series', async () => {
  const res = await fetch(`${baseUrl}/api/trends?days=30`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.alert_trends), 'alert_trends must be an array');
  assert.ok(Array.isArray(data.finding_trends), 'finding_trends must be an array');

  if (data.alert_trends.length > 0) {
    for (const t of data.alert_trends) {
      assert.ok(typeof t.date_bucket === 'string' && t.date_bucket.length >= 10, 'date_bucket must be YYYY-MM-DD');
      assert.ok(typeof t.total_alerts === 'number', 'total_alerts must be numeric');
      assert.ok(typeof t.critical_alerts === 'number', 'critical_alerts must be numeric');
      assert.ok(typeof t.high_alerts === 'number', 'high_alerts must be numeric');
      assert.ok(t.total_alerts >= 0, 'total_alerts must be non-negative');
      assert.ok(t.critical_alerts >= 0, 'critical_alerts must be non-negative');
      assert.ok(t.high_alerts >= 0, 'high_alerts must be non-negative');
      assert.ok(t.total_alerts >= t.critical_alerts + t.high_alerts, 'total_alerts >= critical + high');
    }
  }

  // Scoped entity filter test
  const entityRes = await fetch(`${baseUrl}/api/trends?entity_id=CSE-001&days=30`);
  assert.equal(entityRes.status, 200);
  const entityData = await entityRes.json();
  assert.equal(entityData.success, true);
  assert.ok(Array.isArray(entityData.alert_trends));
});

test('16. Manual Validation Reset: POST /api/expert-finding-labels/reset clears labels and runs', async () => {
  // First insert a test label
  const findingsRes = await fetch(`${baseUrl}/api/findings?limit=1`);
  assert.equal(findingsRes.status, 200);
  const { findings } = await findingsRes.json();
  assert.ok(findings.length > 0);

  const sampleFinding = findings[0];
  const insertRes = await fetch(`${baseUrl}/api/expert-finding-labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      finding_id: sampleFinding.finding_id,
      entity_id: sampleFinding.entity_id,
      expert_label: 'CONFIRMED',
      reviewer_id: 'Test Reviewer',
      review_timestamp: new Date().toISOString(),
      rationale: 'Regression test confirmation'
    })
  });
  assert.equal(insertRes.status, 200);

  // Verify label exists
  const labelsRes = await fetch(`${baseUrl}/api/expert-finding-labels`);
  assert.equal(labelsRes.status, 200);
  const labelsData = await labelsRes.json();
  assert.ok(labelsData.labels.length > 0);

  // Trigger reset
  const resetRes = await fetch(`${baseUrl}/api/expert-finding-labels/reset`, { method: 'POST' });
  assert.equal(resetRes.status, 200);
  const resetData = await resetRes.json();
  assert.equal(resetData.success, true);

  // Verify labels are cleared
  const labelsAfterRes = await fetch(`${baseUrl}/api/expert-finding-labels`);
  assert.equal(labelsAfterRes.status, 200);
  const labelsAfter = await labelsAfterRes.json();
  assert.equal(labelsAfter.labels.length, 0);

  // Verify validation metrics returns to unreviewed empty state
  const metricsRes = await fetch(`${baseUrl}/api/validation-metrics`);
  assert.equal(metricsRes.status, 200);
  const metricsData = await metricsRes.json();
  assert.equal(metricsData.available, false);
  assert.equal(metricsData.label_count, 0);
});


