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

// Labels like "Name (hint)" or "Name — hint" show the hint as small grey text.
function labelEl(label) {
  const m = /^(.*?)\s*(?:\((.*)\)|—\s*(.*))$/.exec(label);
  return m ? el('span', {}, m[1], el('small', { textContent: m[2] || m[3] })) : el('span', { textContent: label });
}

// Builds iOS-style grouped rows. flat = append rows straight into box (no section groups).
function buildForm(box, defs, data, flat) {
  box.replaceChildren();
  let group = flat ? box : null;
  const section = (title) => { if (title) box.append(el('div', { className: 'sec', textContent: title })); group = box.appendChild(el('div', { className: 'group' })); };
  for (const [key, type, label] of defs) {
    if (!type) { if (!flat) section(key); continue; }
    if (!group) section();
    const v = getPath(data, key);
    let c;
    if (type === 'check') c = el('input', { type: 'checkbox', checked: v !== false && v != null ? !!v : false });
    else if (type.startsWith('select:')) c = el('select', {}, ...type.slice(7).split(',').map((o) => el('option', { value: o, textContent: o, selected: o === v })));
    else c = el('input', { type: type === 'number' ? 'number' : type === 'color' ? 'color' : 'text', value: v ?? '', step: 'any' });
    if (type === 'asset') c.setAttribute('list', 'assetList');
    if (type.startsWith('pick:')) c.setAttribute('list', 'dl-' + type.slice(5));
    c.dataset.key = key; c.dataset.type = type;
    group.append(el('label', { className: 'field' + (type === 'check' ? ' check' : '') }, labelEl(label), c));
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
  const dot = (name, ok, text) => el('span', { className: 'dot ' + (ok ? 'ok' : 'bad'), title: `${name}: ${text}` }, el('span', { className: 'lbl', textContent: name }));
  $('status').replaceChildren(
    dot('Overlay', S.overlays > 0, S.overlays ? `${S.overlays} connected` : 'not open in OBS'),
    ...Object.entries(S.status || {}).map(([name, s]) => dot(name, s.ok, s.text || (s.ok ? 'connected' : 'offline'))));
  const c = S.current;
  $('now').textContent = (c ? `✦ Casting ${c.spell} · ${c.donor}` : 'Idle') + (S.queue?.length ? ` · ${S.queue.length} queued` : '');
}

let toastTimer;
function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg; t.className = 'on' + (isErr ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 2600);
}

function addLog(line) {
  const box = $('log');
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 5;
  box.append(el('div', { className: line.level }, el('time', { textContent: new Date(line.t).toLocaleTimeString() }), line.msg));
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
  ws.onclose = () => { $('status').replaceChildren(el('span', { className: 'dot bad', textContent: 'Spellbook offline' })); setTimeout(connect, 2000); };
}

// ---------- spells ----------
const fmt = (n) => Number(n).toLocaleString('id-ID');
const TAGS = { vts: 'VTS', obs: 'OBS', key: 'Keyboard', streamerbot: 'Streamer.bot' };
function renderSpells() {
  const amount = (s) => s.exactAmount != null ? `exactly ${fmt(s.exactAmount)}` : `${fmt(s.minAmount)}${s.maxAmount != null ? ' – ' + fmt(s.maxAmount) : '+'}`;
  const ICONS = [['#ff9f0a', '#ff375f'], ['#5e5ce6', '#bf5af2'], ['#0a84ff', '#64d2ff'], ['#30d158', '#66d4cf'],
    ['#ff375f', '#bf5af2'], ['#ffd60a', '#ff9f0a'], ['#64d2ff', '#5e5ce6'], ['#ff6482', '#ff9f0a']];
  const pick = (id) => ICONS[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % ICONS.length];
  $('spellCount').textContent = `${S.spells.length} spells · ${S.spells.filter((s) => s.enabled).length} enabled`;
  if (!S.spells.length) return $('spells').replaceChildren(el('div', { className: 'empty', textContent: 'No spells yet. Click "New Spell" to create one.' }));
  $('spells').replaceChildren(...S.spells.map((s, i) => {
    const [c1, c2] = pick(s.id);
    const tags = [...new Set(s.actions.map((a) => TAGS[a.type.split('_')[0]]).filter(Boolean))];
    const sw = el('input', { type: 'checkbox', checked: s.enabled, title: 'Enabled for random casts', onclick: (e) => e.stopPropagation(),
      onchange: () => saveSpells(S.spells.map((x, j) => (j === i ? { ...x, enabled: sw.checked } : x))) });
    return el('div', { className: 'spell' + (s.enabled ? '' : ' off'), onclick: () => openEditor(i) },
      el('div', { className: 'icon', style: `background:linear-gradient(135deg,${c1},${c2})`, textContent: s.name.trim()[0]?.toUpperCase() || '✦' }),
      el('div', { className: 'info' }, el('b', { textContent: s.name }),
        el('div', { className: 'meta' }, `${amount(s)} · ${s.duration}s · weight ${s.weight}`, ...tags.map((t) => el('span', { className: 'tag', textContent: t })))),
      el('button', { className: 'btn sm', textContent: 'Test', onclick: (e) => { e.stopPropagation(); test(s.id); } }),
      sw,
      el('span', { className: 'chev', textContent: '›' }));
  }));
}

