import { congressTrades, insiderTrades } from "./positions.mjs";
import { lobbyingBoard } from "./corporate.mjs";
import { alertSeverity } from "../shared/intel.mjs";

/** STOCK Act: periodic transaction reports are due within 45 days of the trade (30 from notice, 45 hard cap). */
export const LATE_DAYS = 45;

/**
 * Pure. Turns the three feeds into alert rows for a watchlist. `since` (YYYY-MM-DD) filters on the date the
 * public could first see the record: filed date for disclosures, posted date for LDA. Each row carries a
 * triage `severity`, the member and ticker a pin can add to the watchlist, and its `source`.
 */
export function buildAlerts({ trades = [], insiders = [], lobbying = [], symbols = [], members = [], since = "", allLate = false }) {
  const syms = new Set(symbols.map((s) => s.toUpperCase()));
  const ids = new Set(members);
  const after = (d) => !since || String(d || "") >= since;
  const out = [];
  const tradeSource = (t) => (t.chamber === "senate" ? "Senate eFD PTR" : "House Clerk PTR");
  const tradePins = (t) => [
    ...(t.bioguide ? [{ kind: "member", id: t.bioguide, label: t.person, chamber: t.chamber }] : []),
    ...(t.symbol ? [{ kind: "symbol", id: t.symbol, label: t.symbol }] : [])
  ];

  for (const t of trades) {
    if (!after(t.filed)) continue;
    const late = t.lag != null && t.lag > LATE_DAYS;
    const watchedMember = ids.has(t.bioguide);
    const watchedSymbol = t.symbol && syms.has(t.symbol);
    if (watchedMember || watchedSymbol) {
      const kind = watchedMember ? "member-trade" : "symbol-trade";
      out.push({
        id: `trade:${t.id}`,
        kind,
        date: t.filed,
        title: `${t.person} ${t.side === "sell" ? "sold" : t.side === "buy" ? "bought" : t.type || "traded"} ${t.symbol || t.asset}`,
        detail: `${t.amount} · traded ${t.traded} · filed ${t.filed}${t.lag != null ? ` (${t.lag}d)` : ""}${late ? " · LATE" : ""}`,
        link: t.link,
        action: t.symbol ? `pos:${t.symbol}` : `member:${t.bioguide}`,
        late,
        severity: alertSeverity({ kind, late, lag: t.lag, amountLow: t.amountLow }),
        source: tradeSource(t),
        pins: tradePins(t)
      });
    } else if (late && allLate) {
      out.push({
        id: `late:${t.id}`,
        kind: "late-filing",
        date: t.filed,
        title: `Late filing · ${t.person} · ${t.symbol || t.asset}`,
        detail: `Filed ${t.lag} days after the trade (limit ${LATE_DAYS}) · ${t.amount}`,
        link: t.link,
        action: `member:${t.bioguide}`,
        late: true,
        severity: alertSeverity({ kind: "late-filing", late: true, lag: t.lag, amountLow: t.amountLow }),
        source: tradeSource(t),
        pins: tradePins(t)
      });
    }
  }

  for (const g of groupForm4(insiders.filter((f) => syms.has(f.symbol) && after(f.filed)))) {
    const traded = g.from === g.to ? g.from : `${g.from} – ${g.to}`;
    out.push({
      id: `f4:${g.symbol}:${g.accession}`,
      kind: "form4",
      date: g.filed,
      title: `Form 4 · ${g.symbol} · ${g.person}`,
      detail: `${g.title ? `${g.title} · ` : ""}${g.buys} buy${g.buys === 1 ? "" : "s"} · ${g.sells} sell${g.sells === 1 ? "" : "s"} · ${g.other} other${g.value ? ` · ${usd(g.value)}` : ""} · ${g.lines} line${g.lines === 1 ? "" : "s"}${g.planned ? " · 10b5-1 plan" : ""} · traded ${traded}`,
      link: g.link,
      action: `pos:${g.symbol}`,
      late: false,
      severity: alertSeverity({ kind: "form4", value: g.openValue, planned: g.planned }),
      source: "SEC EDGAR Form 4",
      pins: [{ kind: "symbol", id: g.symbol, label: g.symbol }],
      form4: { lines: g.lines, buys: g.buys, sells: g.sells, other: g.other, value: g.value, planned: g.planned }
    });
  }

  for (const l of lobbying) {
    if (!l.symbol || !syms.has(l.symbol) || !after(l.posted)) continue;
    out.push({
      id: `lda:${l.id}`,
      kind: "lobbying",
      date: l.posted,
      title: `Lobbying · ${l.symbol} · ${l.registrant}`,
      detail: `${l.typeLabel || l.type}${l.amount ? ` · $${Math.round(l.amount).toLocaleString("en-US")}` : ""}${l.issues?.length ? ` · ${l.issues.slice(0, 2).join(", ")}` : ""}`,
      link: l.link,
      action: `pos:${l.symbol}`,
      late: false,
      severity: alertSeverity({ kind: "lobbying", amount: l.amount }),
      source: "LDA.gov",
      pins: [{ kind: "symbol", id: l.symbol, label: l.symbol }]
    });
  }

  out.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id));
  return out;
}

