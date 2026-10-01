/**
 * Pure size trimming for the published demo. The local demo/snapshot keeps full responses; the copy pushed to
 * GitHub Pages caps long lists and long strings so the site stays small. Every capped list keeps its newest or
 * largest rows (the API already sorts them) and records what was dropped in `demoTrim`.
 */

/** File-name prefixes (demoFile names) → top-level list caps. Lists inside other routes get NESTED_CAP. */
const TOP_CAPS = [
  [/^api_markets_politicians\.json$/, { items: 3000 }],
  [/^api_markets_positions\.json$/, { items: 500 }],
  [/^api_markets_whales\.json$/, { items: 600 }],
  [/^api_markets_insiders\.json$/, { items: 800 }],
  [/^api_congress_member_[A-Z]\d{6}_trades\.json$/, { items: 150 }],
  [/^api_calendar_pacs\.json$/, { rows: 300 }],
  [/^api_news\.json$/, { items: 300 }]
];
const STRING_CAP = 280;
/** Nested display lists that can be shortened, with their caps. Everything else (vote positions, price series, committee members, hearings) is kept whole. */
const CAPPED = new Map([["scheduled", 20], ["awards", 25], ["items", 25], ["insiders", 25], ["recent", 5], ["top", 6], ["bills", 25], ["recentBuyers", 3], ["recentSellers", 3]]);

export function trimText(value, cap = STRING_CAP) {
  return typeof value === "string" && value.length > cap ? `${value.slice(0, cap - 1)}…` : value;
}

function trimDeep(node, depth, dropped, key = "") {
  if (Array.isArray(node)) {
    let list = node;
    const cap = depth > 1 ? CAPPED.get(key) : undefined;
    if (cap != null && list.length > cap) {
      dropped[key] = (dropped[key] || 0) + list.length - cap;
      list = list.slice(0, cap);
    }
    return list.map((v) => trimDeep(v, depth + 1, dropped, key));
  }
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = trimDeep(v, depth + 1, dropped, k);
    return out;
  }
  return typeof node === "string" && /^(https?:|data:)/.test(node) ? node : trimText(node);
}

function trimTimeline(body) {
  return {
    ...body,
    trades: (body.trades || []).map(({ asset, ...t }) => ({
      ...t,
      near: t.near ? { ...t.near, title: trimText(t.near.title, 100), link: undefined } : null
    })),
    votes: (body.votes || []).map((v) => ({ ...v, question: trimText(v.question, 90) })),
    committees: (body.committees || []).map((l) => ({ ...l, hearings: l.hearings.map((h) => ({ ...h, title: trimText(h.title, 120) })) }))
  };
}

/** PAC calendar: every member keeps their top donors but only the five latest receipts. */
function trimPacs(body) {
  const members = {};
  for (const [id, m] of Object.entries(body.members || {})) members[id] = { ...m, recent: (m.recent || []).slice(0, 5) };
  return { ...body, members };
}

export function trimRoute(file, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  if (/^geo_/.test(file) || file === "manifest.json") return body;
  let next = body;
  const dropped = {};
  if (/_timeline\.json$/.test(file)) next = trimTimeline(next);
  if (/^api_calendar_pacs\.json$/.test(file)) next = trimPacs(next);
  for (const [re, caps] of TOP_CAPS) {
    if (!re.test(file)) continue;
    for (const [k, n] of Object.entries(caps)) {
      if (Array.isArray(next[k]) && next[k].length > n) {
        dropped[k] = next[k].length - n;
        next = { ...next, [k]: next[k].slice(0, n) };
      }
    }
  }
  next = trimDeep(next, 0, dropped);
  if (Object.keys(dropped).length) {
    next.demoTrim = dropped;
    const note = `Demo copy: long lists shortened (${Object.entries(dropped).map(([k, n]) => `${n} ${k} rows dropped`).join(", ")}); the live API returns them all.`;
    next.latency = next.latency ? `${next.latency} ${note}` : note;
  }
  return next;
}
