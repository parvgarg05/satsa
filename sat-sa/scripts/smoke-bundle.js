const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const bundleBackend = path.resolve(__dirname, '..', 'deployment', 'sat-sa-offline-bundle', 'app', 'backend');
const port = Number(process.env.PORT || 4010);
const pythonPath = process.env.PYTHON_PATH || path.resolve(__dirname, '..', '..', '.venv', 'Scripts', 'python.exe');
const child = spawn(process.execPath, ['dist/index.js'], {
  cwd: bundleBackend,
  env: { ...process.env, PORT: String(port), PYTHON_PATH: pythonPath, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', data => { output += data.toString(); });
child.stderr.on('data', data => { output += data.toString(); });

function finish(code, message) {
  if (message) console.log(message);
  child.kill();
  process.exit(code);
}

const deadline = Date.now() + 15000;
function check() {
  if (Date.now() > deadline) finish(1, `Bundle smoke test timed out. Output:\n${output}`);
  const request = http.get(`http://127.0.0.1:${port}/api/health`, response => {
    let body = '';
    response.on('data', chunk => { body += chunk; });
    response.on('end', () => {
      if (response.statusCode === 200) finish(0, `Bundle smoke test passed: ${body}`);
      setTimeout(check, 250);
    });
  });
  request.on('error', () => setTimeout(check, 250));
}
child.on('exit', code => {
  if (code !== null && code !== 0) finish(code, `Bundle process exited early with code ${code}. Output:\n${output}`);
});
check();
