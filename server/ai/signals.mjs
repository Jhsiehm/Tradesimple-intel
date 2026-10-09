/**
 * News-wire and satellite-status summaries for Ask's platform signal tools (news, news_desk, satellite): the route
 * bodies trimmed for the model, with source, asOf and latency kept. Open-web tools live in webTool.mjs.
 */

/** Compact satellite/live-imagery summary for the model (no tile templates). */
export function summarizeSatellite(live, imagery) {
  const layers = (live?.layers || []).map((l) => {
    const last = (l.ranges || []).reduce((a, r) => Math.max(a, r.end || 0), 0);
    return {
      id: l.id || l.key,
      name: l.name,
      covers: l.covers,
      latestFrame: last ? new Date(last).toISOString() : "",
      ageNote: "GIBS posts geostationary frames about an hour after capture"
    };
  });
  return {
    ok: true,
    source: live?.source || imagery?.source || "NASA GIBS",
    asOf: live?.asOf || imagery?.asOf || new Date().toISOString(),
    latency: live?.latency || "Satellite frames are delayed; see ageNote per layer.",
    gap: live?.gap || "",
    live: layers,
    daily: live?.daily ? { name: live.daily.name, complete: live.daily.complete, end: live.daily.end } : null,
    basemaps: imagery?.layers ? Object.entries(imagery.layers).filter(([k]) => ["sat", "daily", "night"].includes(k)).map(([id, L]) => ({ id, source: L.source, asOf: L.asOf })) : []
  };
}

/** News items trimmed for the model. */
export function summarizeNews(wire, { q = "", desk = "", limit = 12 } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  const deskWant = String(desk || "").trim().toLowerCase();
  let items = Array.isArray(wire?.items) ? wire.items : [];
  if (deskWant) items = items.filter((r) => String(r.desk || "").toLowerCase() === deskWant || String(r.region || "").toLowerCase() === deskWant || String(r.feed || "").toLowerCase() === deskWant);
  if (needle) items = items.filter((r) => `${r.title} ${r.summary} ${(r.symbols || []).join(" ")}`.toLowerCase().includes(needle));
  return {
    ok: items.length > 0 || Boolean(wire?.ok),
    source: wire?.source || "RSS wires",
    asOf: wire?.asOf || "",
    latency: wire?.latency || "",
    feeds: (wire?.feeds || []).slice(0, 50).map((f) => ({ id: f.id, name: f.name, desk: f.desk, region: f.region, ok: f.ok, count: f.count })),
    errors: (wire?.errors || []).slice(0, 8),
    totalMatched: items.length,
    items: items.slice(0, limit).map((r) => ({
      title: r.title,
      source: r.source,
      desk: r.desk,
      region: r.region || "",
      published: r.published,
      link: r.link,
      symbols: r.symbols || [],
      summary: String(r.summary || "").slice(0, 240)
    }))
  };
}
