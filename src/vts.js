// VTube Studio API client + spell actions (vts_param, vts_tint, vts_item, vts_move, vts_hotkey, vts_expression).
// Docs: https://github.com/DenchiSoft/VTubeStudio
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const config = require('./config');
const actions = require('./actions');
const media = require('./media');
const status = require('./status');
const log = require('./log');

const PLUGIN = { pluginName: 'Spellbook', pluginDeveloper: 'Spellbook' };
const TOKEN_FILE = path.join(config.ROOT, 'data', 'vts-token.txt');

let ws = null;
let authed = false;
let seq = 0;
let retryTimer = null;
let connKey = '';
const pending = new Map();
const injected = new Map(); // key -> { id, value, mode, weight }

const opts = () => config.settings.vts;

function setStatus(ok, text) { status.set('VTS', ok, text); }

function connect() {
  clearTimeout(retryTimer);
  if (!opts().enabled) { status.remove('VTS'); return; }
  const { host, port } = opts();
  connKey = `${host}:${port}`;
  const sock = new WebSocket(`ws://${host}:${port}`);
  ws = sock;
  sock.on('open', () => { if (ws === sock) auth().catch((e) => { setStatus(false, e.message); sock.close(); }); });
  sock.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const p = pending.get(msg.requestID);
    if (!p) return;
    pending.delete(msg.requestID);
    clearTimeout(p.timer);
    if (msg.messageType === 'APIError') p.reject(new Error(`VTS: ${msg.data?.message} (error ${msg.data?.errorID})`));
    else p.resolve(msg.data || {});
  });
  sock.on('error', () => {});
  sock.on('close', () => {
    if (ws !== sock) return;
    const wasAuthed = authed;
    authed = false; ws = null;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('VTS disconnected')); }
    pending.clear();
    if (wasAuthed) log.warn('VTube Studio disconnected');
    setStatus(false, 'offline (is VTube Studio running with API on?)');
    retryTimer = setTimeout(connect, 5000);
  });
}

function request(messageType, data = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('VTube Studio is not connected'));
    const requestID = 'sb' + (++seq);
    const timer = setTimeout(() => { pending.delete(requestID); reject(new Error(`VTS: ${messageType} timed out`)); }, timeoutMs);
    pending.set(requestID, { resolve, reject, timer });
    ws.send(JSON.stringify({ apiName: 'VTubeStudioPublicAPI', apiVersion: '1.0', requestID, messageType, data }));
  });
}

async function auth() {
  let token = '';
  try { token = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch {}
  if (token) {
    const r = await request('AuthenticationRequest', { ...PLUGIN, authenticationToken: token }).catch(() => ({}));
    if (!r.authenticated) token = '';
  }
  if (!token) {
    setStatus(false, 'click "Allow" in VTube Studio');
    log.info('VTube Studio: please click "Allow" in the popup inside VTube Studio');
    const t = await request('AuthenticationTokenRequest', PLUGIN, 5 * 60 * 1000);
    token = t.authenticationToken;
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, token);
    const r = await request('AuthenticationRequest', { ...PLUGIN, authenticationToken: token });
    if (!r.authenticated) throw new Error('authentication failed: ' + r.reason);
  }
  authed = true;
  const m = await request('CurrentModelRequest').catch(() => ({}));
  setStatus(true, m.modelLoaded ? m.modelName : 'connected (no model)');
  log.info(`VTube Studio connected${m.modelLoaded ? ` (model: ${m.modelName})` : ''}`);
}

function ready() { if (!authed) throw new Error('VTube Studio is not connected'); }

// Injected params must be re-sent at least once per second, or VTS returns them to tracking.
let injectFailed = false;
async function sendInjected() {
  if (!authed || !injected.size) return;
  const byMode = { set: [], add: [] };
  for (const v of injected.values()) {
    byMode[v.mode].push(v.mode === 'set' && v.weight != null ? { id: v.id, value: v.value, weight: v.weight } : { id: v.id, value: v.value });
  }
  for (const mode of ['set', 'add']) {
    if (byMode[mode].length) await request('InjectParameterDataRequest', { faceFound: false, mode, parameterValues: byMode[mode] });
  }
}
setInterval(() => sendInjected().then(() => { injectFailed = false; }).catch((e) => {
  if (!injectFailed) log.error(`VTS parameter: ${e.message}`);
  injectFailed = true;
}), 300);

