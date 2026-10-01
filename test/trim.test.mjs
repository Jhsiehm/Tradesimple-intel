import { test } from "node:test";
import assert from "node:assert/strict";
import { roundNumber, trimRoute } from "../scripts/trim.mjs";

test("lite trim caps board lists, labels the cut, and keeps links whole", () => {
  const items = Array.from({ length: 3200 }, (_, i) => ({ id: i, link: `https://example.gov/${"x".repeat(400)}` }));
  const out = trimRoute("api_markets_politicians.json", { ok: true, latency: "Up to 45 days.", items }, { mode: "lite" });
  assert.equal(out.items.length, 3000);
  assert.equal(out.demoTrim.items, 200);
  assert.match(out.latency, /^Up to 45 days\. Demo copy: .*200 items rows dropped/);
  assert.equal(out.items[0].link.length, items[0].link.length);
});

test("full trim keeps every list and string, rounding only numbers", () => {
  const items = Array.from({ length: 3200 }, (_, i) => ({ id: i, note: "n".repeat(400), price: 253.627391, tiny: 0.0000123456789, amount: 1234567.891 }));
  const out = trimRoute("api_markets_politicians.json", { ok: true, latency: "Up to 45 days.", items });
  assert.equal(out.items.length, 3200);
  assert.equal(out.items[0].note.length, 400);
  assert.equal(out.items[0].price, 253.6274);
  assert.equal(out.items[0].tiny, 0.0000123457);
  assert.equal(out.items[0].amount, 1234567.891);
  assert.equal(out.items[5].id, 5);
  assert.equal(out.demoTrim, undefined);
  assert.equal(out.latency, "Up to 45 days.");
});

test("roundNumber leaves integers and non-numbers alone", () => {
  assert.equal(roundNumber(1775050200000), 1775050200000);
  assert.equal(roundNumber("253.627391"), "253.627391");
  assert.equal(roundNumber(-74.00597), -74.006);
});

test("lite trim keeps every timeline trade and vote", () => {
  const trades = Array.from({ length: 900 }, (_, i) => ({ id: `t${i}`, asset: "Long name", near: { title: "y".repeat(300), link: "https://x" } }));
  const votes = Array.from({ length: 700 }, (_, i) => ({ id: `v${i}`, question: "q".repeat(200) }));
  const out = trimRoute("api_congress_member_A000001_timeline.json", { ok: true, trades, votes, committees: [] }, { mode: "lite" });
  assert.equal(out.trades.length, 900);
  assert.equal(out.votes.length, 700);
  assert.equal(out.trades[0].asset, undefined);
  assert.ok(out.trades[0].near.title.length <= 100);
  assert.equal(out.demoTrim, undefined);
});

test("trimRoute leaves geometry and vote positions alone", () => {
  const positions = Array.from({ length: 435 }, (_, i) => ({ bioguide: `A${String(i).padStart(6, "0")}` }));
  assert.equal(trimRoute("api_congress_votes_house_119_2_200.json", { ok: true, vote: { positions } }, { mode: "lite" }).vote.positions.length, 435);
  const geo = { type: "FeatureCollection", features: [{ properties: { name: "z".repeat(500) } }] };
  assert.equal(trimRoute("geo_states.geojson.json", geo), geo);
});
