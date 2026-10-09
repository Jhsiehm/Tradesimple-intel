import { readFileSync } from "node:fs";
import { congressTrades, insiderTrades } from "../positions.mjs";
import { contractFeed } from "../contracts.mjs";
import { lobbyingFor, pacData } from "../corporate.mjs";
import { committees, memberCommittees, roster } from "../roster.mjs";
import { indexStatus, indexedMeetings, indexedVotes, laneOf } from "../timeline.mjs";
import { HQ_LATENCY, HQ_SOURCE, hqAll } from "../hq.mjs";
import { listTickers, tickerBySymbol } from "../lib/db.mjs";
import { CATEGORIES, categoriesFor, clampLimit, clampOffset, groupBy, nodeId, page, parseNode } from "../../shared/relations.mjs";

const CHAIN = JSON.parse(readFileSync(new URL("../../data/supplychain.json", import.meta.url), "utf8"));
const FROM = "2025-01-03";
const CONTRACT_WAIT = 9000;
const COUNT_WAIT = process.env.INTEL_TEST ? 200 : 2500;
const CAST = { Y: "Yea", N: "Nay", P: "Present", "-": "Not voting" };

const usd = (v) => {
  const a = Math.abs(v || 0);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v || 0)}`;
};
const honor = (chamber) => (chamber === "senate" ? "Sen." : "Rep.");
const keyText = (s) => String(s || "").replace(/[^A-Za-z0-9 .,&'()/\-_]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const title = (s) => String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Waits up to `ms`; the upstream keeps running and lands in the cache for the next call. */
function within(promise, ms, fallback) {
  return Promise.race([promise.catch(() => fallback), new Promise((resolve) => setTimeout(() => resolve({ ...fallback, slow: true }), ms).unref?.())]);
}

function seatOf(m) {
  if (!m) return "";
  if (m.chamber === "senate" || !m.district || m.district === "0") return m.chamber === "senate" ? m.state : `${m.state}-AL`;
  return `${m.state}-${String(m.district).padStart(2, "0")}`;
}

const memberRef = (m, sub = "") => ({ id: nodeId("member", m.bioguide), type: "member", label: `${honor(m.chamber)} ${m.name}`, sub: sub || `${m.party || "?"}-${seatOf(m)}` });

function tickerRef(db, symbol, fallbackName = "") {
  const t = tickerBySymbol(db, symbol);
  if (t) return { id: nodeId("ticker", t.symbol), type: "ticker", label: t.symbol, sub: t.name };
  const chain = Object.values(CHAIN).flatMap((e) => (e && typeof e === "object" ? [...(e.suppliers || []), ...(e.customers || [])] : [])).find((n) => n.symbol === symbol);
  return { id: nodeId("company", symbol), type: "company", label: symbol, sub: chain?.name || fallbackName || "Not in data/tickers.json" };
}

async function people(db) {
  const res = await roster(db).catch(() => ({ items: [] }));
  return new Map((res.items || []).map((p) => [p.bioguide, p]));
}

/** The node a request names, with a readable label; null when the id points at nothing we hold. */
export async function describe(db, id) {
  const parsed = parseNode(id);
  if (!parsed) return null;
  const { type, key } = parsed;
  if (type === "member") {
    const m = (await people(db)).get(key);
    return m ? memberRef(m) : null;
  }
  if (type === "ticker" || type === "company") return tickerRef(db, key);
  if (type === "committee") {
    const list = await committees(db).catch(() => ({ items: [] }));
    for (const c of list.items || []) {
      if (c.id === key) return { id, type, label: c.name, sub: c.chamber };
      const sub = (c.subcommittees || []).find((s) => s.id === key);
      if (sub) return { id, type, label: `${c.name} · ${sub.name}`, sub: c.chamber };
    }
    return null;
  }
  if (type === "hearing") {
    const m = indexedMeetings().find((x) => x.id === key);
    return m ? { id, type, label: m.title, sub: m.date } : null;
  }
  if (type === "vote") {
    const v = [...indexedVotes("house"), ...indexedVotes("senate")].find((x) => x.id === key);
    return v ? { id, type, label: v.question || v.id, sub: `${v.date}${v.bill ? ` · ${v.bill}` : ""}` } : null;
  }
  if (type === "district") return { id, type, label: key, sub: key.includes("-") ? "Congressional district" : "State (Senate seats)" };
  if (type === "agency" || type === "firm" || type === "pac") return { id, type, label: key, sub: { agency: "Federal agency", firm: "Lobbying registrant", pac: "Political action committee" }[type] };
  if (type === "insider") {
    const [symbol, ...who] = key.split("/");
    return { id, type, label: who.join("/") || key, sub: `Form 4 filer · ${symbol}` };
  }
  return null;
}

function edge(cat, from, to, label, src, extra = {}) {
  return { from, to, cat, label, n: 1, source: src.source, asOf: src.asOf, latency: src.latency, ...extra };
}

// Each builder returns { source, asOf, latency, rows: [{ node, edge }], note? }, ranked; `expand` pages it.

async function trades(db, origin, { type, key }) {
  const res = await congressTrades(db).catch(() => ({ items: [] }));
  const src = { source: res.source || "House Clerk PTR · Senate eFD", asOf: res.asOf || "", latency: "Trade date as disclosed; filed up to 45 days after the trade." };
  const items = (res.items || []).filter((t) => t.traded >= FROM && t.symbol && (type === "member" ? t.bioguide === key : t.symbol === key));
  const who = type === "ticker" ? await people(db) : null;
  const groups = groupBy(items, (t) => (type === "member" ? t.symbol : t.bioguide), { amount: (t) => t.amountLow, date: (t) => t.traded });
  const rows = groups.flatMap((g) => {
    const buys = g.rows.filter((t) => t.side === "buy").length;
    const sells = g.rows.filter((t) => t.side === "sell").length;
    const label = `${plural(g.n, "trade")} · ${buys} buy · ${sells} sell · latest ${g.last}`;
    const extra = { n: g.n, amount: g.amount, last: g.last, link: g.rows[0].link };
    if (type === "member") {
      const node = tickerRef(db, g.key, g.rows[0].asset);
      return [{ node, edge: edge("trade", origin.id, node.id, label, src, extra) }];
    }
    const m = who.get(g.key);
    if (!m) return [];
    const node = memberRef(m);
    return [{ node, edge: edge("trade", node.id, origin.id, label, src, extra) }];
  });
  return { ...src, rows, note: "Grouped per member and ticker since Jan 2025. Amounts are the low end of disclosed ranges." };
}

async function committeeSeats(db, origin, { type, key }) {
  const list = await committees(db).catch(() => ({ items: [] }));
  const src = { source: list.source || "unitedstates/congress-legislators", asOf: list.asOf || "", latency: list.latency || "Changes when an assignment changes." };
  if (type === "member") {
    const seats = await memberCommittees(db, key).catch(() => []);
    const rows = seats.map((s) => {
      const node = { id: nodeId("committee", s.id), type: "committee", label: s.name, sub: s.id.length === 4 ? "Committee" : "Subcommittee" };
      return { node, edge: edge("committee", origin.id, node.id, s.title || `Member (${s.side || "seat"})`, src) };
    });
    return { ...src, rows };
  }
  const found = (list.items || []).flatMap((c) => [c, ...(c.subcommittees || [])]).find((c) => c.id === key);
  const who = await people(db);
  const rank = (m) => (/chair/i.test(m.title) && !/vice|ranking/i.test(m.title) ? 0 : /ranking/i.test(m.title) ? 1 : m.title ? 2 : 3);
  const rows = (found?.members || [])
    .filter((m) => who.has(m.bioguide))
    .sort((a, b) => rank(a) - rank(b) || a.rank - b.rank)
    .map((m) => {
      const node = memberRef(who.get(m.bioguide));
      return { node, edge: edge("committee", node.id, origin.id, m.title || `Member (${m.side || "seat"})`, src) };
    });
  return { ...src, rows };
}

async function hearings(db, origin, { type, key }) {
  const idx = indexStatus();
  const src = { source: "Congress.gov committee-meeting API", asOf: idx.builtAt || "", latency: "As posted by committee clerks; index refreshed every 6 h. Cancelled and postponed meetings dropped." };
  const live = indexedMeetings().filter((m) => !/cancel|postpon/i.test(m.status || ""));
  if (type === "hearing") {
    const m = live.find((x) => x.id === key);
    const list = await committees(db).catch(() => ({ items: [] }));
    const all = (list.items || []).flatMap((c) => [c, ...(c.subcommittees || []).map((s) => ({ ...s, name: `${c.name} · ${s.name}` }))]);
    const rows = [...new Set((m?.codes || []).map((c) => c.toUpperCase().replace(/00$/, "")))].flatMap((code) => {
      const c = all.find((x) => x.id === code);
      if (!c) return [];
      const node = { id: nodeId("committee", c.id), type: "committee", label: c.name, sub: c.id.length === 4 ? "Committee" : "Subcommittee" };
      return [{ node, edge: edge("hearing", node.id, origin.id, "Held this meeting", src, { last: m.date, link: m.link }) }];
    });
    return { ...src, rows };
  }
  let lanes;
  let via = new Map();
  if (type === "member") {
    const seats = await memberCommittees(db, key).catch(() => []);
    lanes = new Set(seats.map((s) => laneOf(s.id)));
    via = new Map(seats.filter((s) => s.id.length === 4).map((s) => [laneOf(s.id), s.name]));
  } else lanes = new Set([laneOf(key)]);
  const rows = live
    .filter((m) => m.date >= FROM && m.codes.some((c) => lanes.has(laneOf(c))))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .map((m) => {
      const node = { id: nodeId("hearing", keyText(m.id)), type: "hearing", label: m.title, sub: `${m.date} · ${m.chamber === "senate" ? "Senate" : "House"}` };
      const lane = m.codes.map(laneOf).find((l) => lanes.has(l));
      const label = type === "member" ? `On their committee${via.get(lane) ? `: ${via.get(lane)}` : ""}` : "Held this meeting";
      return { node, edge: edge("hearing", origin.id, node.id, label, src, { last: m.date, link: m.link }) };
    });
  return { ...src, rows, note: type === "member" ? "Meetings of committees they sit on today. Calendar proximity only; says nothing about what was discussed." : undefined };
}

async function votes(db, origin, { type, key }) {
  const idx = indexStatus();
  const src = { source: "House Clerk EVS · Senate LIS roll call XML", asOf: idx.builtAt || "", latency: "Roll calls of the 119th Congress; index refreshed every 6 h." };
  if (type === "member") {
    const m = (await people(db)).get(key);
    const chamber = m?.chamber === "senate" ? "senate" : "house";
    const rows = indexedVotes(chamber)
      .filter((v) => v.casts[key])
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map((v) => {
        const node = { id: nodeId("vote", v.id), type: "vote", label: v.question || v.id, sub: `${v.date}${v.bill ? ` · ${v.bill}` : ""}` };
        return { node, edge: edge("vote", origin.id, node.id, `Voted ${CAST[v.casts[key]] || v.casts[key]}`, src, { last: v.date }) };
      });
    return { ...src, rows };
  }
  const v = [...indexedVotes("house"), ...indexedVotes("senate")].find((x) => x.id === key);
  const who = await people(db);
  const order = { Y: 0, N: 1, P: 2, "-": 3 };
  const rows = Object.entries(v?.casts || {})
    .filter(([id]) => who.has(id))
    .sort((a, b) => (order[a[1]] ?? 4) - (order[b[1]] ?? 4))
    .map(([id, cast]) => {
      const node = memberRef(who.get(id));
      return { node, edge: edge("vote", node.id, origin.id, `Voted ${CAST[cast] || cast}`, src, { last: v.date }) };
    });
  return { ...src, rows };
}

async function contractsOf(db, origin, { type, key }) {
  const empty = { ok: false, items: [] };
  const feeds = type === "ticker"
    ? [contractFeed(db, { symbol: key, days: 365, sort: "largest" })]
    : type === "district"
      ? [contractFeed(db, { place: key.endsWith("-AL") ? key.slice(0, 2) : key, days: 90, sort: "largest" })]
      : [contractFeed(db, { days: 365, sort: "largest" }), contractFeed(db, { days: 90, sort: "recent" })];
  const res = await Promise.all(feeds.map((f) => within(f, CONTRACT_WAIT, empty)));
  const first = res.find((r) => r.ok) || res[0];
  const slow = res.some((r) => r.slow);
  const src = { source: first?.source || "USAspending.gov prime contract transactions", asOf: first?.asOf || "", latency: slow ? "USAspending is still answering; ask again in a minute." : first?.latency || "" };
  const seen = new Set();
  const items = res.flatMap((r) => r.items || []).filter((r) => !seen.has(r.award + r.date + r.amount) && seen.add(r.award + r.date + r.amount));
  const scoped = type === "agency" ? items.filter((r) => r.agency === key && r.symbol) : items;
  const groups = groupBy(scoped, (r) => (type === "agency" ? r.symbol : r.agency), { amount: (r) => r.amount, date: (r) => r.date });
  const rows = groups.map((g) => {
    const label = `${plural(g.n, "action")} · ${usd(g.amount)} · latest ${g.last}`;
    const extra = { n: g.n, amount: g.amount, last: g.last, link: g.rows[0].link };
    if (type === "agency") {
      const node = tickerRef(db, g.key);
      return { node, edge: edge("contract", origin.id, node.id, label, src, extra) };
    }
    const node = { id: nodeId("agency", keyText(g.key)), type: "agency", label: g.key.replace(/^Department of (the )?/, ""), sub: "Federal agency" };
    return { node, edge: edge("contract", node.id, origin.id, type === "district" ? `${label} · performed here` : label, src, extra) };
  });
  const note = first?.note || (first?.ok === false ? first.error || "USAspending did not answer." : undefined);
  return { ...src, rows, note: type === "agency" ? "Only actions whose recipient is joined to a ticker in data/tickers.json." : note };
}

async function lobbying(db, origin, { key }) {
  const t = tickerBySymbol(db, key);
  if (!t) return { source: "LDA.gov", asOf: "", latency: "", rows: [], note: "Ticker is not in data/tickers.json." };
  const res = await within(lobbyingFor(db, t, 2), CONTRACT_WAIT, { ok: false, filings: [] });
  const src = { source: res.source || "LDA.gov LD-2 filings", asOf: res.asOf || "", latency: res.latency || "LD-2 reports are due 20 days after quarter end." };
  const groups = groupBy(res.filings || [], (f) => keyText(f.registrant), { amount: (f) => f.amount, date: (f) => f.posted });
  const rows = groups.map((g) => {
    const issues = [...new Set(g.rows.flatMap((f) => f.issues || []))].slice(0, 3).join(", ");
    const node = { id: nodeId("firm", g.key), type: "firm", label: g.key, sub: g.rows[0].inHouse ? "In-house registrant" : "Lobbying firm" };
    return { node, edge: edge("lobbying", node.id, origin.id, `${plural(g.n, "filing")} · ${usd(g.amount)}${issues ? ` · ${issues}` : ""}`, src, { n: g.n, amount: g.amount, last: g.last }) };
  });
  const note = res.missing ? `Set ${res.missing} on the server to load LDA filings.` : res.slow ? "LDA.gov is still answering." : (t.ldaClients || []).length ? `LDA client names from data/tickers.json: ${t.ldaClients.join(", ")}. Last 2 years.` : "No LDA client name in data/tickers.json.";
  return { ...src, rows, note };
}

async function pacs(db, origin, { type, key }) {
  const data = await within(pacData(db), 5000, { rows: [] });
  const src = { source: data.source || "FEC bulk itemized PAC contributions", asOf: data.asOf || "", latency: data.latency || "FEC bulk files refresh weekly; filings arrive up to a month after the gift." };
  const gifts = (data.rows || []).filter((r) => r.kind === "contribution" && r.date >= FROM);
  const who = await people(db);
  if (type === "member") {
    const groups = groupBy(gifts.filter((r) => r.bioguide === key), (r) => r.pac, { amount: (r) => r.amount, date: (r) => r.date });
    const rows = groups.map((g) => {
      const r = g.rows[0];
      const node = { id: nodeId("pac", g.key), type: "pac", label: keyText(r.pacName) || g.key, sub: r.symbol ? `Corporate PAC · ${r.symbol} (data/tickers.json)` : "PAC" };
      return { node, edge: edge("pac", node.id, origin.id, `${plural(g.n, "gift")} · ${usd(g.amount)} · latest ${g.last}`, src, { n: g.n, amount: g.amount, last: g.last, link: r.link }) };
    });
    return { ...src, rows, note: "Contributions from PACs joined to a ticker in data/tickers.json, since Jan 2025." };
  }
  if (type === "ticker") {
    const t = tickerBySymbol(db, key);
    const ids = new Set(t?.pacs || []);
    const groups = groupBy(gifts.filter((r) => ids.has(r.pac)), (r) => r.pac, { amount: (r) => r.amount, date: (r) => r.date });
    const rows = [...ids].map((id) => {
      const g = groups.find((x) => x.key === id);
      const node = { id: nodeId("pac", id), type: "pac", label: keyText(g?.rows[0].pacName) || id, sub: `Corporate PAC · ${key} (data/tickers.json)` };
      return { node, edge: edge("pac", node.id, origin.id, g ? `Sponsored PAC · ${plural(g.n, "gift")} to members · ${usd(g.amount)}` : "Sponsored PAC · no member gifts on file", src, { n: g?.n || 0, amount: g?.amount || 0, last: g?.last || "" }) };
    });
    return { ...src, rows, note: rows.length ? "PAC ids joined in data/tickers.json. Expand a PAC for the members it gave to." : "No PAC id in data/tickers.json for this ticker." };
  }
  const own = gifts.filter((r) => r.pac === key);
  const symbol = own[0]?.symbol || listTickers(db).find((t) => (t.pacs || []).includes(key))?.symbol;
  const groups = groupBy(own.filter((r) => who.has(r.bioguide)), (r) => r.bioguide, { amount: (r) => r.amount, date: (r) => r.date });
  const rows = groups.map((g) => {
    const node = memberRef(who.get(g.key));
    return { node, edge: edge("pac", origin.id, node.id, `${plural(g.n, "gift")} · ${usd(g.amount)} · latest ${g.last}`, src, { n: g.n, amount: g.amount, last: g.last, link: g.rows[0].link }) };
  });
  if (symbol) {
    const node = tickerRef(db, symbol);
    rows.unshift({ node, edge: edge("pac", origin.id, node.id, "Sponsor (PAC id joined in data/tickers.json)", src) });
  }
  return { ...src, rows };
}

function supply(db, origin, { key }) {
  const src = { source: "data/supplychain.json (curated from 10-K/20-F filings, supplier lists, announcements)", asOf: "", latency: "Curated; changes only when filings change." };
  const rows = [];
  const entry = CHAIN[key];
  for (const s of entry?.suppliers || []) {
    const node = tickerRef(db, s.symbol, s.name);
    rows.push({ node, edge: edge("supply", node.id, origin.id, `Supplies: ${s.what}`, src, { link: "", basis: s.basis }) });
  }
  for (const c of entry?.customers || []) {
    const node = tickerRef(db, c.symbol, c.name);
    rows.push({ node, edge: edge("supply", origin.id, node.id, `Customer: ${c.what}`, src, { basis: c.basis }) });
  }
  for (const [sym, e] of Object.entries(CHAIN)) {
    if (sym === key || !e || typeof e !== "object") continue;
    const asSupplier = (e.suppliers || []).find((s) => s.symbol === key);
    const asCustomer = (e.customers || []).find((c) => c.symbol === key);
    if (asSupplier) {
      const node = tickerRef(db, sym);
      rows.push({ node, edge: edge("supply", origin.id, node.id, `Supplies ${sym}: ${asSupplier.what}`, src, { basis: asSupplier.basis }) });
    }
    if (asCustomer) {
      const node = tickerRef(db, sym);
      rows.push({ node, edge: edge("supply", node.id, origin.id, `${sym} sells to it: ${asCustomer.what}`, src, { basis: asCustomer.basis }) });
    }
  }
  return { ...src, rows, note: entry ? undefined : rows.length ? "No curated chain of its own; these list it as a supplier or customer." : "No curated supply chain for this symbol yet." };
}

async function hq(db, origin, { type, key }) {
  const all = hqAll(db);
  const src = { source: HQ_SOURCE, asOf: all.asOf || "", latency: HQ_LATENCY };
  const district = (code) => ({ id: nodeId("district", code), type: "district", label: code, sub: code.includes("-") ? "Congressional district" : "State" });
  if (type === "ticker") {
    const h = all.items.find((x) => x.symbol === key);
    if (!h?.district) return { ...src, rows: [], note: h?.foreign ? "HQ is outside the U.S." : "No geocoded HQ for this ticker." };
    const node = district(h.district);
    return { ...src, rows: [{ node, edge: edge("hq", origin.id, node.id, `HQ · ${title(h.city)}, ${h.state || ""}`, src) }] };
  }
  const who = await people(db);
  const rosterSrc = { source: "unitedstates/congress-legislators", asOf: "", latency: "Changes when a seat changes." };
  if (type === "member") {
    const m = who.get(key);
    if (!m) return { ...src, rows: [] };
    const node = district(m.chamber === "senate" ? m.state : seatOf(m));
    return { ...rosterSrc, rows: [{ node, edge: edge("hq", origin.id, node.id, m.chamber === "senate" ? "Represents the state" : "Represents the district", rosterSrc) }] };
  }
  const rows = [];
  for (const m of who.values()) {
    const seat = m.chamber === "senate" ? m.state : seatOf(m);
    if (seat !== key) continue;
    const node = memberRef(m);
    rows.push({ node, edge: edge("hq", node.id, origin.id, m.chamber === "senate" ? "Represents the state" : "Represents the district", rosterSrc) });
  }
  for (const h of all.items.filter((x) => x.district === key || (!key.includes("-") && x.state === key && !x.foreign))) {
    const node = tickerRef(db, h.symbol);
    rows.push({ node, edge: edge("hq", node.id, origin.id, `HQ · ${title(h.city)}`, src) });
  }
  return { ...src, rows };
}

async function insiders(db, origin, { type, key }) {
  const res = await insiderTrades(db).catch(() => ({ items: [] }));
  const src = { source: res.source || "SEC EDGAR Form 4", asOf: res.asOf || "", latency: "Due 2 business days after the trade." };
  const [symbol, ...rest] = type === "insider" ? key.split("/") : [key];
  const person = rest.join("/");
  const items = (res.items || []).filter((f) => f.symbol === symbol && (type !== "insider" || keyText(f.person) === person));
  if (type === "insider") {
    const node = tickerRef(db, symbol);
    const g = groupBy(items, () => symbol, { amount: (f) => f.value, date: (f) => f.traded })[0];
    return { ...src, rows: g ? [{ node, edge: edge("insider", origin.id, node.id, `${plural(g.n, "Form 4 line")} · ${usd(g.amount)}`, src, { n: g.n, amount: g.amount, last: g.last, link: g.rows[0].link }) }] : [] };
  }
  const groups = groupBy(items, (f) => keyText(f.person), { amount: (f) => f.value, date: (f) => f.traded });
  const rows = groups.map((g) => {
    const f = g.rows[0];
    const buys = g.rows.filter((x) => x.side === "buy").length;
    const sells = g.rows.filter((x) => x.side === "sell").length;
    const node = { id: nodeId("insider", `${symbol}/${g.key}`), type: "insider", label: g.key, sub: `${f.title || "Insider"} · ${symbol}` };
    return { node, edge: edge("insider", node.id, origin.id, `${plural(g.n, "line")} · ${buys} buy · ${sells} sell · ${usd(g.amount)} · latest ${g.last}`, src, { n: g.n, amount: g.amount, last: g.last, link: f.link }) };
  });
  return { ...src, rows };
}

const BUILD = { trade: trades, committee: committeeSeats, hearing: hearings, vote: votes, contract: contractsOf, lobbying, pac: pacs, supply, hq, insider: insiders };

/** One page of neighbors for `node` in `category`. Every edge carries its feed's source, as-of, and latency. */
export async function expand(db, params) {
  const id = String(params.get("node") || "");
  const category = String(params.get("category") || "");
  const parsed = parseNode(id);
  if (!parsed) return { ok: false, status: 400, error: "node must look like member:P000197 or ticker:NVDA" };
  const cat = CATEGORIES.find((c) => c.id === category);
  if (!cat || !cat.from.includes(parsed.type)) return { ok: false, status: 400, error: `No ${category || "category"} relationships for a ${parsed.type}` };
  const origin = await describe(db, id);
  if (!origin) return { ok: false, status: 404, error: "Nothing on file for that node" };
  const built = await BUILD[category](db, origin, parsed);
  const seen = new Set();
  const rows = built.rows.filter((r) => r.node.id !== origin.id && !seen.has(r.node.id) && seen.add(r.node.id));
  const p = page(rows, clampOffset(params.get("offset")), clampLimit(params.get("limit")));
  return {
    ok: true,
    node: origin,
    category,
    label: cat.label,
    source: built.source,
    asOf: built.asOf,
    latency: built.latency,
    total: p.total,
    offset: p.offset,
    limit: p.limit,
    more: p.more,
    nodes: p.items.map((r) => r.node),
    edges: p.items.map((r) => r.edge),
    ...(built.note ? { note: built.note } : {})
  };
}

/** A node plus how many neighbors each of its categories holds. Slow upstreams answer `count: null`. */
export async function nodeInfo(db, params) {
  const id = String(params.get("id") || "");
  const parsed = parseNode(id);
  if (!parsed) return { ok: false, status: 400, error: "id must look like member:P000197 or ticker:NVDA" };
  const node = await describe(db, id);
  if (!node) return { ok: false, status: 404, error: "Nothing on file for that node" };
  const cats = categoriesFor(parsed.type);
  const sizes = await Promise.all(cats.map((c) => within(Promise.resolve().then(() => BUILD[c.id](db, node, parsed)).then((b) => ({ count: b.rows.length, source: b.source, asOf: b.asOf })), COUNT_WAIT, { count: null })));
  return {
    ok: true,
    node,
    categories: cats.map((c, i) => ({ id: c.id, label: c.label, count: sizes[i].slow ? null : sizes[i].count ?? null, source: sizes[i].source || c.source, asOf: sizes[i].asOf || "" }))
  };
}
