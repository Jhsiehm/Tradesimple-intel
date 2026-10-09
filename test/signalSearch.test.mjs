import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dayOf, isoOf } from "../shared/backtest.mjs";
import { LIMITS, decodeSpec } from "../shared/backtestSpec.mjs";
import { capSignals } from "../server/domain/backtest/index.mjs";
import { mulberry32 } from "../shared/backtestStats.mjs";
import { bhQValues, rankFindings, searchWarning } from "../shared/signalSearch.mjs";
import { openDb } from "../server/lib/db.mjs";
import { buildVariants, cleanSearch, searchView, startSearch, waitForSearch } from "../server/domain/backtest/search.mjs";
import { form4Signals } from "../server/domain/backtest/signals.mjs";
import { cleanFilters } from "../shared/backtestSpec.mjs";
import { searchForModel } from "../server/ai/searchTool.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Benjamini–Hochberg q-values match R's p.adjust(method = 'BH')", () => {
  assert.deepEqual(bhQValues([0.01, 0.02, 0.03, 0.04, 0.05]).map((q) => Math.round(q * 1e6) / 1e6), [0.05, 0.05, 0.05, 0.05, 0.05]);
  assert.deepEqual(bhQValues([0.01, 0.04, 0.03, 0.005]).map((q) => Math.round(q * 1e6) / 1e6), [0.02, 0.04, 0.04, 0.02]);
  assert.deepEqual(bhQValues([0.9, 0.001]).map((q) => Math.round(q * 1e6) / 1e6), [0.9, 0.002]);
  assert.deepEqual(bhQValues([]), []);
  const ps = [0.2, 0.8, 0.5, 0.01];
  bhQValues(ps).forEach((q, i) => assert.ok(q >= ps[i] && q <= 1));
});

const row = (id, n, avgExcess, p) => ({ id, dim: "x", label: id, spec: null, signals: n, n, stats: n ? { avgExcess } : null, p });

