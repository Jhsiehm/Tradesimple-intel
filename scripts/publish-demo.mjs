#!/usr/bin/env node
/**
 * Build the zero-key demo for GitHub Pages and push it to the gh-pages branch.
 *   npm run publish:demo                      # build from the existing demo/snapshot and push
 *   npm run publish:demo -- --snapshot        # capture the running API first (needs `npm start` with your keys)
 *   npm run publish:demo -- --no-push         # build dist-demo/ only
 * Options: --base /Tradesimple-intel/  --url https://jhsiehm.github.io/Tradesimple-intel/  --branch gh-pages
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
const git = (args, opts = {}) => execFileSync("git", args, { cwd: root, encoding: "utf8", ...opts }).trim();

if (flag("snapshot")) run(process.execPath, ["scripts/snapshot.mjs", ...(arg("members") ? ["--members", arg("members")] : [])]);
const manifestFile = path.join(root, "demo", "snapshot", "manifest.json");
if (!fs.existsSync(manifestFile)) {
  console.error("No demo/snapshot. Start the API with your keys, then run: npm run publish:demo -- --snapshot");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));

console.log(`building demo for ${URL_BASE} (base ${BASE})`);
run(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
  env: { ...process.env, VITE_DEMO: "1", VITE_BASE: BASE, VITE_PUBLIC_URL: URL_BASE }
});

const snapDir = path.join(OUT, "snapshot");
let before = 0;
let after = 0;
for (const file of fs.readdirSync(snapDir)) {
  if (!file.endsWith(".json")) continue;
  const full = path.join(snapDir, file);
  const text = fs.readFileSync(full, "utf8");
  before += text.length;
  const next = JSON.stringify(trimRoute(file, JSON.parse(text)));
  after += next.length;
  fs.writeFileSync(full, next);
}
console.log(`snapshot trimmed for publishing: ${(before / 1e6).toFixed(1)} MB → ${(after / 1e6).toFixed(1)} MB`);

const pages = path.join(root, "scripts", "member-pages.mjs");
if (fs.existsSync(pages)) run(process.execPath, [pages, "--out", OUT, "--url", URL_BASE]);

fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
fs.copyFileSync(path.join(OUT, "index.html"), path.join(OUT, "404.html"));

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
