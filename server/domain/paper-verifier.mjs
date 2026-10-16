/** Portable verifier: built-in Node modules only; no database or network. */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";
const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const check = (condition, message) => {
  if (!condition) throw Error(message);
};
export async function verifyPaperDirectory(directory) {
  const root = realpathSync(path.resolve(directory));
  const read = (name) => {
    const file = realpathSync(path.join(root, name));
    check(file.startsWith(root + path.sep), "Paper archive file escapes its directory.");
    return readFileSync(file, "utf8");
  };
  const manifest = JSON.parse(read("checksums.json"));
  check(manifest && typeof manifest === "object" && !Array.isArray(manifest), "Invalid paper manifest.");
  const required = [
    "paper.json",
    "source-experiment.json",
    "paper-engine.mjs",
    "verify.mjs",
    "README.txt",
    "source/run.json",
    "source/evidence.json",
    "source/checksums.json",
    "source/replay.mjs",
    "source/README.txt",
    "source/engine/backtest.mjs",
    "source/engine/backtestSpec.mjs",
    "source/engine/backtestStats.mjs",
  ];
  for (const name of required) check(Object.hasOwn(manifest, name), `Missing paper archive file: ${name}`);
  const allowed =
    /^(paper\.json|source-experiment\.json|paper-engine\.mjs|verify\.mjs|README\.txt|source\/(run\.json|evidence\.json|checksums\.json|replay\.mjs|README\.txt|engine\/[A-Za-z0-9_-]+\.mjs))$/;
  for (const [name, digest] of Object.entries(manifest)) {
    check(allowed.test(name), "Unsafe paper archive path.");
    check(hash(read(name)) === digest, `Checksum mismatch: ${name}`);
  }
  const sourceManifest = JSON.parse(read("source/checksums.json"));
  for (const [name, digest] of Object.entries(sourceManifest)) {
    check(
      allowed.test(`source/${name}`) && manifest[`source/${name}`] === digest,
      "Source manifest differs from paper manifest.",
    );
  }
  const bundle = JSON.parse(read("paper.json"));
  check(
    bundle?.schemaVersion === 1 && bundle.ledgerHash === hash(bundle.ledger),
    "Paper ledger payload checksum mismatch.",
  );
  const { account, events, state } = bundle.ledger;
  const { verifyPaperLedger } = await import(pathToFileURL(path.join(root, "paper-engine.mjs")).href);
  const computed = verifyPaperLedger(account, events);
  check(hash(computed) === hash(state), "Paper balances or head differ from replayed events.");
  const experiment = JSON.parse(read("source-experiment.json"));
  check(
    experiment.id === account.experimentId && experiment.runId === account.sourceRunId,
    "Paper experiment reference mismatch.",
  );
  const source = JSON.parse(read("source/run.json"));
  check(
    source.id === account.sourceRunId &&
      source.inputHash === account.sourceInputHash &&
      hash(source.inputs) === account.sourceInputHash,
    "Paper source input reference mismatch.",
  );
  const engine = Object.fromEntries(
    ["backtest.mjs", "backtestSpec.mjs", "backtestStats.mjs"].map((name) => [name, read(`source/engine/${name}`)]),
  );
  check(hash(engine) === source.engineId, "Source engine differs from its pinned checksum.");
  check(
    source.inputs && !source.inputs.kind && source.result?.ok,
    "Paper source must be a completed single-source calculation.",
  );
  const replay = spawnSync(process.execPath, ["replay.mjs"], {
    cwd: path.join(root, "source"),
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
  });
  check(
    !replay.error && replay.status === 0,
    `Source experiment replay failed: ${replay.error?.message || replay.stderr || replay.stdout}`,
  );
  const result = JSON.parse(replay.stdout);
  check(
    result.matches === true && result.inputHash === account.sourceInputHash,
    "Source replay did not confirm pinned inputs.",
  );
  return {
    verified: true,
    accountId: account.id,
    events: events.length,
    cashCents: computed.cashCents,
    positions: computed.positions,
    halted: computed.halted,
    sourceRunId: source.id,
    sourceReplay: true,
    scope:
      "Internal paper ledger and source calculation reproducibility; not verified market fills, identity, current state or broker reconciliation.",
  };
}
if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    console.log(JSON.stringify(await verifyPaperDirectory(path.dirname(fileURLToPath(import.meta.url))), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
