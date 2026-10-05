import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from './src/db';
import { DataIngestionService } from './src/ingestion';

function generateRandomCsv(rows: number) {
  let out = 'entity_id,entity_name,sector\n';
  const sectors = ['ENERGY', 'BANKING', 'DEFENCE', 'TELECOM', 'TRANSPORT', 'HEALTHCARE'];
  for (let i = 0; i < rows; i++) {
    const sec = sectors[i % sectors.length];
    out += `CSE-B-${i},Benchmark Entity ${i},${sec}\n`;
  }
  return out;
}

function runSingleIteration(size: number): { ingestMs: number; analyticsMs: number; dbMb: number; rowsInserted: number } {
  const dbFile = 'benchmark.db';
  if (fs.existsSync(dbFile)) {
    try { fs.unlinkSync(dbFile); } catch {}
  }
  if (fs.existsSync(`${dbFile}-wal`)) {
    try { fs.unlinkSync(`${dbFile}-wal`); } catch {}
  }
  if (fs.existsSync(`${dbFile}-shm`)) {
    try { fs.unlinkSync(`${dbFile}-shm`); } catch {}
  }

  const db = new DatabaseService(dbFile);
  const ing = new DataIngestionService(db);

  let assets = 'asset_id,entity_id,asset_type,criticality,expected_telemetry,last_telemetry\n';
  let alerts = 'alert_id,timestamp,entity_id,asset_id,severity,category,status\n';
  let cases = 'case_id,alert_id,entity_id,investigator,opened_at,investigation_duration,escalated\n';

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < 10; j++) {
      assets += `AST-${i}-${j},CSE-B-${i},Server,CRITICAL,syslog,2026-09-27T12:00:00Z\n`;
      alerts += `ALT-${i}-${j},2026-09-27T12:00:00Z,CSE-B-${i},AST-${i}-${j},CRITICAL,Malware,CLOSED\n`;
      cases += `CAS-${i}-${j},ALT-${i}-${j},CSE-B-${i},Analyst-1,2026-09-27T12:00:00Z,30,1\n`;
    }
  }

  // Ingest
  const startIngest = performance.now();
  const res = ing.ingestCsvTables({
    entities: generateRandomCsv(size),
    assets,
    alerts,
    cases
  }, true);
  const timeIngest = performance.now() - startIngest;

  if (!res.success) {
    throw new Error(`Ingestion failed: ${JSON.stringify(res.validation_errors)}`);
  }

  // Analytics
  const startAnalytics = performance.now();
  execSync('python ../analytics/pipeline.py --db-path benchmark.db', { stdio: 'ignore' });
  const timeAnalytics = performance.now() - startAnalytics;

  // Checkpoint WAL and close connection before measuring file size on disk
  db.getRawDb().exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.getRawDb().close();

  const stat = fs.statSync(dbFile);
  const dbMb = Number((stat.size / (1024 * 1024)).toFixed(2));

  return {
    ingestMs: Math.round(timeIngest),
    analyticsMs: Math.round(timeAnalytics),
    dbMb,
    rowsInserted: res.rows_accepted.total
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function runBenchmark() {
  const sizes = [10, 50, 200];
  const summary = [];

  for (const size of sizes) {
    console.log(`\n========================================`);
    console.log(`Benchmarking with ${size} Entities (10 assets/alerts/cases each = ${size * 31} total rows)`);
    console.log(`========================================`);

    // 1 Warm-up run
    process.stdout.write(`[Warm-up run] Executing... `);
    const warmup = runSingleIteration(size);
    console.log(`done (ingest: ${warmup.ingestMs}ms, analytics: ${warmup.analyticsMs}ms, db: ${warmup.dbMb}MB, rows: ${warmup.rowsInserted})`);

    // 3 Timed runs
    const ingestRuns: number[] = [];
    const analyticsRuns: number[] = [];
    const dbRuns: number[] = [];

    for (let run = 1; run <= 3; run++) {
      process.stdout.write(`[Run ${run}/3] Executing... `);
      const iter = runSingleIteration(size);
      console.log(`done (ingest: ${iter.ingestMs}ms, analytics: ${iter.analyticsMs}ms, db: ${iter.dbMb}MB)`);
      ingestRuns.push(iter.ingestMs);
      analyticsRuns.push(iter.analyticsMs);
      dbRuns.push(iter.dbMb);
    }

    const medianIngest = median(ingestRuns);
    const medianAnalytics = median(analyticsRuns);
    const medianDb = median(dbRuns);

    summary.push({
      entities: size,
      totalRows: size * 31,
      alertsCasesAssets: `${size * 10}/${size * 10}/${size * 10}`,
      ingestRuns: ingestRuns.join(', '),
      analyticsRuns: analyticsRuns.join(', '),
      medianIngestMs: medianIngest,
      medianAnalyticsMs: medianAnalytics,
      medianDbMb: medianDb
    });
  }

  console.log('\n=== BENCHMARK SUMMARY (Median of 3 Runs) ===');
  console.table(summary);
}

runBenchmark();

