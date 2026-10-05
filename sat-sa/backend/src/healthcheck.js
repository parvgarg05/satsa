const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

console.log('=== SAT-SA OFFLINE HEALTH CHECK ===\n');

let allPassed = true;

function check(name, testFn) {
  try {
    testFn();
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    allPassed = false;
  }
}

// 1. Check Python executable
check('Python Environment', () => {
  const version = execSync('python --version').toString().trim();
  if (!version.includes('Python 3')) throw new Error('Python 3 not found. Got: ' + version);
});

// 2. Check Python Analytics Dependencies
check('Python ML Dependencies (pandas, scikit-learn)', () => {
  execSync('python -c "import pandas; import sklearn"', { stdio: 'pipe' });
});

// 3. Check SQLite DB writable
check('SQLite Database Writable', () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('sat_sa.db');
  db.exec('CREATE TABLE IF NOT EXISTS _healthcheck (id INTEGER PRIMARY KEY);');
  db.exec('DROP TABLE _healthcheck;');
  db.close();
});

// 4. Check Frontend Assets
check('Frontend Assets Built', () => {
  if (!fs.existsSync(path.join(__dirname, '../../frontend/dist/index.html'))) {
    throw new Error('Frontend dist/ folder missing. Run npm run build in frontend.');
  }
});

console.log('\n==================================');
if (allPassed) {
  console.log('ALL CHECKS PASSED. SYSTEM READY FOR AIR-GAPPED DEPLOYMENT.');
  process.exit(0);
} else {
  console.error('CHECKS FAILED. PLEASE RESOLVE ISSUES.');
  process.exit(1);
}
