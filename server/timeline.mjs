import { fetchText } from "./http.mjs";
import { readCache, writeCache } from "./db.mjs";
import { SENATE_VOTE, SESSION, cleanText, congressGet, normalizeVote, senateMenuDate, xmlTag } from "./congress.mjs";
import { lisMap, memberCommittees, roster } from "./roster.mjs";
import { congressTrades } from "./positions.mjs";
import { memberReturns } from "./returns.mjs";
import { nyDate, nyDaysAgo } from "../shared/dates.mjs";

const DAY = 24 * 60 * 60 * 1000;
const CONGRESS = 119;
const START = "2025-01-03";
const NEAR_DAYS = 14;
const CAST = { Yea: "Y", Nay: "N", Present: "P", "Not voting": "-" };
const UNCAST = { Y: "Yea", N: "Nay", P: "Present", "-": "Not voting" };

/** In-memory index, rebuilt from the sqlite cache on boot; past meetings and roll calls never change. */
const state = {
  meetings: [],
  votes: { house: [], senate: [] },
  progress: { meetings: { done: 0, total: 0 }, house: { done: 0, total: 0 }, senate: { done: 0, total: 0 } },
  builtAt: null,
  running: false
};

const isPast = (date) => date && date.slice(0, 10) < nyDaysAgo(2);

