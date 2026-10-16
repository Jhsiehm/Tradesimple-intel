import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { hazards, forecast, normalizeQuakes, normalizeDisasters, normalizeForecast } from "../server/weather.mjs";
import { KEY } from "../server/lib/cacheKeys.mjs";
import { inRegion } from "../src/weather/model.ts";
import { NAV_REGIONS } from "../shared/navRegions.mjs";
const db = () => {
  const d = new DatabaseSync(":memory:");
  d.exec(
    "CREATE TABLE cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, stored_at INTEGER NOT NULL, ttl_ms INTEGER NOT NULL)",
  );
  return d;
};
const feature = (properties, coordinates = [10, 20]) => ({
  id: "x",
  properties,
  geometry: { type: "Point", coordinates },
});
const met = (series) => ({ properties: { meta: { updated_at: "2026-10-14T00:00:00Z" }, timeseries: series } });
const period = (hour, rain, span = 1) => ({
  time: `2026-10-${hour < 24 ? "14" : "15"}T${String(hour % 24).padStart(2, "0")}:00:00Z`,
  data: {
    instant: { details: { air_temperature: 20 + hour, wind_speed: null } },
    [`next_${span}_hours`]: { details: { precipitation_amount: rain }, summary: { symbol_code: "rain_day" } },
  },
});

test("normalizes only valid earthquake points; no PAGER level remains unrated", () => {
  const p = { type: "earthquake", mag: 4.2, time: 1791936000000, url: "javascript:alert(1)", alert: null };
  const rows = normalizeQuakes({
    metadata: { status: 200 },
    features: [feature(p), feature(p, [181, 20]), feature({ ...p, mag: null }), feature({ ...p, time: null })],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].level, "unrated");
  assert.equal(rows[0].url, "");
});
test("GDACS excludes superseded, inactive and duplicate earthquake reports", () => {
  const p = {
    eventid: 1,
    eventtype: "DR",
    iscurrent: "true",
    datemodified: "2026-10-14T10:00:00",
    alertlevel: "Orange",
    url: { report: "https://www.gdacs.org/report.aspx?eventid=1" },
  };
  const rows = normalizeDisasters({
    features: [
      feature(p),
      feature({ ...p, datemodified: "2026-10-14T12:00:00" }),
      feature({ ...p, eventtype: "EQ" }),
      feature({ ...p, eventid: 2, iscurrent: "false" }),
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].updated, "2026-10-14T12:00:00.000Z");
  assert.equal(rows[0].level, "orange");
});
test("forecast rain does not double count overlapping periods or turn missing values into zero", () => {
  const out = normalizeForecast(
    met([period(22, 6, 6), period(23, 1), period(24, null), period(25, 1)]),
    0,
    0,
    Date.parse("2026-10-14T22:00:00Z"),
  );
  assert.equal(out.days[0].rain, 2);
  assert.equal(out.days[0].rainHours, 2);
  assert.equal(out.days[1].rain, 4);
  assert.equal(out.days[1].rainHours, 4);
  assert.equal(out.current.wind, null);
  assert.equal(out.change24h, null);
  const missing = normalizeForecast(met([period(22, null)]), 0, 0, Date.parse("2026-10-14T22:00:00Z"));
  assert.equal(missing.current.rain, null);
  assert.equal(missing.days[0].rainHours, 0);
});
test("forecast rejects expired model periods", () => {
  assert.throws(() => normalizeForecast(met([period(1, 0)]), 0, 0, Date.parse("2026-10-20T00:00:00Z")), /No current/);
});
test("weather region filter handles Oceania date line and polar bounds", () => {
  const region = NAV_REGIONS.find((r) => r.id === "oceania");
  assert.equal(inRegion({ lat: -14, lon: -172 }, region), true);
  assert.equal(inRegion({ lat: -14, lon: -20 }, region), false);
  assert.equal(
    inRegion(
      { lat: -80, lon: 0 },
      NAV_REGIONS.find((r) => r.id === "antarctica"),
    ),
    true,
  );
});
test("invalid coordinates do not fetch; failures are cached and identified separately", async () => {
  const d = db();
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("offline");
  };
  try {
    assert.equal((await forecast(d, "", "0")).ok, false);
    assert.equal((await forecast(d, "91", "0")).ok, false);
    assert.equal(calls, 0);
    const [a, b] = await Promise.all([hazards(d), hazards(d)]);
    assert.equal(calls, 3);
    assert.equal(a.ok, false);
    assert.equal(b.feeds[0].state, "unavailable");
    await hazards(d);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = old;
    d.close();
  }
});
test("upstream failure retains stale reports with original timestamps", async () => {
  const d = db();
  const old = globalThis.fetch;
  d.prepare("INSERT INTO cache VALUES (?,?,?,?)").run(
    KEY.weatherQuakes,
    JSON.stringify({ items: [{ id: "old" }], fetchedAt: "2026-10-01T00:00:00Z" }),
    0,
    1,
  );
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  try {
    const a = await hazards(d);
    assert.equal(a.ok, true);
    assert.equal(a.feeds[0].state, "stale");
    assert.equal(a.feeds[0].items[0].id, "old");
    assert.equal(a.feeds[0].fetchedAt, "2026-10-01T00:00:00Z");
  } finally {
    globalThis.fetch = old;
    d.close();
  }
});
test("forecast honors Expires and sends conditional revalidation after cache expiry", async () => {
  const d = db();
  const old = globalThis.fetch;
  const now = Date.now();
  const raw = met([period(22, 0)]);
  raw.properties.meta.updated_at = new Date(now).toISOString();
  raw.properties.timeseries[0].time = new Date(now).toISOString();
  let calls = 0;
  globalThis.fetch = async (_url, opts) => {
    calls++;
    if (calls === 1)
      return new Response(JSON.stringify(raw), {
        headers: { expires: new Date(now + 2 * 3600_000).toUTCString(), "last-modified": new Date(now).toUTCString() },
      });
    assert.equal(opts.headers["If-Modified-Since"], new Date(now).toUTCString());
    return new Response(null, { status: 304 });
  };
  try {
    assert.equal((await forecast(d, 29.76, -95.37)).state, "ok");
    const row = d.prepare("SELECT ttl_ms FROM cache WHERE key=?").get(KEY.weatherPoint(29.76, -95.37));
    assert.ok(row.ttl_ms > 3600_000);
    await forecast(d, 29.76, -95.37);
    assert.equal(calls, 1);
    d.prepare("UPDATE cache SET stored_at=0").run();
    assert.equal((await forecast(d, 29.76, -95.37)).ok, true);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = old;
    d.close();
  }
});

test("overlapping hazard feeds keep the newest report and matching source status", async () => {
  const { latestHazards } = await import("../src/weather/model.ts");
  const newer = { id: "gdacs:DR:1", updated: "2026-10-14T12:00:00Z", title: "Updated drought" };
  const older = { ...newer, updated: "2026-10-12T12:00:00Z", title: "Old drought" };
  const fresh = { id: "slow", state: "ok", items: [newer] };
  const stale = { id: "recent", state: "stale", items: [older] };
  for (const feeds of [
    [fresh, stale],
    [stale, fresh],
  ]) {
    const [entry] = latestHazards(feeds);
    assert.equal(entry.hazard.title, "Updated drought");
    assert.equal(entry.feed.id, "slow");
  }
  assert.equal(latestHazards([{ ...stale, items: [newer] }, fresh])[0].feed.state, "ok");
});