// Lists for the dashboard dropdowns.
async function lists() {
  if (!authed) return { connected: false };
  const [p, a, h, e, i] = await Promise.all([
    request('InputParameterListRequest'),
    request('ArtMeshListRequest'),
    request('HotkeysInCurrentModelRequest'),
    request('ExpressionStateRequest', { details: false }),
    request('ItemListRequest', { includeAvailableSpots: false, includeItemInstancesInScene: false, includeAvailableItemFiles: true }),
  ].map((x) => x.catch(() => ({}))));
  return {
    connected: true,
    model: p.modelName || '',
    params: [...(p.customParameters || []), ...(p.defaultParameters || [])].map((x) => x.name),
    artMeshes: a.artMeshNames || [],
    artMeshTags: a.artMeshTags || [],
    groups: (a.artMeshGroups || []).map((g) => g.groupName),
    hotkeys: (h.availableHotkeys || []).filter((x) => x.name).map((x) => x.name),
    expressions: (e.expressions || []).map((x) => x.file),
    items: (i.availableItemFiles || []).map((x) => x.fileName),
  };
}

async function createParam({ name, min = 0, max = 1, defaultValue = 0, explanation = 'Created by Spellbook' }) {
  ready();
  return request('ParameterCreationRequest', { parameterName: name, explanation, min: +min, max: +max, defaultValue: +defaultValue });
}

// ---------- actions ----------
const num = (v, d) => (v === '' || v == null || isNaN(+v) ? d : +v);
const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);

actions.register('vts_param', async (a) => {
  ready();
  if (!a.param) throw new Error('no parameter chosen');
  const key = Symbol(a.param);
  injected.set(key, { id: a.param, value: num(a.value, 0), mode: a.mode === 'add' ? 'add' : 'set', weight: a.weight === '' || a.weight == null ? null : num(a.weight, 1) });
  try { await sendInjected(); } catch (e) { injected.delete(key); throw e; }
  return () => { injected.delete(key); };
});

async function tintMatcher(a) {
  const by = a.matchBy || 'all';
  if (by === 'all') return { tintAll: true };
  const names = list(a.match);
  if (!names.length) throw new Error('no ArtMesh name/tag given');
  if (by === 'group') {
    const r = await request('ArtMeshListRequest');
    const ids = (r.artMeshGroups || []).filter((g) => names.some((n) => n.toLowerCase() === g.groupName.toLowerCase())).map((g) => g.groupID);
    if (!ids.length) throw new Error(`ArtMesh group not found: ${names.join(', ')}`);
    return { tintAll: false, artMeshGroupIDExact: ids };
  }
  return { tintAll: false, [by]: names };
}

actions.register('vts_tint', async (a) => {
  ready();
  const hex = /^#?([0-9a-f]{6})$/i.exec(a.color || '');
  if (!hex) throw new Error(`invalid color "${a.color}"`);
  const n = parseInt(hex[1], 16);
  const artMeshMatcher = await tintMatcher(a);
  const tint = (r, g, b, al) => request('ColorTintRequest', { colorTint: { colorR: r, colorG: g, colorB: b, colorA: al, mixWithSceneLightingColor: 1 }, artMeshMatcher });
  const res = await tint(n >> 16, (n >> 8) & 255, n & 255, Math.max(0, Math.min(255, num(a.alpha, 255))));
  if (!res.matchedArtMeshes) log.warn(`vts_tint: no ArtMesh matched (${a.matchBy}: ${a.match || 'all'})`);
  return () => tint(255, 255, 255, 255);
});

