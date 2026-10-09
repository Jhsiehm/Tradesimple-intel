/**
 * Pure pieces of the posting bot: which filings to post, the post text, Bluesky link facets, and the
 * OAuth 1.0a signature for X. No network, no clock (callers pass `today`, nonces, and timestamps).
 */
import crypto from "node:crypto";
import { amountShort, dayLabel, honorific, partyTag, verbOf } from "../shared/sentences.mjs";
import { LATE_DAYS } from "../shared/constants.mjs";

export { LATE_DAYS };
export const LARGE_LOW = 250_001;
export const NEAR_DAYS = 14;
export const LIMITS = { bluesky: 300, x: 280 };
const X_URL_LEN = 23;

const back = (today, days) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** Why a trade is worth a post, strongest first. Empty when it is routine. */
export function reasons(t) {
  const out = [];
  if (t.lag != null && t.lag > LATE_DAYS) out.push("late");
  if (t.near && Math.abs(t.near.gap) <= NEAR_DAYS) out.push("near");
  if ((t.amountLow || 0) >= LARGE_LOW) out.push("large");
  return out;
}

function score(t, why) {
  return (why.includes("late") ? 1000 + Math.min(t.lag, 2000) : 0) + (why.includes("near") ? 500 - Math.abs(t.near.gap) * 10 : 0) + (why.includes("large") ? Math.log10(t.amountLow || 1) * 40 : 0);
}

/**
 * Pure. New filings since the last run (filed after `state.lastFiled`, or within `sinceDays` on a first run),
 * not already posted, that are late, large, or near a hearing on the member's committees. At most one post
 * per report, strongest first, capped at `max`.
 */
export function selectPosts(trades, { state = {}, today, sinceDays = 3, max = 5 } = {}) {
  const posted = new Set(Object.keys(state.posted || {}));
  const from = state.lastFiled || back(today, sinceDays);
  const fresh = trades.filter((t) => t.filed && (state.lastFiled ? t.filed > from : t.filed >= from) && t.filed <= today);
  const picked = new Map();
  for (const t of fresh) {
    if (posted.has(t.id)) continue;
    const why = reasons(t);
    if (!why.length) continue;
    const key = t.link || t.id;
    const s = score(t, why);
    const prev = picked.get(key);
    if (!prev || s > prev.score) picked.set(key, { trade: t, why, score: s, siblings: (prev?.siblings || 0) + (prev ? 1 : 0) });
    else prev.siblings += 1;
  }
  const lastFiled = fresh.reduce((m, t) => (t.filed > m ? t.filed : m), state.lastFiled || "");
  return {
    lastFiled,
    considered: fresh.length,
    posts: [...picked.values()].sort((a, b) => b.score - a.score || String(b.trade.filed).localeCompare(String(a.trade.filed))).slice(0, max)
  };
}

function committee(name) {
  return String(name || "their committee").replace(/^(House|Senate|Joint) Committee on (the )?/i, "$1 ").replace(/^Committee on (the )?/i, "");
}

/** Factual headline: "Filed 466 days late", "Traded 2 days before a House Armed Services hearing", "Disclosed $1M–$5M trade". */
export function headline(t, why) {
  if (why[0] === "late") return `Filed ${t.lag} days late`;
  if (why[0] === "near") {
    const g = t.near.gap;
    const when = g === 0 ? "on the day of" : `${Math.abs(g)} day${Math.abs(g) === 1 ? "" : "s"} ${g > 0 ? "before" : "after"}`;
    return `Traded ${when} a ${committee(t.near.laneName)} hearing`;
  }
  return `Disclosed ${amountShort(t.amount)} trade`;
}

/** Bluesky counts graphemes; X counts every URL as 23 characters. */
export function postLength(text, network, url = "") {
  if (network === "x" && url) return [...text.replace(url, "")].length + X_URL_LEN;
  return [...text].length;
}

export function displayUrl(url) {
  try {
    const u = new URL(url);
    const tail = u.pathname.split("/").filter(Boolean).pop() || "";
    return `${u.host}/…/${tail}`.slice(0, 60);
  } catch {
    return String(url).slice(0, 60);
  }
}

