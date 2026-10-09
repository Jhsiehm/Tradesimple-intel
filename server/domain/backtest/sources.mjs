/** Reads the feeds a backtest's signals come from and hands the records to signals.mjs. No ranking, no joins of its own. */
import { listTickers, tickerBySymbol } from "../../lib/db.mjs";
import { pool } from "../../lib/pool.mjs";
import { congressTrades, insiderHistory } from "../positions/index.mjs";
import { HISTORY_PER_ISSUER } from "../positions/insiders.mjs";
import { lobbyingFor } from "../corporate/index.mjs";
import { committees } from "../../roster.mjs";
import { indexStatus, indexedMeetings } from "../../timeline.mjs";
import { contractFeed } from "../../contracts.mjs";
import { dayOf } from "../../../shared/backtest.mjs";
import { CIVILIAN_LAG_DAYS, DOD_LAG_DAYS, contractSignals, congressSignals, form4Signals, hearingsByLane, lanesByMember, lobbySignals, matchCommittees } from "./signals.mjs";

export function sectorLookup(db) {
  const bySymbol = new Map(listTickers(db).map((t) => [t.symbol, t.sector || ""]));
  return (symbol) => bySymbol.get(symbol) || "";
}

const feed = (label, res, extra = {}) => ({ label, source: res?.source || "", asOf: res?.asOf || "", latency: res?.latency || "", ...extra });

/**
 * symbol → contract actions { day, publicDay } from USAspending's 100 largest actions of the last 365 days (the same
 * sample the contracts source reads). publicDay adds the feed's posting lag: 90 days for Defense, 7 for civilian.
 */
export async function contractAwards(db, { feedFn = contractFeed } = {}) {
  const res = await feedFn(db, { symbol: "", days: 365, sort: "largest" }).catch((err) => ({ ok: false, error: err.message, items: [] }));
  const awards = new Map();
  for (const r of res.items || []) {
    const day = dayOf(r.date);
    if (!r.symbol || day == null || !(r.amount > 0)) continue;
    const lag = /defense/i.test(r.agency || "") ? DOD_LAG_DAYS : CIVILIAN_LAG_DAYS;
    (awards.get(r.symbol) || awards.set(r.symbol, []).get(r.symbol)).push({ day, publicDay: day + lag });
  }
  return { awards, res, count: (res.items || []).length };
}

