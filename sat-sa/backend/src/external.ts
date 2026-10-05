import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { DatabaseService } from './db.js';

export const EXTERNAL_UNAVAILABLE_MESSAGE = 'Not applicable — required source fields are unavailable.';

export interface ExternalDatasetSummary {
  dataset_id: string;
  source: string;
  source_file: string;
  source_sha256: string;
  source_size_bytes: number;
  schema: string;
  schema_version: string;
  record_count: number;
  duplicate_count: number;
  ingestion_timestamp: string;
  provenance: Record<string, unknown>;
  field_mapping: Array<{ source_field: string; sat_sa_field: string | null; mapping_type: 'DIRECT' | 'DERIVED' | 'NOT_AVAILABLE'; mapping_status: string }>;
}

export interface ExternalRedteamEvent {
  dataset_id: string;
  event_id: string;
  source_row_number: number;
  raw_record: string;
  raw_record_sha256: string;
  column_1: string;
  column_2: string;
  column_3: string;
  column_4: string;
  duplicate_of_event_id: string | null;
}

export interface ExternalDatasetDetails extends ExternalDatasetSummary {
  events: ExternalRedteamEvent[];
  analytics: Array<{
    module: string;
    status: 'NOT_APPLICABLE' | 'AVAILABLE_AS_RAW_EVENT_ANALYSIS';
    message: string;
  }>;
}

export class ExternalDatasetService {
  constructor(private readonly dbService: DatabaseService) {}

