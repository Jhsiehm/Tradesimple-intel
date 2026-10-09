import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ICON_NAMES } from "../src/ui/icons/names.ts";
import { NAV } from "../src/ui/icons/nav.ts";
import { CONGRESS } from "../src/ui/icons/congress.ts";
import { MARKETS } from "../src/ui/icons/markets.ts";
import { MAP } from "../src/ui/icons/map.ts";
import { ACTIONS } from "../src/ui/icons/actions.ts";
import { RELATIONS } from "../src/ui/icons/relations.ts";
import { commandIcon } from "../src/ui/icons/commandIcon.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOMAINS = { NAV, CONGRESS, MARKETS, MAP, ACTIONS, RELATIONS };
const names = new Set(ICON_NAMES);

test("every icon name has path data in exactly one domain file, and nothing extra", () => {
  const seen = new Map();
  for (const [file, set] of Object.entries(DOMAINS)) {
    for (const key of Object.keys(set)) {
      assert.ok(names.has(key), `${file}.${key} is not in ICON_NAMES`);
      assert.ok(!seen.has(key), `${key} drawn in both ${seen.get(key)} and ${file}`);
      seen.set(key, file);
    }
  }
  assert.equal(ICON_NAMES.length, names.size, "duplicate names in ICON_NAMES");
  assert.deepEqual(ICON_NAMES.filter((n) => !seen.has(n)), [], "names without path data");
});

test("path data is well formed and stays on the 16×16 grid", () => {
  const all = Object.assign({}, ...Object.values(DOMAINS));
  for (const [name, glyph] of Object.entries(all)) {
    assert.ok(glyph.length > 0, `${name} is empty`);
    for (const part of glyph) {
      const d = typeof part === "string" ? part : part.d;
      if (typeof part !== "string") assert.equal(part.fill, true, `${name}: object parts are fill accents`);
      assert.match(d, /^M[\d.\s,MmLlHhVvCcSsQqTtAaZz-]+$/, `${name}: unexpected characters in ${d}`);
      // Absolute coordinates after M/L/H/V/C/S/A endpoints must stay within the 0..16 grid (with stroke slack).
      for (const m of d.matchAll(/[MLC]\s*(-?[\d.]+)[\s,]*(-?[\d.]+)/g)) {
        for (const v of [Number(m[1]), Number(m[2])]) assert.ok(v >= 0 && v <= 16, `${name}: ${v} off grid in ${d}`);
      }
    }
  }
});

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(tsx?|mjs)$/.test(e.name)) out.push(full);
  }
  return out;
}

test("every wired icon uses a valid name", () => {
  const bad = [];
  let wired = 0;
  for (const file of walk(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel.startsWith("src/ui/icons/")) continue;
    const used = [
      ...[...text.matchAll(/<Icon\b[^>]*?\bname="([^"]+)"/g)].map((m) => m[1]),
      ...[...text.matchAll(/<IconLabel\b[^>]*?\bicon="([^"]+)"/g)].map((m) => m[1]),
      ...[...text.matchAll(/\bicon:\s*"([^"]+)"/g)].map((m) => m[1]),
      // Conditional names: the result literals of name={a ? "x" : "y"} / icon={…}, not the tested values.
      ...[...text.matchAll(/<(?:Icon\b[^>]*?\bname|IconLabel\b[^>]*?\bicon)=\{([^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(/(?:^|[?:])\s*"([^"]+)"/g)].map((x) => x[1]))
    ];
    for (const n of used) {
      wired++;
      if (!names.has(n)) bad.push(`${rel}: ${n}`);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(wired > 20, `expected icons wired across the app, found ${wired}`);
});

test("command bar codes map to icons", () => {
  for (const code of ["WEEK", "LEAD", "CTR", "LMT DES", "LMT GP", "TX-12 REP", "P000197 TL", "ALRT", "HQ", "NVDA HQ", "CAL", "BACK", "RCNT", "ZZZZ"]) {
    assert.ok(names.has(commandIcon(code)), `${code} → ${commandIcon(code)}`);
  }
  assert.equal(commandIcon("LMT CTR"), "contracts");
  assert.equal(commandIcon("TX-12 REP"), "members");
  assert.equal(commandIcon("ALRT"), "bell");
});
