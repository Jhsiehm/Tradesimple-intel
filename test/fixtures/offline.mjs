// Preloaded into the API under test: every outbound request fails at once, so each route answers from its error path.
// INTEL_TEST drops upstream gate spacing (server/lib/env.mjs gateSpacing) so the failures are not paced.
process.env.INTEL_TEST = "1";
globalThis.fetch = async (input) => {
  throw new TypeError(`fetch failed (offline test: ${String(input?.url || input).slice(0, 60)})`);
};
