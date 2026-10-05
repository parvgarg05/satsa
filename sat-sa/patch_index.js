const fs = require('fs');

const addition = `
// Serve frontend static files
const frontendDistPath = path.resolve(process.cwd(), '../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
  app.get('*', (req, res, next) => {
    if (req.originalUrl.startsWith('/api')) return next();
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

// Fallback 404 handler`;

let code = fs.readFileSync('backend/src/index.ts', 'utf8');
code = code.replace(/\/\/ Fallback 404 handler/, addition);
// We also need to import fs if it isn't imported.
if (!code.includes("import fs from")) {
    code = code.replace(/import path from 'node:path';/, "import path from 'node:path';\nimport fs from 'node:fs';");
}
fs.writeFileSync('backend/src/index.ts', code);
