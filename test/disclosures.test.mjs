import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeDisclosures, publicDateOf, transactionKey } from "../shared/disclosures.mjs";

const ORIG = "https://efdsearch.senate.gov/search/view/ptr/aaa/";
const AMEND = "https://efdsearch.senate.gov/search/view/ptr/bbb/";

function row(over = {}) {
  return {
    id: "s-aaa-0", chamber: "senate", person: "Sam Senator", bioguide: "S000001", symbol: "LMT", asset: "Lockheed Martin",
    owner: "Self", side: "buy", type: "Purchase", amount: "$1,001 - $15,000", amountLow: 1001,
    traded: "2025-03-03", filed: "2025-03-20", amended: null, amendment: null, lag: 17, link: ORIG, ...over
  };
}
const amend = (over = {}) => row({ id: "s-bbb-0", link: AMEND, amended: "2025-06-01", amendment: 1, ...over });

test("original only: rows pass through with public = filing date", () => {
  const { items, stats } = dedupeDisclosures([row(), row({ id: "s-aaa-1", symbol: "AAPL" })]);
  assert.equal(items.length, 2);
  assert.equal(items[0].public, "2025-03-20");
  assert.equal(items[0].alsoIn, undefined);
  assert.equal(stats.merged, 0);
});

test("amendment only: public on the amendment date, filing lag unchanged", () => {
  const { items } = dedupeDisclosures([amend()]);
  assert.equal(items.length, 1);
  assert.equal(items[0].public, "2025-06-01");
  assert.equal(items[0].filed, "2025-03-20");
  assert.equal(items[0].lag, 17);
});

test("in both, identical: counted once, public at the original filing", () => {
  const { items, stats } = dedupeDisclosures([row(), row({ id: "s-aaa-1", symbol: "AAPL" }), amend(), amend({ id: "s-bbb-1", symbol: "AAPL" })]);
  assert.equal(items.length, 2);
  const lmt = items.find((r) => r.symbol === "LMT");
  assert.equal(lmt.id, "s-aaa-0");
  assert.equal(lmt.public, "2025-03-20");
  assert.equal(lmt.filed, "2025-03-20");
  assert.equal(lmt.amended, "2025-06-01", "the amendment date stays visible");
  assert.equal(lmt.revised, undefined);
  assert.deepEqual(lmt.alsoIn, ["s-bbb-0"]);
  assert.deepEqual(stats, { rows: 4, transactions: 2, merged: 2, revised: 0, byChamber: { senate: 2 } });
});

test("in both, changed: amended values win, public stays at the original filing, change noted", () => {
  const { items, stats } = dedupeDisclosures([
    row({ side: "sell", type: "Sale (Full)", amount: "$15,001 - $50,000", amountLow: 15001 }),
    amend({ side: "sell", type: "Sale (Partial)", amount: "$1,001 - $15,000", amountLow: 1001 })
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "Sale (Partial)");
  assert.equal(items[0].amount, "$1,001 - $15,000");
  assert.equal(items[0].public, "2025-03-20");
  assert.deepEqual(items[0].revised, ["type", "amount", "amountLow"]);
  assert.equal(stats.revised, 1);
});

test("an amendment changing the side or trade date is a different trade, not a revision", () => {
  const { items } = dedupeDisclosures([row(), amend({ traded: "2025-03-04" })]);
  assert.equal(items.length, 2);
  assert.equal(dedupeDisclosures([row(), amend({ side: "sell", type: "Sale" })]).items.length, 2);
  assert.equal(items.find((r) => r.traded === "2025-03-04").public, "2025-06-01");
});

test("an amendment of a report filed a day off (title date vs filing date) still folds", () => {
  const { items } = dedupeDisclosures([row({ filed: "2025-03-05" }), amend({ filed: "2025-03-06", type: "Purchase (Partial)" })]);
  assert.equal(items.length, 1);
  assert.equal(items[0].public, "2025-03-05");
});

test("identical lines inside one report stay separate; a second report repeating them folds pairwise", () => {
  const h = (doc, i, filed) => row({ id: `h-${doc}-${i}`, chamber: "house", link: `https://clerk/${doc}.pdf`, filed, lag: null });
  const { items, stats } = dedupeDisclosures([h("1", 0, "2026-06-18"), h("1", 1, "2026-06-18"), h("2", 0, "2026-07-15"), h("2", 1, "2026-07-15"), h("2", 2, "2026-07-15")]);
  assert.equal(items.length, 3, "two from the first report, one extra from the second");
  assert.deepEqual(items.map((r) => r.public), ["2026-06-18", "2026-06-18", "2026-07-15"]);
  assert.deepEqual(stats.byChamber, { house: 2 });
});

test("different members or owners never fold", () => {
  const { items } = dedupeDisclosures([row(), amend({ bioguide: "S000002" }), amend({ id: "s-bbb-1", owner: "Spouse" })]);
  assert.equal(items.length, 3);
  assert.notEqual(transactionKey(row()), transactionKey(row({ owner: "Spouse" })));
});

test("publicDateOf takes the later amendment date only", () => {
  assert.equal(publicDateOf({ filed: "2025-03-20", amended: "2025-03-01" }), "2025-03-20");
  assert.equal(publicDateOf({ filed: "2025-03-20", amended: null }), "2025-03-20");
  assert.equal(publicDateOf({ filed: "2025-03-20", amended: "2025-04-01" }), "2025-04-01");
});
