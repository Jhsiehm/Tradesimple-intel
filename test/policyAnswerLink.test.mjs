import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
const file = new URL('../src/ask/Answer.tsx', import.meta.url);
let { code } = await transformWithOxc(await readFile(file, 'utf8'), file.pathname, { jsx: { runtime: 'automatic' } });
code = code.replaceAll('"../../shared/citations.mjs"', JSON.stringify(new URL('../shared/citations.mjs', import.meta.url).href));
code = code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
const { Answer } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('policy capability receipt opens the implemented workspace without enabling arbitrary answer links', () => {
  const text = '**Policy research workflow:** [Open Policy research](#research/policy)\n[Unsafe](javascript:alert(1))';
  const html = renderToStaticMarkup(createElement(Answer, { text, steps: [], onChip() {} }));
  assert.match(html, /<a href="#research\/policy">Open Policy research<\/a>/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /<b>Policy research workflow:<\/b>/);
});
