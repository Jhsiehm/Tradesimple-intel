import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAlerts, groupForm4, LATE_DAYS } from "../server/alerts.mjs";

const trade = (id, o) => ({ id, person: "Rep. A", bioguide: "A000001", symbol: "NVDA", asset: "NVIDIA", side: "buy", type: "Purchase", amount: "$1,001 - $15,000", traded: "2026-08-01", filed: "2026-08-20", lag: 19, link: `https://example.test/${id}`, ...o });
const trades = [
  trade("t1", {}),
  trade("t2", { bioguide: "B000002", person: "Sen. B", symbol: "AMD", filed: "2026-09-25", lag: 70 }),
  trade("t3", { bioguide: "C000003", person: "Rep. C", symbol: "XOM", filed: "2026-09-26", lag: 80 }),
  trade("t4", { bioguide: "C000003", person: "Rep. C", symbol: "XOM", filed: "2026-07-01", lag: 10 })
];
const insiders = [
  { id: "f1", symbol: "AMD", person: "Hahn Ava", title: "SVP", code: "S", side: "sell", shares: 2993, price: 488.69, traded: "2026-09-01", filed: "2026-09-03", link: "f1" },
  { id: "f2", symbol: "TSLA", person: "Someone", code: "S", side: "sell", shares: 1, traded: "2026-09-01", filed: "2026-09-03", link: "f2" }
];
const lobbying = [
  { id: "l1", symbol: "AMD", registrant: "Firm", typeLabel: "3rd Quarter - Report", amount: 60000, issues: ["Trade"], posted: "2026-09-30", link: "l1" },
  { id: "l2", symbol: null, registrant: "Other", posted: "2026-09-30", link: "l2" }
];

test("watched member and watched symbol both alert; others do not", () => {
  const out = buildAlerts({ trades, insiders, lobbying, symbols: ["amd"], members: ["A000001"] });
  const ids = out.map((a) => a.id);
  assert.ok(ids.includes("trade:t1"), "watched member A000001");
  assert.ok(ids.includes("trade:t2"), "watched symbol AMD");
  assert.ok(!ids.some((id) => id.includes("t3") || id.includes("t4")), "unwatched XOM trades stay out");
  assert.ok(ids.includes("f4:AMD:f1") && !ids.some((id) => id.startsWith("f4:TSLA")));
  assert.ok(ids.includes("lda:l1") && !ids.includes("lda:l2"), "unjoined LDA rows never alert");
  assert.equal(out.find((a) => a.id === "trade:t2").late, true, `lag 70 > ${LATE_DAYS}`);
  assert.equal(out.find((a) => a.id === "trade:t1").kind, "member-trade");
  assert.equal(out.find((a) => a.id === "trade:t2").kind, "symbol-trade");
});

test("late=all adds unwatched late filings once, and since filters on the filed date", () => {
  const out = buildAlerts({ trades, symbols: [], members: [], allLate: true });
  assert.deepEqual(out.map((a) => a.id), ["late:t3", "late:t2"]);
  const recent = buildAlerts({ trades, insiders, lobbying, symbols: ["AMD"], members: ["A000001"], since: "2026-09-01" });
  assert.ok(!recent.some((a) => a.id === "trade:t1"), "t1 filed 2026-08-20 is before since");
  assert.equal(recent[0].date, "2026-09-30", "newest first");
});

test("Form 4 lines group into one row per filing with counts, summed value, and 10b5-1 triage", () => {
  const line = (i, o) => ({ id: `f4-NVDA-ACC1-${i}`, accession: "ACC1", symbol: "NVDA", person: "Huang Jen-Hsun", title: "CEO", code: "S", side: "sell", shares: 10000, price: 180, value: 1.8e6, plan: true, traded: `2026-09-0${i + 1}`, filed: "2026-09-05", link: "acc1", ...o });
  const planned = [0, 1, 2, 3, 4].map((i) => line(i));
  const mixed = [
    line(0, { id: "x0", accession: "ACC2", plan: false }),
    line(1, { id: "x1", accession: "ACC2", code: "F", side: "tax", plan: false }),
    line(2, { id: "x2", accession: "ACC2", code: "P", side: "buy", value: 50000, plan: false })
  ];
  const out = buildAlerts({ insiders: [...planned, ...mixed], symbols: ["NVDA"] });
  assert.equal(out.length, 2, "five planned lines and three mixed lines are two filings");
  const a = out.find((r) => r.id === "f4:NVDA:ACC1");
  assert.deepEqual(a.form4, { lines: 5, buys: 0, sells: 5, other: 0, value: 9e6, planned: true });
  assert.equal(a.severity, "routine", "10b5-1 planned sales only");
  assert.match(a.detail, /0 buys · 5 sells · 0 other · \$9\.0M · 5 lines · 10b5-1 plan · traded 2026-09-01 – 2026-09-05/);
  const b = out.find((r) => r.id === "f4:NVDA:ACC2");
  assert.deepEqual(b.form4, { lines: 3, buys: 1, sells: 1, other: 1, value: 3.65e6, planned: false });
  assert.equal(b.severity, "high", "unplanned open-market sale + buy = $1.85M");
});

test("groupForm4 leaves the tax-withholding value out of the open-market total", () => {
  const [g] = groupForm4([
    { id: "a", accession: "A", symbol: "X", side: "tax", value: 5e6, traded: "2026-01-02" },
    { id: "b", accession: "A", symbol: "X", side: "sell", value: 2e5, plan: false, traded: "2026-01-01" }
  ]);
  assert.equal(g.value, 5.2e6);
  assert.equal(g.openValue, 2e5);
  assert.equal(g.from, "2026-01-01");
  assert.equal(g.planned, false);
});
