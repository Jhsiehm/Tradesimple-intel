/**
 * Sign-in for a hosted (VPS) copy. One owner: a scrypt password hash (INTEL_PASSWORD_HASH, from `npm run auth:hash`),
 * an optional TOTP secret (INTEL_TOTP_SECRET), and a stateless session cookie signed with INTEL_SESSION_SECRET.
 * Rotating the session secret signs every browser out. Login is required in production (NODE_ENV=production or
 * INTEL_AUTH=on) and for any request that is not a direct loopback call; `npm run dev` on 127.0.0.1 never asks.
 */
import crypto from "node:crypto";

const LOOPBACK = /^(127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/;
const SCRYPT_N = 1 << 15;
const b64u = (buf) => Buffer.from(buf).toString("base64url");

const scrypt = (password, salt, len, opts) =>
  new Promise((resolve, reject) => crypto.scrypt(password, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))));

const scryptOpts = (N, r, p) => ({ N, r, p, maxmem: 256 * N * r + 1024 * 1024 });

/** `scrypt:N:r:p:salt:key` (base64url, no `$`, so it survives env files and shells unquoted). */
export async function hashPassword(password, { N = SCRYPT_N, r = 8, p = 1, salt = crypto.randomBytes(16) } = {}) {
  if (!password) throw new Error("Empty password.");
  const key = await scrypt(String(password).normalize("NFKC"), salt, 32, scryptOpts(N, r, p));
  return `scrypt:${N}:${r}:${p}:${b64u(salt)}:${b64u(key)}`;
}

export function parseHash(stored) {
  const m = /^scrypt:(\d+):(\d+):(\d+):([\w-]{16,}):([\w-]{40,})$/.exec(String(stored || "").trim());
  if (!m) return null;
  const [N, r, p] = [m[1], m[2], m[3]].map(Number);
  if (N < 1024 || N > 1 << 20 || (N & (N - 1)) !== 0 || r < 1 || r > 32 || p < 1 || p > 16) return null;
  return { N, r, p, salt: Buffer.from(m[4], "base64url"), key: Buffer.from(m[5], "base64url") };
}

export async function verifyPassword(password, stored) {
  const h = parseHash(stored);
  if (!h || typeof password !== "string" || !password || password.length > 1024) return false;
  const key = await scrypt(password.normalize("NFKC"), h.salt, h.key.length, scryptOpts(h.N, h.r, h.p));
  return crypto.timingSafeEqual(key, h.key);
}

const mac = (body, secret) => crypto.createHmac("sha256", secret).update(body).digest("base64url");

