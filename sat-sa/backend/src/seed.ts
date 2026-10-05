import path from 'node:path';
import fs from 'node:fs';
import { DatabaseService } from './db.js';
import { DataIngestionService } from './ingestion.js';

function seed() {
  const samplePath = path.resolve(process.cwd(), '../data/sample/dataset.json');
  if (!fs.existsSync(samplePath)) {
    console.error(`Sample dataset file not found at: ${samplePath}`);
    process.exit(1);
  }

  const rawJson = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
  const db = new DatabaseService();
  const ingestion = new DataIngestionService(db);

  console.log('Ingesting representative dataset into sat_sa.db...');
  const res = ingestion.ingestDataset(rawJson, true);

  if (!res.success) {
    console.error('Ingestion failed with errors:', res.errors);
    process.exit(1);
  }

  const counts = db.getCounts();
  console.log('Ingestion completed successfully.');
  console.log('Current Database Row Counts:');
  console.log(`- Entities: ${counts.entities}`);
  console.log(`- Assets:   ${counts.assets}`);
  console.log(`- Alerts:   ${counts.alerts}`);
  console.log(`- Cases:    ${counts.cases}`);
  db.close();
}

seed();
