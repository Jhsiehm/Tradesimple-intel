// Preloaded into the API under test: every outbound request fails at once, so each route answers from its error path.
globalThis.fetch = async (input) => {
  throw new TypeError(`fetch failed (offline test: ${String(input?.url || input).slice(0, 60)})`);
};
