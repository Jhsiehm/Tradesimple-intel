import { hashOf, putDataset, putRun, saveExperiment } from "../../server/domain/research-store.mjs";

const engine = { files: { "fixture.mjs": "fixture" } };
engine.id = hashOf(engine.files);
export function studyAuditFixture(
  db,
  {
    name = "Procurement A",
    partial = false,
    cooldown = 7,
    from = "2025-01-14",
    dataset = null,
    inputRef = null,
    resultPatch = {},
    symbols = ["AAA"],
  } = {},
) {
  const rawContent = "[]";
  dataset ||= putDataset(
    db,
    name,
    {
      sourceFamily: "procurement",
      source: "Frozen government contracts",
      rawContent,
      rawHash: hashOf(rawContent),
      coverage: { received: partial ? 2799 : 204, valid: partial ? 2799 : 204, rejected: 0 },
      manifest: {
        coverage: {
          partitions: 1,
          completed: partial ? 0 : 1,
          received: partial ? 2804 : 204,
          versions: partial ? 2799 : 204,
          ambiguousVersions: partial ? 44 : 0,
          historicalOwnership: "unverified",
        },
        policy: { mode: "assumed", defenseDays: 90, civilianDays: 7 },
        cooldownDays: cooldown,
        scope: {
          symbols,
          actionFrom: "2025-01-01",
          actionTo: "2025-01-31",
          publicFrom: "2025-01-01",
          publicTo: "2025-06-30",
        },
        dropped: partial
          ? { nonPositiveObligation: 589, ambiguousIdentity: 44, cooldown: 2163 }
          : { nonPositiveObligation: 65, cooldown: 130 },
      },
    },
    hashOf(name),
  );
  const runId = putRun(db, {
    inputs: {
      rules: {
        entry: "nextOpen",
        holdDays: 30,
        stopLossPct: null,
        takeProfitPct: null,
        sides: "buy",
        sizing: "equal",
        benchmark: "SPY",
        costBps: 5,
        slippageBps: 5,
        openTrades: "exclude",
      },
    },
    provenance: {
      dataset: inputRef || { id: dataset.id, version: dataset.version, contentHash: dataset.contentHash },
      dropped: { invalidAvailability: 0 },
    },
    engine,
    result: {
      ok: true,
      stats: {
        total: 0.0829,
        benchmarkTotal: 0.0691,
        excessTotal: 0.0138,
        from,
        to: "2025-06-02",
        trades: partial ? 3 : 9,
      },
      counts: { signals: partial ? 3 : 9, used: partial ? 3 : 9, skipped: 0, tickers: 1, priced: 1 },
      caveats: { items: [{ text: "5 signals were filed after the 45-day deadline under the STOCK Act." }] },
      ...resultPatch,
    },
  });
  return { dataset, experiment: saveExperiment(db, { runId, title: name }) };
}
