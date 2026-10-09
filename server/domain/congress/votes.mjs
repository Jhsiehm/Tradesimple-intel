import { fetchText } from "../../lib/http.mjs";
import { readCache, writeCache } from "../../lib/db.mjs";
import { pool } from "../../lib/pool.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";
import { houseGeoid } from "../../geo.mjs";
import { lisMap } from "../../roster.mjs";
import { TTL, congressGet } from "../../feeds/congressGov.mjs";
import { SENATE_HEADERS, SENATE_MENU, SENATE_VOTE, SESSION } from "../../feeds/senate.mjs";
import { cleanText, senateMenuDate, xmlTag } from "../../parsers/senateVoteXml.mjs";
import { countVotes, normalizeParty, normalizeVote } from "../../parsers/votes.mjs";
import { memberIndex, memberName } from "./directory.mjs";

export async function listVotes(db, chamber) {
  if (chamber === "senate") return listSenateVotes(db);
  const res = await congressGet(db, `/house-vote/119/${SESSION}?limit=250`);
  if (!res.ok) return res;
  let raw = res.body.houseRollCallVotes || res.body.votes || [];
  const total = Number(res.body.pagination?.count) || raw.length;
  for (let offset = 250; offset < total; offset += 250) {
    const more = await congressGet(db, `/house-vote/119/${SESSION}?limit=250&offset=${offset}`);
    if (!more.ok) break;
    raw = raw.concat(more.body.houseRollCallVotes || []);
  }
  raw = [...raw].sort((a, b) => Number(b.rollCallNumber) - Number(a.rollCallNumber)).slice(0, 24);
  const items = raw.map((v) => ({
    id: `house-${v.congress}-${v.sessionNumber}-${v.rollCallNumber}`,
    chamber: "house",
    congress: v.congress,
    session: v.sessionNumber,
    roll: v.rollCallNumber,
    date: v.startDate || v.date || "",
    result: v.result || "",
    question: v.voteQuestion || [v.legislationType, v.legislationNumber].filter(Boolean).join(" ") || "Roll call",
    bill: [v.legislationType, v.legislationNumber].filter(Boolean).join(" ")
  }));
  await pool(items, 4, async (item) => {
    const totals = await houseMargin(db, item.congress, item.session, item.roll);
    if (!totals) return;
    item.yea = totals.yea;
    item.nay = totals.nay;
  });
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { ok: true, source: "Congress.gov", asOf: new Date().toISOString(), items };
}

async function houseMargin(db, congress, session, roll) {
  const res = await congressGet(db, `/house-vote/${congress}/${session}/${roll}`);
  if (!res.ok) return null;
  const root = res.body.houseRollCallVote || res.body.vote || res.body;
  const parties = root.votePartyTotal || [];
  let yea = 0;
  let nay = 0;
  for (const party of parties) {
    yea += Number(party.yeaTotal) || 0;
    nay += Number(party.nayTotal) || 0;
  }
  if (!yea && !nay) return null;
  return { yea, nay };
}

export async function voteDetail(db, chamber, congress, session, roll) {
  if (chamber === "senate") return senateVoteDetail(db, congress, session, roll);
  const clerk = Number(congress) === 119 ? readCache(db, KEY.tlHouseVote(session, roll)) : null;
  if (clerk?.casts && Object.keys(clerk.casts).length) return houseFromClerk(db, clerk, congress, session, roll);
  const res = await congressGet(db, `/house-vote/${congress}/${session}/${roll}`);
  if (!res.ok) return res;
  const root = res.body.houseRollCallVote || res.body.vote || res.body;
  const memberRes = await congressGet(db, `/house-vote/${congress}/${session}/${roll}/members?limit=500`);
  const pack = memberRes.ok
    ? memberRes.body.houseRollCallVoteMemberVotes || memberRes.body
    : {};
  const members = pack.results || extractMembers(root);
  const directory = await memberIndex(db);
  const positions = members.map((m) => {
    const vote = normalizeVote(m.voteCast || m.vote || m.cast);
    const bioguide = m.bioguideID || m.bioguideId || m.member?.bioguideId || "";
    const known = directory.get(bioguide) || {};
    const state = known.state || m.voteState || m.state || "";
    const district = known.district || m.district || "";
    const party = normalizeParty(known.party || m.party || m.partyName || "");
    const name = memberName(m);
    return {
      name,
      state,
      district: district === null || district === undefined ? "" : String(district),
      vote,
      party,
      geoid: houseGeoid(state, district),
      bioguide
    };
  });
  const totals = countVotes(positions);
  return {
    ok: true,
    source: "Congress.gov",
    asOf: root.startDate || new Date().toISOString(),
    vote: {
      id: `house-${congress}-${session}-${roll}`,
      chamber: "house",
      question: root.voteQuestion || root.question || "",
      result: root.result || "",
      bill: [root.legislationType, root.legislationNumber].filter(Boolean).join(" "),
      date: root.startDate || "",
      totals,
      positions
    }
  };
}