/** Congressional trades → signals. `error` is set when a filter cannot be honoured (unknown committee, hearing index missing). */
export async function congressSource(db, f) {
  const board = await congressTrades(db).catch(() => null);
  if (!board?.items?.length) return { error: board?.errors?.[0] || "Congressional trades are not loaded yet. Try again in a minute.", building: Boolean(board?.building) };
  const feeds = [feed("Signals", board)];
  const notes = [];
  let committee = null;
  let lanes = new Map();
  let hearings = null;
  if (f.committee || f.nearHearingDays) {
    const all = await committees(db).catch(() => null);
    if (!all?.items?.length) return { error: "Committee rosters are not available (unitedstates/congress-legislators)." };
    feeds.push(feed("Committees", all));
    if (f.committee) {
      committee = matchCommittees(all.items, f.committee);
      if (!committee.ids.length) return { error: `No committee matches “${f.committee}”. Try “Armed Services”, “Banking”, or an id like HSAS.` };
      notes.push({ level: "info", id: "committee", text: `${committee.names.join("; ")}: current assignments (${committee.members.size} members, including subcommittees) applied to every past trade. Members who joined or left a committee mid-window are misclassified.` });
    }
    if (f.nearHearingDays) {
      const st = indexStatus();
      const meetings = indexedMeetings();
      if (!meetings.length) return { error: `The hearing index is not built yet (${st.running ? "building" : "no Congress.gov key or no data"}). “Near a hearing” needs it.`, building: st.running };
      lanes = lanesByMember(all.items);
      hearings = hearingsByLane(meetings);
      feeds.push({ label: "Hearings", source: "Congress.gov committee-meeting API (timeline index)", asOf: st.builtAt || "", latency: `${meetings.length} meetings indexed. Proximity is calendar distance only: ${f.nearHearingDays} days between the trade date and a hearing of a committee the member sits on today. It says nothing about what was discussed.${f.hearingKnown ? " Only hearings on or before the filing date count." : " Hearings after the filing date count too, which selects on a future event; treat as descriptive, not tradable."}` });
      notes.push({ level: f.hearingKnown ? "info" : "warn", id: "hearing", text: f.hearingKnown ? "Near-hearing filter keeps only hearings dated on or before the filing date." : "Near-hearing filter may use hearings held after the filing date. That is selection on a future event: fine for description, not a rule anyone could have followed." });
    }
  }
  let awards = null;
  if (f.awardWithinDays) {
    const got = await contractAwards(db);
    if (!got.count) return { error: got.res.error || "No contract actions came back from USAspending; the award filter needs them." };
    awards = got.awards;
    feeds.push(feed("Contracts", got.res));
    notes.push({ level: "warn", id: "awardSample", text: `Award filter: a contract action to the same company within ${f.awardWithinDays} days after the trade, among USAspending's ${got.count} largest actions of the last 365 days (a sample of big awards, not every award), counted only when the award was public (action date + 90 days for Defense, + 7 civilian) by the day the trade was disclosed.` });
  }
  const out = congressSignals({ trades: board.items, filters: f, sectorOf: sectorLookup(db), committee, lanes, hearings, awards });
  const h = board.progress?.house;
  const s = board.progress?.senate;
  return {
    signals: out.signals,
    dropped: out.dropped,
    feeds,
    building: Boolean(board.building),
    context: {
      rangeAmounts: true,
      paperFilings: (h?.paper || 0) + (s?.paper || 0),
      unparsed: (h?.failed || 0) + (s?.failed || 0),
      notes: [
        ...notes,
        ...(board.building ? [{ level: "warn", id: "building", text: "Disclosures are still being read; this run uses what is parsed so far." }] : []),
        ...(board.dedupe?.merged ? [{ level: "info", id: "dedupe", text: `Across all disclosures, ${board.dedupe.merged} rows repeat a trade already listed in another report (${board.dedupe.byChamber?.senate || 0} Senate amendments re-listing the original, ${board.dedupe.byChamber?.house || 0} House lines filed twice) and are counted once, public on the earliest filing.${out.dropped.revised ? ` ${out.dropped.revised} of these signals use the amendment's corrected values (type or amount).` : ""}` }] : []),
        ...(out.dropped.amendedLater ? [{ level: "info", id: "amended", text: `${out.dropped.amendedLater} Senate trades appear only in an amended report, not in the original we have. Their public date is the amendment date, not the original filing date.` }] : []),
        { level: "info", id: "window", text: `Reports filed since ${board.from}; trades before the earliest filing in the window are not here. ${out.dropped.notJoined || 0} trades in tickers outside data/tickers.json are left out (no guessed joins).` }
      ]
    }
  };
}

const FORM4_DEFAULT_DAYS = 365;
const daysAgo = (n, now = Date.now()) => new Date(now - n * 86_400_000).toISOString().slice(0, 10);
const few = (xs, n = 8) => `${xs.slice(0, n).join(", ")}${xs.length > n ? "…" : ""}`;

/**
 * Form 4 history for the spec's window (the board's latest eight per issuer would leave every buy inside its hold).
 * Reads that miss `deadline` keep filling the cache; the run says how many and is not cached as complete.
 */
export async function form4Source(db, f, { deadline = 0, history = insiderHistory } = {}) {
  const from = f.from || daysAgo(FORM4_DEFAULT_DAYS);
  const res = await history(db, { from, to: f.to, deadline, symbols: f.tickers }).catch((err) => ({ items: [], errors: [err.message], filings: { wanted: 0, read: 0, failed: 0, pending: 0 }, coverage: { shortList: [], capped: [] } }));
  if (!res?.items?.length) {
    return { error: res?.filings?.pending ? `Form 4 filings are still being read from SEC EDGAR (${res.filings.read} of ${res.filings.wanted} so far). Try again in a minute.` : res?.errors?.[0] || "No Form 4 filings were found for join-table issuers in this window.", building: Boolean(res?.building) };
  }
  const out = form4Signals({ rows: res.items, filters: f, sectorOf: sectorLookup(db) });
  const dates = res.items.map((r) => r.filed).sort();
  const { wanted, read, failed, pending } = res.filings;
  const { shortList, capped } = res.coverage;
  return {
    signals: out.signals,
    dropped: out.dropped,
    feeds: [feed("Signals", res)],
    building: Boolean(res.building),
    context: {
      notes: [
        { level: "info", id: "f4cover", text: res.coverageNote || `Form 4 history: ${read} of ${wanted} filings read for ${res.issuers} join-table issuers, filed ${dates[0]} to ${dates.at(-1)}${f.from ? "" : ` (no start date given; last ${FORM4_DEFAULT_DAYS} days)`}. Each issuer's newest ${HISTORY_PER_ISSUER} Form 4s in the window are read.` },
        ...(res.building ? [{ level: "warn", id: "f4pending", text: `${pending} Form 4 filings were still being read from SEC EDGAR when the time budget ended and are not in this run${res.filings.listingIncomplete ? ", and some issuers' filing lists had not been read yet, so more are missing than that" : ""}. They keep loading; run again in a minute.` }] : []),
        ...(failed ? [{ level: "warn", id: "f4failed", text: `${failed} Form 4 documents could not be read from SEC EDGAR this run.` }] : []),
        ...(res.errors?.length ? [{ level: "warn", id: "f4issuers", text: `${res.errors.length} of ${res.issuers} issuers' SEC filing lists could not be read (${few(res.errors.map((e) => e.split(":")[0]))}); their insider trades are missing.` }] : []),
        ...(capped.length ? [{ level: "warn", id: "f4capped", text: `${capped.length} issuers filed more than ${HISTORY_PER_ISSUER} Form 4s in the window (${few(capped)}); only their newest ${HISTORY_PER_ISSUER} are read, so their earlier insider trades are missing.` }] : []),
        ...(shortList.length ? [{ level: "warn", id: "f4short", text: `For ${shortList.length} issuers (${few(shortList)}) SEC's recent-filings list starts after ${from}, so their earlier Form 4s are not here.` }] : []),
        ...(res.otherIssuer ? [{ level: "info", id: "f4owner", text: `${res.otherIssuer} Form 4s listed under a join-table company were filed by it as the owner of another company's shares (for example Berkshire Hathaway buying Lennar). Those trades belong to the other issuer and are not attributed to the filer's ticker.` }] : []),
        { level: "info", id: "f4plan", text: `${out.dropped.plan10b5 || 0} lines flagged as 10b5-1 plan trades and ${out.dropped.notOpenMarket || 0} non-open-market lines (grants, tax withholding, exercises) are excluded.` },
        ...(out.dropped.noTicker || out.dropped.noDates ? [{ level: "warn", id: "f4rows", text: `${out.dropped.noTicker || 0} open-market lines had no join-table ticker and ${out.dropped.noDates || 0} had no trade or filing date; they are left out.` }] : [])
      ]
    }
  };
}

export async function contractsSource(db, f) {
  const symbols = f.tickers.length ? f.tickers : [""];
  const feeds = [];
  const rows = [];
  const failures = [];
  await pool(symbols, 3, async (symbol) => {
    const res = await contractFeed(db, { symbol, days: 365, sort: "largest" }).catch((err) => ({ ok: false, error: err.message, items: [] }));
    if (!res.ok) { failures.push(`${symbol || "all"}: ${res.error || "unavailable"}`); return; }
    rows.push(...res.items);
    if (!feeds.length) feeds.push(feed("Signals", res));
  });
  if (!rows.length) return { error: failures[0] || "No contract actions matched. USAspending may be slow; try again, or name tickers." };
  const out = contractSignals({ rows, filters: f, sectorOf: sectorLookup(db) });
  return {
    signals: out.signals,
    dropped: out.dropped,
    feeds,
    context: {
      notes: [
        { level: "warn", id: "contractCover", text: `USAspending returns at most 100 actions per ask: the largest of the last 365 days${f.tickers.length ? " for each named ticker" : " across all recipients"}. This is a sample of big awards, not every award.` },
        { level: "info", id: "contractLag", text: "Public date = action date + 90 days for Defense (DoD posts late) or + 7 days for civilian agencies, then one signal per ticker per 30 days. Those delays are assumptions from the feed's own latency note." },
        ...failures.map((x) => ({ level: "warn", id: "contractFail", text: `Contract feed: ${x}` }))
      ]
    }
  };
}

export async function lobbyingSource(db, f) {
  if (!process.env.LDA_API_KEY) return { error: "Lobbying needs LDA_API_KEY in .env.local.", missing: "LDA_API_KEY" };
  const filingsBySymbol = {};
  const feeds = [];
  const gaps = [];
  await pool(f.tickers, 3, async (symbol) => {
    const ticker = tickerBySymbol(db, symbol);
    if (!ticker) { gaps.push(`${symbol} is not in data/tickers.json`); return; }
    const res = await lobbyingFor(db, ticker, 4).catch(() => null);
    if (!res?.ok) { gaps.push(`${symbol}: LDA.gov unavailable`); return; }
    filingsBySymbol[symbol] = res.filings;
    if (!feeds.length) feeds.push(feed("Signals", res));
    for (const u of res.unavailable || []) gaps.push(u);
  });
  const out = lobbySignals({ filingsBySymbol, filters: f, sectorOf: sectorLookup(db) });
  return {
    signals: out.signals,
    dropped: out.dropped,
    feeds,
    context: {
      notes: [
        { level: "info", id: "ldaRule", text: `Spike = a quarter's total lobbying (all registrants, original LD-2 filings) at least ${f.spikePct}% above the previous quarter counting only filings posted by then. Public on the last posting date of the quarter.` },
        ...gaps.slice(0, 6).map((x) => ({ level: "warn", id: "ldaGap", text: x }))
      ]
    }
  };
}
