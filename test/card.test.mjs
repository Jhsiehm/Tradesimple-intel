import { test } from "node:test";
import assert from "node:assert/strict";
import { cardSvg, describe, memberPageHtml, memberSlug, summarize } from "../shared/card.mjs";

const timeline = {
  ok: true,
  member: { bioguide: "B001288", name: "Cory A. Booker", party: "D", state: "NJ", district: "", chamber: "senate" },
  range: { from: "2025-01-03", to: "2026-09-30" },
  nearDays: 14,
  trades: [
    { id: "a", symbol: "NVDA", side: "buy", amountLow: 15001, traded: "2025-03-03", filed: "2025-03-20", lag: 17, near: { id: "h" } },
    { id: "b", symbol: "AAPL", side: "sell", amountLow: 1001, traded: "2025-06-10", filed: "2025-09-01", lag: 83, near: null },
    { id: "c", symbol: "MSFT", side: "buy", amountLow: 50001, traded: "2026-02-02", filed: "2026-02-20", lag: 18, near: null }
  ],
  committees: [{ id: "SSFI", hearings: [] }],
  proximity: { dayShare: 0.5, baseline: 0.31 },
  asOf: "2026-09-30T12:00:00Z"
};

test("memberSlug folds accents and punctuation", () => {
  assert.equal(memberSlug("Cory A. Booker"), "cory-a-booker");
  assert.equal(memberSlug("Gilbert Ray Cisneros, Jr."), "gilbert-ray-cisneros-jr");
  assert.equal(memberSlug("Nydia M. Velázquez"), "nydia-m-velazquez");
});

test("summarize counts trades, late filings, median lag, and proximity", () => {
  const s = summarize(timeline);
  assert.equal(s.trades, 3);
  assert.equal(s.buys, 2);
  assert.equal(s.sells, 1);
  assert.equal(s.late, 1);
  assert.equal(s.medianLag, 18);
  assert.equal(s.seat, "D-NJ");
  assert.equal(s.title, "Sen.");
  assert.equal(s.dayShare, 0.5);
  assert.equal(s.asOf, "2026-09-30");
  assert.equal(summarize({ ok: false }), null);
});

test("describe states facts with the proximity caveat and no returns when absent", () => {
  const text = describe(summarize(timeline));
  assert.match(text, /^Sen\. Cory A\. Booker \(D-NJ\): 3 disclosed trades since Mar 3, 2025/);
  assert.match(text, /50% of trade days within 14 days of a hearing on their committees vs 31% of all days/);
  assert.match(text, /median filing lag 18d · 1 filed more than 45 days late/);
  assert.match(text, /Calendar proximity only\.$/);
  assert.doesNotMatch(text, /S&P/);
  const withReturns = describe(summarize({ ...timeline, returns: { buys: 2, priced: 2, excessSince: 0.034, hitRate: 0.5 } }));
  assert.match(withReturns, /disclosed buys \+3\.4 pts vs S&P 500 since trade \(equal-weighted\)/);
});

test("cardSvg is a 1200×630 SVG with the required labels, escaped", () => {
  const svg = cardSvg(summarize({ ...timeline, member: { ...timeline.member, name: "A & B <C>" } }), { host: "example.org/x" });
  assert.match(svg, /^<svg [^>]*width="1200" height="630"/);
  assert.match(svg, /A &amp; B &lt;C&gt;/);
  assert.match(svg, /Calendar proximity only/);
  assert.match(svg, /as of 2026-09-30/);
  assert.match(svg, /TRADESIMPLE INTEL/);
  assert.equal((svg.match(/<circle /g) || []).length, 3);
});

test("memberPageHtml carries absolute OG/Twitter meta and redirects into the timeline", () => {
  const s = summarize(timeline);
  const html = memberPageHtml(s, { pageUrl: "https://x.io/app/m/cory-a-booker/", imageUrl: "https://x.io/app/m/cory-a-booker/card.png", appPath: "../../" });
  assert.match(html, /<meta property="og:image" content="https:\/\/x\.io\/app\/m\/cory-a-booker\/card\.png" \/>/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(html, /<meta property="og:url" content="https:\/\/x\.io\/app\/m\/cory-a-booker\/" \/>/);
  assert.match(html, /url=\.\.\/\.\.\/#timeline\/B001288/);
  assert.match(html, /location\.replace\("\.\.\/\.\.\/#timeline\/B001288"\)/);
});
