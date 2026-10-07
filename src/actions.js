// Action registry. Each handler: async (action, ctx) => undoFunction | null.
// Integrations (VTS, OBS, Streamer.bot) register their own types.
const handlers = {
  overlay_only: async () => null,
};

function register(type, fn) { handlers[type] = fn; }

async function run(action, ctx) {
  const h = handlers[action.type];
  if (!h) throw new Error(`action type "${action.type}" is not available`);
  return h(action, ctx);
}

module.exports = { register, run, types: () => Object.keys(handlers) };
