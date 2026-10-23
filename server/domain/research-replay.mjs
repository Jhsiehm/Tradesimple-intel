import { exportResearchTrials } from "./research-trials.mjs";
import { runEventStudy } from "../../shared/eventStudy.mjs";
import { runStress } from "../../shared/researchStress.mjs";
import { archiveEvidence } from "./research-archive.mjs";
import { readFileSync } from "node:fs";
import { runConvergence } from "../../shared/convergence.mjs";
import { runBacktest } from "../../shared/backtest.mjs";
import { realityCheck, REALITY } from "../../shared/backtestStats.mjs";
import { zipFiles } from "../../shared/replicate.mjs";
import { hashOf, getEngine } from "./research-store.mjs";

const names = [
  "backtest.mjs",
  "backtestSpec.mjs",
  "backtestStats.mjs",
  "executionAssessment.mjs",
  "backtestMetrics.mjs",
];
const files = Object.fromEntries(
  names.map((name) => [name, readFileSync(new URL(`../../shared/${name}`, import.meta.url), "utf8")]),
);
export const ENGINE = { id: hashOf(files), files };
const convergenceFiles = {
  ...files,
  "convergence.mjs": readFileSync(new URL("../../shared/convergence.mjs", import.meta.url), "utf8"),
};
export const CONVERGENCE_ENGINE = { id: hashOf(convergenceFiles), files: convergenceFiles };
const stressFiles = {
  ...convergenceFiles,
  "researchStress.mjs": readFileSync(new URL("../../shared/researchStress.mjs", import.meta.url), "utf8"),
};
export const STRESS_ENGINE = { id: hashOf(stressFiles), files: stressFiles };
const eventStudyFiles = {
  ...files,
  "eventStudy.mjs": readFileSync(new URL("../../shared/eventStudy.mjs", import.meta.url), "utf8"),
};
export const EVENT_STUDY_ENGINE = { id: hashOf(eventStudyFiles), files: eventStudyFiles };
export function calculate(inputs) {
  const result = runBacktest(inputs);
  const reality = result.stats
    ? realityCheck({
        trades: result.trades,
        bars: inputs.bars,
        benchBars: inputs.benchBars,
        rules: result.rules,
        seed: REALITY.seed,
      })
    : null;
  return { result, reality };
}
export function replayRun(run) {
  if (!run.inputs) throw new Error("This failed run has no calculation inputs. Inspect its recorded error.");
  if (run.inputs.kind === "event-study") {
    if (run.engineId !== EVENT_STUDY_ENGINE.id) throw Error("Export this study to replay its original engine.");
    return {
      ok: true,
      matches: hashOf(runEventStudy(run.inputs)) === hashOf(run.result.eventStudy),
      inputHash: run.inputHash,
      engineId: run.engineId,
    };
  }
  if (run.inputs.kind === "stress") {
    if (run.engineId !== STRESS_ENGINE.id) throw Error("Export this stress run to replay its original engine.");
    return {
      ok: true,
      matches: hashOf(runStress(run.inputs)) === hashOf(run.result.stress),
      inputHash: run.inputHash,
      engineId: run.engineId,
    };
  }
  if (run.inputs.kind === "convergence") {
    if (run.engineId !== CONVERGENCE_ENGINE.id) throw new Error("Export this run to replay with its original engine.");
    const report = runConvergence(run.inputs);
    return {
      ok: true,
      matches: hashOf(report) === hashOf(run.result.convergence),
      inputHash: run.inputHash,
      engineId: run.engineId,
    };
  }
  if (run.engineId !== ENGINE.id)
    throw new Error("The engine has changed. Export this run and use its bundled engine for offline replay.");
  const { result, reality } = calculate(run.inputs);
  const expected = { ...run.result.engineResult, reality: run.result.reality };
  const actual = { ...result, reality };
  return {
    ok: true,
    matches: hashOf(actual) === hashOf(expected),
    inputHash: run.inputHash,
    engineId: run.engineId,
    result,
    reality,
  };
}
export const replayScript = `import fs from 'node:fs';
import crypto from 'node:crypto';
import { runBacktest } from './engine/backtest.mjs';
import { realityCheck } from './engine/backtestStats.mjs';
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const manifest = JSON.parse(read('./checksums.json'));
for (const [name, digest] of Object.entries(manifest)) if (hash(read('./' + name)) !== digest) throw Error('Checksum mismatch: ' + name);
const saved = JSON.parse(read('./run.json'));
if (!saved.inputs) throw Error('Failed run: no calculation inputs to replay');
if(saved.inputs.kind==='event-study'){
  const {runEventStudy}=await import('./engine/eventStudy.mjs');
  const matches=JSON.stringify(runEventStudy(saved.inputs))===JSON.stringify(saved.result.eventStudy);
  console.log(JSON.stringify({matches,inputHash:saved.inputHash}));
  process.exit(matches?0:1);
}
if(saved.inputs.kind==='stress'){
  const {runStress}=await import('./engine/researchStress.mjs');
  const matches=JSON.stringify(runStress(saved.inputs))===JSON.stringify(saved.result.stress);
  console.log(JSON.stringify({matches,inputHash:saved.inputHash}));
  process.exit(matches?0:1);
}
if (saved.inputs.kind === 'convergence') {
  const {runConvergence} = await import('./engine/convergence.mjs');
  const matches = JSON.stringify(runConvergence(saved.inputs)) === JSON.stringify(saved.result.convergence);
  console.log(JSON.stringify({matches,inputHash:saved.inputHash}));
  process.exit(matches ? 0 : 1);
}
const result = runBacktest(saved.inputs);
const reality = result.stats ? realityCheck({trades:result.trades,bars:saved.inputs.bars,benchBars:saved.inputs.benchBars,rules:result.rules,seed:saved.provenance.statistics.seed}) : null;
const expected = {...saved.result.engineResult,reality:saved.result.reality};
const actual = {...result,reality};
const matches = JSON.stringify(actual) === JSON.stringify(expected);
console.log(JSON.stringify({matches,stats:result.stats,inputHash:saved.inputHash},null,2));
if (!matches) process.exitCode=1;
`;
export function exportRunFiles(db, run) {
  const engine = getEngine(db, run.engineId);
  const files = [
    { name: "run.json", text: JSON.stringify(run, null, 2) + "\n" },
    { name: "evidence.json", text: JSON.stringify(archiveEvidence(db, run)) + "\n" },
    ...Object.entries(engine).map(([name, text]) => ({ name: `engine/${name}`, text })),
    { name: "replay.mjs", text: replayScript },
    {
      name: "README.txt",
      text: "TradeSimple Intel frozen experiment\nExtract this archive and run: node replay.mjs\nNode 22.13+; no packages or network required.\nrun.json contains exact engine inputs, results, normalized event lineage, entity mappings, source metadata, exclusions, and calculation settings. evidence.json includes pinned source runs and engines, original imported datasets, and referenced frozen contract response blobs. Built-in source records remain parsed records; original provider documents are not universally archived.\nChecksums detect accidental changes, not malicious replacement of this entire archive.\nResearch only. A replay match verifies reproducibility, not predictive validity or causal interpretation.\n",
    },
  ];
  if (run.provenance?.trial?.id)
    files.push({
      name: "trials.json",
      text: JSON.stringify(exportResearchTrials(db, run.provenance.trial.id), null, 2) + "\n",
    });
  files.push({
    name: "checksums.json",
    text: JSON.stringify(Object.fromEntries(files.map((f) => [f.name, hashOf(f.text)])), null, 2) + "\n",
  });
  return files;
}
export function exportRun(db, run) {
  return zipFiles(exportRunFiles(db, run));
}
