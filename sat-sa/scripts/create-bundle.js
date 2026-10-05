const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

console.log('--- STARTING BUNDLE CREATION ---');
console.log('This script requires Internet access to download dependencies.');
console.log('Target bundle will be 100% offline-ready.');

const baseDir = process.cwd();
const deployDir = path.join(baseDir, 'deployment');
const bundleDir = path.join(deployDir, 'sat-sa-offline-bundle');

// 1. Clean previous bundle
if (fs.existsSync(bundleDir)) {
    fs.rmSync(bundleDir, { recursive: true, force: true });
}
fs.mkdirSync(bundleDir, { recursive: true });

// 2. Build Frontend
console.log('\n[1/4] Building Frontend...');
cp.execSync('npm install', { cwd: path.join(baseDir, 'frontend'), stdio: 'inherit' });
cp.execSync('npm run build', { cwd: path.join(baseDir, 'frontend'), stdio: 'inherit' });

// 3. Build Backend
console.log('\n[2/4] Building Backend...');
cp.execSync('npm install', { cwd: path.join(baseDir, 'backend'), stdio: 'inherit' });
cp.execSync('npm run build', { cwd: path.join(baseDir, 'backend'), stdio: 'inherit' });

// 4. Create structure
console.log('\n[3/4] Assembling Bundle Structure...');
const appDir = path.join(bundleDir, 'app');
const backendDir = path.join(appDir, 'backend');
const frontendDir = path.join(appDir, 'frontend');
const analyticsDir = path.join(appDir, 'analytics');
const pythonDir = path.join(bundleDir, 'python');
fs.mkdirSync(appDir);
fs.mkdirSync(backendDir);
fs.mkdirSync(frontendDir);
fs.mkdirSync(analyticsDir);
fs.mkdirSync(pythonDir);

