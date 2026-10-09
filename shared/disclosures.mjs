/**
 * One row per disclosed transaction. A Senate amendment re-lists the original report's trades, and the House Clerk
 * sometimes carries the same PTR line in two documents; without this every such trade is counted twice.
 *
 * Rules:
 *   - Two rows are the same transaction when member, ticker (or asset), trade date, type, amount range and owner
 *     all match and they come from different reports. Identical lines inside one report stay separate trades.
 *   - A Senate amendment row with no exact twin is matched to an original row of the same member, ticker, trade
 *     date, side and owner filed within `windowDays` of the report the amendment amends: the amendment revised it.
 *   - The kept row takes the latest amendment's values, the id of the earliest row, and `public` = the earliest
 *     date any of its reports was public. A row only in an amendment is public on the amendment date.
 *   - `revised` lists fields the amendment changed; `alsoIn` lists the ids of the rows folded into this one.
 */

const DAY_MS = 86400000;
const lc = (v) => String(v ?? "").trim().toLowerCase();
const dayNum = (iso) => {
  const t = Date.parse(`${String(iso || "").slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? Math.round(t / DAY_MS) : null;
};

export const REVISABLE = ["type", "amount", "amountLow", "asset", "assetType"];

/** The date a row's report became public: the amendment date when it is later than the report date. */
export const publicDateOf = (r) => (r.amended && r.amended > r.filed ? r.amended : r.filed);

const memberOf = (r) => `${r.chamber || ""}|${r.bioguide || lc(r.person)}`;
const reportOf = (r) => r.link || String(r.id || "").replace(/-\d+$/, "");
const assetOf = (r) => r.symbol || lc(r.asset);

export const transactionKey = (r) => [memberOf(r), assetOf(r), r.traded, lc(r.type), lc(r.amount), lc(r.owner)].join("|");
const looseKey = (r) => [memberOf(r), assetOf(r), r.traded, r.side, lc(r.owner)].join("|");

const isAmendment = (r) => Boolean(r.amendment);
const byPublic = (a, b) => String(publicDateOf(a)).localeCompare(String(publicDateOf(b))) || (a.amendment || 0) - (b.amendment || 0);

export function dedupeDisclosures(rows, { windowDays = 7 } = {}) {
  const byReport = new Map();
  const position = new Map();
  rows.forEach((r, i) => {
    position.set(r, i);
    const k = reportOf(r);
    (byReport.get(k) || byReport.set(k, { key: k, rows: [], first: i }).get(k)).rows.push(r);
  });
  // Originals first so amendments fold into them; then by public date.
  const reports = [...byReport.values()].sort((a, b) => Number(isAmendment(a.rows[0])) - Number(isAmendment(b.rows[0])) || byPublic(a.rows[0], b.rows[0]) || a.first - b.first);

  const entries = [];
  const exact = new Map();
  for (const report of reports) {
    const seen = new Map();
    for (const r of report.rows) {
      const k = transactionKey(r);
      const n = seen.get(k) || 0;
      seen.set(k, n + 1);
      const slots = exact.get(k) || exact.set(k, []).get(k);
      const slot = slots[n];
      if (slot) {
        slot.rows.push(r);
        slot.reports.add(report.key);
      } else {
        const entry = { rows: [r], reports: new Set([report.key]), order: position.get(r), gone: false };
        slots.push(entry);
        entries.push(entry);
      }
    }
  }

  const loose = new Map();
  for (const e of entries) {
    if (!e.rows.some((r) => !isAmendment(r))) continue;
    const k = looseKey(e.rows[0]);
    (loose.get(k) || loose.set(k, []).get(k)).push(e);
  }
  for (const e of entries) {
    if (e.rows.length !== 1 || !isAmendment(e.rows[0])) continue;
    const a = e.rows[0];
    const report = reportOf(a);
    const day = dayNum(a.filed);
    const target = (loose.get(looseKey(a)) || []).find((o) => !o.gone && !o.reports.has(report) && o.rows.some((r) => {
      const d = dayNum(r.filed);
      return !isAmendment(r) && d != null && day != null && Math.abs(d - day) <= windowDays;
    }));
    if (!target) continue;
    target.rows.push(a);
    target.reports.add(report);
    e.gone = true;
  }

  const kept = entries.filter((e) => !e.gone).sort((a, b) => a.order - b.order);
  const stats = { rows: rows.length, transactions: kept.length, merged: rows.length - kept.length, revised: 0, byChamber: {} };
  const items = kept.map((e) => {
    if (e.rows.length === 1) {
      const r = e.rows[0];
      return { ...r, public: publicDateOf(r) };
    }
    const sorted = [...e.rows].sort(byPublic);
    const first = sorted[0];
    const amendments = sorted.filter(isAmendment).sort((a, b) => (a.amendment || 0) - (b.amendment || 0) || byPublic(a, b));
    const base = amendments.at(-1) || first;
    const revised = REVISABLE.filter((f) => (base[f] ?? null) !== (first[f] ?? null));
    if (revised.length) stats.revised += 1;
    const chamber = first.chamber || "";
    stats.byChamber[chamber] = (stats.byChamber[chamber] || 0) + e.rows.length - 1;
    return {
      ...base,
      id: first.id,
      filed: first.filed,
      lag: first.lag,
      public: publicDateOf(first),
      ...(revised.length ? { revised } : {}),
      alsoIn: sorted.filter((r) => r !== first).map((r) => r.id)
    };
  });
  return { items, stats };
}
