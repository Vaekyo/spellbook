// Loads/saves config.json (settings) and spells.json, validates spells, reloads on file change.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const log = require('./log');

const ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const SPELLS_FILE = path.join(ROOT, 'spells.json');
const SPELLS_EXAMPLE = path.join(ROOT, 'spells.example.json');

const DEFAULTS = {
  host: '127.0.0.1',     // dashboard/overlay/cast listen address ("0.0.0.0" = reachable from LAN)
  port: 7777,
  castToken: '',         // optional: if set, POST /cast needs header "x-token" or ?token=
  cooldown: 3,           // seconds between spells
  maxQueue: 20,
  noMatch: 'ignore',     // "ignore" | "overlay" (show a fizzle message when no spell matches)
  overlay: {
    mystery: '',          // asset for the mystery animation ("" = built-in)
    mysteryDuration: 2.5, // seconds before the spell effect starts
    nameDelay: 4,         // seconds after the effect starts to show the spell name (-1 = never)
    donorText: 'cast by {donor}',
    fizzleText: '{donor}\'s spell fizzled...',
    volume: 0.8,
  },
};

const cfg = new EventEmitter();
cfg.ROOT = ROOT;
cfg.settings = merge(DEFAULTS, {});
cfg.spells = [];
cfg.errors = [];

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function merge(def, val) {
  const out = {};
  for (const k of new Set([...Object.keys(def), ...Object.keys(val || {})])) {
    if (isObj(def[k])) out[k] = merge(def[k], isObj(val?.[k]) ? val[k] : {});
    else out[k] = val && k in val && val[k] !== null ? val[k] : def[k];
  }
  return out;
}

function readJson(file, errors) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { errors.push(`${path.basename(file)}: ${e.message}`); return undefined; }
}

const num = (v, d) => (v === '' || v == null || isNaN(Number(v)) ? d : Number(v));

function normalizeSpell(s, i, errors, ids) {
  if (!isObj(s)) { errors.push(`spell #${i + 1} is not an object`); return null; }
  let id = String(s.id || s.name || `spell_${i + 1}`).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  if (ids.has(id)) { errors.push(`duplicate spell id "${id}" (spell #${i + 1})`); id += '_' + (i + 1); }
  ids.add(id);
  const actions = Array.isArray(s.actions) ? s.actions.filter((a) => {
    if (isObj(a) && a.type) return true;
    errors.push(`spell "${id}": an action is missing "type"`); return false;
  }) : [];
  return {
    ...s,
    id,
    name: String(s.name || id),
    enabled: s.enabled !== false,
    weight: Math.max(0, num(s.weight, 1)),
    minAmount: num(s.minAmount, 0),
    maxAmount: s.maxAmount === '' || s.maxAmount == null ? null : num(s.maxAmount, null),
    exactAmount: s.exactAmount === '' || s.exactAmount == null ? null : num(s.exactAmount, null),
    duration: Math.max(0, num(s.duration, 10)),
    actions,
  };
}

function normalizeSpells(list, errors) {
  if (!Array.isArray(list)) { errors.push('spells.json must be a list [ ... ]'); return null; }
  const ids = new Set();
  return list.map((s, i) => normalizeSpell(s, i, errors, ids)).filter(Boolean);
}

cfg.load = function load() {
  const errors = [];
  if (!fs.existsSync(CONFIG_FILE)) writeJson(CONFIG_FILE, DEFAULTS);
  if (!fs.existsSync(SPELLS_FILE)) {
    if (fs.existsSync(SPELLS_EXAMPLE)) fs.copyFileSync(SPELLS_EXAMPLE, SPELLS_FILE);
    else writeJson(SPELLS_FILE, []);
  }
  const s = readJson(CONFIG_FILE, errors);
  if (s !== undefined) cfg.settings = merge(DEFAULTS, s);
  const sp = readJson(SPELLS_FILE, errors);
  const spells = sp === undefined ? null : normalizeSpells(sp, errors);
  if (spells) cfg.spells = spells;
  cfg.errors = errors;
  errors.forEach((e) => log.error(`Config: ${e}`));
  log.info(`Loaded ${cfg.spells.length} spells`);
  cfg.emit('change');
};

let lastWrite = 0;
function writeJson(file, data) {
  lastWrite = Date.now();
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

// Returns list of validation errors (empty = saved).
cfg.saveSpells = function (list) {
  const errors = [];
  const spells = normalizeSpells(list, errors);
  if (!spells || errors.length) return errors;
  // Store without the defaults we filled in, so the file stays readable.
  writeJson(SPELLS_FILE, list);
  cfg.spells = spells;
  cfg.errors = [];
  cfg.emit('change');
  return [];
};

cfg.saveSettings = function (patch) {
  cfg.settings = merge(cfg.settings, patch);
  writeJson(CONFIG_FILE, cfg.settings);
  cfg.emit('change');
};

// Reload when the user edits the files by hand (ignore our own writes).
cfg.watch = function () {
  for (const f of [CONFIG_FILE, SPELLS_FILE]) {
    fs.watchFile(f, { interval: 1000 }, () => {
      if (Date.now() - lastWrite < 2000) return;
      log.info(`${path.basename(f)} changed, reloading`);
      cfg.load();
    });
  }
};

module.exports = cfg;
