# SAT-SA Air-Gapped Deployment Guide

This guide details the procedure for deploying SAT-SA to a secure machine with zero Internet connectivity.

## A. Internet Required to CREATE the bundle
Perform these steps on a machine **with** Internet access.

1. **Clone the Repository**
   ```bash
   git clone <repo> sat-sa
   cd sat-sa
   ```

2. **Run Bundle Creation Script**
   ```bash
   node scripts/create-bundle.js
   ```
   This script will:
   - Build the frontend static assets
   - Build the backend TypeScript
   - Download the exact Python wheels needed by `analytics/requirements.txt`
   - Run `npm ci --production` to build offline node modules
   - Assemble the offline directory structure

3. **Zip the Bundle**
   ```bash
   cd deployment
   zip -r sat-sa-offline-bundle.zip sat-sa-offline-bundle/
   ```

---

## B. Internet NOT Required to INSTALL/RUN the bundle
Transfer `sat-sa-offline-bundle.zip` to the target machine via secure USB or cross-domain solution.

### Target Machine Requirements
- The bundle is **target-specific**, not universally portable.
- The target OS, CPU architecture, Node major version, and Python major/minor version must match `bundle-manifest.json`.
- The current checked-in bundle targets Windows `win32/x64`, Node major `24`, and Python `3.14`.
- Python 3.10+ and Node.js 22+ are project-level minimums, but the generated bundle records the exact target versions.

### Installation Procedure

1. **Extract Bundle**
   Extract `sat-sa-offline-bundle.zip` to your desired directory.
   ```cmd
   cd sat-sa-offline-bundle
   ```

2. **Run Offline Installer**
   ```cmd
   install.bat
   ```
   This will:
   - Verify Python and Node installations
   - Install Python dependencies directly from `python/` directory without hitting PyPI.
   - Run `verify-bundle.js` to ensure air-gap integrity.
   *(Note: No NPM installation is executed; `node_modules` are pre-compiled and bundled).*

For Linux targets, use the generated `install.sh` and `start.sh`. A Linux bundle must be created on a matching Linux/architecture build machine; do not reuse the checked-in Windows bundle.

### Verify an existing bundle

From the bundle root, run:

```bash
node verify-bundle.js
```

The command reports the recorded bundle target and current machine, and exits non-zero on OS, CPU architecture, Node major, or Python major/minor mismatch.

Create a new target-specific bundle from the repository root with:

```bash
node scripts/create-bundle.js
```

Run that command on the same OS, CPU architecture, Node major, and Python major/minor as the intended air-gapped target. Bundle creation requires Internet access; installation and runtime do not.

3. **Start Application**
   ```cmd
   start.bat
   ```
   The application backend is securely running on `localhost:4000`, and natively serves the frontend assets at the same port.

## Strict Air-Gap Verification
- The `install.bat` strictly uses `--no-index --find-links` for Python packages.
- No `npm install` is executed on the target machine.
- The bundle natively serves static HTML/JS without external CDN references.
- All testing algorithms (including Isolation Forest attribution) run natively via CPU.
- The bundle is not universally portable: create one bundle per target platform/architecture/version combination.