// Assets from /assets are sent as custom image data (needs a one-time permission in VTS);
// anything else is a file name from the VTS "Items" folder.
let permAsked = false;
async function itemData(file) {
  if (!/^assets\//.test(file)) return { fileName: file };
  const abs = media.assetPath(file);
  if (!abs) throw new Error(`item image not found: ${file}`);
  const ext = path.extname(abs).toLowerCase().replace('jpeg', 'jpg');
  if (!['.png', '.jpg', '.gif'].includes(ext)) throw new Error('item image must be .png, .jpg or .gif');
  if (!permAsked) {
    const r = await request('PermissionRequest', { requestedPermission: 'LoadCustomImagesAsItems' }, 5 * 60 * 1000);
    if (!(r.permissions || []).some((p) => p.name === 'LoadCustomImagesAsItems' && p.granted)) throw new Error('permission "Load custom images as items" was denied in VTube Studio');
    permAsked = true;
  }
  const buf = fs.readFileSync(abs);
  const hash = crypto.createHash('md5').update(buf).digest('hex').slice(0, 12);
  return { fileName: `spellbook-${hash}${ext}`, customDataBase64: buf.toString('base64'), customDataAskUserFirst: false, customDataSkipAskingUserIfWhitelisted: true, customDataAskTimer: -1 };
}

actions.register('vts_item', async (a) => {
  ready();
  if (!a.file) throw new Error('no item file chosen');
  const size = Math.max(0, Math.min(1, num(a.size, 0.32)));
  const fade = Math.max(0, Math.min(2, num(a.fadeTime, 0.5)));
  const r = await request('ItemLoadRequest', {
    ...(await itemData(a.file)),
    positionX: num(a.x, 0), positionY: num(a.y, 0), size, rotation: num(a.rotation, 0), fadeTime: fade,
    order: num(a.order, 10), failIfOrderTaken: false, smoothing: 0, censored: false, flipped: !!a.flipped, locked: false,
    unloadWhenPluginDisconnects: true,
  });
  const id = r.instanceID;
  const unload = () => request('ItemUnloadRequest', { unloadAllInScene: false, unloadAllLoadedByThisPlugin: false, allowUnloadingItemsLoadedByUserOrOtherPlugins: false, instanceIDs: [id], fileNames: [] });
  if (a.pinTo) {
    await request('ItemPinRequest', {
      pin: true, itemInstanceID: id, angleRelativeTo: 'RelativeToModel', sizeRelativeTo: 'RelativeToWorld', vertexPinType: 'Center',
      pinInfo: { modelID: '', artMeshID: a.pinTo, angle: num(a.rotation, 0), size },
    }).catch(async (e) => { await unload().catch(() => {}); throw e; });
  }
  return unload;
});

actions.register('vts_move', async (a) => {
  ready();
  const time = Math.max(0, Math.min(2, num(a.time, 0.5)));
  const before = (await request('CurrentModelRequest')).modelPosition;
  const move = { timeInSeconds: time, valuesAreRelativeToModel: !!a.relative };
  for (const [k, f] of [['positionX', 'x'], ['positionY', 'y'], ['rotation', 'rotation'], ['size', 'size']]) {
    if (num(a[f], null) !== null) move[k] = num(a[f], 0);
  }
  await request('MoveModelRequest', move);
  return () => before && request('MoveModelRequest', { timeInSeconds: time, valuesAreRelativeToModel: false, ...before });
});

actions.register('vts_hotkey', async (a) => {
  ready();
  if (!a.hotkey) throw new Error('no hotkey chosen');
  await request('HotkeyTriggerRequest', { hotkeyID: a.hotkey });
  return a.revertHotkey ? () => request('HotkeyTriggerRequest', { hotkeyID: a.revertHotkey }) : null;
});

actions.register('vts_expression', async (a) => {
  ready();
  if (!a.expression) throw new Error('no expression chosen');
  const file = /\.exp3\.json$/i.test(a.expression) ? a.expression : a.expression + '.exp3.json';
  const fadeTime = Math.max(0, Math.min(2, num(a.fadeTime, 0.25)));
  await request('ExpressionActivationRequest', { expressionFile: file, active: true, fadeTime });
  return () => request('ExpressionActivationRequest', { expressionFile: file, active: false, fadeTime });
});

// Connects on first config load, reconnects when VTS settings change.
config.on('change', () => {
  const o = opts();
  const key = o.enabled ? `${o.host}:${o.port}` : '';
  if (key === connKey) return;
  if (ws) { const old = ws; ws = null; authed = false; old.close(); }
  connect();
});

module.exports = { lists, createParam, isReady: () => authed };
