/** Standalone notebook archive verifier. Node built-ins only; no app or network. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const hash = (value) =>
  crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export function verifyNotebookArchive(directory) {
  const root = path.resolve(directory);
  const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
  const manifest = JSON.parse(read("checksums.json"));
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw Error("Invalid checksum manifest.");
  for (const required of ["notebook.json", "verify.mjs", "README.txt"])
    if (!manifest[required]) throw Error(`Missing manifest entry: ${required}`);
  for (const [name, digest] of Object.entries(manifest)) {
    if (
      !/^(notebook\.json|verify\.mjs|README\.txt|runs\/run_[a-f0-9]+\/(run\.json|evidence\.json|trials\.json|checksums\.json|replay\.mjs|README\.txt|engine\/[A-Za-z0-9_-]+\.mjs))$/.test(
        name,
      )
    )
      throw Error("Unsafe archive path.");
    if (hash(read(name)) !== digest) throw Error(`Checksum mismatch: ${name}`);
  }
  const bundle = JSON.parse(read("notebook.json"));
  if (bundle.schemaVersion !== 1 || hash(bundle.notebook) !== bundle.notebookHash)
    throw Error("Notebook revision checksum mismatch.");
  const note = bundle.notebook;
  if (!note?.id || !Number.isSafeInteger(note.revision) || note.revision < 1 || !Array.isArray(note.evidence))
    throw Error("Invalid notebook revision.");
  const runs = new Map();
  for (const reference of note.evidence) {
    if (!/^run_[a-f0-9]+$/.test(reference.runId)) throw Error("Invalid evidence run ID.");
    const folder = `runs/${reference.runId}`;
    if (!manifest[`${folder}/run.json`] || !manifest[`${folder}/checksums.json`] || !manifest[`${folder}/replay.mjs`])
      throw Error("Missing pinned evidence files.");
    const run = JSON.parse(read(`${folder}/run.json`));
    if (run.id !== reference.runId || run.inputHash !== reference.inputHash || hash(run.inputs) !== run.inputHash)
      throw Error("Notebook evidence pin mismatch.");
    runs.set(run.id, run);
  }
  const results = [];
  for (const run of runs.values()) {
    if (!run.inputs) {
      results.push({
        runId: run.id,
        status: "record-only",
        reason: "No calculation inputs; this preserved attempt cannot be replayed.",
      });
      continue;
    }
    const replay = spawnSync(process.execPath, ["replay.mjs"], {
      cwd: path.join(root, "runs", run.id),
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (replay.error || replay.status !== 0)
      throw Error(`Evidence replay failed: ${run.id}: ${replay.error?.message || replay.stderr || replay.stdout}`);
    let result;
    try {
      result = JSON.parse(replay.stdout);
    } catch {
      throw Error(`Invalid replay output: ${run.id}`);
    }
    if (result.matches !== true) throw Error(`Evidence replay mismatch: ${run.id}`);
    results.push({ runId: run.id, status: "replayed", matches: true });
  }
  return {
    verified: true,
    notebookId: note.id,
    revision: note.revision,
    evidenceReferences: note.evidence.length,
    uniqueRuns: runs.size,
    results,
  };
}
if (
  process.argv[1] &&
  fs.existsSync(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    console.log(JSON.stringify(verifyNotebookArchive(path.dirname(fileURLToPath(import.meta.url))), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
