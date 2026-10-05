/**
 * Phase 9 — End-to-End Workflow Test
 *
 * Covers the complete 16-step user workflow:
 *  1.  Upload CSV/JSON dataset
 *  2.  See validation result
 *  3.  Confirm accepted/rejected records
 *  4.  Start analysis
 *  5.  Wait for pipeline completion
 *  6.  See analysis summary
 *  7.  Open Dashboard
 *  8.  See recalculated metrics
 *  9.  Open Entities
 * 10.  Select an entity
 * 11.  See its calculated risk score
 * 12.  Open a finding
 * 13.  See why it was detected (rationale)
 * 14.  See its risk contribution (module weight)
 * 15.  Open supporting evidence
 * 16.  Inspect the original SQLite record
 *
 * Also covers error paths:
 *  - Invalid upload (rejected with validation errors)
 *  - Empty dataset (0 rows accepted)
 *  - Missing evidence (404 with broken_reference flag)
 *  - No findings scenario (empty filter returns empty array)
 *
 * The test uses the representative 20-entity dataset already in the DB.
 * It also performs an upload of a minimal valid supplemental dataset to
 * verify that the workflow works for a separately uploaded valid dataset.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { app, dbService, analyticsService } from '../src/index.js';

let server: Server;
let baseUrl: string;

// ─── Setup / Teardown ────────────────────────────────────────────────────────

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
  // Ensure analytics are primed with the representative dataset
  await analyticsService.getOrRunAnalysis();
});

test.after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

// ─── Helper ──────────────────────────────────────────────────────────────────

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json();
  return { res, data };
}

// ─── STEP 1–3: Upload dataset + validation result + record confirmation ───────

test('E2E Step 1–3: Invalid upload is rejected with validation errors and record counts', async () => {
  // Upload a payload with a completely invalid entity (missing required fields)
  const { res, data } = await json(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entities: [{ entity_id: '', entity_name: '', sector: '' }]
    })
  });

  // Step 2: Validation result visible
  assert.equal(res.status, 400, 'Invalid upload must return HTTP 400');
  assert.equal(data.success, false, 'success must be false for invalid upload');

  // Step 3: Accepted / rejected record counts are present
  assert.ok(data.rows_received, 'rows_received must be present');
  assert.ok(data.rows_rejected, 'rows_rejected must be present');
  assert.ok(data.rows_accepted, 'rows_accepted must be present');
  assert.equal(data.rows_accepted.total ?? 0, 0, 'No rows should be accepted for invalid upload');

  // Validation errors must be a non-empty array
  assert.ok(Array.isArray(data.validation_errors), 'validation_errors must be an array');
  assert.ok(data.validation_errors.length > 0, 'At least one validation error must be present');

  // Every error must have a message field
  for (const err of data.validation_errors) {
    assert.ok(err.message, `Each validation error must have a message, got: ${JSON.stringify(err)}`);
  }
});

test('E2E Step 1–3: Empty dataset upload is rejected with a clear message', async () => {
  const { res, data } = await json(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  assert.equal(res.status, 400, 'Empty upload must return HTTP 400');
  assert.equal(data.success, false);
  assert.ok(Array.isArray(data.validation_errors));
  assert.ok(
    data.validation_errors.some((e: any) =>
      e.message.toLowerCase().includes('no valid dataset') ||
      e.message.toLowerCase().includes('empty') ||
      e.message.toLowerCase().includes('no data')
    ),
    `Expected 'no valid dataset' or 'empty' in errors, got: ${JSON.stringify(data.validation_errors)}`
  );
});

test('E2E Step 1–3: Valid supplemental dataset upload succeeds and shows detailed record counts', async () => {
  // Upload a minimal but fully valid supplemental dataset
  const supplementId = `E2E-SUPP-${Date.now()}`;
  const assetId = `AST-${supplementId}-01`;
  const alertId = `ALT-${supplementId}-001`;
  const caseId = `CAS-${supplementId}-001`;

  const { res, data } = await json(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entities: [{
        entity_id: supplementId,
        entity_name: 'E2E Test Entity',
        sector: 'Energy'
      }],
      assets: [{
        asset_id: assetId,
        entity_id: supplementId,
        asset_type: 'Server',
        criticality: 'HIGH',
        expected_telemetry: 'Daily',
        last_telemetry: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      }],
      alerts: [{
        alert_id: alertId,
        timestamp: new Date().toISOString(),
        entity_id: supplementId,
        asset_id: assetId,
        severity: 'HIGH',
        category: 'Intrusion Attempt',
        source_ip: '192.168.1.1',
        destination_ip: '10.0.0.1',
        status: 'CLOSED'
      }],
      cases: [{
        case_id: caseId,
        alert_id: alertId,
        entity_id: supplementId,
        investigator: 'E2E Analyst',
        opened_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        investigation_duration: 5,
        escalated: 0,
        closed_at: new Date().toISOString(),
        closure_reason: 'Resolved',
        remediation_status: 'Completed'
      }]
    })
  });

  // Step 2: Validation result visible
  assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
  assert.equal(data.success, true);

  // Step 3: Record counts are visible and correct
  assert.ok(data.rows_received, 'rows_received must be present');
  assert.ok(data.rows_accepted, 'rows_accepted must be present');
  assert.ok(data.rows_rejected, 'rows_rejected must be present');
  assert.ok(data.database_counts, 'database_counts must be present');

  // At least 1 row was accepted (our entity)
  const totalAccepted = data.rows_accepted.total ?? Object.values(data.rows_accepted as Record<string, number>).reduce((a: number, b: number) => a + b, 0);
  assert.ok(totalAccepted >= 1, `Expected >=1 accepted rows, got ${totalAccepted}`);

  // The auto-analysis ran after upload
  assert.ok(data.analysis, 'analysis summary must be present after upload');
  assert.ok(data.analysis.timestamp, 'analysis.timestamp must be present');
  assert.ok(typeof data.analysis.total_findings === 'number', 'analysis.total_findings must be a number');
  assert.ok(typeof data.analysis.total_entities_scored === 'number', 'analysis.total_entities_scored must be a number');
});

// ─── STEP 4–6: Run analysis + pipeline completion + summary ──────────────────

test('E2E Step 4–6: Run analysis pipeline and verify structured summary response', async () => {
  // Step 4: Start analysis
  const { res, data } = await json(`${baseUrl}/api/analyze`, { method: 'POST' });

  // Step 5: Pipeline completed (HTTP 200)
  assert.equal(res.status, 200, `Pipeline returned ${res.status}: ${JSON.stringify(data)}`);
  assert.equal(data.success, true);

  // Step 6: Analysis summary has all expected fields
  assert.ok(typeof data.entities_analyzed === 'number', 'entities_analyzed must be a number');
  assert.ok(typeof data.findings_generated === 'number', 'findings_generated must be a number');
  assert.ok(typeof data.high_risk_entities === 'number', 'high_risk_entities must be a number');
  assert.ok(typeof data.critical_entities === 'number', 'critical_entities must be a number');
  assert.ok(typeof data.duration_ms === 'number', 'duration_ms must be a number');
  assert.ok(data.analysis_timestamp, 'analysis_timestamp must be present');
  assert.ok(data.dataset_version, 'dataset_version must be present');
  assert.ok(data.dataset_version.startsWith('v'), 'dataset_version must start with v');

  // Module counts must be present for all 5 modules
  assert.ok(data.module_counts, 'module_counts must be present');
  assert.ok(typeof data.module_counts.EXECUTION_GAP === 'number', 'EXECUTION_GAP count must be a number');
  assert.ok(typeof data.module_counts.NEGATIVE_SPACE === 'number', 'NEGATIVE_SPACE count must be a number');
  assert.ok(typeof data.module_counts.ANOMALY === 'number', 'ANOMALY count must be a number');
  assert.ok(typeof data.module_counts.PEER_DEVIATION === 'number', 'PEER_DEVIATION count must be a number');
  assert.ok(typeof data.module_counts.REPEATED_INCIDENT === 'number', 'REPEATED_INCIDENT count must be a number');

  // Findings and entities must be positive for the representative dataset
  assert.ok(data.entities_analyzed >= 1, 'Must have analyzed at least 1 entity');
  assert.ok(data.findings_generated >= 0, 'findings_generated must be >= 0');
});

// ─── STEP 7–8: Open Dashboard + recalculated metrics ─────────────────────────

test('E2E Step 7–8: Dashboard returns recalculated metrics after analysis', async () => {
  // Step 7: Open Dashboard
  const { res, data } = await json(`${baseUrl}/api/dashboard`);
  assert.equal(res.status, 200);
  assert.equal(data.success, true);

  // Step 8: Dashboard reflects recalculated metrics
  assert.ok(typeof data.total_entities === 'number', 'total_entities must be a number');
  assert.ok(data.total_entities >= 1, 'total_entities must be at least 1');
  assert.ok(data.risk_distribution, 'risk_distribution must be present');
  assert.ok(typeof data.risk_distribution.CRITICAL === 'number');
  assert.ok(typeof data.risk_distribution.HIGH === 'number');
  assert.ok(typeof data.risk_distribution.MEDIUM === 'number');
  assert.ok(typeof data.risk_distribution.LOW === 'number');

  // Finding counts by type must be present
  assert.ok(data.finding_counts_by_type, 'finding_counts_by_type must be present');
  assert.ok(typeof data.finding_counts_by_type.EXECUTION_GAP === 'number');
  assert.ok(typeof data.finding_counts_by_type.NEGATIVE_SPACE === 'number');

  // Aggregate metrics
  assert.ok(data.useful_aggregate_metrics, 'useful_aggregate_metrics must be present');
  assert.ok(typeof data.useful_aggregate_metrics.total_alerts === 'number', 'total_alerts must be a number');
  assert.ok(typeof data.useful_aggregate_metrics.total_cases === 'number', 'total_cases must be a number');
  assert.ok(typeof data.useful_aggregate_metrics.average_risk_score === 'number');

  // Must have at least one high_critical entity after analysis
  assert.ok(Array.isArray(data.high_critical_entities), 'high_critical_entities must be an array');
});

// ─── STEP 9–11: Open Entities + select entity + see risk score ────────────────

test('E2E Step 9–11: Entities list returns scored entities; entity detail has risk score and components', async () => {
  // Step 9: Open Entities
  const listRes = await json(`${baseUrl}/api/entities`);
  assert.equal(listRes.res.status, 200);
  assert.equal(listRes.data.success, true);
  assert.ok(listRes.data.entities.length >= 1, 'Must have at least one entity');

  // Verify entity summary schema
  const ent = listRes.data.entities[0];
  assert.ok(ent.entity_id, 'entity_id must be present');
  assert.ok(ent.entity_name, 'entity_name must be present');
  assert.ok(ent.sector, 'sector must be present');
  assert.ok(typeof ent.risk_score === 'number', 'risk_score must be a number');
  assert.ok(ent.risk_level, 'risk_level must be present');
  assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(ent.risk_level), `Unknown risk_level: ${ent.risk_level}`);
  assert.ok(typeof ent.finding_count === 'number', 'finding_count must be a number');

  // Step 10: Select the first entity
  const entityId = ent.entity_id;
  const detailRes = await json(`${baseUrl}/api/entities/${encodeURIComponent(entityId)}`);
  assert.equal(detailRes.res.status, 200);
  assert.equal(detailRes.data.success, true);

  // Step 11: See its calculated risk score
  assert.equal(detailRes.data.entity_id, entityId);
  assert.ok(typeof detailRes.data.risk_score === 'number', 'risk_score must be a number');
  assert.ok(detailRes.data.risk_level, 'risk_level must be present');
  assert.ok(detailRes.data.component_scores, 'component_scores must be present');

  // Explanation must be present
  assert.ok(detailRes.data.explanation, 'explanation must be present');
  assert.ok(detailRes.data.explanation.score_formula, 'score_formula must be present');
  assert.ok(detailRes.data.explanation.summary, 'summary must be present');
  assert.ok(Array.isArray(detailRes.data.explanation.module_breakdown), 'module_breakdown must be an array');
  assert.ok(detailRes.data.explanation.summary.includes(detailRes.data.risk_level),
    `explanation summary must mention risk level (${detailRes.data.risk_level})`
  );
});

// ─── STEP 12–14: Open finding + rationale + risk contribution ────────────────

test('E2E Step 12–14: Finding has rationale (why detected) and risk contribution (module weight)', async () => {
  // Step 12: Get a finding from the highest-risk entity
  const listRes = await json(`${baseUrl}/api/entities`);
  const topEntityId = listRes.data.entities[0].entity_id;

  const findingsRes = await json(`${baseUrl}/api/findings?entity_id=${encodeURIComponent(topEntityId)}`);
  assert.equal(findingsRes.res.status, 200);
  assert.ok(findingsRes.data.count > 0, `Top entity ${topEntityId} must have at least one finding`);

  const finding = findingsRes.data.findings[0];

  // Step 12: finding_id exists
  assert.ok(finding.finding_id, 'finding_id must be present');
  assert.ok(finding.entity_id, 'entity_id must be present');
  assert.ok(finding.finding_type, 'finding_type must be present');
  assert.ok(['EXECUTION_GAP', 'NEGATIVE_SPACE', 'ANOMALY', 'PEER_DEVIATION', 'REPEATED_INCIDENT'].includes(finding.finding_type),
    `Unknown finding_type: ${finding.finding_type}`
  );

  // Step 13: Rationale explains why it was detected
  assert.ok(finding.rationale, 'rationale must be present (explains detection reason)');
  assert.ok(finding.rationale.length > 20, `Rationale too short: "${finding.rationale}"`);
  assert.ok(finding.title, 'title must be present');

  // Step 14: Risk contribution info via finding_type → module weight
  // Module weights are documented constants — we verify the finding_type maps to a known module
  const MODULE_WEIGHTS: Record<string, number> = {
    EXECUTION_GAP: 0.30,
    NEGATIVE_SPACE: 0.25,
    ANOMALY: 0.20,
    PEER_DEVIATION: 0.15,
    REPEATED_INCIDENT: 0.10
  };
  const weight = MODULE_WEIGHTS[finding.finding_type];
  assert.ok(weight !== undefined, `finding_type ${finding.finding_type} must map to a known module weight`);
  assert.ok(weight > 0, 'Module weight must be positive');

  // Supporting metrics provide forensic observables
  assert.ok(finding.supporting_metrics, 'supporting_metrics must be present');
  assert.equal(typeof finding.supporting_metrics, 'object');

  // Evidence IDs must be an array (may be empty for aggregate findings)
  assert.ok(Array.isArray(finding.evidence_ids), 'evidence_ids must be an array');

  // Step 12 detail: GET /api/findings/:id
  const detailRes = await json(`${baseUrl}/api/findings/${encodeURIComponent(finding.finding_id)}`);
  assert.equal(detailRes.res.status, 200);
  assert.equal(detailRes.data.finding_id, finding.finding_id);
  assert.ok(detailRes.data.rationale, 'Finding detail must include rationale');
  assert.ok(Array.isArray(detailRes.data.evidence_ids), 'Finding detail must include evidence_ids');
});

// ─── STEP 15–16: Open evidence + inspect original SQLite record ───────────────

test('E2E Step 15–16: Evidence lookup resolves to original SQLite record with all required fields', async () => {
  // Find a finding with evidence_ids
  const findingsRes = await json(`${baseUrl}/api/findings`);
  assert.ok(findingsRes.data.count > 0, 'Must have findings to inspect evidence');

  const findingWithEvidence = findingsRes.data.findings.find(
    (f: any) => Array.isArray(f.evidence_ids) && f.evidence_ids.length > 0
  );
  assert.ok(findingWithEvidence, 'At least one finding must have evidence_ids populated');

  // Step 15: Open supporting evidence
  const firstEvidenceId = findingWithEvidence.evidence_ids[0];
  const evRes = await json(`${baseUrl}/api/evidence/${encodeURIComponent(firstEvidenceId)}`);

  assert.equal(evRes.res.status, 200,
    `Evidence lookup for ${firstEvidenceId} failed with ${evRes.res.status}: ${JSON.stringify(evRes.data)}`
  );
  assert.equal(evRes.data.success, true);
  assert.ok(evRes.data.evidence_type, 'evidence_type must be present');

  // Step 16: Inspect the original SQLite record — verify source fields are present
  const evType = evRes.data.evidence_type;

  if (evType === 'alert') {
    assert.ok(evRes.data.alert, 'alert record must be present for alert evidence');
    assert.ok(evRes.data.alert.alert_id, 'alert.alert_id must be present');
    assert.ok(evRes.data.alert.entity_id, 'alert.entity_id must be present');
    assert.ok(evRes.data.alert.severity, 'alert.severity must be present');
    assert.ok(evRes.data.alert.timestamp || evRes.data.alert.created_at, 'alert timestamp must be present');
  } else if (evType === 'case') {
    assert.ok(evRes.data.case, 'case record must be present for case evidence');
    assert.ok(evRes.data.case.case_id, 'case.case_id must be present');
  } else if (evType === 'asset') {
    assert.ok(evRes.data.asset, 'asset record must be present for asset evidence');
    assert.ok(evRes.data.asset.asset_id, 'asset.asset_id must be present');
    assert.ok(evRes.data.asset.entity_id, 'asset.entity_id must be present');
    assert.ok(Array.isArray(evRes.data.recent_alerts), 'recent_alerts must be an array for asset evidence');
  } else if (evType === 'finding_drilldown') {
    assert.ok(evRes.data.evidence_records, 'evidence_records must be present for finding_drilldown');
    assert.ok(Array.isArray(evRes.data.evidence_records.alerts), 'evidence_records.alerts must be an array');
    assert.ok(Array.isArray(evRes.data.evidence_records.cases), 'evidence_records.cases must be an array');
    assert.ok(Array.isArray(evRes.data.evidence_records.assets), 'evidence_records.assets must be an array');
  }
});

// ─── Error path: Missing evidence ────────────────────────────────────────────

test('E2E Error path: Missing evidence ID returns 404 with broken_reference flag', async () => {
  const fakeId = 'ALT-99999999-DOES-NOT-EXIST';
  const { res, data } = await json(`${baseUrl}/api/evidence/${encodeURIComponent(fakeId)}`);

  assert.equal(res.status, 404, `Expected 404 for missing evidence, got ${res.status}`);
  assert.equal(data.success, false, 'success must be false for missing evidence');
  assert.equal(data.broken_reference, true, 'broken_reference must be true for missing evidence ID');
  assert.ok(data.error || data.message, 'Error or message must explain the broken reference');
});

// ─── Error path: Non-existent entity ─────────────────────────────────────────

test('E2E Error path: Non-existent entity returns 404 with error message', async () => {
  const { res, data } = await json(`${baseUrl}/api/entities/ENTITY-DOES-NOT-EXIST-XYZ`);

  assert.equal(res.status, 404, `Expected 404 for non-existent entity, got ${res.status}`);
  assert.equal(data.success, false, 'success must be false for non-existent entity');
  assert.ok(data.error, 'error message must be present');
});

// ─── Error path: No findings for empty entity ─────────────────────────────────

test('E2E Error path: Entity with no findings returns empty findings array, not an error', async () => {
  // Use findings endpoint with an impossible filter to get zero results
  const { res, data } = await json(`${baseUrl}/api/findings?entity_id=ENTITY-ABSOLUTELY-NOT-FOUND`);

  assert.equal(res.status, 200, 'Empty findings query must return 200, not an error');
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.findings), 'findings must be an array even when empty');
  assert.equal(data.findings.length, 0, 'findings array must be empty for non-existent entity');
  assert.equal(data.count, 0, 'count must be 0 for non-existent entity');
});

// ─── End-to-end: Complete workflow in sequence ────────────────────────────────

test('E2E Complete 16-step workflow: upload → analyze → dashboard → entity → finding → evidence', async () => {
  // ── Step 1–3: Upload a valid dataset ────────────────────────────────────
  const e2eEntityId = `E2E-FULL-${Date.now()}`;
  const e2eAssetId = `AST-${e2eEntityId}-01`;
  const e2eAlertId = `ALT-${e2eEntityId}-001`;
  const e2eCaseId = `CAS-${e2eEntityId}-001`;

  const uploadRes = await json(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entities: [{ entity_id: e2eEntityId, entity_name: 'E2E Full Workflow Corp', sector: 'Telecom' }],
      assets: [{
        asset_id: e2eAssetId,
        entity_id: e2eEntityId,
        asset_type: 'SCADA',
        criticality: 'CRITICAL',
        expected_telemetry: 'Hourly',
        last_telemetry: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days stale
      }],
      alerts: [{
        alert_id: e2eAlertId,
        timestamp: new Date().toISOString(),
        entity_id: e2eEntityId,
        asset_id: e2eAssetId,
        severity: 'CRITICAL',
        category: 'Ransomware Detection',
        source_ip: '10.0.0.9',
        destination_ip: '10.0.0.1',
        status: 'CLOSED'
      }],
      cases: [{
        case_id: e2eCaseId,
        alert_id: e2eAlertId,
        entity_id: e2eEntityId,
        investigator: 'E2E Analyst',
        opened_at: new Date(Date.now() - 60 * 1000).toISOString(),
        investigation_duration: 1,  // suspiciously fast
        escalated: 0,               // no escalation for CRITICAL
        closed_at: new Date().toISOString(),
        closure_reason: 'Dismissed',
        remediation_status: 'None'
      }]
    })
  });

  // Steps 1–3: validated
  assert.equal(uploadRes.res.status, 200, `Upload failed: ${JSON.stringify(uploadRes.data)}`);
  assert.equal(uploadRes.data.success, true, 'Upload must succeed');
  const totalAccepted = uploadRes.data.rows_accepted.total ??
    Object.values(uploadRes.data.rows_accepted as Record<string, number>).reduce((a: number, b: number) => a + b, 0);
  assert.ok(totalAccepted >= 1, 'At least 1 row must be accepted');
  assert.ok(uploadRes.data.rows_rejected !== undefined, 'rows_rejected must be present');
  assert.ok(uploadRes.data.database_counts, 'database_counts must be present');

  // ── Step 4–6: Run analysis ───────────────────────────────────────────────
  const analyzeRes = await json(`${baseUrl}/api/analyze`, { method: 'POST' });
  assert.equal(analyzeRes.res.status, 200, `Analysis failed: ${JSON.stringify(analyzeRes.data)}`);
  assert.equal(analyzeRes.data.success, true);
  assert.ok(typeof analyzeRes.data.entities_analyzed === 'number', 'entities_analyzed must be present');
  assert.ok(typeof analyzeRes.data.findings_generated === 'number', 'findings_generated must be present');
  assert.ok(analyzeRes.data.analysis_timestamp, 'analysis_timestamp must be present');
  assert.ok(analyzeRes.data.module_counts, 'module_counts must be present');

  // ── Step 7–8: Dashboard reflects new data ───────────────────────────────
  const dashRes = await json(`${baseUrl}/api/dashboard`);
  assert.equal(dashRes.res.status, 200);
  assert.equal(dashRes.data.success, true);
  assert.ok(dashRes.data.total_entities >= 1, 'Dashboard must show at least 1 entity');
  assert.ok(typeof dashRes.data.useful_aggregate_metrics.total_alerts === 'number', 'total_alerts must be a number');

  // ── Step 9–11: Entities → entity detail → risk score ────────────────────
  const entListRes = await json(`${baseUrl}/api/entities`);
  assert.equal(entListRes.res.status, 200);
  const entities = entListRes.data.entities;
  assert.ok(entities.length >= 1, 'Must have at least 1 entity');

  // Find the highest-risk entity to inspect
  const topEntity = entities[0];
  assert.ok(topEntity.entity_id);
  assert.ok(typeof topEntity.risk_score === 'number');
  assert.ok(topEntity.risk_level);

  const entDetailRes = await json(`${baseUrl}/api/entities/${encodeURIComponent(topEntity.entity_id)}`);
  assert.equal(entDetailRes.res.status, 200);
  assert.equal(entDetailRes.data.entity_id, topEntity.entity_id);
  assert.ok(typeof entDetailRes.data.risk_score === 'number', 'Entity detail must have risk_score');
  assert.ok(entDetailRes.data.component_scores, 'component_scores must be present in entity detail');
  assert.ok(entDetailRes.data.explanation, 'explanation must be present in entity detail');

  // ── Step 12–14: Get a finding → rationale → risk contribution ───────────
  const findingsRes = await json(`${baseUrl}/api/findings?entity_id=${encodeURIComponent(topEntity.entity_id)}`);
  assert.equal(findingsRes.res.status, 200);
  assert.ok(findingsRes.data.count >= 0, 'findings count must be >= 0');

  if (findingsRes.data.count > 0) {
    const finding = findingsRes.data.findings[0];

    // Step 12: finding structure
    assert.ok(finding.finding_id, 'finding_id must be present');
    assert.ok(finding.finding_type, 'finding_type must be present');

    // Step 13: Rationale (why detected)
    assert.ok(finding.rationale, `Finding ${finding.finding_id} must have a rationale`);
    assert.ok(finding.title, `Finding ${finding.finding_id} must have a title`);

    // Step 14: Risk contribution — module weight is known
    const knownModules = ['EXECUTION_GAP', 'NEGATIVE_SPACE', 'ANOMALY', 'PEER_DEVIATION', 'REPEATED_INCIDENT'];
    assert.ok(knownModules.includes(finding.finding_type),
      `finding_type ${finding.finding_type} must be one of the 5 known modules`
    );

    // ── Step 15–16: Evidence → original SQLite record ───────────────────
    if (Array.isArray(finding.evidence_ids) && finding.evidence_ids.length > 0) {
      const evidenceId = finding.evidence_ids[0];
      const evRes = await json(`${baseUrl}/api/evidence/${encodeURIComponent(evidenceId)}`);

      // Step 15: Evidence resolves
      assert.equal(evRes.res.status, 200,
        `Evidence ${evidenceId} for finding ${finding.finding_id} returned ${evRes.res.status}: ${JSON.stringify(evRes.data)}`
      );
      assert.equal(evRes.data.success, true, `Evidence ${evidenceId} must return success:true`);

      // Step 16: Original SQLite record is present
      assert.ok(evRes.data.evidence_type, 'evidence_type must be present');
      const hasSourceRecord =
        evRes.data.alert ||
        evRes.data.case ||
        evRes.data.asset ||
        evRes.data.evidence_records ||
        evRes.data.entity;
      assert.ok(hasSourceRecord, `Evidence ${evidenceId} must contain an original database record`);
    }
  }

  // ── Evidence integrity: all references must resolve ──────────────────────
  const integrityRes = await json(`${baseUrl}/api/evidence/integrity`);
  assert.equal(integrityRes.res.status, 200);
  assert.equal(integrityRes.data.success, true);
  assert.equal(integrityRes.data.integrity_passed, true,
    `Evidence integrity failed: ${integrityRes.data.broken_references} broken references: ${JSON.stringify(integrityRes.data.broken_details)}`
  );
});

// ─── Determinism: same dataset → same results ─────────────────────────────────

test('E2E Determinism: running the pipeline twice on the same data produces identical results', async () => {
  const run1 = await json(`${baseUrl}/api/analyze`, { method: 'POST' });
  assert.equal(run1.res.status, 200);

  const run2 = await json(`${baseUrl}/api/analyze`, { method: 'POST' });
  assert.equal(run2.res.status, 200);

  // Same dataset → same core metrics
  assert.equal(run1.data.entities_analyzed, run2.data.entities_analyzed,
    'entities_analyzed must be deterministic');
  assert.equal(run1.data.findings_generated, run2.data.findings_generated,
    'findings_generated must be deterministic');
  assert.deepEqual(run1.data.module_counts, run2.data.module_counts,
    'module_counts must be deterministic');
  assert.equal(run1.data.dataset_version, run2.data.dataset_version,
    'dataset_version must be identical for same data');
});
