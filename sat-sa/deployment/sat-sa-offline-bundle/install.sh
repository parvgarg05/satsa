#!/usr/bin/env bash
set -euo pipefail
echo "--- SAT-SA OFFLINE INSTALLER ---"
node verify-bundle.js .
python3 -m pip install --no-index --find-links="$(pwd)/python" -r app/analytics/requirements.txt
node app/backend/dist/seed.js || true
echo "Install complete. Run ./start.sh to start SAT-SA."