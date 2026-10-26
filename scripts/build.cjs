const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
fs.cpSync(path.join(root, 'web'), path.join(root, 'dist'), { recursive: true });
console.log('Built static journal → dist');
