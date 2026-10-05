const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const bundleDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..', 'deployment', 'sat-sa-offline-bundle');
const manifestPath = path.join(bundleDir, 'bundle-manifest.json');
let errors = 0;

function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}

function check(name, relativePath) {
  const target = path.join(bundleDir, relativePath);
  if (!fs.existsSync(target)) fail(`${name} missing (${relativePath})`);
  else console.log(`OK: ${name}`);
}

function commandVersion(command, args) {
  try {
    return cp.execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function pythonVersion() {
  const raw = commandVersion(process.env.PYTHON || 'python', ['--version']) || commandVersion('python3', ['--version']);
  const match = raw && raw.match(/Python\s+(\d+)\.(\d+)\.(\d+)/);
  return match ? { raw, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

console.log(`--- VERIFYING TARGET-SPECIFIC SAT-SA BUNDLE: ${bundleDir} ---`);
if (!fs.existsSync(manifestPath)) {
  fail('bundle-manifest.json is missing; this bundle has no recorded target compatibility');
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const currentPython = pythonVersion();
  const currentNodeMajor = Number(process.versions.node.split('.')[0]);
  const expected = manifest.target;
  console.log(`Bundle target: ${expected.platform}/${expected.arch}, Node ${expected.node_version}, Python ${expected.python_version}`);
  console.log(`Current target: ${process.platform}/${os.arch()}, Node ${process.version}, Python ${currentPython?.raw || 'unavailable'}`);

  if (expected.platform !== process.platform) fail(`platform mismatch: bundle=${expected.platform}, current=${process.platform}`);
  if (expected.arch !== os.arch()) fail(`CPU architecture mismatch: bundle=${expected.arch}, current=${os.arch()}`);
  if (Number(expected.node_major) !== currentNodeMajor) fail(`Node major mismatch: bundle=${expected.node_major}, current=${currentNodeMajor}`);
  if (!currentPython) fail('Python 3 is unavailable on the current machine');
  else if (Number(expected.python_major) !== currentPython.major || Number(expected.python_minor) !== currentPython.minor) fail(`Python version mismatch: bundle=${expected.python_major}.${expected.python_minor}, current=${currentPython.major}.${currentPython.minor}`);
}

check('Bundle manifest', 'bundle-manifest.json');
check('Backend dist', 'app/backend/dist/index.js');
check('Backend node_modules', 'app/backend/node_modules/express');
check('Frontend dist', 'app/frontend/dist/index.html');
check('Analytics pipeline', 'app/analytics/pipeline.py');
check('Python wheel directory', 'python');

if (errors > 0) {
  console.error(`Bundle verification failed with ${errors} issue(s). This bundle is target-specific.`);
  process.exit(1);
}
console.log('Bundle target matches the current machine. Offline installation may proceed.');
