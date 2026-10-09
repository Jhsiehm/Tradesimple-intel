import { test } from "node:test";
import assert from "node:assert/strict";
import { KEY } from "../server/lib/cacheKeys.mjs";

test("cache keys keep the strings already stored in data/cache.sqlite", () => {
  assert.equal(KEY.posCongress, "pos:congress:v4");
  assert.equal(KEY.chart("AAPL", "1d"), "chart:v3:AAPL:1d");
  assert.equal(KEY.lda("Lockheed Martin"), "lda:lockheed martin");
  assert.equal(KEY.ldaYear("Boeing", 2025), "lda:v2:boeing:2025");
  assert.equal(KEY.fecCommittees(2026, ["C1", "C2"]), "fec:cmte:v1:2026:C1,C2");
  assert.equal(KEY.usaFeed(["x", null, 30, "recent"]), 'usa:feed:v1:["x",null,30,"recent"]');
  assert.equal(KEY.senateVoteMenu(1), "senate:vote-menu-119-1");
  assert.equal(KEY.econDay("2026-01-02"), `${KEY.econDayPrefix}2026-01-02`);
});

test("every cache key is versioned or parameterized", () => {
  const flat = Object.entries(KEY).filter(([, v]) => typeof v === "string" && !v.endsWith(":"));
  for (const [name, value] of flat) assert.match(value, /:v\d+$/, `${name} = ${value}`);
});
