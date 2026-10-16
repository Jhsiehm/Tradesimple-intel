/** Restore and exercise a backup without opening the application's live stores. */
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { restoreResearchBackup } from "./research-backup.mjs";
import { hashOf } from "./research-store.mjs";
import { replayScript } from "./research-replay.mjs";

export function rehearseResearchBackup(backup, destination, { timeoutMs = 60000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)
    throw Error("Replay timeout must be 1–300000 milliseconds.");
  const startedAt = new Date().toISOString(),
    start = performance.now();
  destination = path.resolve(destination);
  fs.mkdirSync(destination, { mode: 0o700 });
  const report = {
    version: 1,
    startedAt,
    status: "failed",
    backup: path.resolve(backup),
    destination,
    counts: null,
    restoreMs: null,
    replayMs: null,
    totalMs: null,
    runs: [],
    limitations:
      "Measures local backup restoration and frozen-engine reproducibility. Does not start the API, test credentials/providers, perform live cutover, certify historical evidence or guarantee production recovery time.",
  };
  let db;
  try {
    const restored = restoreResearchBackup(backup, path.join(destination, "research.sqlite"));
    report.counts = restored.counts;
    report.restoreMs = Math.round(performance.now() - start);
    db = new DatabaseSync(restored.destination, { readOnly: true });
    const replayStart = performance.now();
    for (const row of db.prepare("SELECT id,body FROM runs ORDER BY created_at,id").iterate()) {
      const run = JSON.parse(row.body),
        entry = { id: row.id, status: "failed", elapsedMs: 0 };
      report.runs.push(entry);
      if (!run.inputs) {
        entry.status = "no-calculation";
        entry.reason = "Saved run has no calculation inputs; its preserved failure was checked by backup verification.";
        continue;
      }
      const runStart = performance.now();
      let work;
      try {
        const engineRow = db.prepare("SELECT body FROM engines WHERE id=?").get(run.engineId);
        const engine = JSON.parse(engineRow.body);
        if (hashOf(engine) !== run.engineId) throw Error("Saved engine checksum mismatch.");
        work = fs.realpathSync(fs.mkdtempSync(path.join(destination, "replay-")));
        fs.chmodSync(work, 0o700);
        fs.mkdirSync(path.join(work, "engine"), { mode: 0o700 });
        const files = { "run.json": JSON.stringify(run), "replay.mjs": replayScript };
        for (const [name, source] of Object.entries(engine)) {
          if (!/^[A-Za-z0-9_-]+\.mjs$/.test(name) || typeof source !== "string")
            throw Error("Invalid archived engine filename or source.");
          files[`engine/${name}`] = source;
        }
        files["checksums.json"] = JSON.stringify(
          Object.fromEntries(Object.entries(files).map(([name, source]) => [name, hashOf(source)])),
        );
        for (const [name, source] of Object.entries(files))
          fs.writeFileSync(path.join(work, name), source, { mode: 0o600, flag: "wx" });
        // Limit accidental filesystem writes and subprocess access by trusted archived engines.
        const child = spawnSync(
          process.execPath,
          ["--permission", `--allow-fs-read=${work}`, path.join(work, "replay.mjs")],
          { cwd: work, env: {}, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" },
        );
        if (child.error)
          throw Error(
            child.error.code === "ETIMEDOUT"
              ? "Archived replay exceeded its time limit."
              : `Archived replay could not finish (${child.error.code || "process error"}).`,
          );
        let output;
        try {
          output = JSON.parse(child.stdout);
        } catch {
          entry.diagnostic = child.stderr.slice(0, 4000);
          throw Error("Archived replay did not return a valid result.");
        }
        if (child.status !== 0 || output.matches !== true || output.inputHash !== run.inputHash)
          throw Error("Archived replay differs from the saved calculation.");
        entry.status = "matched";
        entry.inputHash = run.inputHash;
        entry.engineId = run.engineId;
      } catch (error) {
        entry.reason = error.message;
      } finally {
        entry.elapsedMs = Math.round(performance.now() - runStart);
        if (work) fs.rmSync(work, { recursive: true, force: true });
      }
    }
    report.replayMs = Math.round(performance.now() - replayStart);
    report.matched = report.runs.filter((r) => r.status === "matched").length;
    report.failed = report.runs.filter((r) => r.status === "failed").length;
    report.withoutCalculation = report.runs.filter((r) => r.status === "no-calculation").length;
    report.status = report.failed ? "failed" : report.matched ? "passed" : "no-calculations";
  } catch (error) {
    report.error = error.message;
  } finally {
    db?.close();
    report.totalMs = Math.round(performance.now() - start);
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(destination, "rehearsal.json"), JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  }
  return report;
}
