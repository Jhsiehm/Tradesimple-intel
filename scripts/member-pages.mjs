#!/usr/bin/env node
/**
 * Per-member share pages for the static demo: m/<slug>/index.html and m/<BIOGUIDE>/index.html, each with
 * Open Graph / Twitter meta and a 1200×630 card.png rendered by resvg (no browser).
 *   node scripts/member-pages.mjs --out dist-demo --url https://jhsiehm.github.io/Tradesimple-intel/
 * Reads the timelines already in <out>/snapshot. Run after `vite build` (publish:demo does this).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { cardSvg, memberPageHtml, summarize } from "../shared/card.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const OUT = path.resolve(root, arg("out", "dist-demo"));
const URL_BASE = String(arg("url", process.env.PUBLIC_URL || "https://jhsiehm.github.io/Tradesimple-intel/")).replace(/\/?$/, "/");
const HOST = URL_BASE.replace(/^https?:\/\//, "").replace(/\/$/, "");

const FONTS = ["/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"].filter((f) => fs.existsSync(f));

export function renderPng(svg) {
  const font = FONTS.length ? { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Menlo" } : { loadSystemFonts: true };
  return new Resvg(svg, { fitTo: { mode: "original" }, font }).render().asPng();
}

const snap = path.join(OUT, "snapshot");
const files = fs.readdirSync(snap).filter((f) => /^api_congress_member_[A-Z]\d{6}_timeline\.json$/.test(f));
const used = new Map();
const index = [];
for (const file of files) {
  const s = summarize(JSON.parse(fs.readFileSync(path.join(snap, file), "utf8")));
  if (!s) continue;
  const slug = used.has(s.slug) ? `${s.slug}-${s.bioguide.toLowerCase()}` : s.slug;
  used.set(slug, s.bioguide);
  const png = renderPng(cardSvg(s, { host: HOST }));
  for (const dir of [slug, s.bioguide]) {
    const target = path.join(OUT, "m", dir);
    fs.mkdirSync(target, { recursive: true });
    const pageUrl = `${URL_BASE}m/${dir}/`;
    fs.writeFileSync(path.join(target, "card.png"), png);
    fs.writeFileSync(path.join(target, "index.html"), memberPageHtml(s, { pageUrl, imageUrl: `${pageUrl}card.png`, appPath: "../../" }));
  }
  index.push({ bioguide: s.bioguide, name: s.name, slug });
}
fs.writeFileSync(path.join(OUT, "m", "index.json"), JSON.stringify(index));
console.log(`member pages: ${index.length} members → ${path.relative(root, path.join(OUT, "m"))}/<slug>/ (cards ${1200}×${630})`);
