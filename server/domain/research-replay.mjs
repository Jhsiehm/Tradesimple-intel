import { readFileSync } from 'node:fs';
import { runConvergence } from '../../shared/convergence.mjs';
import { runBacktest } from '../../shared/backtest.mjs';
import { realityCheck, REALITY } from '../../shared/backtestStats.mjs';
import { zipFiles } from '../../shared/replicate.mjs';
import { hashOf, getEngine } from './research-store.mjs';

const names = ['backtest.mjs', 'backtestSpec.mjs', 'backtestStats.mjs'];
const files = Object.fromEntries(names.map(name => [name, readFileSync(new URL(`../../shared/${name}`, import.meta.url), 'utf8')]));
export const ENGINE = { id: hashOf(files), files };
const convergenceFiles = { ...files, 'convergence.mjs': readFileSync(new URL('../../shared/convergence.mjs', import.meta.url), 'utf8') };
export const CONVERGENCE_ENGINE = { id: hashOf(convergenceFiles), files: convergenceFiles };
export function calculate(inputs) {
  const result = runBacktest(inputs);
  const reality = result.stats ? realityCheck({ trades: result.trades, bars: inputs.bars, benchBars: inputs.benchBars, rules: result.rules, seed: REALITY.seed }) : null;
  return { result, reality };
}
export function replayRun(run) {
  if (!run.inputs) throw new Error('This failed run has no calculation inputs. Inspect its recorded error.');
  if (run.inputs.kind === 'convergence') {
    if (run.engineId !== CONVERGENCE_ENGINE.id) throw new Error('Export this run to replay with its original engine.');
    const report = runConvergence(run.inputs);
    return { ok: true, matches: hashOf(report) === hashOf(run.result.convergence), inputHash: run.inputHash, engineId: run.engineId };
  }
  if (run.engineId !== ENGINE.id) throw new Error('The engine has changed. Export this run and use its bundled engine for offline replay.');
  const { result, reality } = calculate(run.inputs);
  const expected = { ...run.result.engineResult, reality: run.result.reality };
  const actual = { ...result, reality };
  return { ok: true, matches: hashOf(actual) === hashOf(expected), inputHash: run.inputHash, engineId: run.engineId, result, reality };
}
const replayScript = `import fs from 'node:fs';
import crypto from 'node:crypto';
import { runBacktest } from './engine/backtest.mjs';
import { realityCheck } from './engine/backtestStats.mjs';
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const manifest = JSON.parse(read('./checksums.json'));
for (const [name, digest] of Object.entries(manifest)) if (hash(read('./' + name)) !== digest) throw Error('Checksum mismatch: ' + name);
const saved = JSON.parse(read('./run.json'));
if (!saved.inputs) throw Error('Failed run: no calculation inputs to replay');
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
export function exportRun(db, run) {
  const engine = getEngine(db, run.engineId);
  const files = [
    { name: 'run.json', text: JSON.stringify(run, null, 2) + '\n' },
    ...Object.entries(engine).map(([name, text]) => ({ name: `engine/${name}`, text })),
    { name: 'replay.mjs', text: replayScript },
    { name: 'README.txt', text: 'TradeSimple Intel frozen experiment\nExtract this archive and run: node replay.mjs\nNode 22.13+; no packages or network required.\nrun.json contains exact engine inputs, results, normalized event lineage, entity mappings, source metadata, exclusions, and calculation settings. Source references are preserved where available; original provider documents are not universally archived.\nChecksums detect accidental changes, not malicious replacement of this entire archive.\nResearch only. A replay match verifies reproducibility, not predictive validity or causal interpretation.\n' }
  ];
  files.push({ name: 'checksums.json', text: JSON.stringify(Object.fromEntries(files.map(f => [f.name, hashOf(f.text)])), null, 2) + '\n' });
  return zipFiles(files);
}
