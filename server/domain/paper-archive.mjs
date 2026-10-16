import { readFileSync } from "node:fs";
import { getPaperAccount } from "./paper-ledger.mjs";
import { getExperiment, getRun, hashOf } from "./research-store.mjs";
import { exportRunFiles } from "./research-replay.mjs";
import { zipFiles } from "../../shared/replicate.mjs";
export function exportPaperArchive(db, id) {
  const ledger = getPaperAccount(db, id),
    source = getRun(db, ledger.account.sourceRunId),
    experiment = getExperiment(db, ledger.account.experimentId);
  if (!source || source.inputHash !== ledger.account.sourceInputHash || experiment?.runId !== source.id)
    throw Error("Paper source experiment differs from its pinned reference.");
  const files = [];
  let bytes = 0;
  const add = (name, text) => {
    bytes += Buffer.byteLength(text);
    if (bytes > 100 * 1024 * 1024) throw Error("Paper archive exceeds the 100 MiB evidence limit.");
    files.push({ name, text });
  };
  const { run: sourceRun, ...sourceExperiment } = experiment;
  add("source-experiment.json", JSON.stringify(sourceExperiment, null, 2));
  add("paper.json", JSON.stringify({ schemaVersion: 1, ledgerHash: hashOf(ledger), ledger }, null, 2));
  add("paper-engine.mjs", readFileSync(new URL("./paper-engine.mjs", import.meta.url), "utf8"));
  add("verify.mjs", readFileSync(new URL("./paper-verifier.mjs", import.meta.url), "utf8"));
  add(
    "README.txt",
    "TradeSimple Intel portable manual paper account\nExtract and run: node verify.mjs\nRequires Node 22.13+; no packages, app, database, credentials or network.\n\nVerification recomputes cash, shares, fees, risk limits and halt state from every event, verifies the hash chain and pinned source inputs, and replays the original source experiment with its bundled engine. The archive is a snapshot at export time; later fills or controls are not included.\n\nThis verifies internal consistency and reproducibility, not actor identity, independently observed prices, market execution, source truth, investment merit or broker reconciliation. No current account state or permission is implied. Prices remain operator assertions. Checksums do not protect against replacement of the whole archive and its verifier.\n",
  );
  for (const file of exportRunFiles(db, source)) add(`source/${file.name}`, file.text);
  add("checksums.json", JSON.stringify(Object.fromEntries(files.map((f) => [f.name, hashOf(f.text)])), null, 2));
  return zipFiles(files);
}
