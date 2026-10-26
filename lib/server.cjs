const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store, atomicWrite, validDate } = require('./store.cjs');
const PORT = 43127;
function equals(a, b) {
  const x = Buffer.from(a || ''); const y = Buffer.from(b || '');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function createService({ directory, webRoot, port = PORT, allowedOrigins = [] }) {
  const store = new Store(directory);
  const credentialsFile = path.join(directory, 'connection.json');
  const credentials = fs.existsSync(credentialsFile) ? JSON.parse(fs.readFileSync(credentialsFile, 'utf8')) : { baseUrl: `http://127.0.0.1:${port}`, readToken: crypto.randomBytes(32).toString('hex') };
  credentials.writeToken ||= crypto.randomBytes(32).toString('hex');
  atomicWrite(credentialsFile, credentials);
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const origins = new Set(allowedOrigins);
  const localOrigin = origin => origin === `http://127.0.0.1:${server.address()?.port}` || origin === `http://localhost:${server.address()?.port}`;
  function dispatch(method, pathname, body = {}, query = new URLSearchParams(), writable = true) {
    store.materialize();
    if (method !== 'GET' && !writable) throw Object.assign(new Error('This key is read-only.'), { status: 403 });
    if (method === 'GET' && (pathname === '/api/v1/export' || pathname === '/api/v1/history')) return store.snapshot();
    if (method === 'GET' && pathname === '/api/v1/today') {
      const data = store.snapshot();
      return { ...data, tasks: data.tasks.filter(t => (!t.completedAt && t.date <= data.today) || t.completedDate === data.today) };
    }
    if (method === 'GET' && pathname === '/api/v1/tasks') {
      const date = query.get('date');
      if (date && !validDate(date)) throw Object.assign(new Error('Invalid date.'), { status: 400 });
      return { tasks: store.snapshot().tasks.filter(t => !date || t.date === date || t.completedDate === date) };
    }
    if (method === 'POST' && pathname === '/api/v1/tasks') return store.add(body);
    if (pathname === '/api/v1/strategies' && method === 'GET') return { strategies: store.snapshot().strategies };
    if (pathname === '/api/v1/strategies' && method === 'POST') return store.addStrategy(body);
    const strategyMatch = pathname.match(/^\/api\/v1\/strategies\/([\w-]+)$/);
    if (strategyMatch && method === 'PATCH') return store.updateStrategy(strategyMatch[1], body);
    if (strategyMatch && method === 'DELETE') { store.removeStrategy(strategyMatch[1]); return { ok: true }; }
    const match = pathname.match(/^\/api\/v1\/tasks\/([\w-]+)$/);
    if (match && method === 'PATCH') return store.update(match[1], body);
    if (match && method === 'DELETE') { store.remove(match[1]); return { ok: true }; }
    throw Object.assign(new Error('Endpoint not found.'), { status: 404 });
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const host = req.headers.host;
    if (host !== `127.0.0.1:${server.address().port}` && host !== `localhost:${server.address().port}`) return send(403, { error: 'Host not allowed.' });
    const origin = req.headers.origin;
    if (origin && !origins.has(origin) && !localOrigin(origin)) return send(403, { error: 'Origin not allowed.' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/health') return send(200, { ok: true, app: 'ridian', version: 1 });
    if (url.pathname.startsWith('/api/')) {
      const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const writable = equals(token, sessionToken) || equals(token, credentials.writeToken);
      if (!writable && !equals(token, credentials.readToken)) return send(401, { error: 'Reopen History from Ridian.' });
      try {
        let body = ''; let length = 0;
        for await (const chunk of req) { length += chunk.length; if (length > 8192) throw Object.assign(new Error('Content too long.'), { status: 413 }); body += chunk; }
        let parsed = {};
        if (body) { try { parsed = JSON.parse(body); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); } }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Object.assign(new Error('A JSON object is required.'), { status: 400 });
        return send(200, dispatch(req.method, url.pathname, parsed, url.searchParams, writable));
      } catch (err) { return send(err.status || 500, { error: err.status ? err.message : 'Save failed. Your existing data is safe.' }); }
    }
    if (req.method !== 'GET') return send(405, { error: 'Method not allowed' });
    const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(webRoot, requested);
    if (!file.startsWith(path.resolve(webRoot) + path.sep)) return send(403, { error: 'Forbidden' });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, { error: 'Not found' });
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:43127; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return { store, server, credentials, sessionToken, dispatch, start: () => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  }) };
}
module.exports = { createService, PORT };
