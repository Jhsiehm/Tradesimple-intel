import { readdirSync, readFileSync } from "node:fs";
import { hashOf } from "../research-store.mjs";
import { zipFiles } from "../../../shared/replicate.mjs";
import { getPolicyRecord } from "./store.mjs";
import { runPolicyMethod } from "./worker.mjs";

export function policyEngine() {
  const folder = new URL("../../../shared/", import.meta.url);
  const files = Object.fromEntries(
    readdirSync(folder)
      .filter((name) => /^policy.*\.mjs$/.test(name))
      .sort()
      .map((name) => [name, readFileSync(new URL(name, folder), "utf8")]),
  );
  return { hash: hashOf(files), files };
}

export async function replayPolicyInvestigation(db, id, options = {}) {
  options.signal?.throwIfAborted();
  const record = getPolicyRecord(db, id);
  if (!record?.evaluation) throw Error("Evaluate and freeze this investigation before replaying it.");
  const { inputs, inputHash, resultHash, engineHash } = record.evaluation;
  if (engineHash !== policyEngine().hash)
    throw Error("The engine changed. Export the frozen archive to replay its original version.");
  const actual = await runPolicyMethod("evaluate", inputs.protocol, inputs.evidence, {
    asOf: inputs.asOf,
    signal: options.signal,
  });
  return {
    ok: true,
    matches: hashOf(actual) === resultHash,
    inputHash,
    engineHash,
    notice: "Replay confirms deterministic calculations, not the accuracy or completeness of supplied evidence.",
  };
}

export function exportPolicyInvestigation(db, id) {
  const record = getPolicyRecord(db, id);
  if (!record) throw Error("Policy investigation not found.");
  return {
    format: "tradesimple-policy-study-v1",
    record,
    recordHash: hashOf(record),
    notice:
      "Immutable evidence, protocol and result snapshot. Imported claims are researcher assertions. Checksums detect changes, not source authenticity. Missing history remains missing.",
  };
}

const replayScript = `import fs from 'node:fs';
import crypto from 'node:crypto';
import { evaluatePolicyStudy } from './engine/policyStudy.mjs';
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const checksums = JSON.parse(read('./checksums.json'));
for (const [name, expected] of Object.entries(checksums)) {
  if (hash(read('./' + name)) !== expected) throw Error('File checksum mismatch: ' + name);
}
const archive = JSON.parse(read('./investigation.json'));
const saved = archive.record;
if (hash(saved) !== archive.recordHash || hash(saved.protocol) !== saved.protocolHash) throw Error('Investigation checksum mismatch');
const evaluation = saved.evaluation;
if (!evaluation) throw Error('No frozen evaluation. Collect/import missing evidence and evaluate first.');
if (hash(evaluation.inputs) !== evaluation.inputHash) throw Error('Input checksum mismatch');
if (hash(evaluation.engineFiles) !== evaluation.engineHash) throw Error('Engine manifest mismatch');
for (const [name, source] of Object.entries(evaluation.engineFiles)) {
  if (read('./engine/' + name) !== source) throw Error('Engine source mismatch: ' + name);
}
const result = evaluatePolicyStudy(evaluation.inputs.protocol, evaluation.inputs.evidence, {asOf:evaluation.inputs.asOf});
const matches = hash(result) === evaluation.resultHash && hash(saved.result) === evaluation.resultHash;
console.log(JSON.stringify({matches, inputHash:evaluation.inputHash, status:result.status, executed:result.executed}, null, 2));
if (!matches) process.exitCode = 1;
`;

export function exportPolicyArchive(db, id) {
  const archive = exportPolicyInvestigation(db, id);
  if (!archive.record.evaluation)
    throw Error(
      "Evaluate this investigation before exporting an executable archive. JSON evidence export is available before evaluation.",
    );
  const files = [
    { name: "investigation.json", text: JSON.stringify(archive, null, 2) + "\n" },
    ...Object.entries(archive.record.evaluation.engineFiles).map(([name, text]) => ({ name: `engine/${name}`, text })),
    { name: "replay.mjs", text: replayScript },
    {
      name: "README.txt",
      text: "TradeSimple Intel — policy/news study\nExtract and run: node replay.mjs\nNode 22.13+; no network or packages.\nThe archive contains the exact protocol, all collected/imported records, source receipts, exclusions, numeric results, original engine and checksums.\nA matching replay establishes computational reproducibility only. Publication timing, article matching, coverage and exposure assertions require independent evidence. No causal, portfolio-performance or investable-edge claim is established.\n",
    },
  ];
  files.push({
    name: "checksums.json",
    text: JSON.stringify(Object.fromEntries(files.map((file) => [file.name, hashOf(file.text)])), null, 2) + "\n",
  });
  return zipFiles(files);
}
