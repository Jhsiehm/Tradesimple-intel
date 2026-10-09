import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { congressTrades, insiderTrades } from "./positions.mjs";
import { contractFeed } from "./contracts.mjs";
import { contractsFor, pacData } from "./corporate.mjs";
import { indexStatus, indexedMeetings, indexedVotes, laneOf, memberTimeline } from "./timeline.mjs";
import { memberCommittees, roster } from "./roster.mjs";
import { HQ_SOURCE, districtCode, hqAll } from "./hq.mjs";
import { STATE_NAME_TO_POSTAL } from "./geo.mjs";
import { tickerBySymbol } from "./db.mjs";
import { ARC_KINDS, NEAR_DAYS, activitySignal, bucketDays, dayNum, severity } from "../shared/intel.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FROM = "2025-01-03";
const MINUTE = 60 * 1000;
const CONTRACT_WAIT = 9000;

let geo = null;

/** Area-weighted centroid of a feature's largest polygon; good enough to anchor an arc on a district or state. */
export function centroidOf(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  let best = null;
  for (const poly of polys) {
    const ring = poly[0] || [];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += cross;
      cx += (ring[j][0] + ring[i][0]) * cross;
      cy += (ring[j][1] + ring[i][1]) * cross;
    }
    if (!a) continue;
    if (!best || Math.abs(a) > best.area) best = { area: Math.abs(a), at: [cx / (3 * a), cy / (3 * a)] };
  }
  return best ? best.at.map((v) => Math.round(v * 1e4) / 1e4) : null;
}

function places() {
  if (geo) return geo;
  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, "data", "geo", name), "utf8"));
  const districts = new Map();
  for (const f of read("cd119.geojson").features) {
    if (f.properties?.CD119 === "ZZ") continue;
    const code = districtCode(String(f.properties.GEOID));
    const at = code && centroidOf(f.geometry);
    if (at) districts.set(code, at);
  }
  const states = new Map();
  for (const f of read("states.geojson").features) {
    const postal = STATE_NAME_TO_POSTAL[f.properties?.name];
    const at = postal && centroidOf(f.geometry);
    if (at) states.set(postal, at);
  }
  const agencies = JSON.parse(fs.readFileSync(path.join(root, "data", "agencies.json"), "utf8"));
  geo = { districts, states, agencies, agencyBy: new Map(agencies.items.map((a) => [a.name, a])) };
  return geo;
}

/** "NJ-5" → "NJ-05"; at-large and delegate seats → "AK-AL". */
export function seatCode(district) {
  const m = /^([A-Z]{2})-(\d{1,2}|AL)$/.exec(String(district || "").toUpperCase());
  if (!m) return "";
  return m[2] === "AL" || Number(m[2]) === 0 ? `${m[1]}-AL` : `${m[1]}-${m[2].padStart(2, "0")}`;
}

/** Where a member's arcs start: the House district centroid, or the state centroid for senators and delegates. */
export function memberAnchor({ chamber, state, district }, g = places()) {
  if (chamber === "house") {
    const code = seatCode(/^\d+$/.test(String(district || "")) ? `${state}-${district}` : district);
    if (code && g.districts.has(code)) return { at: g.districts.get(code), where: code };
  }
  const postal = String(state || district || "").slice(0, 2).toUpperCase();
  return g.states.has(postal) ? { at: g.states.get(postal), where: postal } : null;
}

const honor = (chamber) => (chamber === "senate" ? "Sen." : "Rep.");

/**
 * Pure. Turns trades, contract actions, and PAC gifts into place-indexed links for bundleArcs(). Only real
 * joins: trade symbol → SEC HQ, contract recipient → ticker (data/tickers.json) → HQ, PAC → ticker → HQ.
 */
