#!/usr/bin/env node
/**
 * Posting bot for new and notable Congress trade filings (late > 45 days, ≥ $250k, or within 14 days of a
 * hearing on the member's committees). DRY RUN by default: prints the posts and writes card images to /tmp/intel-bot.
 *   npm run bot                                  # dry run against the running API (npm start)
 *   npm run bot -- --max 3 --since-days 7         # wider first-run window, fewer posts
 *   npm run bot -- --post                         # actually post (needs keys in .env.local; see README)
 *   npm run bot -- --post --only bluesky          # one network
 * State (posted ids, last filed date) is kept in data/bot-state.json (gitignored), updated only with --post
 * or --mark. Keys are read from .env.local and only ever sent to bsky.social / api.x.com.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { loadEnv } from "../server/env.mjs";
import { cardSvg, summarize } from "../shared/card.mjs";
import { composePost, linkFacets, oauthHeader, selectPosts } from "./botlib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(root);
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const BASE = arg("base", "http://127.0.0.1:8787");
const MAX = Number(arg("max", 5));
const SINCE_DAYS = Number(arg("since-days", 3));
const POST = flag("post");
const ONLY = arg("only", "");
const STATE_FILE = path.join(root, "data", "bot-state.json");
const OUT = fs.existsSync("/tmp") ? "/tmp/intel-bot" : path.join(os.tmpdir(), "intel-bot");
const PUBLIC_URL = String(process.env.PUBLIC_URL || "https://jhsiehm.github.io/Tradesimple-intel/").replace(/\/?$/, "/");

const env = process.env;
const networks = {
  bluesky: Boolean(env.BSKY_HANDLE && env.BSKY_APP_PASSWORD),
  x: Boolean(env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET)
};
const targets = Object.keys(networks).filter((n) => !ONLY || n === ONLY);

const FONTS = ["/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"].filter((f) => fs.existsSync(f));
const png = (svg) => new Resvg(svg, { fitTo: { mode: "original" }, font: FONTS.length ? { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Menlo" } : { loadSystemFonts: true } }).render().asPng();

async function getJson(route) {
  const res = await fetch(BASE + route);
  if (!res.ok) throw new Error(`${route}: HTTP ${res.status}`);
  return res.json();
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { posted: {}, lastFiled: "" }; }
}

/* ---------- Bluesky (atproto) ---------- */
async function bskyPost(text, facets, image, alt) {
  const pds = env.BSKY_SERVICE || "https://bsky.social";
  const xrpc = async (method, body, headers = {}) => {
    const res = await fetch(`${pds}/xrpc/${method}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`bluesky ${method}: ${out.error || res.status} ${out.message || ""}`);
    return out;
  };
  const session = await xrpc("com.atproto.server.createSession", JSON.stringify({ identifier: env.BSKY_HANDLE, password: env.BSKY_APP_PASSWORD }));
  const auth = { Authorization: `Bearer ${session.accessJwt}` };
  const blob = await xrpc("com.atproto.repo.uploadBlob", image, { ...auth, "Content-Type": "image/png" });
  const record = {
    $type: "app.bsky.feed.post",
    text,
    facets,
    createdAt: new Date().toISOString(),
    embed: { $type: "app.bsky.embed.images", images: [{ alt, image: blob.blob, aspectRatio: { width: 1200, height: 630 } }] }
  };
  const out = await xrpc("com.atproto.repo.createRecord", JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }), auth);
  return out.uri;
}

/* ---------- X (API v2 + v1.1 media upload, OAuth 1.0a user context) ---------- */
function xAuth(method, url, params = {}) {
  return oauthHeader({
    method, url, params,
    consumerKey: env.X_API_KEY, consumerSecret: env.X_API_SECRET, token: env.X_ACCESS_TOKEN, tokenSecret: env.X_ACCESS_SECRET,
    nonce: crypto.randomBytes(16).toString("hex"), timestamp: Math.floor(Date.now() / 1000)
  }).header;
}

async function xPost(text, image) {
  const uploadUrl = "https://upload.twitter.com/1.1/media/upload.json";
  const form = new FormData();
  form.append("media", new Blob([image], { type: "image/png" }), "card.png");
  const up = await fetch(uploadUrl, { method: "POST", headers: { Authorization: xAuth("POST", uploadUrl) }, body: form });
  const media = await up.json().catch(() => ({}));
  if (!up.ok || !media.media_id_string) throw new Error(`x media upload: HTTP ${up.status}`);
  const tweetUrl = "https://api.x.com/2/tweets";
  const res = await fetch(tweetUrl, {
    method: "POST",
    headers: { Authorization: xAuth("POST", tweetUrl), "Content-Type": "application/json" },
    body: JSON.stringify({ text, media: { media_ids: [media.media_id_string] } })
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`x tweet: HTTP ${res.status} ${out.detail || out.title || ""}`);
  return `https://x.com/i/status/${out.data?.id}`;
}

/* ---------- run ---------- */
const state = readState();
const today = new Date().toISOString().slice(0, 10);
const board = await getJson("/api/markets/politicians").catch((err) => {
  console.error(`No API at ${BASE} (${err.message}). Start it with: npm start`);
  process.exit(1);
});
const trades = board.items || [];

const timelines = new Map();
const timelineFor = async (id) => {
  if (!id) return null;
  if (!timelines.has(id)) timelines.set(id, await getJson(`/api/congress/member/${id}/timeline`).catch(() => null));
  return timelines.get(id);
};
const firstPass = selectPosts(trades, { state, today, sinceDays: SINCE_DAYS, max: 10_000 });
const fresh = trades.filter((t) => t.filed && (state.lastFiled ? t.filed > state.lastFiled : t.filed >= new Date(Date.now() - SINCE_DAYS * 86_400_000).toISOString().slice(0, 10)));
for (const id of new Set(fresh.map((t) => t.bioguide).filter(Boolean))) {
  const tl = await timelineFor(id);
  const near = new Map((tl?.trades || []).filter((t) => t.near).map((t) => [t.id, t.near]));
  for (const t of fresh) if (t.bioguide === id && near.has(t.id)) t.near = near.get(t.id);
}
const { posts, considered, lastFiled } = selectPosts(trades, { state, today, sinceDays: SINCE_DAYS, max: MAX });

console.log(`${POST ? "POSTING" : "DRY RUN"} · ${considered} new trade lines since ${state.lastFiled || `${SINCE_DAYS} days ago`} · ${firstPass.posts.length} notable reports · showing ${posts.length} (max ${MAX})`);
console.log(`source: ${board.source} · as of ${board.asOf}`);
if (POST) {
  const ready = targets.filter((n) => networks[n]);
  if (!ready.length) {
    console.error("--post needs keys in .env.local: BSKY_HANDLE + BSKY_APP_PASSWORD, and/or X_API_KEY + X_API_SECRET + X_ACCESS_TOKEN + X_ACCESS_SECRET. Nothing posted.");
    process.exit(1);
  }
}
fs.mkdirSync(OUT, { recursive: true });

const refYear = Number(today.slice(0, 4));
for (const pick of posts) {
  const t = pick.trade;
  const tl = await timelineFor(t.bioguide);
  const s = summarize(tl);
  const imagePath = path.join(OUT, `${t.id}.png`);
  const image = s ? png(cardSvg(s, { host: PUBLIC_URL.replace(/^https?:\/\//, "").replace(/\/$/, "") })) : null;
  if (image) fs.writeFileSync(imagePath, image);
  const alt = s ? `${s.name}: ${s.trades} disclosed trades by week, filing lag, and calendar proximity to committee hearings.` : "";
  console.log(`\n— ${pick.why.join(" + ")} · ${t.id}${image ? ` · image ${imagePath}` : " · no timeline, no image"}`);
  for (const network of targets) {
    const post = composePost(pick, { network, refYear });
    console.log(`  [${network}] ${post.text.split("\n").join("\n           ")}`);
    if (!POST || !networks[network]) continue;
    try {
      const where = network === "bluesky"
        ? await bskyPost(post.text, linkFacets(post.text, post.display, post.url), image, alt)
        : await xPost(post.text, image);
      console.log(`  posted → ${where}`);
      state.posted = { ...(state.posted || {}), [t.id]: new Date().toISOString() };
    } catch (err) {
      console.error(`  ${network} failed: ${err.message}`);
    }
  }
}

if (POST || flag("mark")) {
  state.lastFiled = lastFiled || state.lastFiled || "";
  if (flag("mark")) for (const p of posts) state.posted = { ...(state.posted || {}), [p.trade.id]: `marked ${new Date().toISOString()}` };
  state.lastRun = new Date().toISOString();
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  console.log(`\nstate → ${path.relative(root, STATE_FILE)} (last filed ${state.lastFiled})`);
} else {
  console.log(`\nDry run: nothing posted, state unchanged. Images in ${OUT}. Keys present: bluesky ${networks.bluesky ? "yes" : "no"}, x ${networks.x ? "yes" : "no"}.`);
}
