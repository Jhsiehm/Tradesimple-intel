import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LAYERS = ["src", "server", "shared", "scripts"];
const CODE = /\.(mjs|js|ts|tsx)$/;

// Which top-level layers each layer must not import from.
const FORBIDDEN = {
  src: ["server", "scripts"],
  server: ["src", "scripts"],
  shared: ["src", "server", "scripts"],
  scripts: ["src"],
};

// Known violations awaiting a fix. Entries may only be removed.
const ALLOWLIST = new Set([
  "server/contracts.mjs -> scripts/joins-match.mjs",
]);

// Files already over the line budget. This set may only shrink.
const MAX_LINES = 600;
const KNOWN_LARGE = new Set([
  "src/styles.css",
  "src/App.tsx",
  "src/markets/CandleChart.tsx",
  "src/markets/CalendarBoard.tsx",
  "server/positions.mjs",
  "server/congress.mjs",
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split(sep).join("/");
const files = LAYERS.flatMap((layer) => walk(join(ROOT, layer)));
const codeFiles = files.filter((f) => CODE.test(f) && !/\.d\.m?ts$/.test(f));

const IMPORT_RE = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function importsOf(file) {
  const text = readFileSync(file, "utf8");
  const specs = new Set();
  for (const re of IMPORT_RE) for (const m of text.matchAll(re)) specs.add(m[1]);
  return [...specs];
}

test("layers only import what they are allowed to", () => {
  const found = [];
  const seenAllowed = new Set();
  for (const file of codeFiles) {
    const from = rel(file);
    const layer = from.split("/")[0];
    for (const spec of importsOf(file)) {
      if (!spec.startsWith(".")) continue;
      const target = rel(resolve(dirname(file), spec));
      const targetLayer = target.split("/")[0];
      if (!FORBIDDEN[layer].includes(targetLayer)) continue;
      const edge = `${from} -> ${target}`;
      if (ALLOWLIST.has(edge)) seenAllowed.add(edge);
      else found.push(edge);
    }
  }
  assert.deepEqual(found, [], `forbidden imports:\n${found.join("\n")}`);
  const stale = [...ALLOWLIST].filter((e) => !seenAllowed.has(e));
  assert.deepEqual(stale, [], `allowlist entries no longer needed:\n${stale.join("\n")}`);
});

test("shared/ is pure", () => {
  const bad = [
    [/["']node:/, "node: import"],
    [/\bfetch\s*\(/, "fetch("],
    [/\bprocess\./, "process."],
    [/\bimport\.meta\b/, "import.meta"],
    [/\b(window|document|localStorage)\s*[.[]/, "browser global"],
  ];
  const found = [];
  for (const file of codeFiles.filter((f) => rel(f).startsWith("shared/"))) {
    const text = readFileSync(file, "utf8");
    for (const [re, label] of bad) if (re.test(text)) found.push(`${rel(file)}: ${label}`);
  }
  assert.deepEqual(found, []);
});

test("every shared/*.mjs has a .d.mts", () => {
  const missing = files
    .map(rel)
    .filter((f) => /^shared\/[^/]+\.mjs$/.test(f))
    .filter((f) => !existsSync(join(ROOT, f.replace(/\.mjs$/, ".d.mts"))));
  assert.deepEqual(missing, []);
});

test("no secrets reach the browser bundle", () => {
  const found = [];
  for (const file of codeFiles.filter((f) => rel(f).startsWith("src/"))) {
    const text = readFileSync(file, "utf8");
    if (/\bprocess\.env\b/.test(text)) found.push(`${rel(file)}: process.env`);
    if (/import\.meta\.env\.VITE_\w*(KEY|TOKEN|SECRET|PASSWORD)/i.test(text))
      found.push(`${rel(file)}: secret-looking VITE_ var`);
  }
  assert.deepEqual(found, []);
});

test("files stay under the line budget", () => {
  const over = [];
  const stillLarge = new Set();
  for (const file of files.filter((f) => CODE.test(f) || f.endsWith(".css"))) {
    const lines = readFileSync(file, "utf8").split("\n").length;
    if (lines <= MAX_LINES) continue;
    const name = rel(file);
    if (KNOWN_LARGE.has(name)) stillLarge.add(name);
    else over.push(`${name}: ${lines} lines`);
  }
  assert.deepEqual(over, [], `files over ${MAX_LINES} lines:\n${over.join("\n")}`);
  const shrunk = [...KNOWN_LARGE].filter((f) => !stillLarge.has(f));
  assert.deepEqual(shrunk, [], `remove from KNOWN_LARGE (now under budget):\n${shrunk.join("\n")}`);
});