export function buildLinks({ trades = [], contracts = [], pacs = [], hq = [], people = [], g = places() }) {
  const placesOut = [];
  const actions = [];
  const placeIdx = new Map();
  const actionIdx = new Map();
  const hqBy = new Map(hq.filter((h) => h.lat != null && h.lon != null && !h.foreign).map((h) => [h.symbol, h]));
  const byId = new Map(people.map((p) => [p.bioguide, p]));
  const place = (key, make) => {
    if (!placeIdx.has(key)) {
      const p = make();
      if (!p) return -1;
      placeIdx.set(key, placesOut.length);
      placesOut.push(p);
    }
    return placeIdx.get(key);
  };
  const act = (a) => {
    if (!actionIdx.has(a)) { actionIdx.set(a, actions.length); actions.push(a); }
    return actionIdx.get(a);
  };
  const hqPlace = (symbol) => place(`hq:${symbol}`, () => {
    const h = hqBy.get(symbol);
    return h ? { lon: h.lon, lat: h.lat, label: `${symbol} HQ · ${title(h.city)}, ${h.state}`, kind: "hq", action: `hq:${symbol}` } : null;
  });
  const memberPlace = (m) => place(`m:${m.bioguide || m.person}`, () => {
    const anchor = memberAnchor(m, g);
    if (!anchor) return null;
    return { lon: anchor.at[0], lat: anchor.at[1], label: `${honor(m.chamber)} ${m.name || m.person}${m.party ? ` (${m.party}-${anchor.where})` : ` · ${anchor.where}`}`, kind: "member", action: m.bioguide ? `member:${m.bioguide}` : "" };
  });
  const agencyPlace = (name) => place(`ag:${name}`, () => {
    const a = g.agencyBy.get(name);
    return a ? { lon: a.lon, lat: a.lat, label: `${a.short} HQ · ${a.address}`, kind: "agency", action: "" } : null;
  });
  const links = [];
  const coverage = Object.fromEntries(ARC_KINDS.map((k) => [k, { total: 0, placed: 0, noFrom: 0, noTo: 0 }]));
  const push = (kind, date, f, t, amount, action) => {
    const c = coverage[kind];
    c.total += 1;
    if (f < 0) { c.noFrom += 1; return; }
    if (t < 0) { c.noTo += 1; return; }
    c.placed += 1;
    links.push([dayNum(date), ARC_KINDS.indexOf(kind), f, t, Math.round(amount || 0), act(action)]);
  };
  for (const t of trades) {
    if (!t.traded || !t.symbol) continue;
    const f = memberPlace(t);
    push("trade", t.traded, f, f < 0 ? -1 : hqPlace(t.symbol), t.amountLow, `pos:${t.symbol}`);
  }
  for (const c of contracts) {
    if (!c.date || !c.symbol) continue;
    const f = agencyPlace(c.agency);
    push("contract", c.date, f, f < 0 ? -1 : hqPlace(c.symbol), c.amount, `contracts:symbol:${c.symbol}`);
  }
  for (const p of pacs) {
    if (!p.date || !p.symbol || !p.bioguide) continue;
    const m = byId.get(p.bioguide);
    const f = hqPlace(p.symbol);
    push("pac", p.date, f, f >= 0 && m ? memberPlace(m) : -1, p.amount, `member:${p.bioguide}`);
  }
  return { places: placesOut, actions, links, coverage };
}

