import { tickerBySymbol } from "../../lib/db.mjs";
import { MINUTE } from "../../lib/time.mjs";
import { secCurrentAtom, secIndexHeaders } from "../../feeds/secCurrent.mjs";
import { form4, form4Rows } from "../positions/insiders.mjs";
import { CURRENT_FEEDS, CURRENT_MAX_PAGES, CURRENT_PAGE, cikIndex, groupFilings, headerPeriod, latencyNote, latencyStats, matchFilings, needsNextPage, newSince, newestAccepted, parseCurrentAtom } from "../../../shared/secCurrent.mjs";
import { filingEvent, insiderEvents, stakeEvent } from "../../../shared/watchlist.mjs";
import { hasSeen } from "./store.mjs";

/** Per-issuer submissions sweep interval: catches anything the Atom pages could not reach (server down, a burst). */
export const SWEEP_MS = 30 * MINUTE;
/** Detection-latency samples kept (every new Form 4 / 8-K / 13D / 13G in the feed, watched or not). */
export const LATENCY_SAMPLES = 400;

const defaults = {
  atom: (type, opts) => secCurrentAtom(type, opts),
  headers: (cik, accession) => secIndexHeaders(cik, accession),
  tickerOf: (db, symbol) => tickerBySymbol(db, symbol),
  readForm4: (db, cik, pick) => form4(db, cik, pick),
  seen: (db, id, symbol) => hasSeen(db, id, symbol),
  now: () => Date.now()
};

const failure = (label, err) => ({ symbol: label, message: String(err?.message || err || "failed").slice(0, 200), status: err?.status || 0, retryAfterMs: err?.retryAfterMs || 0 });
const blocked = (err) => err?.status === 403 || err?.status === 429;

/**
 * One poll of EDGAR's latest-filings Atom feeds (Form 4, 8-K, 13D, 13G) for the watched symbols. Issuers are matched
 * by CIK from data/tickers.json; only matching filings are fetched (the Form 4 full-submission text through the
 * existing parser, the SGML header for an 8-K / 13D/G period). Events use the shared/watchlist.mjs shapes and ids, with
 * `publishedAt` = EDGAR acceptance time. Resolves with the check result plus `sweep: true` when a per-issuer
 * submissions pass is due (first poll, a gap the pages could not cover, or every SWEEP_MS).
 */
export function makeSecFast(overrides = {}) {
  const d = { ...defaults, ...overrides };

  return async function secFast({ db, symbols, state = {} }) {
    const tickers = symbols.map((s) => d.tickerOf(db, s)).filter(Boolean);
    const noCik = symbols.filter((s) => !tickers.some((t) => t.symbol === s && t.cik));
    const index = cikIndex(tickers);
    const bySymbol = new Map(tickers.map((t) => [t.symbol, t]));
    const since = { ...(state.since || {}) };
    const samples = [...(state.samples || [])];
    const events = [];
    const errors = [];
    let feedsOk = 0;
    let gap = false;
    let pages = 0;

    for (const feed of CURRENT_FEEDS) {
      const prev = since[feed.id] || 0;
      const entries = [];
      try {
        for (let page = 0; page < CURRENT_MAX_PAGES; page += 1) {
          const got = parseCurrentAtom(await d.atom(feed.type, { start: page * CURRENT_PAGE })).entries;
          pages += 1;
          entries.push(...got);
          if (!needsNextPage(got, prev)) break;
          if (page === CURRENT_MAX_PAGES - 1) gap = true;
        }
      } catch (err) {
        errors.push(failure(`${feed.label} feed`, err));
        if (blocked(err)) break;
        continue;
      }
      feedsOk += 1;
      const detectedAt = d.now();
      const filings = groupFilings(entries, feed.forms);
      if (prev) for (const f of groupFilings(newSince(entries, prev), feed.forms)) samples.push(Math.max(0, detectedAt - Date.parse(f.acceptedAt)));
      since[feed.id] = Math.max(prev, newestAccepted(entries));

      for (const m of matchFilings(filings, feed, index)) {
        const f = m.filing;
        const t = bySymbol.get(m.symbol);
        try {
          if (feed.id === "form4") {
            if (d.seen(db, `f4:${m.symbol}:${f.accession}`, m.symbol)) continue;
            const pick = { accession: f.accession, filed: f.filed, doc: `${f.accession}.txt` };
            const doc = await d.readForm4(db, m.cik, pick);
            const out = form4Rows(t, pick, doc);
            if (out.other || !out.rows.length) continue;
            for (const ev of insiderEvents(out.rows)) events.push({ ...ev, publishedAt: f.acceptedAt || ev.publishedAt });
          } else {
            const id = feed.id === "8k" ? `8k:${f.accession}` : `stake:${f.accession}`;
            if (d.seen(db, id, m.symbol)) continue;
            const period = headerPeriod(await d.headers(m.cik, f.accession).catch(() => ""));
            const base = { symbol: m.symbol, accession: f.accession, form: f.form, accepted: f.acceptedAt, filed: f.filed, link: f.link };
            events.push(feed.id === "8k" ? filingEvent({ ...base, items: f.items.join(","), reportDate: period }) : stakeEvent({ ...base, person: m.filer?.name || "", eventDate: period }));
          }
        } catch (err) {
          errors.push(failure(m.symbol, err));
          if (blocked(err)) break;
        }
      }
    }

    const now = d.now();
    const kept = samples.slice(-LATENCY_SAMPLES);
    const stats = latencyStats(kept);
    const anyBlocked = errors.some((e) => blocked(e));
    const sweep = !anyBlocked && (!state.sweptAt || gap || now - state.sweptAt >= SWEEP_MS);
    const note = [
      `EDGAR latest-filings Atom, ${pages} page${pages === 1 ? "" : "s"} this pass`,
      latencyNote(stats),
      gap ? "a burst outran the pages read; an issuer sweep runs now" : "",
      noCik.length ? `${noCik.join(", ")}: no SEC CIK in data/tickers.json` : ""
    ].filter(Boolean).join(" · ");
    return {
      events,
      ok: feedsOk > 0 && !anyBlocked ? symbols : [],
      errors,
      note,
      sweep,
      state: { ...state, since, samples: kept, stats }
    };
  };
}

/**
 * The live "sec" check: the Atom poll every pass, plus the per-issuer submissions sweep (`sweep`, the earlier check)
 * when one is due. A backfill of newly added tickers runs the sweep only and leaves the Atom state alone.
 */
export function withSecFast(sweep, fast = makeSecFast(), now = () => Date.now()) {
  return async function sec(ctx) {
    if (ctx.backfill) {
      const res = await sweep(ctx);
      return { ...res, state: ctx.state };
    }
    const res = await fast(ctx);
    if (!res.sweep) return res;
    const swept = await sweep(ctx).catch((err) => ({ events: [], ok: [], errors: [failure("issuer sweep", err)], note: "" }));
    const sweptOk = (swept.ok || []).length > 0;
    return {
      events: [...res.events, ...(swept.events || [])],
      ok: [...new Set([...res.ok, ...(swept.ok || [])])],
      errors: [...res.errors, ...(swept.errors || [])],
      note: [res.note, sweptOk ? "issuer submissions swept" : "", swept.note].filter(Boolean).join(" · "),
      state: { ...res.state, sweptAt: now() }
    };
  };
}
