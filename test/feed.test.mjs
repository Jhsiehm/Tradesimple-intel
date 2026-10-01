import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeed } from "../server/feed.mjs";
import { amountShort, tradeSentence } from "../shared/sentences.mjs";

const t = (over) => ({ id: over.id, person: "Jane Doe", bioguide: "D000001", chamber: "house", party: "D", state: "NY", district: "NY-10", symbol: "NVDA", asset: "NVIDIA", side: "buy", type: "Purchase", amount: "$1,001 - $15,000", amountLow: 1001, traded: "2026-09-01", filed: "2026-09-20", lag: 19, link: `https://x/${over.id}.pdf`, inJoin: true, ...over });

test("amountShort turns disclosure ranges into short labels", () => {
  assert.equal(amountShort("$50,001 - $100,000"), "$50k–$100k");
  assert.equal(amountShort("$1,001 - $15,000"), "$1k–$15k");
  assert.equal(amountShort("$1,000,001 - $5,000,000"), "$1M–$5M");
  assert.equal(amountShort("Over $50,000,000"), "over $50M");
  assert.equal(amountShort("$2,722"), "$2,722");
});

test("tradeSentence reads plainly, with the year only when it differs", () => {
  const s = tradeSentence(t({ id: "a", chamber: "senate", district: "", person: "Pat Roe", side: "sell", type: "Sale", amount: "$50,001 - $100,000", traded: "2026-09-03", filed: "2026-09-25", lag: 22 }), { refYear: 2026 });
  assert.equal(s, "Sen. Pat Roe (D-NY) sold $50k–$100k NVDA · traded Sep 3, filed Sep 25 (22d)");
  assert.match(tradeSentence(t({ id: "b", traded: "2025-06-03", filed: "2026-09-12", lag: 466 }), { refYear: 2026 }), /traded Jun 3, 2025, filed Sep 12 \(466d\)$/);
});

test("buildFeed groups the latest list by filing and keeps late, biggest, and tickers", () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => t({ id: `big${i}`, link: "https://x/one.pdf", bioguide: "H000001", person: "Kev H", filed: "2026-09-25", symbol: `S${i}` })),
    ...["A", "B", "C", "D", "E"].map((p, i) => t({ id: `m${i}`, bioguide: `${p}000001`, person: `Member ${p}`, filed: `2026-09-2${i}`, symbol: i < 3 ? "AAPL" : "MSFT", amountLow: (i + 1) * 15001 })),
    t({ id: "late", bioguide: "R000001", person: "Late Filer", traded: "2025-06-03", filed: "2026-09-12", lag: 466, symbol: "GOOGL", amountLow: 250001 }),
    t({ id: "old", filed: "2026-06-01" })
  ];
  const f = buildFeed(rows, { today: "2026-09-30" });
  assert.equal(f.window.days, 14);
  assert.equal(f.window.fallback, true);
  assert.equal(f.latest[0].id, "big0");
  assert.equal(f.latest[0].more, 4);
  assert.ok(!f.latest.some((r) => r.id === "old"));
  assert.deepEqual(f.late.map((r) => r.id), ["late"]);
  assert.equal(f.biggest[0].id, "m4");
  assert.equal(f.tickers[0].symbol, "AAPL");
  assert.equal(f.tickers[0].members, 3);
  assert.match(f.latest[0].text, /^Rep\. Kev H \(D-NY-10\) bought \$1k–\$15k S0/);
});

test("buildFeed keeps the 7-day window when enough members filed", () => {
  const rows = ["A", "B", "C", "D", "E"].map((p, i) => t({ id: p, bioguide: `${p}000001`, filed: `2026-09-2${5 + (i % 4)}` }));
  const f = buildFeed(rows, { today: "2026-09-30" });
  assert.equal(f.window.days, 7);
  assert.equal(f.window.fallback, false);
  assert.equal(f.counts.members, 5);
});
