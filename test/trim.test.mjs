import { test } from "node:test";
import assert from "node:assert/strict";
import { trimRoute } from "../scripts/trim.mjs";

test("trimRoute caps board lists, labels the cut, and keeps links whole", () => {
  const items = Array.from({ length: 3200 }, (_, i) => ({ id: i, link: `https://example.gov/${"x".repeat(400)}` }));
  const out = trimRoute("api_markets_politicians.json", { ok: true, latency: "Up to 45 days.", items });
  assert.equal(out.items.length, 3000);
  assert.equal(out.demoTrim.items, 200);
  assert.match(out.latency, /^Up to 45 days\. Demo copy: .*200 items rows dropped/);
  assert.equal(out.items[0].link.length, items[0].link.length);
});

test("trimRoute keeps every timeline trade and vote", () => {
  const trades = Array.from({ length: 900 }, (_, i) => ({ id: `t${i}`, asset: "Long name", near: { title: "y".repeat(300), link: "https://x" } }));
  const votes = Array.from({ length: 700 }, (_, i) => ({ id: `v${i}`, question: "q".repeat(200) }));
  const out = trimRoute("api_congress_member_A000001_timeline.json", { ok: true, trades, votes, committees: [] });
  assert.equal(out.trades.length, 900);
  assert.equal(out.votes.length, 700);
  assert.equal(out.trades[0].asset, undefined);
  assert.ok(out.trades[0].near.title.length <= 100);
  assert.equal(out.demoTrim, undefined);
});

test("trimRoute leaves geometry and vote positions alone", () => {
  const positions = Array.from({ length: 435 }, (_, i) => ({ bioguide: `A${String(i).padStart(6, "0")}` }));
  assert.equal(trimRoute("api_congress_votes_house_119_2_200.json", { ok: true, vote: { positions } }).vote.positions.length, 435);
  const geo = { type: "FeatureCollection", features: [{ properties: { name: "z".repeat(500) } }] };
  assert.equal(trimRoute("geo_states.geojson.json", geo), geo);
});
