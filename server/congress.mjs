import { fetchJson } from "./http.mjs";
import { readCache, writeCache } from "./db.mjs";
import { houseGeoid, ladderFromActions } from "./geo.mjs";

const BASE = "https://api.congress.gov/v3";
const TTL = 15 * 60 * 1000;

function key() {
  return process.env.CONGRESS_API_KEY || "";
}

function missing() {
  return { ok: false, missing: "CONGRESS_API_KEY", items: [] };
}

async function congressGet(db, path, ttl = TTL) {
  const apiKey = key();
  if (!apiKey) return missing();
  const cacheKey = `congress:${path}`;
  const hit = readCache(db, cacheKey);
  if (hit) return hit;
  const url = new URL(BASE + path);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  const body = await fetchJson(url);
  const wrapped = { ok: true, body };
  writeCache(db, cacheKey, wrapped, ttl);
  return wrapped;
}

export async function listBills(db) {
  const res = await congressGet(db, "/bill/119?limit=25&sort=updateDate+desc");
  if (!res.ok) return res;
  const items = (res.body.bills || []).map(billRow);
  items.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return { ok: true, source: "Congress.gov", asOf: new Date().toISOString(), items };
}

export async function billDetail(db, id) {
  const parsed = parseBillId(id);
  if (!parsed) return { ok: false, error: "Unknown bill id" };
  const res = await congressGet(db, `/bill/${parsed.congress}/${parsed.type}/${parsed.number}`);
  if (!res.ok) return res;
  const bill = res.body.bill || res.body;
  let actions = [];
  try {
    const act = await congressGet(db, `/bill/${parsed.congress}/${parsed.type}/${parsed.number}/actions?limit=40`);
    actions = act.ok ? act.body.actions || [] : [];
  } catch {
    actions = [];
  }
  if (!actions.length && bill.latestAction) actions = [bill.latestAction];
  const ladder = ladderFromActions(actions);
  return {
    ok: true,
    source: "Congress.gov",
    asOf: bill.updateDate || new Date().toISOString(),
    bill: {
      ...billRow(bill),
      summary: bill.policyArea?.name || "",
      committees: (bill.committees?.url ? [] : bill.committees) || [],
      ladder
    }
  };
}

export async function calendar(db) {
  const res = await congressGet(db, "/committee-meeting/119?limit=12");
  if (!res.ok) return res;
  const meetings = (res.body.committeeMeetings || res.body.meetings || []).slice(0, 8);
  const items = [];
  for (const meeting of meetings) {
    const chamber = String(meeting.chamber || "house").toLowerCase();
    const detail = await congressGet(db, `/committee-meeting/119/${chamber}/${meeting.eventId}`);
    const row = detail.ok ? detail.body.committeeMeeting || detail.body : meeting;
    const room = [row.location?.building, row.location?.room].filter(Boolean).join(" ");
    items.push({
      id: String(meeting.eventId),
      date: row.date || meeting.updateDate || "",
      chamber: meeting.chamber || "",
      title: row.title || "Committee meeting",
      location: room
    });
  }
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { ok: true, source: "Congress.gov committee meetings", asOf: new Date().toISOString(), items };
}

export async function listVotes(db, chamber) {
  const side = chamber === "senate" ? "senate-vote" : "house-vote";
  const res = await congressGet(db, `/${side}/119/1?limit=20`);
  if (!res.ok) return res;
  const raw = res.body.houseRollCallVotes || res.body.senateRollCallVotes || res.body.votes || [];
  const items = raw.map((v) => ({
    id: `${chamber}-${v.congress}-${v.sessionNumber}-${v.rollCallNumber}`,
    chamber,
    congress: v.congress,
    session: v.sessionNumber,
    roll: v.rollCallNumber,
    date: v.startDate || v.date || "",
    result: v.result || "",
    question: v.voteQuestion || [v.legislationType, v.legislationNumber].filter(Boolean).join(" ") || "Roll call",
    bill: [v.legislationType, v.legislationNumber].filter(Boolean).join(" ")
  }));
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { ok: true, source: "Congress.gov", asOf: new Date().toISOString(), items };
}

