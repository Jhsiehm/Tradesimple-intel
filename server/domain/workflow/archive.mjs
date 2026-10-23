import { zipFiles } from "../../../shared/replicate.mjs";
import { hashOf } from "../research-store.mjs";
import { getObservations } from "../research-observations.mjs";
import { freezeSources } from "./sources.mjs";
import { readWorkflowHistory } from "./records.mjs";

export function exportInvestigation(db, id) {
  const history = readWorkflowHistory(db, id, (snapshotId) => getObservations(db, snapshotId));
  const record = history.at(-1);
  return {
    format: "tradesimple-workflow-v1",
    record,
    recordHash: hashOf(record),
    history: history.slice(0, -1),
    ...(record.evaluation ? {} : { evidence: freezeSources(db, record.protocol, record.sourceRefs) }),
    notice:
      "Pinned originals, source restrictions, row decisions and calculations are preserved. Imported identities, availability and rights remain importer assertions. Replay verifies computation, not authenticity, coverage or scientific validity.",
  };
}

const replayScript = `import fs from 'node:fs';
import crypto from 'node:crypto';
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const checksums = JSON.parse(read('./checksums.json'));
for (const [name, expected] of Object.entries(checksums)) {
  if (!/^(investigation\\.json|replay\\.mjs|README\\.txt|engine\\/(workflow[A-Za-z]*|observationSources)\\.mjs)$/.test(name)) throw Error('Invalid archive filename');
  if (hash(read('./' + name)) !== expected) throw Error('File checksum mismatch: ' + name);
}
const archive = JSON.parse(read('./investigation.json')), saved = archive.record, evaluation = saved.evaluation;
if (!evaluation || hash(saved) !== archive.recordHash || hash(saved.protocol) !== saved.protocolHash) throw Error('Investigation checksum mismatch');
let prior = null;
for (const revision of [...archive.history, saved]) {
  if (revision.previousHash !== (prior ? hash(prior) : null) || revision.revision !== (prior?.revision || 0) + 1) throw Error('Revision chain mismatch');
  prior = revision;
}
if (hash(evaluation.inputs) !== evaluation.inputHash || hash(evaluation.originals) !== evaluation.originalsHash || hash(evaluation.engineFiles) !== evaluation.engineHash) throw Error('Frozen input or engine checksum mismatch');
for (const [name, source] of Object.entries(evaluation.engineFiles)) {
  if (!/^(workflow[A-Za-z]*|observationSources)\\.mjs$/.test(name) || read('./engine/' + name) !== source) throw Error('Engine source mismatch');
}
const { projectSnapshot } = await import('./engine/observationSources.mjs');
for (const ref of saved.sourceRefs) {
  const snapshot = evaluation.originals[ref.snapshotId], node = saved.protocol.nodes.find(node => node.id === ref.nodeId);
  if (!snapshot || hash(snapshot) !== ref.snapshotHash || hash(snapshot.rawContent) !== snapshot.rawHash) throw Error('Original snapshot checksum mismatch');
  if (saved.protocol.family === 'descriptive' && saved.protocol.unresolved.length === 0) {
    const resolved = projectSnapshot(snapshot, node, saved.protocol.knownAt);
    if (hash(resolved) !== hash(evaluation.inputs.sources[ref.nodeId])) throw Error('Source resolution mismatch');
  }
}
const { evaluateWorkflow } = await import('./engine/workflow.mjs');
const result = evaluateWorkflow(evaluation.inputs.protocol, evaluation.inputs.sources);
const matches = hash(result) === evaluation.resultHash && hash(saved.result) === evaluation.resultHash;
console.log(JSON.stringify({matches,status:result.status,executed:result.executed,claimScope:result.claimScope,inputHash:evaluation.inputHash},null,2));
if (!matches) process.exitCode = 1;
`;

export function exportInvestigationArchive(db, id) {
  const archive = exportInvestigation(db, id);
  if (!archive.record.evaluation)
    throw Error("Run and freeze this investigation before exporting an executable archive.");
  const files = [
    { name: "investigation.json", text: JSON.stringify(archive, null, 2) + "\n" },
    ...Object.entries(archive.record.evaluation.engineFiles).map(([name, text]) => ({ name: `engine/${name}`, text })),
    { name: "replay.mjs", text: replayScript },
    {
      name: "README.txt",
      text: "TradeSimple Intel — descriptive research workflow\nExtract and run: node replay.mjs\nNode 22.13+; no packages, database or network.\nThe exact plan, original imported snapshots (including raw content and usage labels), vintage decisions, scalar inputs, full outputs and original engine are frozen.\nReplay establishes computational reproducibility only. Importer assertions are not verified source authenticity, complete historical coverage, causal evidence or an investable strategy.\nHosted AI text is not regenerated. Original source restrictions continue to apply.\n",
    },
  ];
  files.push({
    name: "checksums.json",
    text: JSON.stringify(Object.fromEntries(files.map(({ name, text }) => [name, hashOf(text)])), null, 2) + "\n",
  });
  return zipFiles(files);
}
