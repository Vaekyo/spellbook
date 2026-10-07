// Tiny logger: prints to console and keeps the last lines for the dashboard.
const { EventEmitter } = require('events');

const bus = new EventEmitter();
const lines = [];

function add(level, msg) {
  const line = { t: Date.now(), level, msg: String(msg) };
  lines.push(line);
  if (lines.length > 150) lines.shift();
  const time = new Date(line.t).toLocaleTimeString();
  (level === 'error' ? console.error : console.log)(`[${time}] ${level === 'info' ? '' : level.toUpperCase() + ' '}${line.msg}`);
  bus.emit('line', line);
}

module.exports = {
  info: (m) => add('info', m),
  warn: (m) => add('warn', m),
  error: (m) => add('error', m),
  lines,
  on: (ev, fn) => bus.on(ev, fn),
};