test("ranking: minimum sample, m = tested only, sorted by excess, passes needs q and a positive mean", () => {
  const r = rankFindings([row("a", 50, 0.03, 0.001), row("b", 40, 0.05, 0.4), row("c", 12, 0.2, 0.0001), row("d", 60, -0.02, 0.0001), row("e", 0, null, null)], { minTrades: 30, fdr: 0.1 });
  assert.equal(r.built, 5);
  assert.equal(r.tested, 3);
  assert.deepEqual(r.findings.map((f) => f.id), ["b", "a", "d"]);
  assert.deepEqual(r.untested.map((u) => u.id).sort(), ["c", "e"]);
  const by = Object.fromEntries(r.findings.map((f) => [f.id, f]));
  assert.equal(by.a.q, 0.0015);
  assert.equal(by.a.passes, true);
  assert.equal(by.d.passes, false, "negative excess never passes");
  assert.equal(by.b.passes, false);
  const w = searchWarning(r, { minTrades: 30, fdr: 0.1 });
  assert.match(w, /^3 variants were tested \(5 built; 2 had fewer than 30 priced trades/);
  assert.match(w, /1 pass a false discovery rate of 10%/);
});

test("Form 4 filters: plan only, role, cluster buys counted by filing date", () => {
  const rows = [
    { id: "1", symbol: "AAA", side: "buy", code: "P", person: "Ann", title: "Chief Executive Officer", filed: "2025-03-01", traded: "2025-02-27", value: 10_000, plan: false },
    { id: "2", symbol: "AAA", side: "buy", code: "P", person: "Bob", title: "Director", filed: "2025-03-10", traded: "2025-03-08", value: 10_000, plan: false },
    { id: "3", symbol: "AAA", side: "buy", code: "P", person: "Cy", title: "CFO", filed: "2025-03-20", traded: "2025-03-18", value: 10_000, plan: false },
    { id: "4", symbol: "AAA", side: "buy", code: "P", person: "Dee", title: "Director", filed: "2025-03-21", traded: "2025-03-18", value: 10_000, plan: true },
    { id: "5", symbol: "BBB", side: "buy", code: "P", person: "Ed", title: "Director", filed: "2025-03-21", traded: "2025-03-18", value: 10_000, plan: false }
  ];
  const ids = (f) => form4Signals({ rows, filters: cleanFilters(f), sectorOf: () => "" }).signals.map((s) => s.id);
  assert.deepEqual(ids({}), ["1", "2", "3", "5"]);
  assert.deepEqual(ids({ planOnly: true }), ["4"]);
  assert.deepEqual(ids({ role: "ceo" }), ["1"]);
  assert.deepEqual(ids({ role: "cfo" }), ["3"]);
  assert.deepEqual(ids({ role: "director" }), ["2", "5"]);
  assert.deepEqual(ids({ clusterMin: 3 }), ["3"], "third distinct insider within 30 days; the plan buy does not count");
});

/* Fixture: member A's buys of AAA are each followed by an 8% jump; B and C buy random walks. */
const START = dayOf("2025-01-06");
function fixture() {
  const rnd = mulberry32(11);
  const aPublic = Array.from({ length: 40 }, (_, i) => START + 14 + i * 7);
  const jump = new Set(aPublic.map((d) => d + 1));
  const walk = (base, planted) => {
    const out = [];
    let p = base;
    for (let d = START; d < START + 420; d += 1) {
      if (d % 7 === 2 || d % 7 === 3) continue;
      const open = p;
      p *= planted && jump.has(d) ? 1.08 : 1 + (rnd() - 0.5) * 0.03;
      out.push([d, open, p]);
    }
    return out;
  };
  const bars = { AAA: walk(50, true), BBB: walk(80), CCC: walk(30), SPY: walk(400) };
  const trades = [];
  const add = (who, i, symbol, publicDay) => trades.push({
    id: `${who.bioguide}-${i}`, chamber: who.chamber, person: who.person, bioguide: who.bioguide, party: who.party, state: "CA", symbol, side: "buy",
    amount: "$15,001 - $50,000", amountLow: 15001, traded: isoOf(publicDay - 10), filed: isoOf(publicDay), lag: 10, inJoin: true
  });
  const A = { bioguide: "A000001", person: "Ann Ames", party: "D", chamber: "house" };
  const B = { bioguide: "B000002", person: "Bo Bell", party: "R", chamber: "senate" };
  const C = { bioguide: "C000003", person: "Cal Cole", party: "D", chamber: "house" };
  aPublic.forEach((d, i) => add(A, i, "AAA", d));
  for (let i = 0; i < 40; i += 1) add(B, i, "BBB", START + 15 + Math.floor(rnd() * 280));
  for (let i = 0; i < 40; i += 1) add(C, i, "CCC", START + 15 + Math.floor(rnd() * 280));
  const committees = [
    { id: "HSAS", name: "House Committee on Armed Services", chamber: "house", members: [{ bioguide: "A000001" }], subcommittees: [] },
    { id: "SSBK", name: "Senate Committee on Banking", chamber: "senate", members: [{ bioguide: "B000002" }], subcommittees: [] }
  ];
  return { bars, trades, committees };
}

function deps({ bars, trades, committees }) {
  return {
    congressTrades: async () => ({ items: trades, source: "fixture disclosures", asOf: "2026-10-09T00:00:00Z", latency: "none" }),
    loadCommittees: async () => ({ items: committees, source: "fixture rosters", asOf: "2026-10-09T00:00:00Z", latency: "none" }),
    contractAwards: async () => ({ awards: new Map(), res: {}, count: 0 }),
    insiderHistory: async () => ({ items: [] }),
    loadBars: async (_db, symbols) => ({ bars: Object.fromEntries(symbols.filter((s) => bars[s]).map((s) => [s, bars[s]])), pending: [], missing: [], stale: [], cached: symbols.length, fetched: 0, oldestStoredAt: null }),
    sectorOf: (s) => ({ AAA: "Industrials", BBB: "Financials", CCC: "Industrials" })[s] || ""
  };
}

test("variants cover every congressional dimension and members with enough trades", () => {
  const fx = fixture();
  const opts = cleanSearch({ holdDays: 20, minTrades: 30, sources: ["congress"] });
  const v = buildVariants({ ...fx, sectorOf: deps(fx).sectorOf, opts });
  const dims = new Set(v.map((x) => x.dim));
  for (const d of ["all", "chamber", "party", "committee", "member", "size", "sector", "speed"]) assert.ok(dims.has(d), d);
  assert.deepEqual(v.filter((x) => x.dim === "member").map((x) => x.spec.filters.member), ["A000001", "B000002", "C000003"]);
  assert.ok(v.every((x) => x.spec.rules.holdDays === 20 && x.spec.rules.sides === "buy"));
  assert.equal(v.find((x) => x.id === "congress:committee:HSAS").signals.length, 40);
});

test("the signal cap counts only the traded side, so many sells cannot crowd out buys", () => {
  const sig = (i, side) => ({ symbol: `S${i % 7}`, side, signalDate: isoOf(20000 + i) });
  const all = [...Array.from({ length: 5 }, (_, i) => sig(i, "buy")), ...Array.from({ length: LIMITS.signals }, (_, i) => sig(100 + i, "sell"))];
  assert.equal(capSignals(all, "buy").signals.length, 5);
  assert.equal(capSignals(all, "both").signals.filter((s) => s.side === "buy").length, 0);
});

test("end to end on fixture data: the planted member ranks first with a small q; the rerun is a cache hit", async () => {
  process.env.INTEL_CACHE = ":memory:";
  const db = openDb(root);
  const fx = fixture();
  const opts = { holdDays: 3, minTrades: 30, sources: ["congress"] };
  const started = startSearch(db, opts, { inline: true, deps: deps(fx) });
  assert.equal(started.state, "running");
  await waitForSearch(started.id, 30_000);
  const out = searchView(db, started.id);
  assert.equal(out.state, "done", JSON.stringify(out).slice(0, 300));
  assert.ok(out.tested >= 6 && out.tested < out.built, `${out.tested} of ${out.built}`);
  assert.ok(out.untested.some((u) => u.dim === "sector" || u.dim === "size"), "small variants are counted as not tested");
  const top = out.findings[0];
  assert.ok(["congress:member:A000001", "congress:committee:HSAS"].includes(top.id), top.id);
  assert.ok(top.stats.avgExcess > 0.05);
  assert.ok(top.q <= 0.01 && top.passes, `q ${top.q}`);
  assert.ok(top.placebo && top.placebo.pct > 0.95, "placebo on the top findings");
  assert.equal(top.verdict.level, "beat");
  assert.equal(decodeSpec(top.open.replace("bt:token:", "")).filters[top.dim === "member" ? "member" : "committee"], top.dim === "member" ? "A000001" : "HSAS");
  for (const f of out.findings) assert.ok(f.q >= f.p - 1e-9, "q ≥ p");
  const noise = out.findings.find((f) => f.id === "congress:member:B000002");
  assert.equal(noise.passes, false, "a random walk does not pass");
  assert.match(out.warning, new RegExp(`^${out.tested} variants were tested`));
  const again = startSearch(db, opts, { inline: true, deps: deps(fx) });
  assert.equal(again.cache, "hit");
  assert.deepEqual(again.findings.map((f) => f.q), out.findings.map((f) => f.q), "deterministic");
  const model = searchForModel(again);
  assert.equal(model.variantsTested, out.tested);
  assert.ok(model.findings[0].qValue != null && model.findings[0].open.startsWith("bt:token:"));
  assert.ok(model.multipleTestingWarning.length > 50);
});
