#!/usr/bin/env node
/**
 * Build the zero-key demo for GitHub Pages and push it to the gh-pages branch.
 *   npm run publish:demo                      # build from the existing demo/snapshot and push
 *   npm run publish:demo -- --snapshot        # capture the running API first (needs `npm start` with your keys)
 *   npm run publish:demo -- --no-push         # build dist-demo/ only
 * Options: --base /Tradesimple-intel/  --url https://jhsiehm.github.io/Tradesimple-intel/  --branch gh-pages
 *   --trim full|lite (full keeps every list and rounds numbers; lite caps long lists)
 *   Snapshot pass-through: --members all|N --tickers all|N --spans 1d,6mo,1y,5y|all --contracts all|core|none --resume
 * The snapshot never goes to main; only the built site goes to gh-pages, as a normal (fast-forward) commit.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { trimRoute } from "./trim.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const BASE = arg("base", process.env.VITE_BASE || "/Tradesimple-intel/");
const URL_BASE = arg("url", process.env.PUBLIC_URL || "https://jhsiehm.github.io/Tradesimple-intel/");
const BRANCH = arg("branch", "gh-pages");
const OUT = path.join(root, "dist-demo");

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
const git = (args, opts = {}) => String(execFileSync("git", args, { cwd: root, encoding: "utf8", ...opts }) ?? "").trim();

const SNAPSHOT_FLAGS = ["members", "tickers", "spans", "contracts"].flatMap((name) => (arg(name) ? [`--${name}`, arg(name)] : []));
if (flag("snapshot")) run(process.execPath, ["scripts/snapshot.mjs", ...SNAPSHOT_FLAGS, ...(flag("resume") ? ["--resume"] : [])]);
const PARTIAL = flag("partial");
const manifestFile = path.join(root, "demo", "snapshot", "manifest.json");
if (PARTIAL ? !fs.existsSync(path.join(root, "demo", "snapshot.partial")) : !fs.existsSync(manifestFile)) {
  console.error(PARTIAL ? "No demo/snapshot.partial to publish." : "No demo/snapshot. Start the API with your keys, then run: npm run publish:demo -- --snapshot");
  process.exit(1);
}

console.log(`building demo for ${URL_BASE} (base ${BASE})`);
run(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
  env: { ...process.env, VITE_DEMO: "1", VITE_BASE: BASE, VITE_PUBLIC_URL: URL_BASE }
});

const snapDir = path.join(OUT, "snapshot");
const partialDir = path.join(OUT, "snapshot.partial");
if (PARTIAL) {
  fs.rmSync(snapDir, { recursive: true, force: true });
  fs.renameSync(partialDir, snapDir);
  const names = fs.readdirSync(snapDir);
  const pick = (re) => names.map((n) => n.match(re)?.[1]).filter(Boolean);
  fs.writeFileSync(path.join(snapDir, "manifest.json"), JSON.stringify({
    takenAt: new Date(Math.max(...names.map((n) => fs.statSync(path.join(snapDir, n)).mtimeMs))).toISOString(),
    partial: true,
    routes: names.length,
    members: pick(/^api_congress_member_([A-Z]\d{6})_timeline\.json$/),
    symbols: pick(/^api_tickers_([^_]+)\.json$/)
  }));
}
fs.rmSync(partialDir, { recursive: true, force: true });
const manifest = JSON.parse(fs.readFileSync(path.join(snapDir, "manifest.json"), "utf8"));
const TRIM = arg("trim", "full");
let before = 0;
let after = 0;
const lite = [];
for (const file of fs.readdirSync(snapDir)) {
  if (!file.endsWith(".json")) continue;
  const full = path.join(snapDir, file);
  const text = fs.readFileSync(full, "utf8");
  before += text.length;
  const body = trimRoute(file, JSON.parse(text), { mode: TRIM });
  if (body?.demoTrim) lite.push(file);
  const next = JSON.stringify(body);
  after += next.length;
  fs.writeFileSync(full, next);
}
console.log(`snapshot prepared for publishing (${TRIM}): ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB${lite.length ? ` · lists capped in ${lite.length} files: ${lite.slice(0, 8).join(", ")}${lite.length > 8 ? "…" : ""}` : " · no lists capped"}`);

const pages = path.join(root, "scripts", "member-pages.mjs");
if (fs.existsSync(pages)) run(process.execPath, [pages, "--out", OUT, "--url", URL_BASE]);

fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
fs.copyFileSync(path.join(OUT, "index.html"), path.join(OUT, "404.html"));

/** GitHub rejects files over 100 MB and Pages sites over 1 GB; stop well short of both. */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const files = walk(OUT).map((f) => ({ f, size: fs.statSync(f).size }));
const total = files.reduce((s, x) => s + x.size, 0);
const largest = files.reduce((a, b) => (b.size > a.size ? b : a), { f: "", size: 0 });
const count = (re) => files.filter((x) => re.test(path.relative(OUT, x.f))).length;
console.log(`dist-demo: ${(total / 1e6).toFixed(1)} MB in ${files.length} files · snapshot ${count(/^snapshot\//)} · share pages ${count(/^m\/[^/]+\/index\.html$/)} · cards ${count(/^m\/[^/]+\/card\.png$/)} · largest ${path.relative(OUT, largest.f)} ${(largest.size / 1e6).toFixed(1)} MB`);
if (largest.size > 95e6 || total > 900e6) {
  console.error("Too large for GitHub Pages (file over 95 MB or site over 900 MB). Rerun with --trim lite or smaller --members/--tickers/--spans.");
  process.exit(1);
}
if (total > 500e6) console.warn("Warning: site is over 500 MB; consider --spans 6mo or --trim lite.");

if (flag("no-push")) {
  console.log(`built ${OUT}. Preview: npx vite preview --outDir dist-demo --base ${BASE} --port 4180`);
  process.exit(0);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "intel-pages-"));
const remoteHas = git(["ls-remote", "--heads", "origin", BRANCH]).length > 0;
try {
  if (remoteHas) {
    git(["fetch", "origin", BRANCH]);
    git(["worktree", "add", "-B", BRANCH, work, `origin/${BRANCH}`], { stdio: "inherit" });
  } else {
    git(["worktree", "add", "--detach", work], { stdio: "inherit" });
    git(["checkout", "--orphan", BRANCH], { cwd: work });
    git(["rm", "-rf", "--quiet", "."], { cwd: work });
  }
  for (const entry of fs.readdirSync(work)) if (entry !== ".git") fs.rmSync(path.join(work, entry), { recursive: true, force: true });
  fs.cpSync(OUT, work, { recursive: true });
  git(["add", "-A"], { cwd: work });
  const changed = git(["status", "--porcelain"], { cwd: work });
  if (!changed) {
    console.log("gh-pages already up to date");
  } else {
    git(["commit", "--quiet", "-m", `Publish demo · snapshot ${manifest.takenAt || "?"}`], { cwd: work });
    git(["push", "origin", `${BRANCH}:${BRANCH}`], { cwd: work, stdio: "inherit" });
    console.log(`pushed ${BRANCH}: ${git(["rev-parse", "--short", "HEAD"], { cwd: work })} → ${URL_BASE}`);
  }
} finally {
  git(["worktree", "remove", "--force", work]);
}
