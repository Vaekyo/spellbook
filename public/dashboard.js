// Spellbook dashboard (vanilla JS).
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const api = async (url, body) => {
  const r = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
};
let S = { spells: [], settings: {}, status: {}, log: [] };
let assets = [];

// ---------- generic form helpers ----------
// def = [key, type, label] or [title] for a sub-heading. Types: text, number, check, asset, select:a,b,c
const getPath = (o, p) => p.split('.').reduce((v, k) => v?.[k], o);
function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); ks.reduce((x, k) => (x[k] ??= {}), o)[last] = v; }

function buildForm(box, defs, data) {
  box.replaceChildren();
  for (const [key, type, label] of defs) {
    if (!type) { box.append(el('div', { className: 'sub', textContent: key })); continue; }
    const v = getPath(data, key);
    let c;
    if (type === 'check') c = el('input', { type: 'checkbox', checked: v !== false && v != null ? !!v : false });
    else if (type.startsWith('select:')) c = el('select', {}, ...type.slice(7).split(',').map((o) => el('option', { value: o, textContent: o, selected: o === v })));
    else c = el('input', { type: type === 'number' ? 'number' : type === 'color' ? 'color' : 'text', value: v ?? '', step: 'any' });
    if (type === 'asset') c.setAttribute('list', 'assetList');
    if (type.startsWith('pick:')) c.setAttribute('list', 'dl-' + type.slice(5));
    c.dataset.key = key; c.dataset.type = type;
    box.append(type === 'check' ? el('label', { className: 'check' }, c, label) : el('label', {}, label, c));
  }
}

function readForm(box) {
  const out = {};
  for (const c of box.querySelectorAll('[data-key]')) {
    const t = c.dataset.type;
    const v = t === 'check' ? c.checked : t === 'number' ? (c.value === '' ? null : Number(c.value)) : c.value.trim();
    setPath(out, c.dataset.key, v);
  }
  return out;
}

// ---------- status / live ----------
function renderStatus() {
  const pills = [el('span', { className: 'pill ' + (S.overlays ? 'ok' : 'bad'), textContent: `Overlay: ${S.overlays || 0}` })];
  for (const [name, s] of Object.entries(S.status || {})) pills.push(el('span', { className: 'pill ' + (s.ok ? 'ok' : 'bad'), title: s.text || '', textContent: `${name}: ${s.text || (s.ok ? 'connected' : 'offline')}` }));
  $('status').replaceChildren(...pills);
  const c = S.current;
  $('now').textContent = (c ? `Casting: ${c.spell} (${c.donor})` : 'Idle') + (S.queue?.length ? ` · ${S.queue.length} in queue` : '');
}

function addLog(line) {
  const box = $('log');
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 5;
  box.append(el('div', { className: line.level, textContent: `${new Date(line.t).toLocaleTimeString()}  ${line.msg}` }));
  while (box.childElementCount > 150) box.firstChild.remove();
  if (stick) box.scrollTop = box.scrollHeight;
}

async function refresh() {
  S = await api('/api/state');
  assets = await api('/api/assets');
  $('assetList').replaceChildren(...assets.map((a) => el('option', { value: a })));
  $('cfgErrors').textContent = S.errors?.length ? 'Config problems:\n' + S.errors.join('\n') : '';
  renderStatus();
  renderSpells();
  buildForm($('settings'), SETTINGS, S.settings);
  $('log').replaceChildren(); S.log.forEach(addLog);
}

