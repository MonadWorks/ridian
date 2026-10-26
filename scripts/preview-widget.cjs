// Isolated browser preview: synthetic tasks and disposable credentials only.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService } = require('../lib/server.cjs');
const root = path.join(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ridian-preview-'));
const webRoot = path.join(temporary, 'web');
fs.cpSync(path.join(root, 'web'), webRoot, { recursive: true });
const service = createService({ directory: path.join(temporary, 'data'), webRoot, port: 43128 });
for (const [title, priority] of [['Review notes', 'urgent'], ['Plan tomorrow', 'high'], ['Read a chapter', 'normal'], ['Take a walk', 'low']]) service.store.add({ title, priority });
const bridge = `const callbacks = []; window.ridian = {
  async request(method, path, body) {
    const res = await fetch(path, {method, headers: {'Content-Type':'application/json', Authorization: 'Bearer ${service.sessionToken}'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    const data = await res.json(); if (!res.ok) throw new Error(data.error); return data;
  },
  expand(value) { callbacks.forEach(callback => callback(value)); },
  onExpanded(callback) { callbacks.push(callback); },
  hover() {}, drag() {}, menu() {}, taskMenu() {}, history() {}
};`;
fs.writeFileSync(path.join(webRoot, 'preview-bridge.js'), bridge);
fs.writeFileSync(path.join(webRoot, 'preview.css'), 'body{background:#f1f2ed}.widget{width:356px;height:468px}');
const html = fs.readFileSync(path.join(webRoot, 'widget.html'), 'utf8').replace('<script type="module"', '<link rel="stylesheet" href="preview.css"><script src="preview-bridge.js"></script><script type="module"');
fs.writeFileSync(path.join(webRoot, 'widget.html'), html);
function stop() { service.server.close(() => { fs.rmSync(temporary, { recursive: true, force: true }); process.exit(); }); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
service.start().then(() => console.log('Synthetic widget preview: http://127.0.0.1:43128/widget.html')).catch(error => { fs.rmSync(temporary, { recursive: true, force: true }); console.error(error.message); process.exitCode = 1; });