const usd = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);

/**
 * One group per Form 4 filing (accession) from per-line insider rows. `value` sums every priced line;
 * `openValue` sums open-market buys and sells (codes P, S) not under a 10b5-1 plan. `planned` is true when the
 * filing has open-market sells, all under a plan, and no open-market buys.
 */
export function groupForm4(rows) {
  const groups = new Map();
  for (const f of rows) {
    const accession = f.accession || String(f.id);
    const key = `${f.symbol}:${accession}`;
    let g = groups.get(key);
    if (!g) {
      g = { symbol: f.symbol, accession, person: f.person, title: f.title, filed: f.filed, link: f.link, from: f.traded, to: f.traded, lines: 0, buys: 0, sells: 0, other: 0, value: 0, openValue: 0, plannedSells: 0 };
      groups.set(key, g);
    }
    const value = f.value ?? (f.shares || 0) * (f.price || 0);
    g.lines += 1;
    g.value += value || 0;
    if (f.side === "buy") g.buys += 1;
    else if (f.side === "sell") g.sells += 1;
    else g.other += 1;
    if (f.side === "sell" && f.plan) g.plannedSells += 1;
    else if (f.side === "buy" || f.side === "sell") g.openValue += value || 0;
    if (f.traded && (!g.from || f.traded < g.from)) g.from = f.traded;
    if (f.traded && (!g.to || f.traded > g.to)) g.to = f.traded;
  }
  return [...groups.values()].map(({ plannedSells, ...g }) => ({ ...g, value: Math.round(g.value), openValue: Math.round(g.openValue), planned: g.sells > 0 && plannedSells === g.sells && g.buys === 0 }));
}

/** Keeps watchlist rows ahead of unwatched late filings when trimming, so a late-filing batch cannot push them out. */
export function capAlerts(items, cap) {
  const watched = items.filter((a) => a.kind !== "late-filing").slice(0, cap);
  const keep = new Set([...watched, ...items.filter((a) => a.kind === "late-filing").slice(0, cap - watched.length)]);
  return items.filter((a) => keep.has(a));
}

export async function alertsFor(db, params) {
  const symbols = String(params.get("symbols") || "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z.\-]{1,8}$/.test(s)).slice(0, 100);
  const members = String(params.get("members") || "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]\d{6}$/.test(s)).slice(0, 100);
  const since = /^\d{4}-\d{2}-\d{2}$/.test(params.get("since") || "") ? params.get("since") : "";
  const allLate = params.get("late") === "all";
  const [trades, insiders, lobbying] = await Promise.all([
    congressTrades(db).catch(() => ({ items: [] })),
    symbols.length ? insiderTrades(db).catch(() => ({ items: [] })) : { items: [] },
    symbols.length ? lobbyingBoard(db).catch(() => ({ items: [] })) : { items: [] }
  ]);
  const items = buildAlerts({ trades: trades.items || [], insiders: insiders.items || [], lobbying: lobbying.items || [], symbols, members, since, allLate });
  return {
    ok: true,
    asOf: new Date().toISOString(),
    items: capAlerts(items, 200),
    sources: [
      { label: "Congress trades", source: trades.source || "House Clerk PTRs · Senate eFD", asOf: trades.asOf, latency: "Filed up to 45 days after the trade; alert date is the filed date." },
      { label: "Form 4", source: insiders.source || "SEC EDGAR Form 4", asOf: insiders.asOf, latency: "Due 2 business days after the trade. One row per filing; 10b5-1 planned sales are ROUTINE." },
      { label: "Lobbying", source: lobbying.source || "LDA.gov", asOf: lobbying.asOf, latency: "Quarterly LD-2 reports, due 20 days after quarter end." }
    ]
  };
}