function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws?role=dashboard`);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'state') { Object.assign(S, m); renderStatus(); }
    else if (m.type === 'log') addLog(m.line);
    else if (m.type === 'config' && !$('editor').open) refresh();
  };
  ws.onopen = refresh;
  ws.onclose = () => { $('status').replaceChildren(el('span', { className: 'pill bad', textContent: 'Server offline' })); setTimeout(connect, 2000); };
}

// ---------- spells ----------
function renderSpells() {
  const amount = (s) => s.exactAmount != null ? `= ${s.exactAmount}` : `${s.minAmount}${s.maxAmount != null ? ' – ' + s.maxAmount : '+'}`;
  $('spells').replaceChildren(...S.spells.map((s, i) => el('tr', { className: s.enabled ? '' : 'off' },
    el('td', { textContent: s.name }),
    el('td', {}, el('code', { textContent: s.id })),
    el('td', { textContent: s.weight }),
    el('td', { textContent: amount(s) }),
    el('td', { textContent: s.duration + 's' }),
    el('td', { className: 'hint', textContent: s.actions.map((a) => a.type).join(', ') || '—' }),
    el('td', { className: 'act' },
      el('button', { textContent: '▶ Test', onclick: () => test(s.id) }), ' ',
      el('button', { className: 'ghost', textContent: 'Edit', onclick: () => openEditor(i) }), ' ',
      el('button', { className: 'ghost', textContent: '✕', title: 'Delete', onclick: () => del(i) })),
  )));
}

const test = (spellId) => api('/api/test', { spellId, donor: $('tDonor').value, amount: Number($('tAmount').value) || 0 })
  .then((r) => !r.ok && alert(r.error));

const SPELL_FIELDS = [
  ['name', 'text', 'Name (shown on overlay)'],
  ['id', 'text', 'ID (used by /cast?spellId=...)'],
  ['enabled', 'check', 'Enabled (can be picked randomly)'],
  ['weight', 'number', 'Weight (higher = more often)'],
  ['minAmount', 'number', 'Min amount'],
  ['maxAmount', 'number', 'Max amount (empty = no limit)'],
  ['exactAmount', 'number', 'Exact amount only (empty = off)'],
  ['duration', 'number', 'Duration in seconds (then revert)'],
  ['nameDelay', 'number', 'Show name after s (empty = default, -1 = never)'],
  ['Reveal effect'],
  ['revealSrc', 'asset', 'Effect: .webm / .png / PNG-sequence folder'],
  ['revealFps', 'number', 'PNG sequence FPS (default 30)'],
  ['revealLoop', 'check', 'Loop effect for the whole duration'],
  ['sound', 'asset', 'Sound (.mp3 / .ogg / .wav)'],
];

// Drop empty fields so spells.json stays tidy.
const saveSpells = (list) => api('/api/spells', list.map((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null && v !== undefined && v !== ''))));

let editIndex = -1;
function openEditor(i) {
  editIndex = i;
  const s = i >= 0 ? S.spells[i] : { name: 'New Spell', enabled: true, weight: 10, minAmount: 0, duration: 15, actions: [] };
  const r = s.reveal;
  const data = { ...s, revealSrc: typeof r === 'string' ? r : r?.src || r?.frames || '', revealFps: r?.fps ?? null, revealLoop: !!r?.loop };
  $('edTitle').textContent = i >= 0 ? `Edit: ${s.name}` : 'New spell';
  buildForm($('edForm'), SPELL_FIELDS, data);
  renderActions($('edActions'), s.actions || []);
  $('edErrors').textContent = '';
  $('editor').showModal();
}

// ---------- action editor ----------
// fields: [key, type, label, default]
const ACTIONS = {
  overlay_only: { label: 'Overlay only (no effect)', fields: [] },
  vts_param: { label: 'VTS: set parameter', fields: [
    ['param', 'pick:params', 'Parameter'], ['value', 'number', 'Value', 1],
    ['mode', 'select:set,add', 'Mode (set = replace, add = add to tracking)', 'set'], ['weight', 'number', 'Weight 0–1 (set mode, empty = 1)']] },
  vts_tint: { label: 'VTS: tint color', fields: [
    ['color', 'color', 'Color', '#ff7070'], ['alpha', 'number', 'Alpha 0–255', 255],
    ['matchBy', 'select:all,nameContains,nameExact,tagContains,tagExact,group', 'Which ArtMeshes', 'all'],
    ['match', 'pick:tint', 'Names / tags / groups (comma-separated)']] },
  vts_item: { label: 'VTS: load item (accessory)', fields: [
    ['file', 'pick:items', 'Item: VTS item, or assets/… image'], ['pinTo', 'pick:artMeshes', 'Pin to ArtMesh (optional)'],
    ['size', 'number', 'Size 0–1', 0.32], ['x', 'number', 'X (-1 … 1)', 0], ['y', 'number', 'Y (-1 … 1)', 0],
    ['rotation', 'number', 'Rotation', 0], ['order', 'number', 'Layer order', 10], ['flipped', 'check', 'Flipped']] },
  vts_move: { label: 'VTS: move / resize model', fields: [
    ['size', 'number', 'Size -100 … 100 (empty = keep)'], ['x', 'number', 'X (empty = keep)'], ['y', 'number', 'Y (empty = keep)'],
    ['rotation', 'number', 'Rotation (empty = keep)'], ['relative', 'check', 'Relative to current position'], ['time', 'number', 'Move time in s (0–2)', 0.5]] },
  vts_hotkey: { label: 'VTS: trigger hotkey', fields: [
    ['hotkey', 'pick:hotkeys', 'Hotkey'], ['revertHotkey', 'pick:hotkeys', 'Hotkey to trigger at the end (optional)']] },
  vts_expression: { label: 'VTS: expression on → off', fields: [
    ['expression', 'pick:expressions', 'Expression'], ['fadeTime', 'number', 'Fade time (s)', 0.25]] },
  key_block: { label: 'Keyboard: block keys', fields: [
    ['keys', 'pick:keys', 'Keys to disable (comma-separated, e.g. space, w)', 'space']] },
  key_swap: { label: 'Keyboard: swap keys', fields: [
    ['pairs', 'text', 'Pairs to swap, e.g. w=s, a=d', 'w=s, a=d']] },
  key_press: { label: 'Keyboard: press / hold key', fields: [
    ['key', 'pick:keys', 'Key or shortcut (e.g. space, w, cmd+shift+a)', 'space'],
    ['mode', 'select:tap,hold,repeat', 'tap = once, hold = whole spell, repeat = every N s', 'tap'],
    ['interval', 'number', 'Repeat every (seconds)', 1]] },
};

const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''));

function actionRow(a) {
  const sel = el('select', {}, ...Object.entries(ACTIONS).map(([t, d]) => el('option', { value: t, textContent: d.label })));
  if (!ACTIONS[a.type]) sel.prepend(el('option', { value: a.type, textContent: a.type + ' (edit as JSON)' }));
  sel.value = a.type;
  const body = el('div', { className: 'grid' });
  const draw = (data) => {
    const d = ACTIONS[sel.value];
    if (!d) return body.replaceChildren(el('textarea', { rows: 4, value: JSON.stringify(data, null, 2) }));
    const defaults = Object.fromEntries(d.fields.filter((f) => f[3] !== undefined).map((f) => [f[0], f[3]]));
    buildForm(body, d.fields, { ...defaults, ...data });
  };
  sel.onchange = () => draw({});
  draw(a);
  const row = el('div', { className: 'action' },
    el('div', { className: 'row' }, sel, el('span', { className: 'grow' }), el('button', { className: 'ghost', textContent: '✕', title: 'Remove action', onclick: () => row.remove() })),
    body);
  row.read = () => {
    if (!ACTIONS[sel.value]) return { ...JSON.parse(body.querySelector('textarea').value || '{}'), type: sel.value };
    return strip({ ...(sel.value === a.type ? a : {}), ...readForm(body), type: sel.value });
  };
  return row;
}

function renderActions(box, list) {
  const rows = el('div', {}, ...list.map(actionRow));
  box.replaceChildren(rows, el('button', { className: 'ghost', textContent: '+ Add action', onclick: () => rows.append(actionRow({ type: 'vts_param' })) }), el('span', { id: 'vtsHint', className: 'hint' }));
  loadPickLists();
}
function readActions() { return [...$('edActions').querySelectorAll('.action')].map((r) => r.read()); }

// Fill dropdown suggestions from VTube Studio (+ image assets for items).
async function loadPickLists() {
  const v = await api('/api/vts/lists').catch(() => ({}));
  const imgs = assets.filter((a) => /\.(png|jpe?g|gif)$/i.test(a));
  const fill = (id, items) => {
    const dl = $('dl-' + id) || document.body.appendChild(el('datalist', { id: 'dl-' + id }));
    dl.replaceChildren(...[...new Set(items)].map((x) => el('option', { value: x })));
  };
  fill('params', v.params || []);
  fill('artMeshes', v.artMeshes || []);
  fill('tint', [...(v.artMeshes || []), ...(v.artMeshTags || []), ...(v.groups || [])]);
  fill('hotkeys', v.hotkeys || []);
  fill('expressions', v.expressions || []);
  fill('items', [...(v.items || []), ...imgs]);
  fill('keys', S.keyNames || []);
  const hint = $('vtsHint');
  if (hint) hint.textContent = v.connected ? `  VTube Studio: ${v.model || 'no model'} — click a field to pick from the list` : '  VTube Studio not connected — lists are empty, but you can still type names.';
}

async function saveEditor() {
  let actions;
  try { actions = readActions(); } catch (e) { $('edErrors').textContent = 'Actions: ' + e.message; return false; }
  const f = readForm($('edForm'));
  const { revealSrc, revealFps, revealLoop, ...rest } = f;
  const spell = { ...(editIndex >= 0 ? S.spells[editIndex] : {}), ...rest, actions };
  spell.reveal = !revealSrc ? undefined : (revealFps || revealLoop) ? { src: revealSrc, fps: revealFps || undefined, loop: revealLoop || undefined } : revealSrc;
  const list = S.spells.slice();
  if (editIndex >= 0) list[editIndex] = spell; else list.push(spell);
  const r = await saveSpells(list);
  if (!r.ok) { $('edErrors').textContent = r.errors.join('\n'); return false; }
  $('editor').close();
  await refresh();
  return spell.id || list.length - 1;
}

async function del(i) {
  if (!confirm(`Delete spell "${S.spells[i].name}"?`)) return;
  const r = await saveSpells(S.spells.filter((_, j) => j !== i));
  if (!r.ok) alert(r.errors.join('\n'));
}

// ---------- settings ----------
const SETTINGS = [
  ['Spell engine'],
  ['cooldown', 'number', 'Cooldown between spells (seconds)'],
  ['maxQueue', 'number', 'Max spells waiting in queue'],
  ['noMatch', 'select:ignore,overlay', 'When no spell matches the amount'],
  ['castToken', 'text', 'Token for /cast (optional, empty = none)'],
  ['Overlay'],
  ['overlay.mystery', 'asset', 'Mystery animation (empty = built-in)'],
  ['overlay.mysteryDuration', 'number', 'Mystery animation length (seconds)'],
  ['overlay.nameDelay', 'number', 'Show spell name after (s, -1 = never)'],
  ['overlay.donorText', 'text', 'Donor line — {donor} {amount} {message}'],
  ['overlay.fizzleText', 'text', 'No-match text (if noMatch = overlay)'],
  ['overlay.volume', 'number', 'Volume (0 – 1)'],
  ['VTube Studio'],
  ['vts.enabled', 'check', 'Connect to VTube Studio'],
  ['vts.port', 'number', 'VTS API port (default 8001)'],
  ['vts.host', 'text', 'VTS host (127.0.0.1 = this PC)'],
  ['Keyboard spells (macOS)'],
  ['keyboard.enabled', 'check', 'Allow keyboard spells'],
  ['keyboard.maxSeconds', 'number', 'Keyboard effects last at most (seconds)'],
  ['Server (restart needed)'],
  ['port', 'number', 'Port'],
  ['host', 'text', 'Host (127.0.0.1 = this PC only)'],
];

// ---------- wire up ----------
$('stop').onclick = () => api('/api/stop', {});
$('random').onclick = () => api('/api/test', { donor: $('tDonor').value, amount: Number($('tAmount').value) || 0 }).then((r) => !r.ok && alert(r.error));
$('add').onclick = () => openEditor(-1);
$('edCancel').onclick = () => $('editor').close();
$('edSave').onclick = saveEditor;
$('edTest').onclick = async () => { const ok = await saveEditor(); if (ok !== false) test(typeof ok === 'string' ? ok : S.spells[S.spells.length - 1]?.id); };
$('saveSettings').onclick = async () => { await api('/api/settings', readForm($('settings'))); alert('Settings saved'); };
$('cpCreate').onclick = async () => {
  const r = await api('/api/vts/param', { name: $('cpName').value.trim(), min: $('cpMin').value, max: $('cpMax').value, defaultValue: $('cpDef').value });
  alert(r.ok ? `Parameter "${r.parameterName}" created. Now map it in VTube Studio model settings.` : r.error);
};
$('ovUrl').textContent = `${location.origin}/overlay`;
connect();
