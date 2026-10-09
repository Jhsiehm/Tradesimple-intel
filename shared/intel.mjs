/** Pure shaping for the time scrubber, map arcs, case-file signals, and the alert queue. Shared by server/ and src/. */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const EVENT_KINDS = ["trade", "hearing", "roll", "contract", "form4"];
export const ARC_KINDS = ["trade", "contract", "pac"];
export const NEAR_DAYS = 14;

export const dayNum = (iso) => Math.round(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / DAY_MS);
export const dayIso = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Daily counts per kind, index 0 = `from`. Events outside [from, to] or without a date are dropped and counted. */
export function bucketDays(events, from, to) {
  const start = dayNum(from);
  const len = Math.max(0, dayNum(to) - start + 1);
  const days = {};
  let dropped = 0;
  for (const e of events) {
    const i = dayNum(e.date) - start;
    if (!(i >= 0 && i < len)) { dropped += 1; continue; }
    (days[e.kind] ||= new Array(len).fill(0))[i] += 1;
  }
  return { start, len, days, dropped };
}

/** Sums `counts[a..b]` inclusive, clamped to the array. */
export function windowSum(counts, a, b) {
  if (!counts) return 0;
  let n = 0;
  for (let i = Math.max(0, a); i <= Math.min(counts.length - 1, b); i += 1) n += counts[i];
  return n;
}

/** Folds daily counts into `bins` equal-width bins for drawing; each bin sums its days. */
export function binCounts(counts, bins) {
  const out = new Array(Math.max(0, bins)).fill(0);
  if (!counts?.length || !bins) return out;
  for (let i = 0; i < counts.length; i += 1) out[Math.min(bins - 1, Math.floor((i * bins) / counts.length))] += counts[i];
  return out;
}

/** Points along the great circle between two [lon, lat] pairs. Identical endpoints return []. */
export function greatCircle(a, b, steps = 32) {
  const rad = Math.PI / 180;
  const [l1, p1] = [a[0] * rad, a[1] * rad];
  const [l2, p2] = [b[0] * rad, b[1] * rad];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (!(d > 1e-9)) return [];
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    out.push([Math.atan2(y, x) / rad, Math.atan2(z, Math.sqrt(x * x + y * y)) / rad]);
  }
  return out;
}

/**
 * Links are `[day, kindIndex, fromPlace, toPlace, amount, actionIndex]`. Bundles every link inside the
 * day window by (kind, from, to), drops same-place links (counted as `local`), and keeps the `cap` heaviest
 * bundles by count then amount.
 */
export function bundleArcs(links, { from = -Infinity, to = Infinity, kinds = null, cap = 160 } = {}) {
  const groups = new Map();
  let local = 0;
  let inWindow = 0;
  for (const [d, k, f, t, amount, action] of links) {
    if (d < from || d > to) continue;
    if (kinds && !kinds.has(ARC_KINDS[k])) continue;
    inWindow += 1;
    if (f === t) { local += 1; continue; }
    const key = `${k}:${f}:${t}`;
    const g = groups.get(key);
    if (g) {
      g.n += 1;
      g.amount += amount || 0;
      if (d < g.first) g.first = d;
      if (d > g.last) g.last = d;
    } else groups.set(key, { key, kind: ARC_KINDS[k], from: f, to: t, n: 1, amount: amount || 0, first: d, last: d, action });
  }
  const all = [...groups.values()].sort((a, b) => b.n - a.n || b.amount - a.amount || a.key.localeCompare(b.key));
  return { arcs: all.slice(0, cap), bundles: all.length, hidden: Math.max(0, all.length - cap), links: inWindow, local };
}

const pct = (v) => `${Math.round(v * 100)}%`;

export const SEVERITY_RULE = `Share of trade days within ${NEAR_DAYS} days of a hearing on the member's committees, minus the share of all calendar days that are. HIGH: ≥25 points over with ≥4 near trade days. ELEVATED: ≥10 points over with ≥2. Fewer than 3 trade days is THIN DATA. Calendar distance only; it says nothing about what was discussed.`;

