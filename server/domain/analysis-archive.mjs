import { readFileSync } from "node:fs";
import { hashOf } from "./research-store.mjs";
import { getAnalysis } from "./research-analysis.mjs";
import { exportNotebookFiles } from "./notebook-archive.mjs";
import { verifyAnalysisArchive } from "./analysis-verifier.mjs";
import { zipFiles } from "../../shared/replicate.mjs";

/** Snapshot a journal as it exists now. An active or interrupted run stays incomplete. */
export function exportAnalysis(db, id) {
  const payload = getAnalysis(db, id);
  const bundle = { schemaVersion: 1, payloadHash: hashOf(payload), payload };
  verifyAnalysisArchive(bundle);
  const files = [];
  let bytes = 0;
  const add = (name, text) => {
    bytes += Buffer.byteLength(text);
    if (bytes > 100 * 1024 * 1024) throw Error("Analysis evidence exceeds the 100 MiB portable archive limit.");
    files.push({ name, text });
  };
  add("analysis.json", JSON.stringify(bundle, null, 2));
  add("verify.mjs", readFileSync(new URL("./analysis-verifier.mjs", import.meta.url), "utf8"));
  add(
    "README.txt",
    "TradeSimple Intel controlled execution record\nExtract and run: node verify.mjs\nNode 22.13+; no app, database, packages, credentials or network required.\n\nPreserves the journal at export time, including partial text and failures, original model inputs, tool outputs and the exact recorded memory. Incomplete means no terminal record existed at export; later progress is not included. Included notebooks preserve exact approved revisions and replay their pinned calculations. Failed calculations remain record-only. Arbitrary references within tool outputs are not recursively resolved.\n\nVerification checks internal consistency, not authorship, source truth, claim support, historical availability or model regeneration. A replaced archive and verifier are outside this checksum guarantee. Historical approval does not authorize current reuse.\n",
  );
  const seen = new Set();
  for (const { notebook } of payload.events[0].data.snapshot.records) {
    const key = `${notebook.id}-r${notebook.revision}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const exported = exportNotebookFiles(db, notebook.id, notebook.revision);
    const saved = JSON.parse(exported.files.find((f) => f.name === "notebook.json").text);
    if (saved.notebookHash !== hashOf(notebook)) throw Error("Analysis notebook differs from recorded memory.");
    for (const file of exported.files) add(`notebooks/${key}/${file.name}`, file.text);
  }
  add("checksums.json", JSON.stringify(Object.fromEntries(files.map((f) => [f.name, hashOf(f.text)])), null, 2) + "\n");
  return zipFiles(files);
}