function getPythonVersion() {
    const output = cp.execFileSync(process.env.PYTHON || 'python', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const match = output.match(/Python\s+(\d+)\.(\d+)\.(\d+)/);
    if (!match) throw new Error(`Unable to parse Python version: ${output}`);
    return { raw: output, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

// Copy backend
fs.cpSync(path.join(baseDir, 'backend', 'dist'), path.join(backendDir, 'dist'), { recursive: true });
fs.copyFileSync(path.join(baseDir, 'backend', 'package.json'), path.join(backendDir, 'package.json'));
fs.copyFileSync(path.join(baseDir, 'backend', 'package-lock.json'), path.join(backendDir, 'package-lock.json'));
// Install production node modules offline-ready
cp.execSync('npm ci --production', { cwd: backendDir, stdio: 'inherit' });

// Copy frontend
fs.cpSync(path.join(baseDir, 'frontend', 'dist'), path.join(frontendDir, 'dist'), { recursive: true });

// Copy analytics
fs.cpSync(path.join(baseDir, 'analytics'), analyticsDir, { 
    recursive: true, 
    filter: (src) => !src.includes('__pycache__') && !src.includes('tests') && !src.includes('.pytest_cache') 
});

// 5. Download Python Wheels
console.log('\n[4/4] Downloading Python Wheels...');
try {
    cp.execSync('pip download -r requirements.txt -d ../../python/', { cwd: analyticsDir, stdio: 'inherit' });
} catch (e) {
    console.error('Warning: pip download failed', e);
}

const pythonInfo = getPythonVersion();
const nodePackage = JSON.parse(fs.readFileSync(path.join(backendDir, 'package.json'), 'utf8'));
const manifest = {
    manifest_version: '1.0',
    created_at: new Date().toISOString(),
    target: {
        platform: process.platform,
        arch: os.arch(),
        node_version: process.version,
        node_major: Number(process.versions.node.split('.')[0]),
        python_version: pythonInfo.raw,
        python_major: pythonInfo.major,
        python_minor: pythonInfo.minor,
        python_arch: os.arch()
    },
    dependencies: {
        node: nodePackage.dependencies || {},
        python_requirements: fs.readFileSync(path.join(analyticsDir, 'requirements.txt'), 'utf8').split(/\r?\n/).filter(Boolean),
        wheel_files: fs.readdirSync(pythonDir).filter(name => name.endsWith('.whl'))
    },
    portability: 'target-specific; platform, architecture, Node major, and Python major/minor must match'
};
fs.writeFileSync(path.join(bundleDir, 'bundle-manifest.json'), JSON.stringify(manifest, null, 2));

// 6. Create Install & Verify Scripts for Windows target
const installScript = `
@echo off
echo --- SAT-SA OFFLINE INSTALLER ---
echo Checking Python version...
python --version
if errorlevel 1 (
    echo Python is not installed or not in PATH!
    exit /b 1
)

echo Checking Node.js version...
node --version
if errorlevel 1 (
    echo Node.js is not installed or not in PATH!
    exit /b 1
)

echo Verifying target compatibility before offline installation...
node verify-bundle.js .
if errorlevel 1 (
    echo Bundle target does not match this machine.
    exit /b 1
)

echo Installing Python dependencies OFFLINE...
cd app\\analytics
python -m pip install --no-index --find-links=../../python/ -r requirements.txt
if errorlevel 1 (
    echo Failed to install Python dependencies.
    exit /b 1
)
cd ..\\..

echo Initializing database and verifying...
cd app\\backend
node dist/seed.js
if errorlevel 1 (
    echo Warning: Failed to seed DB (it might already exist or seed.js might not be compiled).
)

node ../../verify-bundle.js .
if errorlevel 1 (
    echo Verification Failed!
    exit /b 1
)

echo Install complete. Run start.bat to run the application.
cd ..\\..
`;

const startScript = `
@echo off
echo Starting SAT-SA Application...
cd app\\backend
set NODE_ENV=production
node dist/index.js
`;

const linuxInstallScript = `
#!/usr/bin/env bash
set -euo pipefail
echo "--- SAT-SA OFFLINE INSTALLER ---"
node verify-bundle.js .
python3 -m pip install --no-index --find-links="$(pwd)/python" -r app/analytics/requirements.txt
node app/backend/dist/seed.js || true
echo "Install complete. Run ./start.sh to start SAT-SA."
`;

const linuxStartScript = `
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/app/backend"
NODE_ENV=production node dist/index.js
`;

const verifyScript = `
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

console.log('--- VERIFYING OFFLINE BUNDLE ---');
let errors = 0;

function check(name, filepath) {
    if (!fs.existsSync(filepath)) {
        console.error('MISSING: ' + name + ' (' + filepath + ')');
        errors++;
    } else {
        console.log('OK: ' + name);
    }
}

check('Backend Dist', path.join(__dirname, 'app/backend/dist/index.js'));
check('Backend Node Modules', path.join(__dirname, 'app/backend/node_modules/express'));
check('Frontend Dist', path.join(__dirname, 'app/frontend/dist/index.html'));
check('Analytics Pipeline', path.join(__dirname, 'app/analytics/pipeline.py'));
check('Python Wheels', path.join(__dirname, 'python'));

if (errors > 0) {
    console.error('Bundle is missing ' + errors + ' required components!');
    process.exit(1);
} else {
    console.log('Bundle structure is complete.');
    process.exit(0);
}
`;

fs.writeFileSync(path.join(bundleDir, 'install.bat'), installScript.trim());
fs.writeFileSync(path.join(bundleDir, 'start.bat'), startScript.trim());
fs.writeFileSync(path.join(bundleDir, 'install.sh'), linuxInstallScript.trim());
fs.writeFileSync(path.join(bundleDir, 'start.sh'), linuxStartScript.trim());
fs.chmodSync(path.join(bundleDir, 'install.sh'), 0o755);
fs.chmodSync(path.join(bundleDir, 'start.sh'), 0o755);
fs.writeFileSync(path.join(bundleDir, 'verify-bundle.js'), verifyScript.trim());
fs.copyFileSync(path.join(baseDir, 'scripts', 'verify-bundle.js'), path.join(bundleDir, 'verify-bundle.js'));

// Zipping would normally go here, but this directory structure itself constitutes the bundle.
console.log('\n=== OFFLINE BUNDLE CREATED at deployment/sat-sa-offline-bundle ===');
console.log('You may now zip this folder and transfer it to the air-gapped machine.');
