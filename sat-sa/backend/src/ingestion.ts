import { DatabaseService, EntityRecord, AssetRecord, AlertRecord, CaseRecord } from './db.js';
import { DatabaseSync } from 'node:sqlite';

export interface ValidationError {
  table: 'entities' | 'assets' | 'alerts' | 'cases' | 'dataset';
  recordId?: string;
  field?: string;
  message: string;
  value?: unknown;
}

export interface RowCounts {
  entities: number;
  assets: number;
  alerts: number;
  cases: number;
  total: number;
}

export interface IngestionResult {
  success: boolean;
  message: string;
  rows_received: RowCounts;
  rows_accepted: RowCounts;
  rows_rejected: RowCounts;
  validation_errors: ValidationError[];
  database_counts: {
    entities: number;
    assets: number;
    alerts: number;
    cases: number;
  };
  // Backwards compatibility properties
  inserted: {
    entities: number;
    assets: number;
    alerts: number;
    cases: number;
  };
  errors: ValidationError[];
}

export interface DatasetPayload {
  entities?: EntityRecord[];
  assets?: AssetRecord[];
  alerts?: AlertRecord[];
  cases?: CaseRecord[];
}

export interface ParsedCsvResult {
  headers: string[];
  rows: Record<string, string>[];
  isEmpty: boolean;
}

export class DataValidator {
  public static isValidISODate(dStr: unknown): boolean {
    if (!dStr || typeof dStr !== 'string') return false;
    const trimmed = dStr.trim();
    if (trimmed.length < 8) return false;
    const d = new Date(trimmed);
    return !isNaN(d.getTime());
  }

  public static parseBoolean(val: unknown): { valid: boolean; value: number } {
    if (val === true || val === 1 || val === '1' || val === 'true' || val === 'TRUE' || val === 'True') {
      return { valid: true, value: 1 };
    }
    if (val === false || val === 0 || val === '0' || val === 'false' || val === 'FALSE' || val === 'False') {
      return { valid: true, value: 0 };
    }
    return { valid: false, value: 0 };
  }

  public static parseCsvWithMeta(csvContent: string): ParsedCsvResult {
    if (!csvContent || csvContent.trim().length === 0) {
      return { headers: [], rows: [], isEmpty: true };
    }

    const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) {
      return { headers: [], rows: [], isEmpty: true };
    }

    const parseRow = (line: string): string[] => {
      const cells: string[] = [];
      let inQuotes = false;
      let current = '';
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' && (i === 0 || line[i - 1] !== '\\')) {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          cells.push(current.trim().replace(/^"|"$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      cells.push(current.trim().replace(/^"|"$/g, ''));
      return cells;
    };

    const headerMap: Record<string, string> = {
      'alertid': 'alert_id', 'alert_identifier': 'alert_id', 'alert id': 'alert_id',
      'entityid': 'entity_id', 'entity_identifier': 'entity_id', 'entity id': 'entity_id',
      'assetid': 'asset_id', 'asset_identifier': 'asset_id', 'asset id': 'asset_id',
      'caseid': 'case_id', 'case_identifier': 'case_id', 'case id': 'case_id',
      'time': 'timestamp', 'date': 'timestamp',
      'entityname': 'entity_name', 'entity name': 'entity_name',
      'assettype': 'asset_type', 'asset type': 'asset_type',
      'lasttelemetry': 'last_telemetry', 'last_seen': 'last_telemetry',
      'closuretime': 'closed_at', 'closed': 'closed_at',
      'duration': 'investigation_duration', 'investigation duration': 'investigation_duration',
      'escalation': 'escalated', 'is_escalated': 'escalated'
    };

    const rawHeaders = parseRow(lines[0]);
    const headers = rawHeaders.map(h => {
      const clean = h.toLowerCase().replace(/[^a-z0-9_ ]/g, '').trim();
      return headerMap[clean] || clean.replace(/ /g, '_');
    });

