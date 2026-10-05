@echo off
echo Starting SAT-SA Application...
cd app\backend
set NODE_ENV=production
node dist/index.js