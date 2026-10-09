/**
 * Signal builders. Pure: records and lookups in, backtest signals out. Each signal's `signalDate` is the date
 * the record became public (filing, Form 4 filing, contract publication, LDA posting), never the event date.
 */
import { amountMid, dayOf, isoOf } from "../../../shared/backtest.mjs";

const inRange = (date, f) => (!f.from || date >= f.from) && (!f.to || date <= f.to);
const lc = (v) => String(v || "").toLowerCase();

/** Parent committees whose id or name matches `query`; members of the parent and its subcommittees. */
export function matchCommittees(committees, query) {
  const q = lc(query).trim();
  if (!q) return null;
  const hits = committees.filter((c) => lc(c.id) === q || lc(c.name).includes(q) || lc(c.name.replace(/^(House|Senate|Joint) Committee on /i, "")).includes(q));
  const members = new Set();
  const lanesBy = new Map();
  for (const c of hits) {
    for (const m of [...c.members, ...(c.subcommittees || []).flatMap((s) => s.members)]) {
      members.add(m.bioguide);
      lanesBy.set(m.bioguide, (lanesBy.get(m.bioguide) || new Set()).add(c.id.slice(0, 4).toUpperCase()));
    }
  }
  return { ids: hits.map((c) => c.id), names: hits.map((c) => c.name), members };
}

/** bioguide → Set of 4-letter committee lanes the member sits on today (the timeline's lanes). */
export function lanesByMember(committees) {
  const out = new Map();
  for (const c of committees) {
    for (const m of [...c.members, ...(c.subcommittees || []).flatMap((s) => s.members)]) {
      if (!m.bioguide) continue;
      (out.get(m.bioguide) || out.set(m.bioguide, new Set()).get(m.bioguide)).add(c.id.slice(0, 4).toUpperCase());
    }
  }
  return out;
}

const laneOf = (code) => String(code || "").slice(0, 4).toUpperCase();

/** lane → ascending hearing day numbers, cancelled and postponed meetings out. */
export function hearingsByLane(meetings) {
  const out = new Map();
  for (const m of meetings) {
    if (/cancel|postpon/i.test(m.status || "")) continue;
    const d = dayOf(m.date);
    if (d == null) continue;
    for (const lane of new Set((m.codes || []).map(laneOf))) (out.get(lane) || out.set(lane, []).get(lane)).push(d);
  }
  for (const list of out.values()) list.sort((a, b) => a - b);
  return out;
}

/** Days between the trade and the nearest hearing on one of the member's committees, if within `days`. */
export function nearestHearing(lanes, hearings, tradeDay, days, knownBy = null) {
  let best = null;
  for (const lane of lanes || []) {
    for (const d of hearings.get(lane) || []) {
      if (knownBy != null && d > knownBy) break;
      const gap = Math.abs(d - tradeDay);
      if (gap <= days && (best == null || gap < best)) best = gap;
    }
  }
  return best;
}

export function congressSignals({ trades, filters: f, sectorOf, committee = null, lanes = new Map(), hearings = null }) {
  const dropped = {};
  const drop = (why) => { dropped[why] = (dropped[why] || 0) + 1; };
  const member = lc(f.member).trim();
  const signals = [];
  for (const t of trades) {
    if (t.side !== "buy" && t.side !== "sell") { drop("notBuyOrSell"); continue; }
    if (!t.symbol || !t.inJoin) { drop("notJoined"); continue; }
    if (!t.filed || !t.traded) { drop("noDates"); continue; }
    if (f.party && t.party !== f.party) continue;
    if (f.chamber && t.chamber !== f.chamber) continue;
    if (member && !(lc(t.bioguide) === member || lc(t.person).includes(member))) continue;
    if (committee && !committee.members.has(t.bioguide)) continue;
    if (f.tickers.length && !f.tickers.includes(t.symbol)) continue;
    const sector = sectorOf(t.symbol);
    if (f.sector && sector !== f.sector) continue;
    if (!inRange(t.filed, f)) continue;
    if (f.minAmount && !(t.amountLow >= f.minAmount)) continue;
    if (f.minLagDays && !(t.lag >= f.minLagDays)) continue;
    if (f.maxLagDays && !(t.lag <= f.maxLagDays)) continue;
    let near = null;
    if (f.nearHearingDays) {
      const tradeDay = dayOf(t.traded);
      const filedDay = dayOf(t.filed);
      near = hearings ? nearestHearing(lanes.get(t.bioguide), hearings, tradeDay, f.nearHearingDays, f.hearingKnown ? filedDay : null) : null;
      if (near == null) { drop("noNearbyHearing"); continue; }
    }
    signals.push({
      id: t.id,
      symbol: t.symbol,
      signalDate: t.filed,
      tradeDate: t.traded,
      side: t.side,
      sizeHint: amountMid(t.amount, t.amountLow) || null,
      sizeIsRange: true,
      actor: t.bioguide || t.person,
      actorLabel: `${t.person}${t.party ? ` (${t.party}${t.state ? `-${t.state}` : ""})` : ""}`,
      sector,
      meta: near == null ? undefined : { hearingGap: near }
    });
  }
  return { signals, dropped };
}

const FORM4_SIDE = { buy: "buy", sell: "sell" };

