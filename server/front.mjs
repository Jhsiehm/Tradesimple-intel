/**
 * The HTTP front in front of the route table. Order: /healthz and /api/health (open), /login and /logout, the
 * sign-in gate (lib/auth.mjs), then the built app from dist/ (production or INTEL_SERVE_DIST=1) for GET/HEAD
 * outside /api and /geo, and finally the API router. In development on loopback this is a pass-through.
 */
import path from "node:path";
import { authConfig, checkTotp, clientIp, createLimiter, formOriginOk, needsLogin, parseCookies, readSession, safeNext, sessionCookie, signSession, verifyPassword } from "./lib/auth.mjs";
import { readBody } from "./lib/body.mjs";
import { staticSite } from "./lib/static.mjs";
import { PAGE_HEADERS, loginPage, logoutPage } from "./lib/loginPage.mjs";

const API = /^\/(api|geo)(\/|$)/;
const OPEN = new Set(["/healthz", "/api/health"]);

/**
 * `handle(req, res)` is the API router. Throws in production when sign-in is not fully configured, so a
 * misconfigured server never starts open.
 */
export function createFront({ handle, root, env = process.env, now = () => Date.now(), log = console.log }) {
  const cfg = authConfig(env);
  if (cfg.production && cfg.problems.length) throw new Error(`Sign-in is not configured:\n  - ${cfg.problems.join("\n  - ")}`);
  if (cfg.production && !cfg.secure) log(`intel auth: WARNING ${cfg.origin} is plain http; the password and session cookie travel unencrypted.`);
  const limiter = createLimiter();
  const serveStatic = cfg.production || env.INTEL_SERVE_DIST === "1" ? staticSite(path.join(root, env.INTEL_DIST || "dist")) : null;
  let lastTotp = -1;

  function session(req) {
    return cfg.configured ? readSession(parseCookies(req.headers.cookie)[cfg.cookie], cfg.secret, now()) : null;
  }

  function issue(res) {
    const iat = now();
    const value = signSession({ sub: "owner", iat, exp: iat + cfg.ttlMs }, cfg.secret);
    res.setHeader("Set-Cookie", sessionCookie(cfg, value, Math.floor(cfg.ttlMs / 1000)));
  }

  function page(res, status, html, extra = {}) {
    res.writeHead(status, { ...PAGE_HEADERS, ...extra });
    res.end(html);
  }

  function redirect(res, to, extra = {}) {
    res.writeHead(303, { Location: to, "Cache-Control": "no-store", ...extra });
    res.end();
  }

  async function login(req, res, url) {
    if (req.method === "GET" || req.method === "HEAD") {
      if (session(req)) return redirect(res, safeNext(url.searchParams.get("next")));
      return page(res, 200, loginPage({ next: safeNext(url.searchParams.get("next")), totp: Boolean(cfg.totp) }));
    }
    if (req.method !== "POST") return page(res, 405, loginPage(), { Allow: "GET, POST" });
    if (!cfg.configured) return page(res, 503, loginPage({ error: "Sign-in is not configured on this server." }));
    if (!formOriginOk(req, cfg)) return page(res, 403, loginPage({ error: "Sign-in must come from this site." }));
    const ip = clientIp(req);
    const gate = limiter.check(ip, now());
    if (!gate.ok) {
      log(`intel auth: rate limited ${ip}`);
      return page(res, 429, loginPage({ error: `Too many attempts. Try again in ${Math.ceil(gate.retryAfterS / 60)} min.`, totp: Boolean(cfg.totp) }), { "Retry-After": String(gate.retryAfterS) });
    }
    let form;
    try {
      form = new URLSearchParams(await readBody(req, 4096));
    } catch {
      return page(res, 413, loginPage({ error: "Form too large." }));
    }
    const next = safeNext(form.get("next"));
    const passOk = await verifyPassword(form.get("password") || "", cfg.hash);
    const step = cfg.totp ? checkTotp(form.get("code"), cfg.totp, now(), lastTotp) : 0;
    if (!passOk || step < 0) {
      limiter.fail(ip, now());
      log(`intel auth: failed login from ${ip}`);
      return page(res, 401, loginPage({ next, error: cfg.totp ? "Wrong password or code." : "Wrong password.", totp: Boolean(cfg.totp) }));
    }
    if (cfg.totp) lastTotp = step;
    limiter.reset(ip);
    log(`intel auth: signed in from ${ip}`);
    issue(res);
    return redirect(res, next);
  }

  function logout(req, res) {
    if (req.method === "GET" || req.method === "HEAD") return page(res, 200, logoutPage());
    if (req.method !== "POST") return page(res, 405, logoutPage(), { Allow: "GET, POST" });
    if (!formOriginOk(req, cfg)) return page(res, 403, logoutPage());
    return redirect(res, "/login", { "Set-Cookie": sessionCookie(cfg, "", 0) });
  }

  async function front(req, res) {
    const url = new URL(req.url || "/", "http://front.invalid");
    const p = url.pathname;
    try {
      if (p === "/healthz") {
        res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
        return res.end("ok");
      }
      if (p === "/login") return await login(req, res, url);
      if (p === "/logout") return logout(req, res);
      if (!OPEN.has(p) && needsLogin(req, cfg)) {
        const s = session(req);
        if (!s) {
          if (API.test(p) || (req.method !== "GET" && req.method !== "HEAD")) {
            res.writeHead(401, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            return res.end(JSON.stringify({ ok: false, error: "Sign in required.", login: "/login", missing: "" }));
          }
          return redirect(res, `/login?next=${encodeURIComponent(safeNext(p + url.search))}`);
        }
        if (s.exp - now() < cfg.ttlMs / 2) issue(res);
      }
      if (serveStatic && !API.test(p) && (req.method === "GET" || req.method === "HEAD")) return await serveStatic(req, res, url);
      return await handle(req, res);
    } catch (err) {
      if (res.headersSent) return res.destroy();
      res.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ok: false, error: err?.message || "Request failed" }));
    }
  }

  front.production = cfg.production;
  return front;
}