/** Hearing-proximity signal from server/timeline.mjs proximity(): trade-day share versus the calendar baseline. */
export function severity(prox) {
  if (!prox || prox.baseline == null) return { level: "thin", label: "NO DATA", why: "No hearing index or trade record yet." };
  if (!prox.baseline) return { level: "thin", label: "NO HEARINGS", why: "No meetings on file for this member's current committees, so there is nothing to measure trades against." };
  const days = prox.tradeDays || 0;
  if (days < 3 || prox.dayShare == null) return { level: "thin", label: "THIN DATA", why: `${days} trade day${days === 1 ? "" : "s"} since ${prox.from || "2025-01-03"}; too few to compare with the ${pct(prox.baseline)} baseline.` };
  const excess = prox.dayShare - prox.baseline;
  const near = prox.nearTradeDays || 0;
  const why = `${pct(prox.dayShare)} of ${days} trade days fall within ${NEAR_DAYS} d of a hearing vs ${pct(prox.baseline)} of all days.`;
  if (excess >= 0.25 && near >= 4) return { level: "high", label: "HIGH", why, excess };
  if (excess >= 0.1 && near >= 2) return { level: "elevated", label: "ELEVATED", why, excess };
  if (excess <= -0.1) return { level: "low", label: "BELOW BASELINE", why, excess };
  return { level: "baseline", label: "BASELINE", why, excess };
}

export const ACTIVITY_RULE = "Congress trades in the last 30 days versus the 30-day rate over the prior 11 months. HIGH: ≥5 trades and ≥3× the rate. ELEVATED: ≥3 trades and ≥1.5×. Fewer than 3 trades in 12 months is THIN DATA.";

/** Last-30-day trade count against the trailing 11-month rate, for ticker dossiers. */
export function activitySignal(dates, today, recentDays = 30, baseDays = 365) {
  const end = dayNum(today);
  let recent = 0;
  let prior = 0;
  for (const d of dates) {
    const gap = end - dayNum(d);
    if (!(gap >= 0)) continue;
    if (gap < recentDays) recent += 1;
    else if (gap < baseDays) prior += 1;
  }
  const expected = (prior * recentDays) / (baseDays - recentDays);
  const ratio = expected > 0 ? recent / expected : null;
  const base = { recent, prior, expected, ratio };
  const why = `${recent} trade${recent === 1 ? "" : "s"} in ${recentDays} d vs ${expected.toFixed(1)} expected from the prior ${Math.round((baseDays - recentDays) / 30)} months.`;
  if (recent + prior < 3) return { ...base, level: "thin", label: "THIN DATA", why: `${recent + prior} Congress trade${recent + prior === 1 ? "" : "s"} in 12 months.` };
  const r = ratio ?? Infinity;
  if (recent >= 5 && r >= 3) return { ...base, level: "high", label: "HIGH", why };
  if (recent >= 3 && r >= 1.5) return { ...base, level: "elevated", label: "ELEVATED", why };
  if (expected >= 2 && r < 0.5) return { ...base, level: "low", label: "BELOW BASELINE", why };
  return { ...base, level: "baseline", label: "BASELINE", why };
}

export const ALERT_RULE = "HIGH: filed more than 90 days after the trade, a Congress trade of $250,001+, or a Form 4 worth $1M+. ELEVATED: filed past the 45-day STOCK Act limit, a trade of $50,001+, a Form 4 of $100K+, or lobbying of $500K+. Otherwise ROUTINE.";

/** Triage level for one alert row; amounts are the disclosed range floor, not the trade size. */
export function alertSeverity(a) {
  const lag = a.lag ?? 0;
  const low = a.amountLow ?? 0;
  const value = a.value ?? 0;
  if (lag > 90 || low >= 250001 || (a.kind === "form4" && value >= 1e6)) return "high";
  if (a.late || lag > 45 || low >= 50001 || (a.kind === "form4" && value >= 1e5) || (a.kind === "lobbying" && (a.amount ?? 0) >= 5e5)) return "elevated";
  return "routine";
}
