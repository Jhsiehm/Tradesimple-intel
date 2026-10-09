/**
 * Cross-site request guard. The API listens on 127.0.0.1, but any page the user has open can still POST to it
 * (a form posts text/plain without a CORS preflight), which would run backtests or spend model credits.
 * State-changing methods must come from an allowed origin (the Vite app, INTEL_ALLOWED_ORIGINS) or,
 * with no Origin or Referer at all, from a loopback non-browser client (curl, scripts/warm.mjs); bodies must be
 * application/json. No CORS headers are sent anywhere, so other origins cannot read responses either.
 */

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const BODY = new Set(["POST", "PUT", "PATCH"]);
const LOOPBACK = /^(127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/;

const originOf = (raw) => {
  try {
    return new URL(String(raw).trim()).origin;
  } catch {
    return "";
  }
};

/** Origins allowed to make state-changing calls. */
export function allowedOrigins(env = process.env) {
  const out = new Set();
  for (const port of new Set(["5173", env.VITE_PORT].filter(Boolean))) {
    out.add(`http://127.0.0.1:${port}`);
    out.add(`http://localhost:${port}`);
  }
  for (const raw of String(env.INTEL_ALLOWED_ORIGINS || "").split(",")) {
    const o = raw && raw.trim() ? originOf(raw) : "";
    if (o && o !== "null") out.add(o);
  }
  return out;
}

/** `null` when the request may proceed, else the reason it is refused (sent as 403). */
export function crossSiteRefusal(req, origins) {
  const method = String(req.method || "GET").toUpperCase();
  if (SAFE.has(method)) return null;
  const h = req.headers || {};
  const site = String(h["sec-fetch-site"] || "").toLowerCase();
  if (site === "cross-site" || site === "same-site") return `Cross-site request refused (Sec-Fetch-Site: ${site}). Open the app at http://127.0.0.1:5173.`;
  const origin = h.origin;
  const referer = h.referer || h.referrer;
  if (origin != null) {
    if (!origins.has(String(origin))) return `Cross-site request refused: origin ${String(origin).slice(0, 80)} is not allowed. Open the app at http://127.0.0.1:5173.`;
  } else if (referer) {
    const from = originOf(referer);
    if (!origins.has(from)) return `Cross-site request refused: referer ${from || "unknown"} is not allowed. Open the app at http://127.0.0.1:5173.`;
  } else if (!LOOPBACK.test(String(req.socket?.remoteAddress || ""))) {
    return "Request refused: no Origin or Referer, and the caller is not on this machine.";
  }
  if (BODY.has(method)) {
    const type = String(h["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return `Request refused: Content-Type must be application/json${type ? `, not ${type.slice(0, 60)}` : ""}.`;
  }
  return null;
}