function title(s) {
  return String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Waits up to `ms` for slow upstreams; the fetch keeps running and lands in the cache for the next call. */
function within(promise, ms, fallback) {
  return Promise.race([promise.catch(() => fallback), new Promise((resolve) => setTimeout(() => resolve({ ...fallback, slow: true }), ms).unref?.())]);
}

async function contractRows(db, scope) {
  const empty = { ok: false, items: [] };
  const feeds = scope.kind === "member"
    ? [contractFeed(db, { member: scope.id, days: 365, sort: "largest" })]
    : scope.kind === "symbol"
      ? [contractFeed(db, { symbol: scope.id, days: 365, sort: "largest" }), contractFeed(db, { symbol: scope.id, days: 90, sort: "recent" })]
      : [contractFeed(db, { days: 365, sort: "largest" }), contractFeed(db, { days: 90, sort: "recent" })];
  const res = await Promise.all(feeds.map((f) => within(f, CONTRACT_WAIT, empty)));
  const seen = new Set();
  const items = res.flatMap((r) => r.items || []).filter((r) => !seen.has(r.id) && seen.add(r.id));
  const first = res.find((r) => r.ok) || res[0];
  return { items, slow: res.some((r) => r.slow), source: first?.source || "USAspending.gov prime contract transactions", asOf: first?.asOf || "", latency: first?.latency || "", error: res.every((r) => !r.ok) ? (first?.error || "USAspending did not answer") : "" };
}

const memo = new Map();

/**
 * Everything the scrubber and arcs need for one scope (all Congress, one member, or one ticker): daily event
 * counts per lane, the scoped event list, and place-indexed arc links. The client windows and bundles them.
 */
export async function intelScope(db, params) {
  const member = String(params.get("member") || "").toUpperCase();
  const symbol = String(params.get("symbol") || "").toUpperCase();
  const scope = /^[A-Z]\d{6}$/.test(member) ? { kind: "member", id: member } : /^[A-Z.\-]{1,8}$/.test(symbol) ? { kind: "symbol", id: symbol } : { kind: "all", id: "" };
  if (scope.kind === "symbol" && !tickerBySymbol(db, scope.id)) return { ok: false, error: "Ticker is not in data/tickers.json" };
  const key = `${scope.kind}:${scope.id}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 10 * MINUTE && !hit.body.partial) return hit.body;
  const t0 = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const [tradeRes, insiderRes, people, pacRes, contracts, seats] = await Promise.all([
    congressTrades(db).catch(() => ({ items: [] })),
    insiderTrades(db).catch(() => ({ items: [] })),
    roster(db).catch(() => ({ items: [] })),
    within(pacData(db), 5000, { rows: [] }),
    contractRows(db, scope),
    scope.kind === "member" ? memberCommittees(db, scope.id).catch(() => []) : []
  ]);
  const person = scope.kind === "member" ? (people.items || []).find((p) => p.bioguide === scope.id) : null;
  if (scope.kind === "member" && !person) return { ok: false, error: "Member is not in the current roster" };
  let trades = (tradeRes.items || []).filter((t) => t.traded >= FROM);
  if (scope.kind === "member") trades = trades.filter((t) => t.bioguide === scope.id);
  if (scope.kind === "symbol") trades = trades.filter((t) => t.symbol === scope.id);
  const traded = new Set(trades.map((t) => t.symbol).filter(Boolean));
  const insiders = (insiderRes.items || []).filter((f) => f.traded >= FROM && (scope.kind === "all" || (scope.kind === "symbol" ? f.symbol === scope.id : traded.has(f.symbol))));
  const lanes = new Set(seats.map((s) => laneOf(s.id)));
  const meetings = indexedMeetings().filter((m) => !/cancel|postpon/i.test(m.status) && (scope.kind !== "member" || m.codes.some((c) => lanes.has(laneOf(c)))));
  const chambers = scope.kind === "member" ? [person.chamber === "senate" ? "senate" : "house"] : ["house", "senate"];
  const rolls = chambers.flatMap((c) => indexedVotes(c).map((v) => ({ ...v, chamber: c }))).filter((v) => scope.kind !== "member" || v.casts[scope.id]);
  let pacs = (pacRes.rows || []).filter((r) => r.kind === "contribution" && r.bioguide && r.date >= FROM);
  if (scope.kind === "member") pacs = pacs.filter((r) => r.bioguide === scope.id);
  if (scope.kind === "symbol") pacs = pacs.filter((r) => r.symbol === scope.id);

  const events = [
    ...trades.map((t) => ({ kind: "trade", date: t.traded, label: `${t.person} ${t.side === "buy" ? "bought" : t.side === "sell" ? "sold" : "traded"} ${t.symbol || t.asset} · ${t.amount}`, action: t.symbol ? `pos:${t.symbol}` : t.bioguide ? `member:${t.bioguide}` : "", link: t.link })),
    ...meetings.map((m) => ({ kind: "hearing", date: m.date, label: `${m.chamber === "senate" ? "Senate" : "House"} · ${m.title}`, link: m.link })),
    ...rolls.map((v) => ({ kind: "roll", date: v.date, label: `${v.chamber === "senate" ? "Senate" : "House"} roll · ${v.question}${v.bill ? ` · ${v.bill}` : ""}${scope.kind === "member" ? ` · voted ${{ Y: "Yea", N: "Nay", P: "Present", "-": "not voting" }[v.casts[scope.id]]}` : ""}`, action: `vote:${v.id}` })),
    ...contracts.items.map((c) => ({ kind: "contract", date: c.date, label: `${c.agency.replace(/^Department of (the )?/, "")} → ${c.recipient}${c.symbol ? ` (${c.symbol})` : ""} · $${Math.round(c.amount).toLocaleString("en-US")}`, action: c.symbol ? `contracts:symbol:${c.symbol}` : "", link: c.link })),
    ...insiders.map((f) => ({ kind: "form4", date: f.traded, label: `Form 4 · ${f.symbol} · ${f.person} ${f.side === "sell" ? "sold" : f.side === "buy" ? "bought" : f.code}${f.value ? ` $${Math.round(f.value).toLocaleString("en-US")}` : ""}`, action: `pos:${f.symbol}`, link: f.link }))
  ];
  const buckets = bucketDays(events, FROM, today);
  const scoped = scope.kind !== "all";
  const list = events
    .filter((e) => (scoped || e.kind === "contract") && dayNum(e.date) >= buckets.start)
    .map((e) => ({ d: dayNum(e.date) - buckets.start, k: e.kind, label: e.label, action: e.action || undefined, link: e.link || undefined }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 1500);
  const hq = hqAll(db);
  const arcs = buildLinks({ trades, contracts: contracts.items, pacs, hq: hq.items, people: people.items || [] });
  arcs.links = arcs.links.map((l) => [l[0] - buckets.start, ...l.slice(1)]);
  const g = places();
  const idx = indexStatus();
  const latencies = {
    trade: "Plotted on the trade date; filed up to 45 days later by law.",
    hearing: "As posted by committee clerks; index refreshed every 6 h. Cancelled and postponed meetings dropped.",
    roll: "Roll calls of the 119th Congress; index refreshed every 6 h.",
    contract: contracts.slow ? "USAspending is still answering; the lane fills on the next load." : contracts.latency,
    form4: "Plotted on the trade date; due 2 business days after the trade."
  };
  const body = {
    ok: true,
    asOf: new Date().toISOString(),
    ms: Date.now() - t0,
    partial: contracts.slow,
    scope: { ...scope, label: scope.kind === "member" ? `${honor(person.chamber)} ${person.name}` : scope.kind === "symbol" ? scope.id : "All Congress" },
    from: FROM,
    to: today,
    len: buckets.len,
    days: buckets.days,
    kinds: [
      { id: "trade", label: "Congress trades", source: tradeRes.source || "House Clerk PTR PDFs · Senate eFD PTRs", asOf: tradeRes.asOf || "", latency: latencies.trade, total: trades.length },
      { id: "hearing", label: scope.kind === "member" ? "Their committee hearings" : "Committee meetings", source: "Congress.gov committee-meeting API", asOf: idx.builtAt || "", latency: latencies.hearing, total: meetings.length },
      { id: "roll", label: scope.kind === "member" ? "Roll calls they cast" : "House + Senate roll calls", source: "House Clerk EVS · Senate LIS roll call XML", asOf: idx.builtAt || "", latency: latencies.roll, total: rolls.length },
      { id: "contract", label: "Contract awards", source: contracts.source, asOf: contracts.asOf, latency: latencies.contract, total: contracts.items.length, note: scope.kind === "member" ? "Largest 100 actions performed in their district (state for senators), last 365 days." : "Largest 100 actions in 365 days plus latest 100 in 90 days.", error: contracts.error || undefined },
      { id: "form4", label: scope.kind === "member" ? "Form 4 on tickers they traded" : "Form 4 insiders", source: insiderRes.source || "SEC EDGAR Form 4", asOf: insiderRes.asOf || "", latency: latencies.form4, total: insiders.length }
    ],
    events: list,
    arcs: {
      places: arcs.places,
      actions: arcs.actions,
      links: arcs.links,
      coverage: arcs.coverage,
      sources: {
        trade: `Member district (state for senators) → SEC EDGAR HQ · ${tradeRes.source || "House Clerk · Senate eFD"} · as of ${String(tradeRes.asOf || "").slice(0, 16).replace("T", " ")}`,
        contract: `${g.agencies.source} → contractor HQ via data/tickers.json · USAspending · as of ${String(contracts.asOf || "").slice(0, 16).replace("T", " ")}`,
        pac: `Corporate PAC (joined ticker's SEC HQ) → member district · ${pacRes.source || "FEC bulk"} · as of ${String(pacRes.asOf || "").slice(0, 16).replace("T", " ")}`
      },
      hq: { source: HQ_SOURCE, asOf: hq.asOf, placed: hq.items.filter((h) => h.lat != null && !h.foreign).length, total: hq.items.length }
    }
  };
  memo.set(key, { at: Date.now(), body });
  if (memo.size > 40) memo.delete(memo.keys().next().value);
  return body;
}

