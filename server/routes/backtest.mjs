import { reply } from "../router.mjs";
import { readJson } from "../lib/body.mjs";
import { decodeSpec } from "../../shared/backtestSpec.mjs";
import { backtestOptions, runSpec } from "../domain/backtest/index.mjs";
import { replicateSpec } from "../domain/backtest/replicate.mjs";
import { latestSearch, searchView, startSearch } from "../domain/backtest/search.mjs";

const MAX_RUNNING = 2;
let running = 0;

/** `?spec=` is a JSON object or the base64url token the board puts after `#bt=`. */
function specFromQuery(raw) {
  const s = String(raw || "").trim();
  if (!s) return undefined;
  if (s.startsWith("{")) {
    try { return JSON.parse(s); } catch { return null; }
  }
  return decodeSpec(s);
}

async function guarded(fn) {
  if (running >= MAX_RUNNING) return reply(429, { ok: false, error: "Two backtests are already running. Try again in a few seconds.", missing: "" });
  running += 1;
  try {
    const out = await fn();
    return out.ok ? out : reply(out.building ? 503 : 400, out);
  } finally {
    running -= 1;
  }
}

export const handlers = {
  backtest: async ({ db, req, query }) => {
    let raw;
    if (req?.method === "POST") {
      const body = await readJson(req, 16 * 1024);
      if (!body.ok) return reply(body.status, { ok: false, error: body.error, missing: "" });
      raw = body.value?.spec ?? body.value;
    } else {
      raw = specFromQuery(query.str("spec"));
      if (raw === null) return reply(400, { ok: false, error: "spec must be a JSON object or a #bt= token.", missing: "" });
      if (raw === undefined) return backtestOptions(db);
    }
    return guarded(() => runSpec(db, raw));
  },
  /** The spec, the trades, and the daily bars one run used, so it can be re-run outside the app. */
  "backtest.replicate": async ({ db, query }) => {
    const raw = specFromQuery(query.str("spec"));
    if (!raw) return reply(400, { ok: false, error: "spec is required: a JSON object or a #bt= token.", missing: "" });
    return guarded(() => replicateSpec(db, raw));
  },
  /** POST starts a signal search (options in the body); GET ?id= polls one; GET alone shows the latest or idle. */
  "backtest.search": async ({ db, req, query }) => {
    if (req?.method === "POST") {
      const body = await readJson(req, 4 * 1024);
      if (!body.ok) return reply(body.status, { ok: false, error: body.error, missing: "" });
      const out = startSearch(db, body.value || {}, { fresh: Boolean(body.value?.fresh) });
      return out.ok ? out : reply(429, { ...out, missing: "" });
    }
    const id = query.str("id");
    if (!id) return latestSearch(db);
    return searchView(db, id) || reply(404, { ok: false, error: "No signal search with that id. Start one with POST.", missing: "" });
  }
};
