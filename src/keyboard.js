// Keyboard spells (macOS): key_block, key_swap (via hidutil remapping) and key_press (via a JXA helper).
// Everything reverts at spell end; leftover remaps from a crash are cleaned up on next start.
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const config = require('./config');
const actions = require('./actions');
const status = require('./status');
const log = require('./log');

const MAC = process.platform === 'darwin';
const STATE_FILE = path.join(config.ROOT, 'data', 'keyboard-remap.json');

// name -> [HID usage (page 7), macOS virtual key code]
const KEYS = {};
'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => { KEYS[c] = [0x04 + i]; });
'1234567890'.split('').forEach((c, i) => { KEYS[c] = [0x1e + i]; });
Object.assign(KEYS, {
  enter: [0x28], escape: [0x29], backspace: [0x2a], tab: [0x2b], space: [0x2c], minus: [0x2d], equal: [0x2e],
  '[': [0x2f], ']': [0x30], '\\': [0x31], ';': [0x33], "'": [0x34], '`': [0x35], ',': [0x36], '.': [0x37], '/': [0x38],
  capslock: [0x39], right: [0x4f], left: [0x50], down: [0x51], up: [0x52],
  ctrl: [0xe0], shift: [0xe1], option: [0xe2], cmd: [0xe3], rctrl: [0xe4], rshift: [0xe5], roption: [0xe6], rcmd: [0xe7],
});
for (let i = 1; i <= 12; i++) KEYS['f' + i] = [0x3a + i - 1];
const VK = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  1: 18, 2: 19, 3: 20, 4: 21, 6: 22, 5: 23, equal: 24, 9: 25, 7: 26, minus: 27, 8: 28, 0: 29, ']': 30, o: 31, u: 32,
  '[': 33, i: 34, p: 35, enter: 36, l: 37, j: 38, "'": 39, k: 40, ';': 41, '\\': 42, ',': 43, '/': 44, n: 45, m: 46,
  '.': 47, tab: 48, space: 49, '`': 50, backspace: 51, escape: 53, cmd: 55, shift: 56, capslock: 57, option: 58,
  ctrl: 59, rshift: 60, roption: 61, rctrl: 62, rcmd: 54, f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98,
  f8: 100, f9: 101, f10: 109, f11: 103, f12: 111, left: 123, right: 124, down: 125, up: 126,
};
for (const k of Object.keys(KEYS)) KEYS[k][1] = VK[k];
const ALIAS = { esc: 'escape', return: 'enter', alt: 'option', command: 'cmd', control: 'ctrl', spacebar: 'space', ralt: 'roption' };
const PROTECTED = new Set(['escape', 'cmd', 'rcmd']); // never block/swap these, so you can't lock yourself out
const FLAGS = { shift: 0x20000, rshift: 0x20000, ctrl: 0x40000, rctrl: 0x40000, option: 0x80000, roption: 0x80000, cmd: 0x100000, rcmd: 0x100000 };
const BLOCK_TARGET = 0x700000073; // blocked keys are remapped to F24, which nothing uses

function key(name) {
  let n = String(name || '').trim().toLowerCase();
  n = ALIAS[n] || n;
  if (!KEYS[n]) throw new Error(`unknown key "${name}"`);
  return n;
}
const usage = (n) => 0x700000000 + KEYS[n][0];
const names = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
const unsupported = () => new Error('keyboard spells currently work on macOS only');

function ready() {
  if (!MAC) throw unsupported();
  if (!config.settings.keyboard.enabled) throw new Error('keyboard spells are turned off in settings');
}

// Safety cap: keyboard effects never last longer than keyboard.maxSeconds.
function capped(ctx, undo) {
  const max = Number(config.settings.keyboard.maxSeconds) || 0;
  if (!max || ctx.spell.duration <= max) return undo;
  let done = false;
  const once = async () => { if (!done) { done = true; await undo(); } };
  setTimeout(() => once().catch((e) => log.error(`keyboard: ${e.message}`)), max * 1000);
  return once;
}

// ---------- hidutil remapping ----------
function hidutil(args) {
  return new Promise((resolve, reject) => execFile('hidutil', ['property', ...args], (err, out) => (err ? reject(err) : resolve(out))));
}

function parseMapping(out) {
  const list = [];
  for (const block of String(out).split('}')) {
    const s = /MappingSrc = (\d+)/.exec(block);
    const d = /MappingDst = (\d+)/.exec(block);
    if (s && d) list.push({ src: +s[1], dst: +d[1] });
  }
  return list;
}

const toJson = (list) => `{"UserKeyMapping":[${list.map((m) => `{"HIDKeyboardModifierMappingSrc":0x${m.src.toString(16)},"HIDKeyboardModifierMappingDst":0x${m.dst.toString(16)}}`).join(',')}]}`;

let baseline = null;          // the user's own mapping before we touched anything
const remaps = new Map();     // Symbol -> [{src, dst}]
let chain = Promise.resolve();

function applyRemaps() {
  chain = chain.then(async () => {
    if (!remaps.size) {
      if (baseline === null) return;
      await hidutil(['--set', toJson(baseline)]);
      baseline = null;
      fs.rmSync(STATE_FILE, { force: true });
      return;
    }
    if (baseline === null) {
      baseline = parseMapping(await hidutil(['--get', 'UserKeyMapping']));
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(baseline));
    }
    const merged = new Map(baseline.map((m) => [m.src, m.dst]));
    for (const list of remaps.values()) for (const m of list) merged.set(m.src, m.dst);
    await hidutil(['--set', toJson([...merged].map(([src, dst]) => ({ src, dst })))]);
  });
  return chain;
}

