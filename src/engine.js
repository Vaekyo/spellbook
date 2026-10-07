// Spell engine: pick -> queue -> reveal -> actions -> wait duration -> revert -> cooldown.
const { EventEmitter } = require('events');
const config = require('./config');
const actions = require('./actions');
const media = require('./media');
const log = require('./log');

const sleep = (ms, signal) => new Promise((res) => {
  if (signal?.aborted || ms <= 0) return res();
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

function weightedPick(list) {
  const total = list.reduce((n, s) => n + s.weight, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const s of list) if ((r -= s.weight) < 0) return s;
  return list[list.length - 1];
}

class Engine extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.busy = false;
    this.ac = null;
    this.seq = 0;
  }

  // Explicit spellId wins (even if disabled), then exactAmount, then weighted random by tier.
  pick(ev) {
    if (ev.spellId) return config.spells.find((s) => s.id === ev.spellId) || null;
    const on = config.spells.filter((s) => s.enabled && s.weight > 0);
    const exact = on.filter((s) => s.exactAmount != null && s.exactAmount === ev.amount);
    if (exact.length) return weightedPick(exact);
    return weightedPick(on.filter((s) => s.exactAmount == null && ev.amount >= s.minAmount
      && (s.maxAmount == null || ev.amount <= s.maxAmount)));
  }

  cast(input = {}) {
    const ev = {
      source: String(input.source || 'manual'),
      donor: String(input.donor || 'Someone').slice(0, 60),
      amount: Number(input.amount) || 0,
      message: String(input.message || '').slice(0, 300),
      spellId: input.spellId ? String(input.spellId) : '',
    };
    const spell = this.pick(ev);
    if (!spell) {
      const error = ev.spellId ? `spell "${ev.spellId}" not found` : `no spell matches amount ${ev.amount}`;
      log.warn(`${ev.source}: ${ev.donor} (${ev.amount}) - ${error}`);
      if (!ev.spellId && config.settings.noMatch === 'overlay') this.emit('fizzle', ev);
      return { ok: false, error };
    }
    if (this.queue.length >= config.settings.maxQueue) {
      log.warn(`Queue full, dropped ${spell.name} from ${ev.donor}`);
      return { ok: false, error: 'queue full' };
    }
    const ahead = this.queue.length + (this.busy ? 1 : 0);
    this.queue.push({ id: ++this.seq, spell, ev });
    log.info(`${ev.source}: ${ev.donor} (${ev.amount}) -> ${spell.name}${ahead ? ` [${ahead} ahead in queue]` : ''}`);
    this.emit('state');
    this.pump();
    return { ok: true, spell: spell.id, ahead };
  }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const job = this.queue.shift();
      this.current = job;
      this.ac = new AbortController();
      this.emit('state');
      try { await this.run(job, this.ac.signal); } catch (e) { log.error(`Spell ${job.spell.name}: ${e.message}`); }
      this.current = null;
      this.emit('state');
      await sleep(config.settings.cooldown * 1000, this.ac.signal);
    }
    this.busy = false;
    this.emit('state');
  }

  async run({ id, spell, ev }, signal) {
    const o = config.settings.overlay;
    const mysteryMs = Math.max(0, Number(o.mysteryDuration) || 0) * 1000;
    this.emit('cast', {
      id,
      spell: { id: spell.id, name: spell.name },
      donor: ev.donor, amount: ev.amount, message: ev.message,
      mystery: media.resolve(o.mystery),
      reveal: media.resolve(spell.reveal),
      sound: media.resolve(spell.sound),
      mysteryMs,
      durationMs: spell.duration * 1000,
      nameDelay: spell.nameDelay ?? o.nameDelay,
    });
    await sleep(mysteryMs, signal);

    const undos = [];
    if (!signal.aborted) {
      const ctx = { spell, ev, signal };
      const results = await Promise.allSettled(spell.actions.map((a) => actions.run(a, ctx)));
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') { if (typeof r.value === 'function') undos.push(r.value); }
        else log.error(`${spell.name}: action ${i + 1} (${spell.actions[i].type}) failed: ${r.reason?.message || r.reason}`);
      });
      await sleep(spell.duration * 1000, signal);
    }

    // Revert everything, even if stopped early.
    (await Promise.allSettled(undos.map((u) => u())))
      .forEach((r) => r.status === 'rejected' && log.error(`${spell.name}: revert failed: ${r.reason?.message || r.reason}`));
    this.emit('end', { id });
  }

  stopAll() {
    const n = this.queue.length;
    this.queue.length = 0;
    this.ac?.abort();
    log.info(`Stop: cleared ${n} queued spell(s)${this.current ? ', reverting current spell' : ''}`);
    this.emit('state');
  }

  async idle(timeoutMs = 5000) {
    const end = Date.now() + timeoutMs;
    while (this.busy && Date.now() < end) await sleep(100);
  }

  snapshot() {
    const j = (x) => x && { id: x.id, spell: x.spell.name, donor: x.ev.donor, amount: x.ev.amount };
    return { current: j(this.current), queue: this.queue.map(j) };
  }
}

module.exports = new Engine();
