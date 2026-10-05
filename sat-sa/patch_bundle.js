const fs = require('fs');
let code = fs.readFileSync('scripts/create-bundle.js', 'utf8');
code = code.replace(/node verify-bundle\.js/g, 'node verify-bundle.js .');
code = code.replace(/node \.\.\/\.\.\/verify-bundle\.js/g, 'node ../../verify-bundle.js .');
fs.writeFileSync('scripts/create-bundle.js', code);
