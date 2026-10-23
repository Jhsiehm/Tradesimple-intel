import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformWithOxc } from "vite";

const require = createRequire(import.meta.url);
const file = new URL("../src/backtest/IsItReal.tsx", import.meta.url);
let { code } = await transformWithOxc(await readFile(file, "utf8"), file.pathname, { jsx: { runtime: "automatic" } });
code = code.replaceAll(
  '"../../shared/backtestStats.mjs"',
  JSON.stringify(new URL("../shared/backtestStats.mjs", import.meta.url).href),
);
code = code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href));
const { IsItReal } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const reality = {
  n: 50,
  seed: 12345,
  inference: {
    status: "withheld",
    basis: "entry-week",
    blocks: 10,
    reasons: ["Holding intervals overlap across blocks."],
  },
  verdict: { level: "few", text: "Inference withheld." },
  bootstrap: { blocks: 10, iters: 2000, meanTrade: { lo: 0.1, hi: 0.2 }, meanExcess: { lo: 0.1, hi: 0.2 } },
  placebo: null,
  cluster: null,
};
test("withheld diagnostics never render as confident intervals in full or compact results", () => {
  for (const compact of [false, true]) {
    const html = renderToStaticMarkup(createElement(IsItReal, { reality, compact }));
    assert.match(html, /Inference withheld/);
    assert.match(html, /Holding intervals overlap/);
    assert.doesNotMatch(html, /Mean excess, 95% CI|10\.0% to/);
  }
});
test("eligible exploratory intervals retain their meaning and repeated-search caveat", () => {
  const html = renderToStaticMarkup(
    createElement(IsItReal, {
      reality: {
        ...reality,
        inference: { ...reality.inference, status: "exploratory", reasons: [] },
        verdict: { level: "mixed", text: "Exploratory only." },
      },
    }),
  );
  assert.match(html, /Mean excess, 95% CI/);
  assert.match(html, /does not correct earlier or repeated searches/);
});
