import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transformWithOxc} from 'vite';
import {evaluatePolicyStudy, assessPolicyReadiness} from '../shared/policyStudy.mjs';
import {completePolicyStudyFixture, POLICY_FIXTURE_NOW} from './fixtures/policyStudy.mjs';

const require = createRequire(import.meta.url);
const moduleUrls = new Map();
async function uiModule(name) {
  if (moduleUrls.has(name)) return moduleUrls.get(name);
  const file = new URL(`../src/research/policy/${name}`, import.meta.url);
  let {code} = await transformWithOxc(await readFile(file, 'utf8'), file.pathname, {jsx: {runtime: 'automatic'}});
  if (code.includes('"./types"')) code = code.replaceAll('"./types"', JSON.stringify(await uiModule('types.ts')));
  for (const dependency of ['react/jsx-runtime', 'react']) code = code.replaceAll(JSON.stringify(dependency), JSON.stringify(pathToFileURL(require.resolve(dependency)).href));
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  moduleUrls.set(name, url); return url;
}
const {StudyReport} = await import(await uiModule('StudyReport.tsx'));
const {EvidenceTable} = await import(await uiModule('EvidenceTable.tsx'));
const {sourceLink} = await import(await uiModule('types.ts'));
const investigation = () => {
  const {protocol, evidence} = completePolicyStudyFixture();
  return {id: 'test-study', protocol, evidence, status: 'conditional-analysis', revision: 1, readiness: assessPolicyReadiness(protocol, evidence, {asOf: POLICY_FIXTURE_NOW}), result: evaluatePolicyStudy(protocol, evidence, {asOf: POLICY_FIXTURE_NOW})};
};
const render = (Component, record) => renderToStaticMarkup(createElement(Component, {investigation: record}));

test('policy report converts decimal returns to percentages and paired differences to percentage points', () => {
  const record = investigation(), html = render(StudyReport, record);
  assert.equal(record.result.executed, true);
  assert.match(html, /9\.900%/);
  assert.match(html, /-1\.918%/);
  assert.match(html, /11\.818 pp/);
  assert.match(html, /Paired event-return comparison/);
  assert.match(html, /Frozen evaluation time · UTC:/);
  assert.match(html, /2026-10-20T12:00:00\.000Z/);
  assert.match(html, /not a portfolio backtest or a causal finding/);
  assert.match(html, /No confidence interval or statistical edge is established/);
});
test('an empty holdout is visibly unavailable and does not become a zero return', () => {
  const record = investigation(), html = render(StudyReport, record);
  assert.equal(record.result.summary.holdout.meanPolicyNet, null);
  const holdout = html.slice(html.indexOf('<h4>Holdout period</h4>'));
  assert.match(holdout, /Not available/);
  assert.match(html, /Holdout status:/);
});
test('unsupported evidence produces an assessment, with the original question and no result claims', () => {
  const record = investigation(); record.evidence.bars = [];
  record.result = evaluatePolicyStudy(record.protocol, record.evidence, {asOf: POLICY_FIXTURE_NOW});
  const html = render(StudyReport, record);
  assert.equal(record.result.executed, false);
  assert.match(html, /Evidence assessment · no study executed/);
  assert.match(html, /Does a predefined defense vote signal precede covered news returns/);
  assert.doesNotMatch(html, /Included paired observations/);
});
test('evidence table exposes source precision and blocks executable imported source links', () => {
  const record = investigation(); record.evidence.events[0].sourceUrl = 'javascript:alert(1)';
  const html = render(EvidenceTable, record);
  assert.match(html, /Public release/);
  assert.match(html, /Release precision/);
  assert.match(html, /importer-asserted/);
  assert.match(html, /No source URL/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.equal(sourceLink('data:text/html,hello'), undefined);
});
test('empty evidence is described as missing observations, not absence of legislative activity', () => {
  const record = investigation(); record.evidence.events = [];
  assert.match(render(EvidenceTable, record), /This is not evidence of no activity/);
});
