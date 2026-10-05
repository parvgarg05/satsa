#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/app/backend"
NODE_ENV=production node dist/index.js