  public ingestLanlRedteam(sourceBytes: Buffer, sourceFile: string): ExternalDatasetSummary {
    const sourceSha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
    const datasetId = `LANL-REDTEAM-${sourceSha256.slice(0, 16).toUpperCase()}`;
    const existing = this.getDataset(datasetId);
    if (existing) return existing;

    const decompressed = sourceBytes.length >= 2 && sourceBytes[0] === 0x1f && sourceBytes[1] === 0x8b
      ? gunzipSync(sourceBytes)
      : sourceBytes;
    const text = decompressed.toString('utf8');
    const lines = text.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    const events: ExternalRedteamEvent[] = [];
    const firstEventByRawRecord = new Map<string, string>();
    let duplicateCount = 0;

    lines.forEach((line, index) => {
      const rawRecord = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (rawRecord.trim() === '') {
        throw new Error(`LANL redteam row ${index + 1} is blank`);
      }
      const columns = rawRecord.split(',');
      if (columns.length !== 4) {
        throw new Error(`LANL redteam row ${index + 1} must contain exactly four comma-separated fields`);
      }

      const eventId = `LANL-RT-${sourceSha256.slice(0, 16).toUpperCase()}-${String(index + 1).padStart(4, '0')}`;
      const duplicateOfEventId = firstEventByRawRecord.get(rawRecord) ?? null;
      if (duplicateOfEventId) duplicateCount++;
      else firstEventByRawRecord.set(rawRecord, eventId);

      events.push({
        dataset_id: datasetId,
        event_id: eventId,
        source_row_number: index + 1,
        raw_record: rawRecord,
        raw_record_sha256: crypto.createHash('sha256').update(rawRecord, 'utf8').digest('hex'),
        column_1: columns[0],
        column_2: columns[1],
        column_3: columns[2],
        column_4: columns[3],
        duplicate_of_event_id: duplicateOfEventId
      });
    });

    const ingestionTimestamp = new Date().toISOString();
    const provenance = {
      source: 'LANL redteam dataset supplied in workspace',
      source_file: sourceFile,
      acquisition_date: null,
      acquisition_date_status: 'not_provided_by_source',
      source_documentation_available: false,
      semantic_interpretation: 'positional four-column raw event staging only',
      compression_detected: sourceBytes.length >= 2 && sourceBytes[0] === 0x1f && sourceBytes[1] === 0x8b,
      original_content_preserved: true,
      synthetic_sat_sa_fields_created: false
    };
    const fieldMapping = [1, 2, 3, 4].map(column => ({
      source_field: `column_${column}`,
      sat_sa_field: null,
      mapping_type: 'NOT_AVAILABLE' as const,
      mapping_status: 'Preserved as opaque external raw-event field; authoritative source semantics unavailable'
    }));
    (provenance as Record<string, unknown>).field_mapping = fieldMapping;
    const summary: ExternalDatasetSummary = {
      dataset_id: datasetId,
      source: 'LANL redteam dataset',
      source_file: sourceFile,
      source_sha256: sourceSha256,
      source_size_bytes: sourceBytes.length,
      schema: 'column_1,column_2,column_3,column_4',
      schema_version: 'positional-v1',
      record_count: events.length,
      duplicate_count: duplicateCount,
      ingestion_timestamp: ingestionTimestamp,
      provenance,
      field_mapping: fieldMapping
    };

    const rawDb = this.dbService.getRawDb();
    rawDb.exec('BEGIN TRANSACTION;');
    try {
      rawDb.prepare(`
        INSERT INTO external_dataset_imports
        (dataset_id, source, source_file, source_sha256, source_size_bytes, schema, schema_version, record_count, duplicate_count, ingestion_timestamp, provenance, raw_content)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        summary.dataset_id,
        summary.source,
        summary.source_file,
        summary.source_sha256,
        summary.source_size_bytes,
        summary.schema,
        summary.schema_version,
        summary.record_count,
        summary.duplicate_count,
        summary.ingestion_timestamp,
        JSON.stringify(summary.provenance),
        sourceBytes
      );

      const eventStatement = rawDb.prepare(`
        INSERT INTO external_redteam_events
        (dataset_id, event_id, source_row_number, raw_record, raw_record_sha256, column_1, column_2, column_3, column_4, duplicate_of_event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const event of events) {
        eventStatement.run(
          event.dataset_id,
          event.event_id,
          event.source_row_number,
          event.raw_record,
          event.raw_record_sha256,
          event.column_1,
          event.column_2,
          event.column_3,
          event.column_4,
          event.duplicate_of_event_id
        );
      }
      rawDb.exec('COMMIT;');
    } catch (error) {
      rawDb.exec('ROLLBACK;');
      throw error;
    }

    return summary;
  }

  public getDatasets(): ExternalDatasetSummary[] {
    const rows = this.dbService.getRawDb().prepare(`
      SELECT dataset_id, source, source_file, source_sha256, source_size_bytes, schema, schema_version,
             record_count, duplicate_count, ingestion_timestamp, provenance
      FROM external_dataset_imports ORDER BY ingestion_timestamp DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map(row => this.toSummary(row));
  }

  public getDataset(datasetId: string): ExternalDatasetSummary | null {
    const row = this.dbService.getRawDb().prepare(`
      SELECT dataset_id, source, source_file, source_sha256, source_size_bytes, schema, schema_version,
             record_count, duplicate_count, ingestion_timestamp, provenance
      FROM external_dataset_imports WHERE dataset_id = ?
    `).get(datasetId) as Record<string, unknown> | undefined;
    return row ? this.toSummary(row) : null;
  }

  public getDatasetDetails(datasetId: string): ExternalDatasetDetails | null {
    const summary = this.getDataset(datasetId);
    if (!summary) return null;
    const events = this.dbService.getRawDb().prepare(`
      SELECT dataset_id, event_id, source_row_number, raw_record, raw_record_sha256,
             column_1, column_2, column_3, column_4, duplicate_of_event_id
      FROM external_redteam_events WHERE dataset_id = ? ORDER BY source_row_number
    `).all(datasetId) as unknown as ExternalRedteamEvent[];
    return {
      ...summary,
      events,
      analytics: [
        ...['EXECUTION_GAP', 'NEGATIVE_SPACE', 'PEER_COMPARISON', 'REPEATED_INCIDENT', 'ALERT_PRIORITIZATION', 'ENTITY_RISK', 'EXPERT_VALIDATION'].map(module => ({
          module,
          status: 'NOT_APPLICABLE' as const,
          message: EXTERNAL_UNAVAILABLE_MESSAGE
        })),
        {
          module: 'RAW_EVENT_ANALYSIS',
          status: 'AVAILABLE_AS_RAW_EVENT_ANALYSIS' as const,
          message: 'Raw event frequency, ordering, co-occurrence, and identifier analysis may be performed without assigning SAT-SA supervisory semantics.'
        }
      ]
    };
  }

  public getEvent(datasetId: string, eventId: string): ExternalRedteamEvent | null {
    const row = this.dbService.getRawDb().prepare(`
      SELECT dataset_id, event_id, source_row_number, raw_record, raw_record_sha256,
             column_1, column_2, column_3, column_4, duplicate_of_event_id
      FROM external_redteam_events WHERE dataset_id = ? AND event_id = ?
    `).get(datasetId, eventId) as ExternalRedteamEvent | undefined;
    return row ?? null;
  }

  private toSummary(row: Record<string, unknown>): ExternalDatasetSummary {
    return {
      dataset_id: String(row.dataset_id),
      source: String(row.source),
      source_file: String(row.source_file),
      source_sha256: String(row.source_sha256),
      source_size_bytes: Number(row.source_size_bytes),
      schema: String(row.schema),
      schema_version: String(row.schema_version),
      record_count: Number(row.record_count),
      duplicate_count: Number(row.duplicate_count),
      ingestion_timestamp: String(row.ingestion_timestamp),
      provenance: JSON.parse(String(row.provenance)) as Record<string, unknown>,
      field_mapping: (JSON.parse(String(row.provenance)).field_mapping || [1, 2, 3, 4].map(column => ({
        source_field: `column_${column}`,
        sat_sa_field: null,
        mapping_type: 'NOT_AVAILABLE',
        mapping_status: 'Mapping not available'
      }))) as ExternalDatasetSummary['field_mapping']
    };
  }
}
