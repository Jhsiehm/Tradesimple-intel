import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { openDb } from "../server/lib/db.mjs";
import { putRun, saveExperiment, hashOf } from "../server/domain/research-store.mjs";
import { ENGINE } from "../server/domain/research-replay.mjs";
import { auditSignals, INTEGRITY_VERSION } from "../server/domain/research-integrity.mjs";
import {
  createPaperAccount,
  getPaperAccount,
  recordPaperAction,
  verifyPaperLedger,
} from "../server/domain/paper-ledger.mjs";
import {
  createResearchBackup,
  verifyResearchBackup,
  restoreResearchBackup,
} from "../server/domain/research-backup.mjs";
import { router } from "../server/routes/index.mjs";
const root = decodeURIComponent(new URL("..", import.meta.url).pathname);
function open(file = ":memory:") {
  const prior = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = file;
  try {
    return openDb(root);
  } finally {
    if (prior === undefined) delete process.env.INTEL_CACHE;
    else process.env.INTEL_CACHE = prior;
  }
}
function fixture(db) {
  const signals = [{ id: "fixture", symbol: "AAPL", side: "buy", signalDate: "2025-01-02", tradeDate: "2025-01-01" }];
  const experiment = saveExperiment(db, {
    title: "Paper source",
    runId: putRun(db, {
      engine: ENGINE,
      inputs: { signals, bars: {}, benchBars: {} },
      result: { ok: true, integrityVersion: INTEGRITY_VERSION, spec: { source: "congress" } },
      provenance: { matchedSignals: signals, integrity: auditSignals(signals, { source: "congress" }).report },
    }),
  });
  return {
    title: "Manual paper",
    experimentId: experiment.id,
    initialCashCents: 100000,
    maxOrderCents: 50000,
    maxPositionShares: 10,
  };
}
const fill = (sequence, id, patch = {}) => ({
  kind: "fill",
  requestId: id,
  expectedSequence: sequence,
  symbol: "AAPL",
  side: "buy",
  quantity: 2,
  priceCents: 10000,
  feeCents: 10,
  priceBasis: "Synthetic assumed price",
  approvalReason: "Manual test approval",
  ...patch,
});
test("manual paper fills reconcile cash and shares with immutable approved evidence", () => {
  const db = open();
  try {
    const created = createPaperAccount(db, fixture(db)),
      id = created.account.id;
    const bought = recordPaperAction(db, id, fill(0, "buy"));
    assert.equal(bought.state.cashCents, 79990);
    assert.deepEqual(bought.state.positions, { AAPL: 2 });
    const sold = recordPaperAction(db, id, fill(1, "sell", { side: "sell", quantity: 1, priceCents: 11000 }));
    assert.equal(sold.state.cashCents, 90980);
    assert.equal(sold.state.feesCents, 20);
    assert.equal(sold.state.positions.AAPL, 1);
    assert.equal(sold.events[0].action.approvalReason, "Manual test approval");
    assert.deepEqual(verifyPaperLedger(sold.account, sold.events), sold.state);
    assert.throws(() => db.prepare("UPDATE research.paper_events SET body=?").run("{}"), /immutable/);
    assert.throws(() => db.prepare("DELETE FROM research.paper_accounts").run(), /immutable/);
  } finally {
    db.close();
  }
});
test("paper limits, no shorts and explicit approvals fail without changing balances", () => {
  const db = open();
  try {
    const created = createPaperAccount(db, fixture(db)),
      id = created.account.id;
    for (const patch of [
      { approvalReason: "" },
      { priceBasis: "" },
      { priceCents: 1.5 },
      { quantity: 1.5 },
      { quantity: 6 },
      { side: "sell" },
      { quantity: 11, priceCents: 1 },
      { symbol: "BAD/PAIR" },
    ])
      assert.throws(() => recordPaperAction(db, id, fill(0, "bad", patch)));
    assert.deepEqual(getPaperAccount(db, id), created);
    const small = createPaperAccount(db, { ...fixture(db), initialCashCents: 100, maxOrderCents: 100 });
    recordPaperAction(db, small.account.id, fill(0, "first", { quantity: 1, priceCents: 90, feeCents: 0 }));
    assert.throws(
      () => recordPaperAction(db, small.account.id, fill(1, "next", { quantity: 1, priceCents: 20, feeCents: 0 })),
      /Insufficient/,
    );
  } finally {
    db.close();
  }
});
test("halt blocks fills, explicit resume restores operation and retries cannot duplicate fills", () => {
  const db = open();
  try {
    const { account } = createPaperAccount(db, fixture(db)),
      id = account.id;
    recordPaperAction(db, id, fill(0, "buy"));
    recordPaperAction(db, id, { kind: "halt", requestId: "stop", expectedSequence: 1, reason: "Review risk" });
    assert.throws(() => recordPaperAction(db, id, fill(2, "blocked")), /halted/);
    const retry = recordPaperAction(db, id, fill(0, "buy"));
    assert.equal(retry.state.fills, 1);
    assert.equal(retry.state.halted, true);
    assert.throws(() => recordPaperAction(db, id, fill(0, "buy", { quantity: 1 })), /different instructions/);
    recordPaperAction(db, id, { kind: "resume", requestId: "resume", expectedSequence: 2, reason: "Review complete" });
    assert.equal(recordPaperAction(db, id, fill(3, "new")).state.fills, 2);
  } finally {
    db.close();
  }
});
test("stale writers fail and paper history survives reopen and validated backup", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-paper-"));
  let db, other, restored;
  try {
    const file = path.join(dir, "cache.sqlite");
    db = open(file);
    const created = createPaperAccount(db, fixture(db)),
      id = created.account.id;
    other = open(file);
    getPaperAccount(other, id);
    recordPaperAction(db, id, fill(0, "first"));
    assert.throws(() => recordPaperAction(other, id, fill(0, "stale")), /changed/);
    other.close();
    other = null;
    db.close();
    db = open(file);
    const ledger = getPaperAccount(db, id);
    assert.equal(ledger.state.fills, 1);
    createResearchBackup(path.join(dir, "research.sqlite"), path.join(dir, "backup"));
    assert.equal(verifyResearchBackup(path.join(dir, "backup")).counts.paper_events, 1);
    fs.mkdirSync(path.join(dir, "restored"));
    restoreResearchBackup(path.join(dir, "backup"), path.join(dir, "restored", "research.sqlite"));
    restored = open(path.join(dir, "restored", "cache.sqlite"));
    assert.deepEqual(getPaperAccount(restored, id), ledger);
    assert.equal(recordPaperAction(restored, id, fill(0, "first")).state.fills, 1);
    assert.equal(recordPaperAction(restored, id, fill(1, "restored-fill")).state.fills, 2);
    const changed = structuredClone(ledger.events);
    changed[0].action.quantity = 999;
    assert.throws(() => verifyPaperLedger(ledger.account, changed), /limit/);
    changed[0].previousHash = "bad";
    assert.throws(() => verifyPaperLedger(ledger.account, changed), /chain/);
  } finally {
    restored?.close();
    other?.close();
    db?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("paper routes enforce origin and methods and export the complete ledger", async () => {
  const db = open(),
    routes = router(),
    server = http.createServer((req, res) => routes.handle(req, res, { db, root }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`,
      request = fixture(db),
      call = (url, body, origin = "http://127.0.0.1:5173") =>
        fetch(base + url, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
    assert.equal((await call("/api/research/paper", request, "https://evil.example")).status, 403);
    const response = await call("/api/research/paper", request);
    assert.equal(response.status, 200);
    const { ledger } = await response.json(),
      url = `/api/research/paper/${ledger.account.id}`;
    assert.equal((await fetch(base + url + "/actions")).status, 405);
    assert.equal((await call(url + "/actions", fill(0, "http"))).status, 200);
    const exported = await fetch(base + url + "/export");
    assert.match(exported.headers.get("content-disposition"), /attachment/);
    const data = await exported.json();
    assert.equal(data.events.length, 1);
    assert.deepEqual(verifyPaperLedger(data.account, data.events), data.state);
    assert.equal(data.state.head, hashOf(data.events[0]));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
