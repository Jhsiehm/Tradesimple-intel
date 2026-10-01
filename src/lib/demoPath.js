/** One file per API route: "/api/markets/chart?symbol=AMD&span=6mo" → "api_markets_chart_symbol_AMD_span_6mo.json". Shared by the snapshot script and the browser. */
export function demoFile(route) {
  return `${String(route).replace(/^\//, "").replace(/[^A-Za-z0-9.-]+/g, "_")}.json`;
}