const UNCAST = { Y: "Yea", N: "Nay", P: "Present", "-": "Not voting" };

/** House roll call from the indexed Clerk EVS casts, seated through the Congress.gov 119th member list. */
async function houseFromClerk(db, row, congress, session, roll) {
  const directory = await memberIndex(db);
  const positions = Object.entries(row.casts).map(([bioguide, cast]) => {
    const known = directory.get(bioguide) || {};
    const [last, first] = String(known.name || "").split(", ");
    return {
      name: first ? `${first} ${last}` : known.name || bioguide,
      state: known.state || "",
      district: known.district || "",
      vote: UNCAST[cast] || "Not voting",
      party: normalizeParty(known.party || ""),
      geoid: houseGeoid(known.state, known.district),
      bioguide
    };
  });
  return {
    ok: true,
    source: "House Clerk EVS roll call XML",
    asOf: row.date || new Date().toISOString(),
    vote: {
      id: `house-${congress}-${session}-${roll}`,
      chamber: "house",
      question: row.question || "",
      result: row.result || "",
      bill: row.bill || "",
      date: row.date || "",
      totals: countVotes(positions),
      positions
    }
  };
}

async function listSenateVotes(db) {
  const cacheKey = KEY.senateVoteMenu(SESSION);
  const hit = readCache(db, cacheKey);
  let xml = hit?.xml;
  if (!xml) {
    xml = await fetchText(SENATE_MENU, SENATE_HEADERS);
    writeCache(db, cacheKey, { xml }, TTL);
  }
  const year = Number(xmlTag(xml, "congress_year")) || new Date().getUTCFullYear();
  const blocks = xml.match(/<vote>[\s\S]*?<\/vote>/g) || [];
  const items = blocks.slice(0, 24).map((block) => {
    const roll = Number(xmlTag(block, "vote_number") || 0);
    const issue = xmlTag(block, "issue");
    const question = cleanText(xmlTag(block, "question") || xmlTag(block, "title") || `Roll ${roll}`);
    const dateRaw = xmlTag(block, "vote_date");
    return {
      id: `senate-119-${SESSION}-${roll}`,
      chamber: "senate",
      congress: 119,
      session: SESSION,
      roll,
      date: senateMenuDate(dateRaw, year),
      result: cleanText(xmlTag(block, "result")),
      question,
      bill: issue || "",
      yea: Number(xmlTag(block, "yeas")) || 0,
      nay: Number(xmlTag(block, "nays")) || 0
    };
  });
  items.sort((a, b) => Number(b.roll) - Number(a.roll));
  return { ok: true, source: "Senate.gov LIS", asOf: new Date().toISOString(), items };
}

async function senateVoteDetail(db, congress, session, roll) {
  const url = SENATE_VOTE(congress, session, roll);
  const cacheKey = KEY.senateVote(congress, session, roll);
  const hit = readCache(db, cacheKey);
  let xml = hit?.xml;
  if (!xml) {
    xml = await fetchText(url, SENATE_HEADERS);
    writeCache(db, cacheKey, { xml }, TTL);
  }
  const membersXml = xml.match(/<member>[\s\S]*?<\/member>/g) || [];
  const byLis = await lisMap(db).catch(() => new Map());
  const positions = membersXml.map((block) => {
    const first = xmlTag(block, "first_name");
    const last = xmlTag(block, "last_name");
    const full = xmlTag(block, "member_full");
    const state = xmlTag(block, "state") || "";
    const party = normalizeParty(xmlTag(block, "party"));
    const vote = normalizeVote(xmlTag(block, "vote_cast"));
    const lis = xmlTag(block, "lis_member_id");
    return {
      name: [first, last].filter(Boolean).join(" ") || full || "Senator",
      state,
      district: "",
      vote,
      party,
      geoid: null,
      bioguide: byLis.get(lis)?.bioguide || lis || ""
    };
  });
  const totals = countVotes(positions);
  return {
    ok: true,
    source: "Senate.gov LIS",
    asOf: cleanText(xmlTag(xml, "vote_date")) || new Date().toISOString(),
    vote: {
      id: `senate-${congress}-${session}-${roll}`,
      chamber: "senate",
      question: cleanText(xmlTag(xml, "vote_question_text") || xmlTag(xml, "question") || xmlTag(xml, "vote_title")),
      result: cleanText(xmlTag(xml, "vote_result_text") || xmlTag(xml, "vote_result")),
      bill: cleanText(xmlTag(xml, "vote_document_text")).slice(0, 120),
      date: cleanText(xmlTag(xml, "vote_date")),
      totals,
      positions
    }
  };
}

function extractMembers(root) {
  if (Array.isArray(root.members)) return root.members;
  if (Array.isArray(root.votes)) return root.votes;
  if (Array.isArray(root.voteCast)) return root.voteCast;
  const nested = root.votes?.vote || root.memberVotes || root.positions;
  if (Array.isArray(nested)) return nested;
  return [];
}
