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
    else c = el('input', { type: type === 'number' ? 'number' : 'text', value: v ?? '', step: 'any' });
    if (type === 'asset') c.setAttribute('list', 'assetList');
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

// Phase 1: actions edited as JSON. (Replaced by a picker UI once VTS/OBS are connected.)
function renderActions(box, actions) {
  box.replaceChildren(
    el('textarea', { id: 'actionsJson', rows: 8, value: JSON.stringify(actions, null, 2) }),
    el('div', { className: 'hint', textContent: `Available types: ${(S.actionTypes || []).join(', ')}` }));
}
function readActions() { return JSON.parse($('actionsJson').value || '[]'); }

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
$('ovUrl').textContent = `${location.origin}/overlay`;
connect();