/**
 * Pure. Post text for one pick, shortened step by step until it fits the network limit. Near-hearing posts
 * always keep the caveat. Returns { text, url, display } where `display` is the visible link text.
 */
export function composePost(pick, { network = "bluesky", refYear } = {}) {
  const t = pick.trade;
  const why = pick.why;
  const head = headline(t, why);
  const caveat = !why.includes("near") ? "" : why[0] === "near" ? "Calendar proximity only, not evidence of wrongdoing." : `${headline(t, ["near"])}; calendar proximity only, not evidence of wrongdoing.`;
  const more = pick.siblings ? ` (+${pick.siblings} more in this report)` : "";
  const url = t.link || "";
  const display = network === "bluesky" ? displayUrl(url) : url;
  const what = t.symbol || t.asset || "an asset";
  const lag = t.lag != null ? ` (${t.lag}d)` : "";
  const who = (party) => `${honorific(t)} ${t.person}${party && partyTag(t) ? ` (${partyTag(t)})` : ""}`;
  const variants = [
    [`${head}: ${who(true)} ${verbOf(t)} ${amountShort(t.amount)} ${what} · traded ${dayLabel(t.traded, refYear)}, filed ${dayLabel(t.filed, refYear)}${lag}${more}.`, caveat, url ? `Filing: ${display}` : ""],
    [`${head}: ${who(true)} ${verbOf(t)} ${amountShort(t.amount)} ${what} · traded ${dayLabel(t.traded, refYear)}, filed ${dayLabel(t.filed, refYear)}${lag}.`, caveat, url ? `Filing: ${display}` : ""],
    [`${head}: ${who(false)} ${verbOf(t)} ${amountShort(t.amount)} ${what}, traded ${dayLabel(t.traded, refYear)}.`, caveat, url ? display : ""],
    [`${head}: ${who(false)} ${verbOf(t)} ${what}.`, caveat ? "Calendar proximity only." : "", url ? display : ""]
  ];
  const limit = LIMITS[network] || 280;
  for (const parts of variants) {
    const text = parts.filter(Boolean).join("\n");
    if (postLength(text, network, display) <= limit) return { text, url, display };
  }
  const parts = variants.at(-1);
  const tail = parts.slice(1).filter(Boolean).join("\n");
  const room = limit - postLength(tail, network, display) - 2;
  return { text: `${[...parts[0]].slice(0, Math.max(10, room)).join("")}…\n${tail}`, url, display };
}

/** Bluesky link facet: byte offsets (UTF-8) of the visible link text, pointing at the full URL. */
export function linkFacets(text, display, url) {
  if (!display || !url) return [];
  const at = text.lastIndexOf(display);
  if (at < 0) return [];
  const enc = new TextEncoder();
  const byteStart = enc.encode(text.slice(0, at)).length;
  return [{ index: { byteStart, byteEnd: byteStart + enc.encode(display).length }, features: [{ $type: "app.bsky.richtext.facet#link", uri: url }] }];
}

const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** OAuth 1.0a HMAC-SHA1 Authorization header. `params` are the query/form params that are part of the signature. */
export function oauthHeader({ method, url, params = {}, consumerKey, consumerSecret, token, tokenSecret, nonce, timestamp }) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_token: token,
    oauth_version: "1.0"
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all).sort().map((k) => `${rfc3986(k)}=${rfc3986(String(all[k]))}`).join("&");
  const base = [method.toUpperCase(), rfc3986(url), rfc3986(paramString)].join("&");
  const key = `${rfc3986(consumerSecret)}&${rfc3986(tokenSecret || "")}`;
  const signature = crypto.createHmac("sha1", key).update(base).digest("base64");
  const header = { ...oauth, oauth_signature: signature };
  return { signature, base, header: `OAuth ${Object.keys(header).sort().map((k) => `${rfc3986(k)}="${rfc3986(header[k])}"`).join(", ")}` };
}
