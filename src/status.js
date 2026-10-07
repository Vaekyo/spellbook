// Connection status of each integration, shown as pills in the dashboard.
const { EventEmitter } = require('events');

const status = new EventEmitter();
status.all = {};
status.set = (name, ok, text) => {
  const prev = status.all[name];
  if (prev && prev.ok === ok && prev.text === text) return;
  status.all[name] = { ok, text };
  status.emit('change');
};
status.remove = (name) => { delete status.all[name]; status.emit('change'); };

module.exports = status;