/** Open-market Form 4 purchases and sales. Rows flagged as a 10b5-1 plan are left out: they were scheduled, not decided. */
export function form4Signals({ rows, filters: f, sectorOf }) {
  const dropped = {};
  const drop = (why) => { dropped[why] = (dropped[why] || 0) + 1; };
  const member = lc(f.member).trim();
  const seen = new Set();
  const signals = [];
  for (const r of rows) {
    const side = FORM4_SIDE[r.side];
    if (!side || (r.code !== "P" && r.code !== "S")) { drop("notOpenMarket"); continue; }
    if (r.plan) { drop("plan10b5"); continue; }
    if (!r.filed || !r.traded || !r.symbol) { drop("noDates"); continue; }
    if (f.tickers.length && !f.tickers.includes(r.symbol)) continue;
    const sector = sectorOf(r.symbol);
    if (f.sector && sector !== f.sector) continue;
    if (member && !lc(r.person).includes(member)) continue;
    if (!inRange(r.filed, f)) continue;
    if (f.minAmount && !(r.value >= f.minAmount)) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    signals.push({
      id: r.id,
      symbol: r.symbol,
      signalDate: r.filed,
      tradeDate: r.traded,
      side,
      sizeHint: r.value || null,
      sizeIsRange: false,
      actor: r.person,
      actorLabel: `${r.person}${r.title ? ` · ${r.title}` : ""}`,
      sector
    });
  }
  return { signals, dropped };
}

/** DoD actions post about 90 days late on USAspending; civilian agencies within days. */
export const DOD_LAG_DAYS = 90;
export const CIVILIAN_LAG_DAYS = 7;
export const CONTRACT_COOLDOWN_DAYS = 30;

export function contractSignals({ rows, filters: f, sectorOf }) {
  const dropped = {};
  const drop = (why) => { dropped[why] = (dropped[why] || 0) + 1; };
  const agency = lc(f.contractAgency).trim();
  const last = new Map();
  const signals = [];
  const sorted = [...rows].filter((r) => r.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const r of sorted) {
    if (!r.symbol) { drop("noJoin"); continue; }
    if (f.tickers.length && !f.tickers.includes(r.symbol)) continue;
    if (agency && !lc(`${r.agency} ${r.subAgency}`).includes(agency)) continue;
    const sector = sectorOf(r.symbol);
    if (f.sector && sector !== f.sector) continue;
    if (!(r.amount > 0)) { drop("deobligation"); continue; }
    if (f.minAmount && r.amount < f.minAmount) continue;
    const lag = /defense/i.test(r.agency || "") ? DOD_LAG_DAYS : CIVILIAN_LAG_DAYS;
    const day = dayOf(r.date);
    if (day == null) continue;
    const signalDate = isoOf(day + lag);
    if (!inRange(signalDate, f)) continue;
    const prev = last.get(r.symbol);
    if (prev != null && day + lag - prev < CONTRACT_COOLDOWN_DAYS) { drop("cooldown"); continue; }
    last.set(r.symbol, day + lag);
    signals.push({
      id: r.id || `${r.award}:${r.date}`,
      symbol: r.symbol,
      signalDate,
      tradeDate: r.date,
      side: "buy",
      sizeHint: r.amount,
      sizeIsRange: false,
      actor: r.agency || "agency",
      actorLabel: r.subAgency || r.agency || "agency",
      sector
    });
  }
  return { signals, dropped };
}

const QUARTER_TYPES = /^Q[1-4]$/;

/**
 * A quarter whose total lobbying income/expense is at least `spikePct` above the quarter before. Public on the
 * latest posting date of the quarter's filings; the earlier quarter counts only filings posted by then.
 */
export function lobbySignals({ filingsBySymbol, filters: f, sectorOf }) {
  const dropped = {};
  const signals = [];
  for (const [symbol, filings] of Object.entries(filingsBySymbol)) {
    const sector = sectorOf(symbol);
    if (f.sector && sector !== f.sector) continue;
    const quarters = new Map();
    for (const x of filings) {
      if (!QUARTER_TYPES.test(String(x.type || "")) || !x.posted || !(x.amount > 0)) continue;
      const key = `${x.year}${x.type}`;
      (quarters.get(key) || quarters.set(key, []).get(key)).push(x);
    }
    const keys = [...quarters.keys()].sort();
    for (let i = 1; i < keys.length; i += 1) {
      const cur = quarters.get(keys[i]);
      const prevKey = keys[i - 1];
      const posted = cur.map((x) => x.posted).sort().at(-1);
      const prev = quarters.get(prevKey).filter((x) => x.posted <= posted);
      const now = cur.reduce((a, x) => a + x.amount, 0);
      const before = prev.reduce((a, x) => a + x.amount, 0);
      if (!(before > 0)) { dropped.noPriorQuarter = (dropped.noPriorQuarter || 0) + 1; continue; }
      const jump = now / before - 1;
      if (jump * 100 < f.spikePct) continue;
      if (!inRange(posted, f)) continue;
      if (f.minAmount && now < f.minAmount) continue;
      const q = cur[0];
      signals.push({
        id: `lda:${symbol}:${keys[i]}`,
        symbol,
        signalDate: posted,
        tradeDate: q.periodEnd || posted,
        side: "buy",
        sizeHint: now,
        sizeIsRange: false,
        actor: symbol,
        actorLabel: `${symbol} ${q.type} ${q.year} (+${Math.round(jump * 100)}%)`,
        sector
      });
    }
  }
  return { signals, dropped };
}