export async function voteDetail(db, chamber, congress, session, roll) {
  const side = chamber === "senate" ? "senate-vote" : "house-vote";
  const res = await congressGet(db, `/${side}/${congress}/${session}/${roll}`);
  if (!res.ok) return res;
  const root = res.body.houseRollCallVote || res.body.senateRollCallVote || res.body.vote || res.body;
  const memberRes = await congressGet(db, `/${side}/${congress}/${session}/${roll}/members?limit=500`);
  const pack = memberRes.ok
    ? memberRes.body.houseRollCallVoteMemberVotes || memberRes.body.senateRollCallVoteMemberVotes || memberRes.body
    : {};
  const members = pack.results || extractMembers(root);
  const directory = await memberIndex(db);
  const positions = members.map((m) => {
    const vote = normalizeVote(m.voteCast || m.vote || m.cast);
    const bioguide = m.bioguideID || m.bioguideId || m.member?.bioguideId || "";
    const known = directory.get(bioguide) || {};
    const state = known.state || m.voteState || m.state || "";
    const district = known.district || m.district || "";
    const name = memberName(m);
    return {
      name,
      state,
      district: district === null || district === undefined ? "" : String(district),
      vote,
      geoid: chamber === "house" ? houseGeoid(state, district) : null,
      bioguide
    };
  });
  const totals = countVotes(positions);
  return {
    ok: true,
    source: "Congress.gov",
    asOf: root.startDate || new Date().toISOString(),
    vote: {
      id: `${chamber}-${congress}-${session}-${roll}`,
      chamber,
      question: root.voteQuestion || root.question || "",
      result: root.result || "",
      bill: [root.legislationType, root.legislationNumber].filter(Boolean).join(" "),
      date: root.startDate || "",
      totals,
      positions
    }
  };
}

export async function searchMembers(db, q) {
  const res = await congressGet(db, "/member/congress/119?limit=250", 12 * 60 * 60 * 1000);
  if (!res.ok) return res;
  const needle = q.trim().toLowerCase();
  const members = (res.body.members || [])
    .filter((m) => {
      const name = `${m.name || ""} ${m.firstName || ""} ${m.lastName || ""}`.toLowerCase();
      const dist = `${m.state || ""}-${m.district || ""}`.toLowerCase();
      return name.includes(needle) || dist === needle;
    })
    .slice(0, 8)
    .map((m) => ({
      id: m.bioguideId,
      name: m.name || `${m.firstName || ""} ${m.lastName || ""}`.trim(),
      state: m.state,
      district: m.district == null ? "" : String(m.district),
      chamber: String(m.district) === "undefined" || m.terms?.item?.[0]?.chamber || (m.district == null ? "Senate" : "House"),
      geoid: houseGeoid(m.state, m.district),
      party: m.partyName || ""
    }));
  return { ok: true, items: members };
}

function billRow(bill) {
  const type = String(bill.type || "").toLowerCase();
  const congress = bill.congress;
  const number = bill.number;
  return {
    id: `${type}-${congress}-${number}`,
    title: bill.title || `${type.toUpperCase()} ${number}`,
    type: type.toUpperCase(),
    number: String(number),
    congress,
    chamber: bill.originChamber || "",
    updated: bill.updateDate || bill.latestAction?.actionDate || "",
    latest: bill.latestAction?.text || "",
    stage: ladderFromActions(bill.latestAction ? [bill.latestAction] : []).current
  };
}

function parseBillId(id) {
  const m = String(id).toLowerCase().match(/^([a-z]+)-(\d+)-(\d+)$/);
  if (!m) return null;
  return { type: m[1], congress: m[2], number: m[3] };
}

async function memberIndex(db) {
  const map = new Map();
  for (let offset = 0; offset < 800; offset += 250) {
    const res = await congressGet(db, `/member/congress/119?limit=250&offset=${offset}`, 12 * 60 * 60 * 1000);
    if (!res.ok) break;
    const members = res.body.members || [];
    for (const m of members) {
      map.set(m.bioguideId, {
        state: m.state,
        district: m.district == null ? "" : String(m.district)
      });
    }
    if (members.length < 250) break;
  }
  return map;
}

function extractMembers(root) {
  if (Array.isArray(root.members)) return root.members;
  if (Array.isArray(root.votes)) return root.votes;
  if (Array.isArray(root.voteCast)) return root.voteCast;
  const nested = root.votes?.vote || root.memberVotes || root.positions;
  if (Array.isArray(nested)) return nested;
  return [];
}

function memberName(m) {
  if (m.name) return m.name;
  const mem = m.member || m;
  return [mem.firstName, mem.lastName].filter(Boolean).join(" ") || mem.directOrderName || "Member";
}

function normalizeVote(value) {
  const v = String(value || "").toLowerCase();
  if (v.startsWith("yea") || v.startsWith("aye") || v === "yes") return "Yea";
  if (v.startsWith("nay") || v === "no") return "Nay";
  if (v.includes("present")) return "Present";
  return "Not voting";
}

function countVotes(positions) {
  const totals = { Yea: 0, Nay: 0, Present: 0, "Not voting": 0 };
  for (const p of positions) totals[p.vote] = (totals[p.vote] || 0) + 1;
  return totals;
}
