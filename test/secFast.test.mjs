import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeSecFast, SWEEP_MS, withSecFast } from "../server/domain/live/secFast.mjs";
import { parseForm4 } from "../server/parsers/form4.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (f) => fs.readFileSync(path.join(dir, f), "latin1");
const ATOM = { "4": read("edgar-current-4.atom"), "8-K": read("edgar-current-8k.atom"), "SCHEDULE 13D": "<feed></feed>", "SCHEDULE 13G": read("edgar-current-13g.atom") };
const TICKERS = { PRTA: { symbol: "PRTA", cik: "0001559053" }, ATO: { symbol: "ATO", cik: "0000731802" }, UHS: { symbol: "UHS", cik: "0000352915" }, NOPE: { symbol: "NOPE", cik: "" } };

function fakes({ atom = (type) => ATOM[type], seen = new Set() } = {}) {
  const calls = { atom: [], headers: [], form4: [] };
  const f4 = parseForm4(read("form4-0000002488-26-000165.xml"));
  const deps = {
    atom: async (type, opts) => { calls.atom.push([type, opts.start]); return atom(type, opts); },
    headers: async (cik, acc) => { calls.headers.push(acc); return "<PERIOD>20261007\n"; },
    tickerOf: (_db, s) => TICKERS[s] || null,
    readForm4: async (_db, cik, pick) => { calls.form4.push([cik, pick.doc]); return { ...f4, issuerCik: String(Number(cik)) }; },
    seen: (_db, id) => seen.has(id),
    now: () => Date.parse("2026-10-09T14:31:00Z")
  };
  return { deps, calls };
}

test("fast scan: fetches only matching filings and emits the shared event shapes with the acceptance time", async () => {
  const { deps, calls } = fakes();
  const scan = makeSecFast(deps);
  const res = await scan({ db: null, symbols: ["PRTA", "ATO", "UHS", "NOPE"], state: {} });
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.ok, ["PRTA", "ATO", "UHS", "NOPE"]);
  assert.deepEqual(calls.atom.map((c) => c[0]), ["4", "8-K", "SCHEDULE 13D", "SCHEDULE 13G"], "one page each on the first poll");
  assert.deepEqual(calls.form4, [["0001559053", "0001045463-26-000020.txt"]], "one Form 4 read, by full-submission text");
  const f4 = res.events.find((e) => e.source === "insiders");
  assert.equal(f4.id, "f4:PRTA:0001045463-26-000020");
  assert.equal(f4.publishedAt, "2026-10-09T13:43:09.000Z");
  const k = res.events.find((e) => e.source === "filings");
  assert.equal(k.id, "8k:0001193125-26-418579");
  assert.equal(k.symbol, "ATO");
  assert.equal(k.eventAt, "2026-10-07");
  assert.equal(k.publishedAt, "2026-10-09T13:10:06.000Z");
  const g = res.events.find((e) => e.source === "stakes");
  assert.equal(g.id, "stake:0000354204-26-001051");
  assert.match(g.title, /DIMENSIONAL FUND ADVISORS LP · 13G/);
  assert.equal(g.activist, false);
  assert.equal(res.sweep, true, "first poll asks for an issuer sweep");
  assert.match(res.note, /NOPE: no SEC CIK/);
  assert.equal(res.state.stats.n, 0, "the first poll has no baseline, so no latency samples");
  assert.ok(res.state.since.form4 > 0);
});

test("fast scan: second poll samples latency on new filings, skips seen ones, no sweep until due", async () => {
  const seen = new Set(["f4:PRTA:0001045463-26-000020", "8k:0001193125-26-418579", "stake:0000354204-26-001051"]);
  const { deps, calls } = fakes({ seen });
  const scan = makeSecFast(deps);
  const since = { form4: Date.parse("2026-10-09T13:40:00Z"), "8k": Date.parse("2026-10-09T13:00:00Z"), "13d": 0, "13g": Date.parse("2026-10-09T14:00:00Z") };
  const res = await scan({ db: null, symbols: ["PRTA", "ATO", "UHS"], state: { since, sweptAt: deps.now() - 60_000 } });
  assert.equal(res.events.length, 0);
  assert.equal(calls.form4.length, 0);
  assert.equal(calls.headers.length, 0);
  assert.equal(res.sweep, false);
  // New since the watermarks: 2 Form 4s (13:43:09, 14:00:24), 6 8-Ks (13:03:54 … 13:50:45), 2 13Gs (14:00:54, 14:18:13).
  assert.equal(res.state.stats.n, 10);
  assert.equal(res.state.stats.maxMs, Date.parse("2026-10-09T14:31:00Z") - Date.parse("2026-10-09T13:03:54Z"));
  assert.match(res.note, /detected a median/);
});

test("fast scan: 403 stops the pass, primes nothing and never triggers a sweep", async () => {
  const err = Object.assign(new Error("HTTP 403"), { status: 403 });
  const { deps, calls } = fakes({ atom: () => { throw err; } });
  const res = await makeSecFast(deps)({ db: null, symbols: ["PRTA"], state: {} });
  assert.equal(calls.atom.length, 1);
  assert.deepEqual(res.ok, []);
  assert.equal(res.errors[0].status, 403);
  assert.equal(res.sweep, false);
});

test("fast scan pages back when the newest page does not reach the last poll", async () => {
  const entry = (i) => `<entry><title>4 - X (0000000001) (Reporting)</title><updated>${new Date(Date.parse("2026-10-09T14:30:00Z") - i * 1000).toISOString()}</updated><category term="4"/><id>urn:tag:sec.gov,2008:accession-number=0000000001-26-${String(i).padStart(6, "0")}</id></entry>`;
  const page = (start) => `<feed>${Array.from({ length: 100 }, (_, i) => entry(start + i)).join("")}</feed>`;
  const { deps, calls } = fakes({ atom: (type, { start }) => (type === "4" ? page(start) : "<feed></feed>") });
  const res = await makeSecFast(deps)({ db: null, symbols: ["PRTA"], state: { since: { form4: Date.parse("2026-10-09T14:00:00Z") }, sweptAt: deps.now() } });
  assert.deepEqual(calls.atom.filter((c) => c[0] === "4").map((c) => c[1]), [0, 100, 200]);
  assert.equal(res.sweep, true, "three full pages newer than the last poll is a gap");
  assert.match(res.note, /issuer sweep runs now/);
});

test("withSecFast: sweep merges in when due; backfill runs the sweep only", async () => {
  let sweeps = 0;
  const sweep = async ({ symbols }) => { sweeps += 1; return { events: [{ id: "8k:old", symbol: symbols[0] }], ok: symbols, errors: [], note: "" }; };
  const fast = async ({ symbols, state }) => ({ events: [{ id: "f4:new", symbol: symbols[0] }], ok: symbols, errors: [], note: "atom", sweep: !state.sweptAt, state: { ...state, since: { form4: 1 } } });
  const check = withSecFast(sweep, fast, () => 42);
  const a = await check({ symbols: ["PRTA"], state: {} });
  assert.deepEqual(a.events.map((e) => e.id), ["f4:new", "8k:old"]);
  assert.equal(a.state.sweptAt, 42);
  const b = await check({ symbols: ["PRTA"], state: a.state });
  assert.deepEqual(b.events.map((e) => e.id), ["f4:new"]);
  assert.equal(sweeps, 1);
  const c = await check({ symbols: ["NEW"], state: a.state, backfill: true });
  assert.equal(sweeps, 2);
  assert.equal(c.state, a.state, "backfill leaves the Atom watermarks alone");
  assert.ok(SWEEP_MS >= 10 * 60_000);
});