async function remap(ctx, list) {
  const id = Symbol('remap');
  remaps.set(id, list);
  try { await applyRemaps(); } catch (e) { remaps.delete(id); throw new Error(`hidutil failed: ${e.message}`); }
  return capped(ctx, async () => { if (remaps.delete(id)) await applyRemaps(); });
}

actions.register('key_block', async (a, ctx) => {
  ready();
  const ks = names(a.keys).map(key);
  if (!ks.length) throw new Error('no keys chosen');
  const bad = ks.filter((k) => PROTECTED.has(k));
  if (bad.length) throw new Error(`these keys can't be blocked (safety): ${bad.join(', ')}`);
  return remap(ctx, ks.map((k) => ({ src: usage(k), dst: BLOCK_TARGET })));
});

// pairs: "w=s, a=d" -> both directions swapped
actions.register('key_swap', async (a, ctx) => {
  ready();
  const list = [];
  for (const p of names(a.pairs)) {
    const [x, y] = p.split('=').map(key);
    if (!y) throw new Error(`write pairs like "w=s", got "${p}"`);
    if (PROTECTED.has(x) || PROTECTED.has(y)) throw new Error(`can't swap ${x}/${y} (safety)`);
    list.push({ src: usage(x), dst: usage(y) }, { src: usage(y), dst: usage(x) });
  }
  if (!list.length) throw new Error('no key pairs given');
  return remap(ctx, list);
});

// Leftover remap from a crash: restore the user's original mapping.
function restoreLeftover() {
  if (!MAC || !fs.existsSync(STATE_FILE)) return;
  let saved = [];
  try { saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  hidutil(['--set', toJson(saved)])
    .then(() => { fs.rmSync(STATE_FILE, { force: true }); log.info('Keyboard: restored key mapping left over from last session'); })
    .catch((e) => log.error(`Keyboard: could not restore key mapping: ${e.message}`));
}

// ---------- key presses (JXA helper, needs Accessibility permission) ----------
const HELPER = `
ObjC.import('Foundation'); ObjC.import('CoreGraphics'); ObjC.import('ApplicationServices');
function out(s) { $.NSFileHandle.fileHandleWithStandardOutput.writeData($(s + '\\n').dataUsingEncoding($.NSUTF8StringEncoding)); }
out('trusted ' + ($.AXIsProcessTrusted() ? 1 : 0));
var input = $.NSFileHandle.fileHandleWithStandardInput, buf = '';
while (true) {
  var data = input.availableData;
  if (data.length == 0) break;
  buf += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
  var i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    var p = buf.slice(0, i).trim().split(' '); buf = buf.slice(i + 1);
    if (p[0] !== 'down' && p[0] !== 'up') continue;
    var e = $.CGEventCreateKeyboardEvent(null, +p[1], p[0] === 'down');
    $.CGEventSetFlags(e, +p[2] || 0);
    $.CGEventPost(0, e);
  }
}`;

let helper = null;
function send(line) {
  if (!helper) {
    helper = spawn('osascript', ['-l', 'JavaScript', '-e', HELPER], { stdio: ['pipe', 'pipe', 'pipe'] });
    helper.stdout.on('data', (d) => {
      if (/trusted 0/.test(d)) {
        status.set('Keyboard', false, 'needs Accessibility permission');
        log.warn('Keyboard: key presses need permission. Open System Settings → Privacy & Security → Accessibility and turn on the app that runs Spellbook (Terminal), then restart Spellbook.');
      } else if (/trusted 1/.test(d)) status.set('Keyboard', true, 'ready');
    });
    helper.stderr.on('data', (d) => log.error(`Keyboard helper: ${String(d).trim()}`));
    helper.on('error', (e) => log.error(`Keyboard helper: ${e.message}`));
    helper.on('exit', () => { helper = null; });
  }
  helper.stdin.write(line + '\n');
}

// "cmd+shift+a" -> { mods: ['cmd','shift'], main: 'a', flags }
function combo(str) {
  const parts = String(str || '').split('+').map((s) => s.trim()).filter(Boolean).map(key);
  if (!parts.length) throw new Error('no key chosen');
  const main = parts.pop();
  const flags = parts.reduce((f, m) => f | (FLAGS[m] || 0), FLAGS[main] || 0);
  return { mods: parts, main, flags };
}
function press(c, down) {
  let f = 0;
  if (down) for (const m of c.mods) { f |= FLAGS[m] || 0; send(`down ${KEYS[m][1]} ${f}`); }
  send(`${down ? 'down' : 'up'} ${KEYS[c.main][1]} ${c.flags}`);
  if (!down) for (const m of [...c.mods].reverse()) { send(`up ${KEYS[m][1]} 0`); }
}
function tap(c) { press(c, true); setTimeout(() => press(c, false), 60); }

// mode: tap (once) | hold (held for the whole spell) | repeat (tap every `interval` seconds)
actions.register('key_press', async (a, ctx) => {
  ready();
  const c = combo(a.key);
  const mode = a.mode || 'tap';
  if (mode === 'hold') { press(c, true); return capped(ctx, () => press(c, false)); }
  if (mode === 'repeat') {
    const ms = Math.max(0.1, Number(a.interval) || 1) * 1000;
    tap(c);
    const t = setInterval(() => tap(c), ms);
    return capped(ctx, () => clearInterval(t));
  }
  tap(c);
  return null;
});

function init() {
  if (!MAC) return status.set('Keyboard', false, 'macOS only (for now)');
  restoreLeftover();
  status.set('Keyboard', true, 'ready');
}

module.exports = { init, keyNames: Object.keys(KEYS) };