/** `payload.mac`, both base64url. */
export function signSession(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${mac(body, secret)}`;
}

/** The payload when the signature matches and `exp` is in the future, else null. */
export function readSession(value, secret, now = Date.now()) {
  const [body, sig, extra] = String(value || "").split(".");
  if (!body || !sig || extra !== undefined || !secret) return null;
  const want = Buffer.from(mac(body, secret));
  const got = Buffer.from(sig);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload && typeof payload.exp === "number" && payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!(name in out)) out[name] = part.slice(eq + 1).trim();
  }
  return out;
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(text) {
  const clean = String(text || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) return null;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits ? out + B32[(value << (5 - bits)) & 31] : out;
}

/** RFC 6238 code (SHA-1, 6 digits, 30 s steps) for one step counter. */
export function totpAt(key, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** The matching step counter (±1 step of clock drift), or -1. Counters at or below `after` are replays. */
export function checkTotp(code, secretB32, now = Date.now(), after = -1) {
  const key = base32Decode(secretB32);
  if (!key?.length || !/^\d{6}$/.test(String(code || "").trim())) return -1;
  const step = Math.floor(now / 30_000);
  for (const c of [step - 1, step, step + 1]) {
    if (c > after && crypto.timingSafeEqual(Buffer.from(totpAt(key, c)), Buffer.from(String(code).trim()))) return c;
  }
  return -1;
}

/**
 * Failed-login limiter: `perIp` failures per window per client, `global` across all clients (a spread-out guess
 * attack locks sign-in for everyone until the window passes; the owner waits, the attacker gets nowhere).
 */
export function createLimiter({ perIp = 5, global = 30, windowMs = 15 * 60_000, maxIps = 10_000 } = {}) {
  const byIp = new Map();
  let all = [];
  const live = (list, now) => list.filter((t) => now - t < windowMs);
  return {
    check(ip, now = Date.now()) {
      all = live(all, now);
      const mine = live(byIp.get(ip) || [], now);
      if (mine.length) byIp.set(ip, mine);
      else byIp.delete(ip);
      const full = mine.length >= perIp ? mine : all.length >= global ? all : null;
      if (!full) return { ok: true, retryAfterS: 0 };
      return { ok: false, retryAfterS: Math.max(1, Math.ceil((full[0] + windowMs - now) / 1000)) };
    },
    fail(ip, now = Date.now()) {
      if (!byIp.has(ip) && byIp.size >= maxIps) byIp.delete(byIp.keys().next().value);
      byIp.set(ip, [...live(byIp.get(ip) || [], now), now]);
      all.push(now);
    },
    reset(ip) {
      byIp.delete(ip);
    }
  };
}

/** Direct loopback call with no proxy in between (Caddy always adds X-Forwarded-For). */
export function isLocal(req) {
  const h = req.headers || {};
  return LOOPBACK.test(String(req.socket?.remoteAddress || "")) && !h["x-forwarded-for"] && !h.forwarded;
}

/** Client address: the socket, or behind a loopback proxy the last X-Forwarded-For hop (the one Caddy saw). */
export function clientIp(req) {
  const remote = String(req.socket?.remoteAddress || "");
  const fwd = String(req.headers?.["x-forwarded-for"] || "");
  if (!LOOPBACK.test(remote) || !fwd) return remote;
  return fwd.split(",").map((s) => s.trim()).filter(Boolean).pop() || remote;
}

const originOf = (raw) => {
  try {
    return raw ? new URL(String(raw).trim()).origin : "";
  } catch {
    return "";
  }
};

/** Auth settings from the environment. `problems` non-empty in production means the server must not start. */
export function authConfig(env = process.env) {
  const production = env.NODE_ENV === "production" || env.INTEL_AUTH === "on";
  const origin = originOf(env.PUBLIC_ORIGIN);
  const hash = String(env.INTEL_PASSWORD_HASH || "").trim();
  const secret = String(env.INTEL_SESSION_SECRET || "").trim();
  const totp = String(env.INTEL_TOTP_SECRET || "").trim();
  const days = Math.min(90, Math.max(1, Number(env.INTEL_SESSION_DAYS) || 30));
  const problems = [];
  if (!parseHash(hash)) problems.push("INTEL_PASSWORD_HASH is missing or malformed (make one with `npm run auth:hash`).");
  if (secret.length < 32) problems.push("INTEL_SESSION_SECRET must be at least 32 characters (`npm run auth:hash` prints one).");
  if (totp && !(base32Decode(totp)?.length >= 10)) problems.push("INTEL_TOTP_SECRET is not a base32 secret of at least 16 characters.");
  const configured = !problems.length;
  if (production && !origin) problems.push("PUBLIC_ORIGIN is not set (the https:// address you open the app at).");
  const secure = origin.startsWith("https:");
  return {
    production,
    configured,
    origin,
    hash,
    secret,
    totp,
    ttlMs: days * 86_400_000,
    secure,
    cookie: secure ? "__Host-intel_session" : "intel_session",
    problems
  };
}

/** Production always signs in; development only for requests that did not come straight from this machine. */
export function needsLogin(req, cfg) {
  return cfg.production || !isLocal(req);
}

export function sessionCookie(cfg, value, maxAgeS) {
  return `${cfg.cookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${cfg.secure ? "; Secure" : ""}`;
}

/** Same-origin check for the login and logout forms (they are plain form posts, so lib/guard.mjs does not apply). */
export function formOriginOk(req, cfg) {
  const h = req.headers || {};
  const site = String(h["sec-fetch-site"] || "").toLowerCase();
  if (site === "cross-site" || site === "same-site") return false;
  const origin = h.origin;
  if (origin == null) return true;
  const self = cfg.origin || `http://${h.host}`;
  return String(origin) === self;
}

/** Only same-site relative paths; anything else lands on the app root. */
export function safeNext(raw) {
  const s = String(raw || "");
  return /^\/(?![/\\])[^\s]*$/.test(s) && !s.startsWith("/login") && !s.startsWith("/logout") ? s : "/";
}
