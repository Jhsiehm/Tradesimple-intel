import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAlerts, LATE_DAYS } from "../server/alerts.mjs";

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
  assert.ok(ids.includes("f4:f1") && !ids.includes("f4:f2"));
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
