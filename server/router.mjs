/**
 * Table router. Paths are matched in table order against the raw (still percent-encoded) pathname, first match
 * wins. `:name` matches one segment; `:name(regex)` constrains it. Params arrive undecoded.
 * A handler returns the JSON body (sent as 200), `reply(status, body)` for another status, or `undefined`
 * after writing to `ctx.res` itself.
 */
import { sendEncoded } from "./lib/compress.mjs";
import { allowedOrigins, crossSiteRefusal } from "./lib/guard.mjs";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function compile(path) {
  const names = [];
  let pattern = "";
  let last = 0;
  for (const m of path.matchAll(/:(\w+)(\((?:[^()]|\([^()]*\))*\))?/g)) {
    pattern += escapeRe(path.slice(last, m.index)) + (m[2] || "([^/]+)");
    names.push(m[1]);
    last = m.index + m[0].length;
  }
  const re = new RegExp(`^${pattern}${escapeRe(path.slice(last))}$`);
  return (pathname) => {
    const m = pathname.match(re);
    if (!m) return null;
    return Object.fromEntries(names.map((n, i) => [n, m[i + 1]]));
  };
}

const REPLY = Symbol("reply");

export function reply(status, body) {
  return { [REPLY]: true, status, body };
}

/** JSON response; brotli or gzip when `req` accepts it (see lib/compress.mjs). */
export function sendJson(res, status, body, req = null) {
  sendEncoded(req, res, status, { "Content-Type": "application/json", "Cache-Control": "no-store" }, JSON.stringify(body), body);
}

/** Query helpers bound to one request's search params. */
export function queryOf(searchParams) {
  return {
    params: searchParams,
    str: (name, fallback = "") => searchParams.get(name) || fallback,
    chamber: () => (searchParams.get("chamber") === "senate" ? "senate" : "house")
  };
}

/**
 * `manifest` is the ordered list of { id, path } entries; `handlers` maps id → handler. Every manifest id needs a
 * handler and every handler a manifest entry. POST/PUT/PATCH/DELETE pass lib/guard.mjs first (403 otherwise).
 */
export function createRouter(manifest, handlers, { origins = allowedOrigins() } = {}) {
  const missing = manifest.filter((r) => !handlers[r.id]).map((r) => r.id);
  const extra = Object.keys(handlers).filter((id) => !manifest.some((r) => r.id === id));
  if (missing.length || extra.length) throw new Error(`route table mismatch: missing ${missing.join(",") || "-"}; extra ${extra.join(",") || "-"}`);
  const table = manifest.map((r) => ({ ...r, match: compile(r.path), handler: handlers[r.id] }));

  function match(pathname) {
    for (const route of table) {
      const params = route.match(pathname);
      if (params) return { route, params };
    }
    return null;
  }

  async function handle(req, res, ctx) {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    try {
      const refused = crossSiteRefusal(req, origins);
      if (refused) return sendJson(res, 403, { ok: false, error: refused, missing: "" }, req);
      const found = match(url.pathname);
      if (!found) return sendJson(res, 404, { ok: false, error: "Not found" }, req);
      const out = await found.route.handler({ ...ctx, req, res, url, params: found.params, query: queryOf(url.searchParams) });
      if (out === undefined) return;
      if (out?.[REPLY]) return sendJson(res, out.status, out.body, req);
      sendJson(res, 200, out, req);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || "Request failed" }, req);
    }
  }

  return { match, handle, table };
}
