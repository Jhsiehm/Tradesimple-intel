import { tickerBySymbol } from "../../lib/db.mjs";
import { earningsCalendar, earningsFiled } from "./earnings.mjs";
import { lobbyingFor } from "./lobbying.mjs";
import { pacFor } from "./pacs.mjs";
import { contractsFor } from "./contracts.mjs";

/** How long the chart waits for one kind; a slower feed keeps loading into its cache and the kind is listed as pending. */
export const EVENT_WAIT = 8000;

const SLOW = Symbol("slow");

function budget(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(SLOW), ms); timer.unref?.(); })]).finally(() => clearTimeout(timer));
}

/**
 * Corporate chart marks for a joined equity. Each kind gets `waitMs`; `feeds` labels every kind with source, as-of
 * and latency, `pending` lists kinds still loading, `failed` kinds whose upstream errored.
 */
export async function equityEvents(db, symbol, kinds, { waitMs = EVENT_WAIT } = {}) {
  const ticker = tickerBySymbol(db, symbol);
  if (!ticker) return { marks: [], feeds: [], pending: [], failed: [] };
  const marks = [];
  const feeds = [];
  const pending = [];
  const failed = [];
  const want = (k) => !kinds || kinds.includes(k);
  const jobs = [];
  const run = (id, load, use, label) => {
    jobs.push(budget(load(), waitMs).then((res) => {
      if (res === SLOW) { pending.push(id); feeds.push({ id, ...label, asOf: "", note: `Still loading after ${waitMs / 1000} s; reload the chart in a minute.` }); return; }
      feeds.push({ id, ...label, asOf: res?.asOf || "", ...(res?.note ? { note: res.note } : {}) });
      use(res);
    }, (err) => { failed.push(id); feeds.push({ id, ...label, asOf: "", note: `Failed: ${err.message}` }); }));
  };
  if (want("earn")) {
    run("earn", () => earningsFiled(db, ticker), (res) => {
      for (const r of res.items) marks.push({ t: Date.parse(`${r.date}T21:00:00Z`), label: "Earnings 8-K", tone: "earn", detail: `8-K item 2.02 filed ${r.date}`, href: r.link });
    }, { source: "SEC EDGAR 8-K item 2.02", latency: "8-K filed within 4 business days of the release; marked on the filed date." });
    run("next", () => earningsCalendar(db, 0, 60), (res) => {
      const next = res.items.find((r) => r.symbol === symbol);
      if (next) marks.push({ t: Date.parse(`${next.date}T${next.time === "pre" ? "12" : "21"}:00:00Z`), label: `Next EPS ${next.epsForecast || ""}`.trim(), tone: "earn", detail: `Scheduled ${next.date} ${next.time}` });
    }, { source: "Nasdaq earnings calendar", latency: "Scheduled dates and consensus as published by Nasdaq; can move." });
  }
  if (want("lobby")) {
    run("lobby", () => lobbyingFor(db, ticker, 5), (res) => {
      const byPost = new Map();
      for (const f of res.filings || []) {
        const cur = byPost.get(f.posted) || { amount: 0, firms: new Set(), issues: new Set() };
        cur.amount += f.amount;
        cur.firms.add(f.registrant);
        f.issues.forEach((i) => cur.issues.add(i));
        byPost.set(f.posted, cur);
      }
      for (const [date, v] of byPost) {
        if (!date) continue;
        marks.push({ t: Date.parse(`${date}T16:00:00Z`), label: `LDA ${compact(v.amount)}`, tone: "lobby", detail: `${v.firms.size} filing firm(s) · ${[...v.issues].slice(0, 3).join(", ")}` });
      }
    }, { source: "LDA.gov LD-2", latency: "Quarterly reports due 20 days after quarter end; marked on the posted date." });
  }
  if (want("pac")) {
    run("pac", () => pacFor(db, symbol), (res) => {
      const byMonth = new Map();
      for (const r of res.rows) {
        if (!r.date) continue;
        const m = r.date.slice(0, 7);
        const cur = byMonth.get(m) || { amount: 0, count: 0, dem: 0, rep: 0 };
        cur.amount += r.amount;
        cur.count += 1;
        if (r.party === "D") cur.dem += r.amount;
        if (r.party === "R") cur.rep += r.amount;
        byMonth.set(m, cur);
      }
      for (const [m, v] of byMonth) {
        marks.push({ t: Date.parse(`${m}-15T16:00:00Z`), label: `PAC ${compact(v.amount)}`, tone: "pac", detail: `${v.count} gifts · D ${compact(v.dem)} / R ${compact(v.rep)}` });
      }
    }, { source: "FEC bulk PAC contributions", latency: "Monthly or quarterly FEC reports; marked mid-month of the gift." });
  }
  if (want("gov")) {
    run("gov", () => contractsFor(db, ticker), (res) => {
      for (const a of (res.awards || []).slice(0, 12)) {
        if (!a.start) continue;
        marks.push({ t: Date.parse(`${a.start}T16:00:00Z`), label: `${agencyCode(a.agency)} ${compact(a.amount)}`, tone: "gov", detail: `${a.agency} · ${a.description.slice(0, 80)}`, href: a.link });
      }
    }, { source: "USAspending.gov prime awards", latency: "DoD actions published about 90 days after award; marked on the award start date." });
  }
  await Promise.all(jobs);
  return { marks: marks.filter((m) => Number.isFinite(m.t)).sort((a, b) => a.t - b.t), feeds, pending, failed };
}

function agencyCode(agency) {
  const map = { "Department of Defense": "DoD", "National Aeronautics and Space Administration": "NASA", "Department of Health and Human Services": "HHS", "Department of Energy": "DOE", "Department of Homeland Security": "DHS", "Department of Veterans Affairs": "VA", "General Services Administration": "GSA", "Department of State": "State", "Department of Transportation": "DOT", "Department of the Treasury": "Treas" };
  return map[agency] || agency.split(" ").filter((w) => /^[A-Z]/.test(w) && !/^(Department|Of|The|And)$/i.test(w)).map((w) => w[0]).join("").slice(0, 5) || "Fed";
}

function compact(n) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