async function pool(items, size, fn) {
  const queue = [...items];
  const worker = async () => { while (queue.length) await fn(queue.shift()); };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

async function listAll(db, path, field) {
  const first = await congressGet(db, `${path}?limit=250`, 6 * 60 * 60 * 1000);
  if (!first.ok) return [];
  let rows = first.body[field] || [];
  const total = Number(first.body.pagination?.count) || rows.length;
  for (let offset = 250; offset < total; offset += 250) {
    const more = await congressGet(db, `${path}?limit=250&offset=${offset}`, 6 * 60 * 60 * 1000).catch(() => null);
    if (!more?.ok) break;
    rows = rows.concat(more.body[field] || []);
  }
  return rows;
}

async function meetingRow(db, chamber, eventId) {
  const key = `tl:meet:${chamber}:${eventId}`;
  const hit = readCache(db, key);
  if (hit) return hit;
  const detail = await congressGet(db, `/committee-meeting/${CONGRESS}/${chamber}/${eventId}`, DAY);
  const row = detail.body?.committeeMeeting || detail.body || {};
  const out = {
    id: String(eventId),
    chamber,
    date: String(row.date || "").slice(0, 10),
    title: cleanText(row.title) || "Committee meeting",
    type: row.type || "",
    status: row.meetingStatus || "",
    codes: (row.committees || []).map((c) => String(c.systemCode || "").toLowerCase()).filter(Boolean),
    link: `https://www.congress.gov/event/${CONGRESS}th-congress/${chamber}-event/${eventId}`
  };
  writeCache(db, key, out, isPast(out.date) ? 120 * DAY : DAY);
  return out;
}

/** House Clerk EVS roll call XML → { bioguide: "Y" | "N" | "P" | "-" }. */
export function clerkCasts(xml) {
  const casts = {};
  for (const m of String(xml || "").matchAll(/<legislator name-id="([A-Z]\d{6})"[^>]*>[^<]*<\/legislator>\s*<vote>([^<]*)<\/vote>/g)) {
    casts[m[1]] = CAST[normalizeVote(m[2])];
  }
  return casts;
}

async function houseVotes(db, session, onRow) {
  const list = await listAll(db, `/house-vote/${CONGRESS}/${session}`, "houseRollCallVotes");
  state.progress.house.total += list.length;
  const rows = [];
  await pool(list, 3, async (v) => {
    const roll = v.rollCallNumber;
    const key = `tl:vote:house:${session}:${roll}`;
    let row = readCache(db, key);
    if (!row) {
      const year = 2024 + session;
      const xml = await fetchText(`https://clerk.house.gov/evs/${year}/roll${String(roll).padStart(3, "0")}.xml`).catch(() => "");
      let casts = clerkCasts(xml);
      if (!Object.keys(casts).length) {
        const res = await congressGet(db, `/house-vote/${CONGRESS}/${session}/${roll}/members?limit=500`, DAY).catch(() => null);
        casts = {};
        for (const p of (res?.ok ? (res.body.houseRollCallVoteMemberVotes || res.body).results : null) || []) {
          const id = p.bioguideID || p.bioguideId;
          if (id) casts[id] = CAST[normalizeVote(p.voteCast)];
        }
      }
      if (Object.keys(casts).length) {
        row = {
          id: `house-${CONGRESS}-${session}-${roll}`,
          date: String(v.startDate || "").slice(0, 10),
          question: cleanText(v.voteQuestion) || "Roll call",
          result: v.result || "",
          bill: [v.legislationType, v.legislationNumber].filter(Boolean).join(" "),
          casts
        };
        writeCache(db, key, row, isPast(row.date) ? 365 * DAY : DAY);
      }
    }
    if (row) { rows.push(row); onRow(row); }
    state.progress.house.done += 1;
  });
  return rows;
}

async function senateVotes(db, session, onRow) {
  const menuKey = `tl:senmenu:${CONGRESS}:${session}`;
  let xml = readCache(db, menuKey)?.xml;
  if (!xml) {
    xml = await fetchText(`https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${CONGRESS}_${session}.xml`).catch(() => "");
    if (xml) writeCache(db, menuKey, { xml }, session === SESSION ? 6 * 60 * 60 * 1000 : 365 * DAY);
  }
  const year = Number(xmlTag(xml, "congress_year")) || 2024 + session;
  const blocks = xml.match(/<vote>[\s\S]*?<\/vote>/g) || [];
  state.progress.senate.total += blocks.length;
  const byLis = await lisMap(db).catch(() => new Map());
  const rows = [];
  await pool(blocks, 2, async (block) => {
    const roll = Number(xmlTag(block, "vote_number"));
    const key = `tl:vote:senate:${session}:${roll}`;
    let row = readCache(db, key);
    if (!row) {
      const body = await fetchText(SENATE_VOTE(CONGRESS, session, roll)).catch(() => "");
      if (body) {
        const casts = {};
        for (const m of body.match(/<member>[\s\S]*?<\/member>/g) || []) {
          const id = byLis.get(xmlTag(m, "lis_member_id"))?.bioguide;
          if (id) casts[id] = CAST[normalizeVote(xmlTag(m, "vote_cast"))];
        }
        row = {
          id: `senate-${CONGRESS}-${session}-${roll}`,
          date: senateMenuDate(xmlTag(block, "vote_date"), year),
          question: cleanText(xmlTag(block, "question") || xmlTag(block, "title")) || `Roll ${roll}`,
          result: cleanText(xmlTag(block, "result")),
          bill: cleanText(xmlTag(block, "issue")),
          casts
        };
        writeCache(db, key, row, isPast(row.date) ? 365 * DAY : DAY);
      }
    }
    if (row) { rows.push(row); onRow(row); }
    state.progress.senate.done += 1;
  });
  return rows;
}

export async function buildIndex(db) {
  if (state.running || !process.env.CONGRESS_API_KEY) return;
  state.running = true;
  state.progress = { meetings: { done: 0, total: 0 }, house: { done: 0, total: 0 }, senate: { done: 0, total: 0 } };
  try {
    const sessions = Array.from({ length: SESSION }, (_, i) => i + 1).reverse();
    const votesFor = async (chamber, load) => {
      const rows = [];
      const onRow = (row) => { rows.push(row); if (rows.length % 25 === 0) state.votes[chamber] = [...rows].sort(byDate); };
      for (const s of sessions) await load(db, s, onRow).catch(() => []);
      state.votes[chamber] = rows.sort(byDate);
    };
    const meetingsAll = async () => {
      const lists = await Promise.all(["house", "senate"].map(async (chamber) =>
        (await listAll(db, `/committee-meeting/${CONGRESS}/${chamber}`, "committeeMeetings").catch(() => [])).map((m) => ({ chamber, eventId: m.eventId }))
      ));
      const all = lists.flat();
      state.progress.meetings.total = all.length;
      const meetings = [];
      await pool(all, 6, async ({ chamber, eventId }) => {
        const row = await meetingRow(db, chamber, eventId).catch(() => null);
        if (row?.date) meetings.push(row);
        state.progress.meetings.done += 1;
        if (state.progress.meetings.done % 100 === 0) state.meetings = [...meetings].sort(byDate);
      });
      state.meetings = meetings.sort(byDate);
    };
    await Promise.all([votesFor("house", houseVotes), votesFor("senate", senateVotes), meetingsAll()]);
    state.builtAt = new Date().toISOString();
  } finally {
    state.running = false;
  }
}

/** Indexed roll calls for one chamber, oldest first; each carries `casts` keyed by bioguide. */
export function indexedVotes(chamber) {
  return state.votes[chamber] || [];
}

/** Indexed committee meetings, both chambers, oldest first. */
export function indexedMeetings() {
  return state.meetings;
}

export function indexStatus() {
  return { builtAt: state.builtAt, running: state.running, house: state.votes.house.length, senate: state.votes.senate.length };
}

function gaps() {
  const p = state.progress;
  return p.house.total - state.votes.house.length + p.senate.total - state.votes.senate.length + p.meetings.total - p.meetings.done;
}

export function warmTimeline(db) {
  const run = () => buildIndex(db)
    .then(() => {
      const missing = gaps();
      console.log(`timeline index: ${state.meetings.length} meetings, ${state.votes.house.length} house + ${state.votes.senate.length} senate roll calls, ${missing} missing`);
      if (missing > 0) setTimeout(run, 10 * 60 * 1000).unref();
    })
    .catch((err) => console.error("timeline", err.message));
  setTimeout(run, 8_000);
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}

function byDate(a, b) {
  return String(a.date).localeCompare(String(b.date));
}

const dayNum = (iso) => Math.round(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / DAY);

/** Lane key: the four-letter parent committee, so subcommittee hearings land on the parent lane. */
export function laneOf(code) {
  return String(code || "").slice(0, 4).toUpperCase();
}

/**
 * Pure assembly. A trade is "near" a hearing only by calendar distance (≤ NEAR_DAYS) on a committee
 * the member sits on today; it says nothing about what was discussed.
 */
export function buildTimeline({ trades, seats, meetings, votes, bioguide, today }) {
  const lanes = new Map();
  for (const seat of seats) {
    const lane = laneOf(seat.id);
    const row = lanes.get(lane) || { id: lane, name: seat.name.split(" · ")[0], title: "", subs: [], hearings: [] };
    if (seat.id.length === 4) row.title = seat.title || seat.side || "";
    else row.subs.push({ id: seat.id, name: seat.name.split(" · ").slice(1).join(" · "), title: seat.title || "" });
    lanes.set(lane, row);
  }
  const mySubs = new Set(seats.filter((s) => s.id.length > 4).map((s) => s.id.toLowerCase()));
  for (const m of meetings) {
    const hit = [...new Set(m.codes.map(laneOf))].filter((l) => lanes.has(l));
    for (const lane of hit) {
      lanes.get(lane).hearings.push({
        id: m.id, date: m.date, title: m.title, type: m.type, status: m.status, link: m.link,
        mine: m.codes.some((c) => c.endsWith("00") ? laneOf(c) === lane : mySubs.has(c))
      });
    }
  }
  const allHearings = [...lanes.values()].flatMap((l) => l.hearings.map((h) => ({ ...h, lane: l.id, laneName: l.name })));
  const cast = votes
    .filter((v) => v.casts[bioguide])
    .map((v) => ({ id: v.id, date: v.date, question: v.question, result: v.result, bill: v.bill, vote: UNCAST[v.casts[bioguide]] }));
  const tradeRows = trades
    .filter((t) => t.traded)
    .map((t) => {
      const d = dayNum(t.traded);
      let near = null;
      for (const h of allHearings) {
        if (/cancel|postpon/i.test(h.status)) continue;
        const gap = dayNum(h.date) - d;
        if (Math.abs(gap) <= NEAR_DAYS && (!near || Math.abs(gap) < Math.abs(near.gap))) near = { id: h.id, date: h.date, title: h.title, lane: h.lane, laneName: h.laneName, link: h.link, gap };
      }
      return { id: t.id, symbol: t.symbol, asset: t.asset, side: t.side, type: t.type, owner: t.owner, amount: t.amount, amountLow: t.amountLow, traded: t.traded, filed: t.filed, lag: t.lag, link: t.link, near };
    })
    .sort((a, b) => a.traded.localeCompare(b.traded));
  const dates = [START, ...tradeRows.map((t) => t.traded)].sort();
  return {
    range: { from: dates[0], to: today },
    trades: tradeRows,
    committees: [...lanes.values()].sort((a, b) => b.hearings.length - a.hearings.length),
    votes: cast,
    nearDays: NEAR_DAYS,
    proximity: proximity(tradeRows, allHearings, today)
  };
}

/**
 * How often trades land near a hearing versus how often any calendar day does. Busy committees put
 * most days within NEAR_DAYS of a hearing, so the raw count alone overstates the pattern.
 */
export function proximity(tradeRows, hearings, today) {
  const start = dayNum(START);
  const end = dayNum(today);
  if (!(end > start)) return null;
  const covered = new Uint8Array(end - start + 1);
  for (const h of hearings) {
    if (/cancel|postpon/i.test(h.status)) continue;
    const d = dayNum(h.date) - start;
    for (let i = Math.max(0, d - NEAR_DAYS); i <= Math.min(covered.length - 1, d + NEAR_DAYS); i += 1) covered[i] = 1;
  }
  const days = covered.length;
  const nearDays = covered.reduce((n, v) => n + v, 0);
  const inRange = tradeRows.filter((t) => t.traded >= START && t.traded <= today);
  const near = inRange.filter((t) => t.near).length;
  const tradeDays = new Set(inRange.map((t) => t.traded));
  const nearTradeDays = new Set(inRange.filter((t) => t.near).map((t) => t.traded));
  return {
    from: START,
    trades: inRange.length,
    near,
    share: inRange.length ? near / inRange.length : null,
    tradeDays: tradeDays.size,
    nearTradeDays: nearTradeDays.size,
    dayShare: tradeDays.size ? nearTradeDays.size / tradeDays.size : null,
    baseline: nearDays / days
  };
}

export async function memberTimeline(db, bioguide) {
  const id = String(bioguide || "").toUpperCase();
  if (!/^[A-Z]\d{6}$/.test(id)) return { ok: false, error: "Unknown member id" };
  if (!process.env.CONGRESS_API_KEY) return { ok: false, missing: "CONGRESS_API_KEY" };
  if (!state.builtAt && !state.running && !process.env.INTEL_NO_WARM) void buildIndex(db);
  const [board, seats, people] = await Promise.all([
    congressTrades(db).catch(() => ({ items: [] })),
    memberCommittees(db, id).catch(() => []),
    roster(db).catch(() => ({ items: [] }))
  ]);
  const trades = (board.items || []).filter((r) => r.bioguide === id);
  const person = people.items.find((p) => p.bioguide === id) || {};
  const chamber = person.chamber === "senate" ? "senate" : "house";
  const body = buildTimeline({ trades, seats, meetings: state.meetings, votes: state.votes[chamber], bioguide: id, today: nyDate() });
  const rets = memberReturns(id);
  body.trades = body.trades.map((t) => {
    const r = rets.byTrade.get(t.id);
    return r ? { ...t, ret: { entry: r.entry, since: r.since, d30: r.d30, d90: r.d90 } } : t;
  });
  const p = state.progress;
  return {
    ok: true,
    member: { bioguide: id, name: person.name || trades[0]?.person || id, party: person.party || "", state: person.state || "", district: person.district || "", chamber },
    ...body,
    returns: rets.stats,
    building: state.running || Boolean(board.building),
    coverage: {
      trades: board.progress ? { from: board.from, building: Boolean(board.building), ...board.progress[chamber], notes: board.errors || [] } : null,
      meetings: { done: p.meetings.done, total: p.meetings.total },
      votes: { done: state.votes[chamber].length, total: p[chamber].total },
      builtAt: state.builtAt
    },
    sources: [
      { label: "Trades", source: "House Clerk PTR PDFs / Senate eFD", latency: "Trade date as disclosed; filed up to 45 days later by law." },
      { label: "Committees", source: "unitedstates/congress-legislators (current assignments)", latency: "Current roster only; past assignments are not shown." },
      { label: "Hearings", source: "Congress.gov committee-meeting API", latency: "As posted by committee clerks; refreshed every 6 h." },
      { label: "Votes", source: chamber === "senate" ? "Senate.gov LIS roll call XML" : "House Clerk EVS roll call XML", latency: "Roll calls of the 119th Congress; refreshed every 6 h." },
      { label: "Returns", source: `Yahoo Finance daily adjusted closes vs SPY${rets.stats?.lastClose ? ` through ${rets.stats.lastClose}` : ""}`, latency: "Disclosed buys of joined tickers only, equal-weighted, not their actual portfolio. Refreshed every 12 h." }
    ],
    asOf: state.builtAt || new Date().toISOString()
  };
}
