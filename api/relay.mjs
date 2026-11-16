/**
 * Vercel Node function: same-origin streaming gateway for the public beta.
 *
 * No keys or direct backend addresses are shipped to the browser.
 * The persistent backend independently enforces the public route/tool allowlist.
 * The owner uses the backend domain directly for private features and login.
 */
import crypto from "node:crypto";

const allowed = /^(api|geo)\/[A-Za-z0-9_./-]+$/;
const filteredHeaders = [
  "content-type", "cache-control", "retry-after", "content-encoding",
  "content-disposition", "vary", "last-modified", "etag",
];
const clean = (value) => String(Array.isArray(value) ? value[0] : value || "");

export default async function handler(req, res) {
  const origin = process.env.INTEL_BACKEND_ORIGIN || "";
  const secret = process.env.INTEL_PROXY_SECRET || "";
  let upstream;
  try {
    upstream = new URL(origin);
    if (
      upstream.protocol !== "https:" ||
      upstream.username ||
      upstream.password ||
      upstream.pathname !== "/" ||
      upstream.search ||
      upstream.hash ||
      secret.length < 32
    ) throw new Error("Invalid backend configuration");
  } catch {
    res.statusCode = 503;
    return res.end("The public beta backend is not configured.");
  }

  const incoming = new URL(req.url || "/", "https://beta.invalid");
  const route = incoming.searchParams.get("route") || "";
  if (!allowed.test(route) || route.split("/").some((part) => part === "." || part === "..")) {
    res.statusCode = 404;
    return res.end("Not found.");
  }
  incoming.searchParams.delete("route");

  // Rate limits have a signed per-visitor identifier, not a caller-supplied
  // x-forwarded-for header. The backend validates the signature independently.
  const ip = clean(req.headers["x-vercel-forwarded-for"] || req.socket?.remoteAddress);
  const ua = clean(req.headers["user-agent"]).slice(0, 250);
  const visitor = crypto.createHmac("sha256", secret).update(ip + "\n" + ua).digest("hex");
  const signature = crypto.createHmac("sha256", secret).update(visitor).digest("hex");
  const headers = {
    "accept": clean(req.headers.accept) || "*/*",
    "accept-encoding": "identity",
    "origin": upstream.origin,
    "content-type": "application/json",
    "x-intel-beta-visitor": visitor,
    "x-intel-beta-signature": signature,
    "user-agent": "TradeSimpleIntel-Beta-Gateway/1.0",
  };
  // Never forward browser cookies, user-supplied forwarding headers, auth headers,
  // or headers that could confuse the backend's origin checks.
  const method = String(req.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "POST"].includes(method)) {
    res.statusCode = 405;
    return res.end("Method not allowed.");
  }
  if (method === "POST" && !["api/ask", "api/backtest"].includes(route)) {
    res.statusCode = 403;
    return res.end("This public beta operation is not available.");
  }
  const destination = new URL("/" + route, upstream);
  destination.search = incoming.searchParams.toString();
  let body;
  if (method === "POST") {
    // Vercel's Node request parser may already have consumed the JSON payload.
    body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
    if (Buffer.byteLength(body) > 32 * 1024) {
      res.statusCode = 413;
      return res.end("Request too large.");
    }
  }
  try {
    const response = await fetch(destination, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: req.signal,
    });
    res.statusCode = response.status;
    for (const name of filteredHeaders) {
      const value = response.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!response.body || method === "HEAD") return res.end();
    const reader = response.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done || res.destroyed) break;
        if (value?.length) res.write(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
      if (!res.writableEnded) res.end();
    }
  } catch {
    if (!res.headersSent) {
      res.statusCode = 502;
      return res.end("The public beta backend is temporarily unavailable.");
    }
    res.end();
  }
}
