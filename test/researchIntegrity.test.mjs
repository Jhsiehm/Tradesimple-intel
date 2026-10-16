import { test } from "node:test";
import assert from "node:assert/strict";
import { auditSignals } from "../server/domain/research-integrity.mjs";
const base = { id: "a", symbol: "AAPL", tradeDate: "2025-01-02", signalDate: "2025-01-06" };
const options = { source: "contracts", now: "2025-02-01T12:00:00Z" };
test("timing audit excludes invalid, reversed and future records without losing reasons", () => {
  const result = auditSignals(
    [
      base,
      { ...base, id: "bad", signalDate: "2025-02-30" },
      { ...base, id: "reverse", signalDate: "2025-01-01" },
      { ...base, id: "future", signalDate: "2025-03-01" },
      { ...base, id: "missing", tradeDate: null },
    ],
    options,
  );
  assert.deepEqual(result.signals, [base]);
  assert.deepEqual(
    result.report.exclusions.map((e) => e.reason),
    ["invalid-availability", "availability-before-event", "future-availability", "invalid-event-time"],
  );
  assert.equal(result.report.timing["assumed-publication-lag"], 1);
  assert.equal(result.report.received, result.report.accepted + result.report.excluded);
});
test("timing labels distinguish imported assertions from source dates without claiming verification", () => {
  const result = auditSignals([base, { ...base, availabilityBasis: "importer-asserted; not independently verified" }], {
    ...options,
    source: "form4",
  });
  assert.equal(result.report.timing["source-derived-public-date"], 1);
  assert.equal(result.report.timing["importer-asserted; not independently verified"], 1);
  assert.equal(result.report.publicationVerification, "not-certified");
  assert.equal(result.report.historicalIdentity, "current-registry-only");
});