const test = (spellId) => api('/api/test', { spellId, donor: $('tDonor').value, amount: Number($('tAmount').value) || 0 })
  .then((r) => (r.ok ? toast('Casting…') : toast(r.error, true)));

const SPELL_FIELDS = [
  ['Spell'],
  ['name', 'text', 'Name (shown on overlay)'],
  ['id', 'text', 'ID (used by /cast?spellId=...)'],
  ['enabled', 'check', 'Enabled (can be picked randomly)'],
  ['Who can get it'],
  ['weight', 'number', 'Weight (higher = more often)'],
  ['minAmount', 'number', 'Min amount'],
  ['maxAmount', 'number', 'Max amount (empty = no limit)'],
  ['exactAmount', 'number', 'Exact amount only (empty = off)'],
  ['Timing'],
  ['duration', 'number', 'Duration in seconds (then revert)'],
  ['nameDelay', 'number', 'Show name after (seconds; empty = default, -1 = never)'],
  ['Reveal effect'],
  ['revealSrc', 'asset', 'Effect file (.webm, .png or a PNG-sequence folder)'],
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
  $('edTitle').textContent = i >= 0 ? s.name : 'New Spell';
  $('edDelete').style.display = i >= 0 ? '' : 'none';
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
  const body = el('div');
  const draw = (data) => {
    const d = ACTIONS[sel.value];
    if (!d) return body.replaceChildren(el('div', { className: 'field' }, el('textarea', { rows: 4, value: JSON.stringify(data, null, 2) })));
    const defaults = Object.fromEntries(d.fields.filter((f) => f[3] !== undefined).map((f) => [f[0], f[3]]));
    buildForm(body, d.fields, { ...defaults, ...data }, true);
  };
  sel.onchange = () => draw({});
  draw(a);
  const row = el('div', { className: 'group action' },
    el('div', { className: 'field head' }, sel, el('button', { type: 'button', className: 'remove', textContent: 'Remove', onclick: () => row.remove() })),
    body);
  row.read = () => {
    if (!ACTIONS[sel.value]) return { ...JSON.parse(body.querySelector('textarea').value || '{}'), type: sel.value };
    return strip({ ...(sel.value === a.type ? a : {}), ...readForm(body), type: sel.value });
  };
  return row;
}

function renderActions(box, list) {
  const rows = el('div', {}, ...list.map(actionRow));
  box.replaceChildren(rows,
    el('div', { className: 'sheetfoot', style: 'margin-top:8px' }, el('button', { type: 'button', className: 'btn sm', textContent: '+ Add Action', onclick: () => rows.append(actionRow({ type: 'vts_param' })) })),
    el('p', { id: 'vtsHint', className: 'note' }));
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
  if (hint) hint.textContent = v.connected ? `VTube Studio connected (${v.model || 'no model'}). Click a field to pick from the list.` : 'VTube Studio not connected. Lists are empty, but you can still type names.';
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
  toast('Saved');
  await refresh();
  return spell.id || list.length - 1;
}

async function del(i) {
  if (!confirm(`Delete spell "${S.spells[i].name}"?`)) return;
  const r = await saveSpells(S.spells.filter((_, j) => j !== i));
  if (!r.ok) return toast(r.errors.join(', '), true);
  $('editor').close();
  toast('Spell deleted');
  await refresh();
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
  ['overlay.nameDelay', 'number', 'Show spell name after (seconds, -1 = never)'],
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
$('random').onclick = () => api('/api/test', { donor: $('tDonor').value, amount: Number($('tAmount').value) || 0 }).then((r) => (r.ok ? toast('Casting…') : toast(r.error, true)));
$('stop').onclick = () => api('/api/stop', {}).then(() => toast('Stopped and reverted'));
$('edDelete').onclick = () => del(editIndex);
for (const b of document.querySelectorAll('#tabs button')) {
  b.onclick = () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('on', p.id === 'page-' + b.dataset.page));
    if (b.dataset.page === 'log') $('log').scrollTop = $('log').scrollHeight;
  };
}
$('add').onclick = () => openEditor(-1);
$('edCancel').onclick = () => $('editor').close();
$('edSave').onclick = saveEditor;
$('edTest').onclick = async () => { const ok = await saveEditor(); if (ok !== false) test(typeof ok === 'string' ? ok : S.spells[S.spells.length - 1]?.id); };
$('saveSettings').onclick = async () => { await api('/api/settings', readForm($('settings'))); toast('Settings saved'); };
$('cpCreate').onclick = async () => {
  const r = await api('/api/vts/param', { name: $('cpName').value.trim(), min: $('cpMin').value, max: $('cpMax').value, defaultValue: $('cpDef').value });
  toast(r.ok ? `"${r.parameterName}" created. Now map it in VTube Studio.` : r.error, !r.ok);
};
$('ovUrl').textContent = `${location.origin}/overlay`;
$('ovPreview').href = '/overlay?preview';
$('copyOv').onclick = () => navigator.clipboard.writeText($('ovUrl').textContent).then(() => toast('Copied'), () => toast('Copy failed, select the text instead', true));
connect();