    if (lines.length < 2) {
      return { headers, rows: [], isEmpty: true };
    }

    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const rowValues = parseRow(lines[i]);
      if (rowValues.length === 0 || (rowValues.length === 1 && rowValues[0] === '')) continue;
      const rec: Record<string, string> = {};
      headers.forEach((h, idx) => {
        rec[h] = rowValues[idx] ?? '';
      });
      rows.push(rec);
    }

    return { headers, rows, isEmpty: rows.length === 0 };
  }

  public static parseCsvString(csvContent: string): Record<string, string>[] {
    return this.parseCsvWithMeta(csvContent).rows;
  }

  public static validateRequiredHeaders(
    headers: string[],
    required: string[],
    table: 'entities' | 'assets' | 'alerts' | 'cases'
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const normalizedHeaders = new Set(headers.map(h => h.toLowerCase()));

    for (const req of required) {
      if (!normalizedHeaders.has(req.toLowerCase())) {
        errors.push({
          table,
          field: req,
          message: `Missing required column '${req}' in ${table} CSV header`
        });
      }
    }
    return errors;
  }

  public static validateDataset(
    dataset: DatasetPayload,
    dbService?: DatabaseService,
    clearExisting = false
  ): { valid: boolean; errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    const entities = dataset.entities || [];
    const assets = dataset.assets || [];
    const alerts = dataset.alerts || [];
    const cases = dataset.cases || [];

    const totalRows = entities.length + assets.length + alerts.length + cases.length;
    if (totalRows === 0) {
      return {
        valid: false,
        errors: [{
          table: 'dataset',
          message: 'Dataset is empty or contains no records'
        }]
      };
    }

    const entityIds = new Set<string>();
    const assetMap = new Map<string, { entity_id: string }>();
    const alertMap = new Map<string, { entity_id: string; asset_id: string; timestamp: string }>();
    const caseIds = new Set<string>();

    // If incremental ingestion (not clearExisting) and dbService is provided, populate existing foreign keys
    if (!clearExisting && dbService) {
      try {
        const existingEntities = dbService.getEntities();
        for (const e of existingEntities) entityIds.add(e.entity_id);

        const rawDb = dbService.getRawDb();
        const existingAssets = rawDb.prepare('SELECT asset_id, entity_id FROM assets').all() as unknown as { asset_id: string; entity_id: string }[];
        for (const a of existingAssets) assetMap.set(a.asset_id, { entity_id: a.entity_id });

        const existingAlerts = rawDb.prepare('SELECT alert_id, entity_id, asset_id, timestamp FROM alerts').all() as unknown as { alert_id: string; entity_id: string; asset_id: string; timestamp: string }[];
        for (const al of existingAlerts) alertMap.set(al.alert_id, { entity_id: al.entity_id, asset_id: al.asset_id, timestamp: al.timestamp });
      } catch {
        // Fallback to in-batch only if query fails
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Validate Entities
    // ─────────────────────────────────────────────────────────────────────────
    const seenBatchEntityIds = new Set<string>();

    entities.forEach((entity, index) => {
      const rawId = entity.entity_id;
      const id = typeof rawId === 'string' ? rawId.trim() : '';

      if (!id) {
        errors.push({ table: 'entities', field: 'entity_id', message: `Row ${index + 1}: Missing or empty entity_id` });
      } else if (seenBatchEntityIds.has(id)) {
        errors.push({ table: 'entities', recordId: id, field: 'entity_id', message: `Duplicate entity_id: ${id}` });
      } else {
        seenBatchEntityIds.add(id);
        entityIds.add(id);
      }

      if (!entity.entity_name || typeof entity.entity_name !== 'string' || entity.entity_name.trim() === '') {
        errors.push({ table: 'entities', recordId: id || `Row ${index + 1}`, field: 'entity_name', message: 'Missing or empty entity_name' });
      }

      if (!entity.sector || typeof entity.sector !== 'string' || entity.sector.trim() === '') {
        errors.push({ table: 'entities', recordId: id || `Row ${index + 1}`, field: 'sector', message: 'Missing or empty sector' });
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Validate Assets
    // ─────────────────────────────────────────────────────────────────────────
    const seenBatchAssetIds = new Set<string>();

    assets.forEach((asset, index) => {
      const rawId = asset.asset_id;
      const id = typeof rawId === 'string' ? rawId.trim() : '';

      if (!id) {
        errors.push({ table: 'assets', field: 'asset_id', message: `Row ${index + 1}: Missing or empty asset_id` });
      } else if (seenBatchAssetIds.has(id)) {
        errors.push({ table: 'assets', recordId: id, field: 'asset_id', message: `Duplicate asset_id: ${id}` });
      } else {
        seenBatchAssetIds.add(id);
        assetMap.set(id, { entity_id: asset.entity_id });
      }

      if (!asset.entity_id || typeof asset.entity_id !== 'string' || asset.entity_id.trim() === '') {
        errors.push({
          table: 'assets',
          recordId: id || `Row ${index + 1}`,
          field: 'entity_id',
          message: 'Missing or empty entity_id in assets table'
        });
      } else if (!entityIds.has(asset.entity_id.trim())) {
        errors.push({
          table: 'assets',
          recordId: id,
          field: 'entity_id',
          message: `Referenced entity_id '${asset.entity_id}' does not exist in entities table`,
          value: asset.entity_id
        });
      }

      if (!asset.asset_type || typeof asset.asset_type !== 'string' || asset.asset_type.trim() === '') {
        errors.push({ table: 'assets', recordId: id || `Row ${index + 1}`, field: 'asset_type', message: 'Missing asset_type' });
      }

      const validCriticalities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
      if (!asset.criticality || !validCriticalities.includes(asset.criticality)) {
        errors.push({
          table: 'assets',
          recordId: id || `Row ${index + 1}`,
          field: 'criticality',
          message: `Invalid criticality '${asset.criticality}'. Must be one of: ${validCriticalities.join(', ')}`,
          value: asset.criticality
        });
      }

      if (!asset.expected_telemetry || typeof asset.expected_telemetry !== 'string' || asset.expected_telemetry.trim() === '') {
        errors.push({ table: 'assets', recordId: id || `Row ${index + 1}`, field: 'expected_telemetry', message: 'Missing expected_telemetry' });
      }

      if (asset.last_telemetry && !this.isValidISODate(asset.last_telemetry)) {
        errors.push({
          table: 'assets',
          recordId: id,
          field: 'last_telemetry',
          message: `Invalid ISO date format for last_telemetry: '${asset.last_telemetry}'`,
          value: asset.last_telemetry
        });
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Validate Alerts
    // ─────────────────────────────────────────────────────────────────────────
    const seenBatchAlertIds = new Set<string>();

    alerts.forEach((alert, index) => {
      const rawId = alert.alert_id;
      const id = typeof rawId === 'string' ? rawId.trim() : '';

      if (!id) {
        errors.push({ table: 'alerts', field: 'alert_id', message: `Row ${index + 1}: Missing or empty alert_id` });
      } else if (seenBatchAlertIds.has(id)) {
        errors.push({ table: 'alerts', recordId: id, field: 'alert_id', message: `Duplicate alert_id: ${id}` });
      } else {
        seenBatchAlertIds.add(id);
        alertMap.set(id, {
          entity_id: alert.entity_id,
          asset_id: alert.asset_id,
          timestamp: alert.timestamp
        });
      }

      if (!this.isValidISODate(alert.timestamp)) {
        errors.push({
          table: 'alerts',
          recordId: id || `Row ${index + 1}`,
          field: 'timestamp',
          message: `Invalid ISO timestamp: '${alert.timestamp}'`,
          value: alert.timestamp
        });
      }

      if (!alert.entity_id || typeof alert.entity_id !== 'string' || alert.entity_id.trim() === '') {
        errors.push({
          table: 'alerts',
          recordId: id || `Row ${index + 1}`,
          field: 'entity_id',
          message: 'Missing entity_id in alerts table'
        });
      } else if (!entityIds.has(alert.entity_id.trim())) {
        errors.push({
          table: 'alerts',
          recordId: id,
          field: 'entity_id',
          message: `Referenced entity_id '${alert.entity_id}' does not exist in entities table`,
          value: alert.entity_id
        });
      }

      const assetInfo = alert.asset_id ? assetMap.get(alert.asset_id.trim()) : undefined;
      if (!alert.asset_id || typeof alert.asset_id !== 'string' || alert.asset_id.trim() === '') {
        errors.push({
          table: 'alerts',
          recordId: id || `Row ${index + 1}`,
          field: 'asset_id',
          message: 'Missing asset_id in alerts table'
        });
      } else if (!assetInfo) {
        errors.push({
          table: 'alerts',
          recordId: id,
          field: 'asset_id',
          message: `Referenced asset_id '${alert.asset_id}' does not exist in assets table`,
          value: alert.asset_id
        });
      } else if (alert.entity_id && assetInfo.entity_id !== alert.entity_id) {
        errors.push({
          table: 'alerts',
          recordId: id,
          field: 'asset_id',
          message: `Asset '${alert.asset_id}' belongs to entity '${assetInfo.entity_id}', not '${alert.entity_id}'`,
          value: alert.asset_id
        });
      }

      const validSeverities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
      if (!alert.severity || !validSeverities.includes(alert.severity)) {
        errors.push({
          table: 'alerts',
          recordId: id || `Row ${index + 1}`,
          field: 'severity',
          message: `Invalid severity '${alert.severity}'. Must be one of: ${validSeverities.join(', ')}`,
          value: alert.severity
        });
      }

      if (!alert.category || typeof alert.category !== 'string' || alert.category.trim() === '') {
        errors.push({ table: 'alerts', recordId: id || `Row ${index + 1}`, field: 'category', message: 'Missing category' });
      }

      const validStatuses = ['OPEN', 'INVESTIGATING', 'CLOSED', 'ESCALATED'];
      if (!alert.status || !validStatuses.includes(alert.status)) {
        errors.push({
          table: 'alerts',
          recordId: id || `Row ${index + 1}`,
          field: 'status',
          message: `Invalid status '${alert.status}'. Must be one of: ${validStatuses.join(', ')}`,
          value: alert.status
        });
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Validate Cases
    // ─────────────────────────────────────────────────────────────────────────
    cases.forEach((c, index) => {
      const rawId = c.case_id;
      const id = typeof rawId === 'string' ? rawId.trim() : '';

      if (!id) {
        errors.push({ table: 'cases', field: 'case_id', message: `Row ${index + 1}: Missing or empty case_id` });
      } else if (caseIds.has(id)) {
        errors.push({ table: 'cases', recordId: id, field: 'case_id', message: `Duplicate case_id: ${id}` });
      } else {
        caseIds.add(id);
      }

      const alertInfo = c.alert_id ? alertMap.get(c.alert_id.trim()) : undefined;
      if (!c.alert_id || typeof c.alert_id !== 'string' || c.alert_id.trim() === '') {
        errors.push({
          table: 'cases',
          recordId: id || `Row ${index + 1}`,
          field: 'alert_id',
          message: 'Missing alert_id in cases table'
        });
      } else if (!alertInfo) {
        errors.push({
          table: 'cases',
          recordId: id,
          field: 'alert_id',
          message: `Referenced alert_id '${c.alert_id}' does not exist in alerts table`,
          value: c.alert_id
        });
      } else if (c.entity_id && alertInfo.entity_id !== c.entity_id) {
        errors.push({
          table: 'cases',
          recordId: id,
          field: 'entity_id',
          message: `Case entity_id '${c.entity_id}' does not match alert entity_id '${alertInfo.entity_id}'`,
          value: c.entity_id
        });
      }

      if (!c.entity_id || typeof c.entity_id !== 'string' || c.entity_id.trim() === '') {
        errors.push({
          table: 'cases',
          recordId: id || `Row ${index + 1}`,
          field: 'entity_id',
          message: 'Missing entity_id in cases table'
        });
      } else if (!entityIds.has(c.entity_id.trim())) {
        errors.push({
          table: 'cases',
          recordId: id,
          field: 'entity_id',
          message: `Referenced entity_id '${c.entity_id}' does not exist in entities table`,
          value: c.entity_id
        });
      }

      if (!c.investigator || typeof c.investigator !== 'string' || c.investigator.trim() === '') {
        errors.push({ table: 'cases', recordId: id || `Row ${index + 1}`, field: 'investigator', message: 'Missing investigator' });
      }

      if (!this.isValidISODate(c.opened_at)) {
        errors.push({
          table: 'cases',
          recordId: id || `Row ${index + 1}`,
          field: 'opened_at',
          message: `Invalid ISO opened_at date: '${c.opened_at}'`,
          value: c.opened_at
        });
      }

      const dur = Number(c.investigation_duration);
      if (c.investigation_duration === undefined || c.investigation_duration === null || isNaN(dur) || dur < 0) {
        errors.push({
          table: 'cases',
          recordId: id || `Row ${index + 1}`,
          field: 'investigation_duration',
          message: `Investigation duration must be a non-negative number: '${c.investigation_duration}'`,
          value: c.investigation_duration
        });
      }

      // Boolean validation for escalated
      const boolCheck = this.parseBoolean(c.escalated);
      if (!boolCheck.valid) {
        errors.push({
          table: 'cases',
          recordId: id || `Row ${index + 1}`,
          field: 'escalated',
          message: `Invalid boolean field 'escalated': '${c.escalated}'. Expected 0, 1, true, or false.`,
          value: c.escalated
        });
      }

      if (c.closed_at && !this.isValidISODate(c.closed_at)) {
        errors.push({
          table: 'cases',
          recordId: id,
          field: 'closed_at',
          message: `Invalid ISO closed_at date: '${c.closed_at}'`,
          value: c.closed_at
        });
      }

      const validRemediation = ['Completed', 'In Progress', 'None', 'Ignored', null, undefined, ''];
      if (!validRemediation.includes(c.remediation_status)) {
        errors.push({
          table: 'cases',
          recordId: id,
          field: 'remediation_status',
          message: `Invalid remediation_status '${c.remediation_status}'`,
          value: c.remediation_status
        });
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export class DataIngestionService {
  constructor(private dbService: DatabaseService) {}

  public readSqliteExport(filePath: string): DatasetPayload {
    const sourceDb = new DatabaseSync(filePath, { readOnly: true });
    try {
      const tables = sourceDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
      const available = new Set(tables.map(table => table.name));
      const requiredTables = ['entities', 'assets', 'alerts', 'cases'];
      const missing = requiredTables.filter(table => !available.has(table));
      if (missing.length > 0) {
        throw new Error(`SQLite export is missing required table(s): ${missing.join(', ')}`);
      }

      return {
        entities: sourceDb.prepare('SELECT entity_id, entity_name, sector FROM entities').all() as unknown as EntityRecord[],
        assets: sourceDb.prepare('SELECT asset_id, entity_id, asset_type, criticality, expected_telemetry, last_telemetry FROM assets').all() as unknown as AssetRecord[],
        alerts: sourceDb.prepare('SELECT alert_id, timestamp, entity_id, asset_id, severity, category, source_ip, destination_ip, status FROM alerts').all() as unknown as AlertRecord[],
        cases: sourceDb.prepare('SELECT case_id, alert_id, entity_id, investigator, opened_at, investigation_duration, escalated, closed_at, closure_reason, remediation_status FROM cases').all() as unknown as CaseRecord[]
      };
    } finally {
      sourceDb.close();
    }
  }

  public ingestDataset(dataset: DatasetPayload, clearExisting = false): IngestionResult {
    const rawEntities = dataset.entities || [];
    const rawAssets = dataset.assets || [];
    const rawAlerts = dataset.alerts || [];
    const rawCases = dataset.cases || [];

    const rowsReceived: RowCounts = {
      entities: rawEntities.length,
      assets: rawAssets.length,
      alerts: rawAlerts.length,
      cases: rawCases.length,
      total: rawEntities.length + rawAssets.length + rawAlerts.length + rawCases.length
    };

    const emptyCounts = { entities: 0, assets: 0, alerts: 0, cases: 0, total: 0 };
    const currentDbCounts = this.dbService.getCounts();

    const validation = DataValidator.validateDataset(dataset, this.dbService, clearExisting);
    if (!validation.valid) {
      return {
        success: false,
        message: `Validation failed with ${validation.errors.length} error(s). Dataset was rejected.`,
        rows_received: rowsReceived,
        rows_accepted: emptyCounts,
        rows_rejected: rowsReceived,
        validation_errors: validation.errors,
        database_counts: currentDbCounts,
        inserted: { entities: 0, assets: 0, alerts: 0, cases: 0 },
        errors: validation.errors
      };
    }

    const rawDb = this.dbService.getRawDb();

    try {
      rawDb.exec('BEGIN TRANSACTION;');

      if (clearExisting) {
        this.dbService.clearAll();
      }

      // Insert Entities (Normalized)
      const insertEntity = rawDb.prepare(`
        INSERT INTO entities (entity_id, entity_name, sector)
        VALUES (?, ?, ?)
        ON CONFLICT(entity_id) DO UPDATE SET
          entity_name = excluded.entity_name,
          sector = excluded.sector;
      `);

      for (const ent of rawEntities) {
        insertEntity.run(ent.entity_id.trim(), ent.entity_name.trim(), ent.sector.trim());
      }

      // Insert Assets (Normalized)
      const insertAsset = rawDb.prepare(`
        INSERT INTO assets (asset_id, entity_id, asset_type, criticality, expected_telemetry, last_telemetry)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id) DO UPDATE SET
          entity_id = excluded.entity_id,
          asset_type = excluded.asset_type,
          criticality = excluded.criticality,
          expected_telemetry = excluded.expected_telemetry,
          last_telemetry = excluded.last_telemetry;
      `);

      for (const ast of rawAssets) {
        insertAsset.run(
          ast.asset_id.trim(),
          ast.entity_id.trim(),
          ast.asset_type.trim(),
          ast.criticality,
          ast.expected_telemetry.trim(),
          ast.last_telemetry ? ast.last_telemetry.trim() : null
        );
      }

      // Insert Alerts (Normalized)
      const insertAlert = rawDb.prepare(`
        INSERT INTO alerts (alert_id, timestamp, entity_id, asset_id, severity, category, source_ip, destination_ip, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(alert_id) DO UPDATE SET
          timestamp = excluded.timestamp,
          entity_id = excluded.entity_id,
          asset_id = excluded.asset_id,
          severity = excluded.severity,
          category = excluded.category,
          source_ip = excluded.source_ip,
          destination_ip = excluded.destination_ip,
          status = excluded.status;
      `);

      for (const al of rawAlerts) {
        insertAlert.run(
          al.alert_id.trim(),
          al.timestamp.trim(),
          al.entity_id.trim(),
          al.asset_id.trim(),
          al.severity,
          al.category.trim(),
          al.source_ip ? al.source_ip.trim() : null,
          al.destination_ip ? al.destination_ip.trim() : null,
          al.status
        );
      }

      // Insert Cases (Normalized)
      const insertCase = rawDb.prepare(`
        INSERT INTO cases (case_id, alert_id, entity_id, investigator, opened_at, investigation_duration, escalated, closed_at, closure_reason, remediation_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(case_id) DO UPDATE SET
          alert_id = excluded.alert_id,
          entity_id = excluded.entity_id,
          investigator = excluded.investigator,
          opened_at = excluded.opened_at,
          investigation_duration = excluded.investigation_duration,
          escalated = excluded.escalated,
          closed_at = excluded.closed_at,
          closure_reason = excluded.closure_reason,
          remediation_status = excluded.remediation_status;
      `);

      for (const cs of rawCases) {
        const boolParsed = DataValidator.parseBoolean(cs.escalated);
        insertCase.run(
          cs.case_id.trim(),
          cs.alert_id.trim(),
          cs.entity_id.trim(),
          cs.investigator.trim(),
          cs.opened_at.trim(),
          Math.round(Number(cs.investigation_duration)),
          boolParsed.value,
          cs.closed_at ? cs.closed_at.trim() : null,
          cs.closure_reason ? cs.closure_reason.trim() : null,
          cs.remediation_status ? cs.remediation_status : null
        );
      }

      rawDb.exec('COMMIT;');

      const updatedCounts = this.dbService.getCounts();
      const rowsAccepted: RowCounts = {
        entities: rawEntities.length,
        assets: rawAssets.length,
        alerts: rawAlerts.length,
        cases: rawCases.length,
        total: rowsReceived.total
      };

      return {
        success: true,
        message: `Successfully validated and ingested ${rowsAccepted.total} record(s).`,
        rows_received: rowsReceived,
        rows_accepted: rowsAccepted,
        rows_rejected: emptyCounts,
        validation_errors: [],
        database_counts: updatedCounts,
        inserted: {
          entities: rawEntities.length,
          assets: rawAssets.length,
          alerts: rawAlerts.length,
          cases: rawCases.length
        },
        errors: []
      };
    } catch (err: unknown) {
      try {
        rawDb.exec('ROLLBACK;');
      } catch {
        // ignore rollback errors if not in transaction
      }

      const txError: ValidationError = {
        table: 'dataset',
        message: `Database transaction error: ${err instanceof Error ? err.message : String(err)}`
      };

      return {
        success: false,
        message: `Database transaction error: ${err instanceof Error ? err.message : String(err)}`,
        rows_received: rowsReceived,
        rows_accepted: emptyCounts,
        rows_rejected: rowsReceived,
        validation_errors: [txError],
        database_counts: currentDbCounts,
        inserted: { entities: 0, assets: 0, alerts: 0, cases: 0 },
        errors: [txError]
      };
    }
  }

  public ingestCsvTables(csvMap: {
    entities?: string;
    assets?: string;
    alerts?: string;
    cases?: string;
  }, clearExisting = false): IngestionResult {
    const dataset: DatasetPayload = {};
    const headerErrors: ValidationError[] = [];

    let totalEntitiesReceived = 0;
    let totalAssetsReceived = 0;
    let totalAlertsReceived = 0;
    let totalCasesReceived = 0;

    // 1. Entities CSV
    if (csvMap.entities !== undefined) {
      const parsed = DataValidator.parseCsvWithMeta(csvMap.entities);
      if (parsed.isEmpty) {
        headerErrors.push({ table: 'entities', message: 'Entities CSV file is empty or contains no records' });
      } else {
        const missing = DataValidator.validateRequiredHeaders(parsed.headers, ['entity_id', 'entity_name', 'sector'], 'entities');
        headerErrors.push(...missing);
        totalEntitiesReceived = parsed.rows.length;
        dataset.entities = parsed.rows.map(r => ({
          entity_id: r.entity_id ?? r.ENTITY_ID ?? '',
          entity_name: r.entity_name ?? r.ENTITY_NAME ?? '',
          sector: r.sector ?? r.SECTOR ?? ''
        }));
      }
    }

    // 2. Assets CSV
    if (csvMap.assets !== undefined) {
      const parsed = DataValidator.parseCsvWithMeta(csvMap.assets);
      if (parsed.isEmpty) {
        headerErrors.push({ table: 'assets', message: 'Assets CSV file is empty or contains no records' });
      } else {
        const missing = DataValidator.validateRequiredHeaders(parsed.headers, ['asset_id', 'entity_id', 'asset_type', 'criticality', 'expected_telemetry'], 'assets');
        headerErrors.push(...missing);
        totalAssetsReceived = parsed.rows.length;
        dataset.assets = parsed.rows.map(r => ({
          asset_id: r.asset_id ?? r.ASSET_ID ?? '',
          entity_id: r.entity_id ?? r.ENTITY_ID ?? '',
          asset_type: r.asset_type ?? r.ASSET_TYPE ?? '',
          criticality: (r.criticality ?? r.CRITICALITY ?? '') as AssetRecord['criticality'],
          expected_telemetry: r.expected_telemetry ?? r.EXPECTED_TELEMETRY ?? '',
          last_telemetry: r.last_telemetry || r.LAST_TELEMETRY || null
        }));
      }
    }

    // 3. Alerts CSV
    if (csvMap.alerts !== undefined) {
      const parsed = DataValidator.parseCsvWithMeta(csvMap.alerts);
      if (parsed.isEmpty) {
        headerErrors.push({ table: 'alerts', message: 'Alerts CSV file is empty or contains no records' });
      } else {
        const missing = DataValidator.validateRequiredHeaders(parsed.headers, ['alert_id', 'timestamp', 'entity_id', 'asset_id', 'severity', 'category', 'status'], 'alerts');
        headerErrors.push(...missing);
        totalAlertsReceived = parsed.rows.length;
        dataset.alerts = parsed.rows.map(r => ({
          alert_id: r.alert_id ?? r.ALERT_ID ?? '',
          timestamp: r.timestamp ?? r.TIMESTAMP ?? '',
          entity_id: r.entity_id ?? r.ENTITY_ID ?? '',
          asset_id: r.asset_id ?? r.ASSET_ID ?? '',
          severity: (r.severity ?? r.SEVERITY ?? '') as AlertRecord['severity'],
          category: r.category ?? r.CATEGORY ?? '',
          source_ip: r.source_ip || r.SOURCE_IP || null,
          destination_ip: r.destination_ip || r.DESTINATION_IP || null,
          status: (r.status ?? r.STATUS ?? '') as AlertRecord['status']
        }));
      }
    }

    // 4. Cases CSV
    if (csvMap.cases !== undefined) {
      const parsed = DataValidator.parseCsvWithMeta(csvMap.cases);
      if (parsed.isEmpty) {
        headerErrors.push({ table: 'cases', message: 'Cases CSV file is empty or contains no records' });
      } else {
        const missing = DataValidator.validateRequiredHeaders(parsed.headers, ['case_id', 'alert_id', 'entity_id', 'investigator', 'opened_at', 'investigation_duration', 'escalated'], 'cases');
        headerErrors.push(...missing);
        totalCasesReceived = parsed.rows.length;
        dataset.cases = parsed.rows.map(r => {
          const rawDuration = r.investigation_duration ?? r.INVESTIGATION_DURATION ?? '';
          const durNum = rawDuration === '' ? NaN : Number(rawDuration);
          const rawEsc = r.escalated ?? r.ESCALATED;

          return {
            case_id: r.case_id ?? r.CASE_ID ?? '',
            alert_id: r.alert_id ?? r.ALERT_ID ?? '',
            entity_id: r.entity_id ?? r.ENTITY_ID ?? '',
            investigator: r.investigator ?? r.INVESTIGATOR ?? '',
            opened_at: r.opened_at ?? r.OPENED_AT ?? '',
            investigation_duration: isNaN(durNum) ? (-1 as number) : durNum,
            escalated: rawEsc as any,
            closed_at: r.closed_at || r.CLOSED_AT || null,
            closure_reason: r.closure_reason || r.CLOSURE_REASON || null,
            remediation_status: (r.remediation_status || r.REMEDIATION_STATUS || null) as CaseRecord['remediation_status']
          };
        });
      }
    }

    const rowsReceived: RowCounts = {
      entities: totalEntitiesReceived,
      assets: totalAssetsReceived,
      alerts: totalAlertsReceived,
      cases: totalCasesReceived,
      total: totalEntitiesReceived + totalAssetsReceived + totalAlertsReceived + totalCasesReceived
    };

    if (headerErrors.length > 0) {
      return {
        success: false,
        message: `CSV parsing/header validation failed with ${headerErrors.length} error(s)`,
        rows_received: rowsReceived,
        rows_accepted: { entities: 0, assets: 0, alerts: 0, cases: 0, total: 0 },
        rows_rejected: rowsReceived,
        validation_errors: headerErrors,
        database_counts: this.dbService.getCounts(),
        inserted: { entities: 0, assets: 0, alerts: 0, cases: 0 },
        errors: headerErrors
      };
    }

    return this.ingestDataset(dataset, clearExisting);
  }
}
