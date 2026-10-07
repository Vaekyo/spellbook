// Spellbook server: dashboard + overlay + /cast on one local port.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const config = require('./src/config');
const engine = require('./src/engine');
const media = require('./src/media');
const actions = require('./src/actions');
const status = require('./src/status');
const vts = require('./src/vts');
const keyboard = require('./src/keyboard');
const log = require('./src/log');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.apng': 'image/apng', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.m4v': 'video/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.opus': 'audio/ogg',
};


function send(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('invalid JSON'), { code: 400 }); }
}

// Static files with Range support (needed for smooth video in browsers).
function serveFile(req, res, abs) {
  fs.stat(abs, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'not found' });
    const type = TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    if (range && (range[1] || range[2])) {
      const start = range[1] ? +range[1] : st.size - +range[2];
      const end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
      if (start > end || start < 0) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(abs, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...head, 'Content-Length': st.size });
    fs.createReadStream(abs).pipe(res);
  });
}

function stateFor(full) {
  const s = { type: 'state', status: status.all, overlays: overlayCount(), ...engine.snapshot() };
  if (full) Object.assign(s, { settings: config.settings, spells: config.spells, errors: config.errors, log: log.lines, actionTypes: actions.types(), keyNames: keyboard.keyNames });
  return s;
}

function tokenOk(req, url) {
  const t = config.settings.castToken;
  return !t || req.headers['x-token'] === t || url.searchParams.get('token') === t;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  const m = req.method;

  if (m === 'GET' && (p === '/' || p === '/dashboard')) return serveFile(req, res, path.join(PUBLIC, 'dashboard.html'));
  if (m === 'GET' && p === '/overlay') return serveFile(req, res, path.join(PUBLIC, 'overlay.html'));
  if (m === 'GET' && p.startsWith('/public/')) {
    const abs = path.join(PUBLIC, path.normalize(p.slice(8)));
    return abs.startsWith(PUBLIC + path.sep) ? serveFile(req, res, abs) : send(res, 404, { error: 'not found' });
  }
  if (m === 'GET' && p.startsWith('/assets/')) {
    const abs = media.assetPath(p.slice(1));
    return abs ? serveFile(req, res, abs) : send(res, 404, { error: 'not found' });
  }

  // POST /cast {spellId?, donor?, amount?, message?} - also accepts query params (?spellId=..&donor=..)
  if (p === '/cast' && (m === 'POST' || m === 'GET')) {
    if (!tokenOk(req, url)) return send(res, 401, { ok: false, error: 'bad token' });
    const body = m === 'POST' ? await readJsonBody(req) : {};
    const q = Object.fromEntries(url.searchParams);
    return send(res, 200, engine.cast({ source: 'cast', ...q, ...body }));
  }

  if (m === 'GET' && p === '/api/state') return send(res, 200, stateFor(true));
  if (m === 'GET' && p === '/api/assets') return send(res, 200, media.list());
  if (m === 'POST' && p === '/api/stop') { engine.stopAll(); return send(res, 200, { ok: true }); }
  if (m === 'POST' && p === '/api/test') return send(res, 200, engine.cast({ source: 'dashboard', ...(await readJsonBody(req)) }));
  if (m === 'POST' && p === '/api/spells') {
    const errors = config.saveSpells(await readJsonBody(req));
    return send(res, errors.length ? 400 : 200, { ok: !errors.length, errors });
  }
  if (m === 'POST' && p === '/api/settings') { config.saveSettings(await readJsonBody(req)); return send(res, 200, { ok: true }); }
  if (m === 'GET' && p === '/api/vts/lists') return send(res, 200, await vts.lists());
  if (m === 'POST' && p === '/api/vts/param') return send(res, 200, { ok: true, ...(await vts.createParam(await readJsonBody(req))) });
  if (m === 'POST' && p === '/api/reload') { config.load(); return send(res, 200, { ok: true, errors: config.errors }); }

  send(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!e.code) log.warn(`HTTP ${req.method} ${req.url}: ${e.message}`);
    if (!res.headersSent) send(res, e.code || 500, { ok: false, error: e.message });
  });
});

// WebSocket: overlay (?role=overlay) and dashboard both connect to /ws.
const wss = new WebSocketServer({ server, path: '/ws' });
const overlayCount = () => [...wss.clients].filter((c) => c.role === 'overlay').length;
function broadcast(msg, role) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1 && (!role || c.role === role)) c.send(data);
}
let stateTimer = null;
function pushState() { // throttled
  if (stateTimer) return;
  stateTimer = setTimeout(() => { stateTimer = null; broadcast(stateFor(false), 'dashboard'); }, 100);
}
wss.on('connection', (ws, req) => {
  ws.role = new URL(req.url, 'http://x').searchParams.get('role') || 'dashboard';
  if (ws.role === 'overlay') log.info('Overlay connected');
  ws.on('close', () => { if (ws.role === 'overlay') log.info('Overlay disconnected'); pushState(); });
  ws.on('error', () => {});
  pushState();
});

engine.on('cast', (c) => broadcast({ type: 'cast', ...c, volume: config.settings.overlay.volume, donorText: config.settings.overlay.donorText }));
engine.on('end', (e) => broadcast({ type: 'end', ...e }));
engine.on('fizzle', (ev) => broadcast({ type: 'fizzle', donor: ev.donor, amount: ev.amount, text: config.settings.overlay.fizzleText }, 'overlay'));
engine.on('state', pushState);
status.on('change', pushState);
log.on('line', (line) => broadcast({ type: 'log', line }, 'dashboard'));
config.on('change', () => broadcast({ type: 'config' }, 'dashboard'));

// ---- start ----
config.load();
config.watch();
keyboard.init();
const { host, port } = config.settings;
server.on('error', (e) => {
  log.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Is Spellbook already running?` : e.message);
  process.exit(1);
});
server.listen(port, host, () => {
  log.info(`Spellbook running`);
  log.info(`  Dashboard:     http://localhost:${port}/`);
  log.info(`  OBS overlay:   http://localhost:${port}/overlay   (Browser Source 1920x1080)`);
  log.info(`  Cast endpoint: POST http://localhost:${port}/cast`);
});

// Revert active spell effects before exiting (Ctrl+C or closing the window).
let quitting = false;
async function shutdown() {
  if (quitting) return process.exit(0);
  quitting = true;
  log.info('Shutting down, reverting active spell...');
  engine.stopAll();
  await engine.idle(4000);
  process.exit(0);
}
['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'].forEach((s) => process.on(s, shutdown));
process.on('uncaughtException', (e) => log.error(`Unexpected error: ${e.stack || e.message}`));
process.on('unhandledRejection', (e) => log.error(`Unexpected error: ${e?.stack || e}`));
