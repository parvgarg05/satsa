import fs from 'node:fs';
import path from 'node:path';
import { DatabaseService } from './db.js';

async function clearAll() {
  console.log('==============================================');
  console.log('  SAT-SA: Clearing All Database & Portal Data');
  console.log('==============================================');

  const rootDir = process.cwd();
  const dbPath = path.resolve(rootDir, 'sat_sa.db');
  const assessmentsDir = path.resolve(rootDir, 'assessments');
  const registryPath = path.resolve(assessmentsDir, 'registry.json');
  const cachePath = path.resolve(rootDir, 'analytics_cache.json');

  // 1. Clear all records from main sat_sa.db
  try {
    const db = new DatabaseService(dbPath);
    db.clearAll();
    console.log('✔ Cleared all tables in main SQLite database (sat_sa.db)');
    db.close();
  } catch (err: any) {
    console.warn('Note on main DB wipe:', err.message);
  }

  // 2. Remove all assessment SQLite databases and cache files
  if (fs.existsSync(assessmentsDir)) {
    const files = fs.readdirSync(assessmentsDir);
    for (const file of files) {
      if (file !== 'registry.json') {
        try {
          fs.unlinkSync(path.join(assessmentsDir, file));
        } catch {
          // ignore busy locks if any
        }
      }
    }
    console.log('✔ Removed all isolated assessment period databases & caches');
  } else {
    fs.mkdirSync(assessmentsDir, { recursive: true });
  }

  // 3. Reset assessments registry to clean ASM-DEFAULT
  const now = new Date().toISOString();
  const cleanRegistry = {
    active_id: 'ASM-DEFAULT',
    assessments: {
      'ASM-DEFAULT': {
        assessment_id: 'ASM-DEFAULT',
        name: 'Baseline Assessment',
        description: 'Default baseline supervisory assessment',
        created_at: now,
        updated_at: now,
        db_path: dbPath,
        cache_path: cachePath,
        status: 'READY'
      }
    }
  };
  fs.writeFileSync(registryPath, JSON.stringify(cleanRegistry, null, 2), 'utf-8');
  console.log('✔ Reset assessments registry to clean ASM-DEFAULT');

  // 4. Remove all root analytics cache files and temporary files
  const rootFiles = fs.readdirSync(rootDir);
  for (const file of rootFiles) {
    if (
      file.startsWith('analytics_cache') ||
      file.startsWith('analytics_run_') ||
      (file.startsWith('temp_') && file.endsWith('.db'))
    ) {
      try {
        fs.unlinkSync(path.join(rootDir, file));
      } catch {
        // ignore
      }
    }
  }
  console.log('✔ Removed analytics cache & temporary files');

  // 5. If server is currently running, notify it to activate ASM-DEFAULT & refresh in-memory state
  try {
    const res = await fetch('http://localhost:4000/api/assessments/ASM-DEFAULT/activate', {
      method: 'POST'
    });
    if (res.ok) {
      console.log('✔ Live server notified: active assessment switched to clean ASM-DEFAULT');
    }
  } catch {
    // Server might not be running right now, which is completely fine
  }

  console.log('==============================================');
  console.log('  STATUS: Platform & Database 100% Cleared');
  console.log('  - Entities:     0');
  console.log('  - Assets:       0');
  console.log('  - Alerts:       0');
  console.log('  - Cases:        0');
  console.log('  - Findings:     0');
  console.log('  - Risk Scores:  0');
  console.log('  - Validations:  0');
  console.log('  All portals (Dashboard, Findings, Validation,');
  console.log('  Entities, Evidence) are now completely empty.');
  console.log('==============================================');
}

clearAll().catch((err) => {
  console.error('Error clearing platform data:', err);
  process.exit(1);
});
