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

  for (const f of insiders) {
    if (!syms.has(f.symbol) || !after(f.filed)) continue;
    out.push({
      id: `f4:${f.id}`,
      kind: "form4",
      date: f.filed,
      title: `Form 4 · ${f.symbol} · ${f.person}`,
      detail: `${f.title ? `${f.title} · ` : ""}${f.side === "sell" ? "sold" : f.side === "buy" ? "bought" : f.code} ${Math.round(f.shares || 0).toLocaleString("en-US")} sh${f.price ? ` @ ${f.price}` : ""} · traded ${f.traded}`,
      link: f.link,
      action: `pos:${f.symbol}`,
      late: false,
      severity: alertSeverity({ kind: "form4", value: f.value ?? (f.shares || 0) * (f.price || 0) }),
      source: "SEC EDGAR Form 4",
      pins: [{ kind: "symbol", id: f.symbol, label: f.symbol }]
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
    items: items.slice(0, 200),
    sources: [
      { label: "Congress trades", source: trades.source || "House Clerk PTRs · Senate eFD", asOf: trades.asOf, latency: "Filed up to 45 days after the trade; alert date is the filed date." },
      { label: "Form 4", source: insiders.source || "SEC EDGAR Form 4", asOf: insiders.asOf, latency: "Due 2 business days after the trade." },
      { label: "Lobbying", source: lobbying.source || "LDA.gov", asOf: lobbying.asOf, latency: "Quarterly LD-2 reports, due 20 days after quarter end." }
    ]
  };
}
