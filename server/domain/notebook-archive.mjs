import { readFileSync } from "node:fs";
import { notebookHistory } from "./notebooks.mjs";
import { getRun, hashOf } from "./research-store.mjs";
import { exportRunFiles } from "./research-replay.mjs";
import { zipFiles } from "../../shared/replicate.mjs";
const LIMIT = 100 * 1024 * 1024;
export function exportNotebookFiles(db, id, revision) {
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))
    throw Error("Choose a positive notebook revision.");
  const history = notebookHistory(db, id),
    notebook = revision === undefined ? history[0] : history.find((n) => n.revision === revision);
  if (!notebook) throw Error("Notebook revision not found.");
  const bundle = { schemaVersion: 1, notebookHash: hashOf(notebook), notebook };
  const files = [
    { name: "notebook.json", text: JSON.stringify(bundle, null, 2) + "\n" },
    { name: "verify.mjs", text: readFileSync(new URL("./notebook-verifier.mjs", import.meta.url), "utf8") },
    {
      name: "README.txt",
      text: "TradeSimple Intel portable finding\nExtract and run: node verify.mjs\nNode 22.13+; no packages, credentials, app database or network required.\n\nnotebook.json preserves one exact saved revision: hypothesis, conclusion, decision, classification, tags, follow-ups and pinned evidence references. Unsaved edits and other revisions are not included. Each runs/<id>/ directory contains the pinned run, original engine and available transitive source evidence. Verification checks all listed file hashes, evidence pins and recalculates each executable result. Failed attempts without calculation inputs remain inspectable record-only evidence.\n\nNo current memory approval or permission is implied. Checksums detect accidental changes and internal inconsistencies, not malicious replacement of the archive and verifier. This does not certify source completeness, historical availability, causal effects or investment validity. Original source caveats remain in each run.\n",
    },
  ];
  let bytes = files.reduce((n, f) => n + Buffer.byteLength(f.text), 0);
  const seen = new Set();
  for (const reference of notebook.evidence) {
    const run = getRun(db, reference.runId);
    if (!run || run.inputHash !== reference.inputHash)
      throw Error("Notebook evidence run is missing or differs from its pinned checksum.");
    if (seen.has(run.id)) continue;
    seen.add(run.id);
    for (const file of exportRunFiles(db, run)) {
      bytes += Buffer.byteLength(file.text);
      if (bytes > LIMIT)
        throw Error(
          "Notebook evidence exceeds the 100 MiB portable archive limit. Export its individual runs separately.",
        );
      files.push({ name: `runs/${run.id}/${file.name}`, text: file.text });
    }
  }
  files.push({
    name: "checksums.json",
    text: JSON.stringify(Object.fromEntries(files.map((f) => [f.name, hashOf(f.text)])), null, 2) + "\n",
  });
  return { notebookId: notebook.id, revision: notebook.revision, files };
}

export function exportNotebook(db, id, revision) {
  const { files, ...record } = exportNotebookFiles(db, id, revision);
  return { ...record, bytes: zipFiles(files) };
}