const usd = (v) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
};
const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);

async function districtContracts(db, place) {
  const res = await within(contractFeed(db, { place, days: 90, sort: "largest" }), CONTRACT_WAIT, { ok: false, items: [] });
  const sum = (res.items || []).reduce((s, r) => s + (r.amount || 0), 0);
  return { sum, n: (res.items || []).length, slow: Boolean(res.slow), ok: Boolean(res.ok), asOf: res.asOf || "", capped: (res.items || []).length >= 100 };
}

function contractStat(c, label) {
  if (!c.ok) return { label, value: "—", note: c.slow ? "USAspending still answering; reopen in a minute." : "USAspending unavailable." };
  return { label, value: usd(c.sum), note: `${c.n}${c.capped ? " largest" : ""} actions · USAspending` };
}

async function memberSignal(db, bioguide) {
  const tl = await memberTimeline(db, bioguide).catch(() => null);
  if (!tl?.ok) return { tl: null, sig: severity(null) };
  return { tl, sig: severity(tl.proximity) };
}

/** Case header for a member, ticker, or district dossier: one headline, a signal tag, three stats, sources. */
export async function caseFile(db, kind, rawId) {
  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  if (kind === "member") {
    const id = String(rawId).toUpperCase();
    if (!/^[A-Z]\d{6}$/.test(id)) return { ok: false, error: "Unknown member id" };
    const people = await roster(db).catch(() => ({ items: [] }));
    const m = people.items.find((p) => p.bioguide === id);
    if (!m) return { ok: false, error: "Member is not in the current roster" };
    const place = m.chamber === "senate" || !m.district || m.district === "0" ? m.state : `${m.state}-${String(m.district).padStart(2, "0")}`;
    const [{ tl, sig }, c] = await Promise.all([memberSignal(db, id), districtContracts(db, place)]);
    const trades = tl?.trades || [];
    const prox = tl?.proximity;
    const near = prox?.near ?? 0;
    const name = `${honor(m.chamber)} ${m.name}`;
    return {
      ok: true,
      kind: "member",
      subject: "MEMBER",
      headline: !trades.length
        ? `${name}: no disclosed trades since ${FROM}`
        : prox && !prox.baseline
          ? `${name}: ${prox.trades} trades, no committee hearings on file to compare`
          : `${name}: ${near} of ${prox?.trades ?? trades.length} trades within ${NEAR_DAYS} days of a hearing${prox?.baseline != null ? ` (${pct(prox.baseline)} of all days are)` : ""}`,
      sub: `${m.party}-${place} · ${m.chamber === "senate" ? "Senate" : "House"}`,
      signal: { ...sig, rule: "hearing" },
      stats: [
        { label: `Trades ${year}`, value: String(trades.filter((t) => t.traded.startsWith(year)).length), note: `${trades.length} since Jan 2025` },
        { label: "Hearing proximity", value: prox?.dayShare == null || !prox.baseline ? "—" : `${pct(prox.dayShare)} / ${pct(prox.baseline)}`, note: `trade days ≤${NEAR_DAYS} d of a hearing / all days` },
        contractStat(c, `Contracts in ${place} · 90d`)
      ],
      asOf: tl?.asOf || new Date().toISOString(),
      sources: ["House Clerk PTR / Senate eFD", "Congress.gov committee meetings", "USAspending place of performance"]
    };
  }
  if (kind === "ticker") {
    const t = tickerBySymbol(db, String(rawId).toUpperCase());
    if (!t) return { ok: false, error: "Ticker is not in data/tickers.json" };
    const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const f4since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const [tradeRes, insiderRes, hist] = await Promise.all([
      congressTrades(db).catch(() => ({ items: [] })),
      insiderTrades(db).catch(() => ({ items: [] })),
      contractsFor(db, t, { cachedOnly: true }).catch(() => null)
    ]);
    const trades = (tradeRes.items || []).filter((r) => r.symbol === t.symbol && r.traded >= since);
    const sig = activitySignal(trades.map((r) => r.traded), today);
    const f4 = (insiderRes.items || []).filter((r) => r.symbol === t.symbol && r.traded >= f4since);
    const fy = hist?.dependence || null;
    const lastYear = hist?.byYear?.at(-1) || null;
    let contract = fy ? { label: `Obligations FY${fy.fy}`, value: usd(fy.obligations), note: `${pct(fy.share)} of revenue · USAspending` } : lastYear ? { label: `Obligations FY${lastYear.fy}`, value: usd(lastYear.amount), note: "USAspending, parent UEIs" } : null;
    if (!contract) {
      if (!(t.contractParents || []).length) contract = { label: "Federal contracts", value: "—", note: "No USAspending parent in data/tickers.json" };
      else {
        const res = await within(contractFeed(db, { symbol: t.symbol, days: 180, sort: "largest" }), CONTRACT_WAIT, { ok: false, items: [] });
        contract = res.ok ? { label: "Contracts · 180d", value: usd((res.items || []).reduce((s, r) => s + r.amount, 0)), note: `${res.items.length} actions · USAspending` } : { label: "Federal contracts", value: "—", note: res.slow ? "USAspending still answering; reopen in a minute." : "USAspending unavailable." };
      }
    }
    return {
      ok: true,
      kind: "ticker",
      subject: "TICKER",
      headline: trades.length ? `${t.symbol}: ${sig.recent} Congress trade${sig.recent === 1 ? "" : "s"} in 30 days vs ${sig.expected.toFixed(1)} expected` : `${t.symbol}: no Congress trades in 12 months`,
      sub: t.name,
      signal: { level: sig.level, label: sig.label, why: sig.why, rule: "activity" },
      stats: [
        { label: "Congress trades · 12 mo", value: String(trades.length), note: `${new Set(trades.map((r) => r.bioguide || r.person)).size} members` },
        { label: "Form 4 · 90d", value: String(f4.length), note: `${f4.filter((r) => r.side === "buy").length} buys · ${f4.filter((r) => r.side === "sell").length} sells` },
        contract
      ],
      asOf: tradeRes.asOf || new Date().toISOString(),
      sources: ["House Clerk PTR / Senate eFD", "SEC EDGAR Form 4", "USAspending"]
    };
  }
  if (kind === "district") {
    const code = seatCode(rawId);
    if (!code) return { ok: false, error: "District must look like TX-12" };
    const [state, num] = code.split("-");
    const people = await roster(db).catch(() => ({ items: [] }));
    const rep = people.items.find((p) => p.chamber === "house" && p.state === state && (num === "AL" ? p.district === "0" || p.district === "" : Number(p.district) === Number(num)));
    const hqs = hqAll(db).items.filter((h) => h.district === code);
    const [c, repSig] = await Promise.all([districtContracts(db, code === `${state}-AL` ? state : code), rep ? memberSignal(db, rep.bioguide) : null]);
    const trades = repSig?.tl?.trades || [];
    const near = repSig?.tl?.proximity?.near ?? 0;
    const sig = repSig?.sig || { level: "thin", label: "NO MEMBER", why: "No current representative on the roster." };
    return {
      ok: true,
      kind: "district",
      subject: "DISTRICT",
      headline: `${code}: ${c.ok ? `${usd(c.sum)} in federal contract actions over 90 days` : "contract total pending"}${rep ? (trades.length ? ` · Rep. ${rep.name}: ${near} of ${trades.length} trades near a hearing` : ` · Rep. ${rep.name}: no disclosed trades`) : ""}`,
      sub: rep ? `Rep. ${rep.name} (${rep.party}) · signal is the representative's hearing proximity` : "Vacant or not on the roster",
      signal: { ...sig, rule: "hearing" },
      stats: [
        contractStat(c, "Contract actions · 90d"),
        { label: "Index HQs here", value: String(hqs.length), note: hqs.length ? hqs.slice(0, 4).map((h) => h.symbol).join(", ") : "SEC business address" },
        { label: `Rep. trades ${year}`, value: rep ? String(trades.filter((t) => t.traded.startsWith(year)).length) : "—", note: rep ? `${trades.length} since Jan 2025` : "" }
      ],
      asOf: new Date().toISOString(),
      sources: ["USAspending place of performance", "SEC EDGAR business address", "House Clerk PTR"]
    };
  }
  return { ok: false, error: "Unknown case kind" };
}
