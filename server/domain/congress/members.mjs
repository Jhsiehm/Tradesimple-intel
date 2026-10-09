import { houseGeoid } from "../../geo.mjs";
import { memberCommittees, roster } from "../../roster.mjs";
import { memberPacs } from "../../corporate.mjs";
import { matchMembers } from "../../../shared/memberMatch.mjs";
import { congressGet } from "../../feeds/congressGov.mjs";
import { countVotes, normalizeParty } from "../../parsers/votes.mjs";
import { memberIndex, memberName } from "./directory.mjs";
import { listVotes, voteDetail } from "./votes.mjs";

export async function memberRoster(db) {
  return roster(db);
}

export async function memberProfile(db, bioguide, chamber) {
  const id = String(bioguide || "").trim();
  if (!/^[A-Za-z]\d{6}$/.test(id)) return { ok: false, error: "Unknown member id" };
  const res = await congressGet(db, `/member/${id}`, 12 * 60 * 60 * 1000);
  if (!res.ok) return res;
  const member = res.body.member || res.body;
  const terms = member.terms || member.terms?.item || [];
  const termList = Array.isArray(terms) ? terms : terms.item || [];
  const latest = termList[termList.length - 1] || {};
  const history = Array.isArray(member.partyHistory) ? member.partyHistory : member.partyHistory?.item || [];
  const party = normalizeParty(member.partyName || latest.partyName || latest.party || history[0]?.partyName || "");
  const seated = String(latest.chamber || "").toLowerCase();
  const side = seated.includes("senate") ? "senate" : seated.includes("house") ? "house" : chamber === "senate" ? "senate" : "house";
  const [recent, seats, people, pacs] = await Promise.all([
    recentCasts(db, id, side),
    memberCommittees(db, id).catch(() => []),
    roster(db).catch(() => ({ items: [] })),
    Promise.race([memberPacs(db, id).catch(() => null), new Promise((r) => setTimeout(() => r(null), 4000))])
  ]);
  const known = people.items.find((p) => p.bioguide === id) || {};
  const apiRoles = (Array.isArray(member.leadership) ? member.leadership : []).filter((l) => l.current).map((l) => ({ title: l.type, since: "" }));
  const leadership = known.leadership?.length ? known.leadership : apiRoles;
  const pattern = countVotes(recent.map((row) => ({ vote: row.vote })));
  return {
    ok: true,
    source: "Congress.gov member record",
    asOf: new Date().toISOString(),
    latency: "Portrait is the official Bioguide photo. The pattern is the latest roll calls on this feed, not a lifetime score.",
    member: {
      bioguide: id,
      name: member.directOrderName || memberName(member),
      party,
      state: member.state || latest.stateCode || latest.state || "",
      district: latest.district == null ? "" : String(latest.district),
      chamber: String(latest.chamber || side),
      photo: member.depiction?.imageUrl || bioguidePhoto(id),
      url: member.officialWebsiteUrl || `https://bioguide.congress.gov/search/bio/${id}`,
      served: termList.length ? `${termList.length} terms on the Congress.gov record` : "Term count not on this record",
      leadership,
      since: known.since || "",
      termEnds: known.termEnds || "",
      stateRank: known.stateRank || "",
      senateClass: known.senateClass || null,
      birthday: known.birthday || member.birthYear || "",
      phone: known.phone || "",
      office: known.office || "",
      contact: known.contact || ""
    },
    pacs: pacs ? { ...pacs, source: "FEC bulk committee-to-candidate file", latency: "Weekly FEC bulk refresh; lag is filing image date minus gift date." } : { loading: true },
    pattern,
    votes: recent,
    committees: seats
  };
}

function bioguidePhoto(id) {
  return `https://unitedstates.github.io/images/congress/225x275/${id.toUpperCase()}.jpg`;
}

async function recentCasts(db, bioguide, chamber) {
  const listed = await listVotes(db, chamber);
  if (!listed.ok) return [];
  const rows = [];
  for (const vote of (listed.items || []).slice(0, 6)) {
    const detail = await voteDetail(db, chamber, vote.congress, vote.session, vote.roll);
    const hit = detail.ok ? (detail.vote?.positions || []).find((p) => p.bioguide === bioguide) : null;
    if (!hit) continue;
    rows.push({
      id: vote.id,
      question: vote.question,
      result: vote.result,
      date: vote.date,
      bill: vote.bill,
      vote: hit.vote
    });
  }
  return rows;
}

export async function compareMembers(db, a, b, chamber) {
  const side = chamber === "senate" ? "senate" : "house";
  const leftId = String(a || "");
  const rightId = String(b || "");
  if (!/^[A-Za-z]\d{6}$/.test(leftId) || !/^[A-Za-z]\d{6}$/.test(rightId)) {
    return { ok: false, error: "Unknown member id" };
  }
  const index = await memberIndex(db);
  const [leftVotes, rightVotes] = await Promise.all([
    recentCasts(db, leftId, side),
    recentCasts(db, rightId, side)
  ]);
  const other = new Map(rightVotes.map((vote) => [vote.id, vote]));
  const shared = leftVotes.filter((vote) => other.has(vote.id));
  const splits = shared
    .filter((vote) => other.get(vote.id).vote !== vote.vote)
    .map((vote) => ({
      id: vote.id,
      question: vote.question,
      result: vote.result,
      date: vote.date,
      bill: vote.bill,
      a: vote.vote,
      b: other.get(vote.id).vote
    }));
  return {
    ok: true,
    source: side === "senate" ? "Senate.gov LIS" : "Congress.gov roll call",
    asOf: new Date().toISOString(),
    latency: "Split is only where both members cast a vote on the latest roll calls this feed loaded. Not a lifetime score.",
    a: { bioguide: leftId, name: index.get(leftId)?.name || leftId },
    b: { bioguide: rightId, name: index.get(rightId)?.name || rightId },
    shared: shared.length,
    splits
  };
}

export async function seatsForCodes(db, codes) {
  return matchSeats(codes, await memberIndex(db));
}

/** District codes like "CA-17" or "ID-02" to the House members holding them. Senators (no district) never match. */
export function matchSeats(codes, index) {
  const seats = [];
  for (const code of codes) {
    const match = String(code || "").toUpperCase().match(/^([A-Z]{2})-(\d+)$/);
    if (!match) continue;
    const stateName = POSTAL_TO_NAME[match[1]];
    const district = String(Number(match[2]));
    const found = [];
    for (const [bioguide, info] of index) {
      if (!info.district) continue;
      if (info.state !== stateName && info.state !== match[1]) continue;
      if (String(Number(info.district)) !== district) continue;
      found.push({
        bioguide,
        name: info.name || bioguide,
        party: info.party || "",
        district: `${match[1]}-${district}`
      });
    }
    seats.push({ code: `${match[1]}-${district}`, members: found });
  }
  return seats;
}

const POSTAL_TO_NAME = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
};

export async function searchMembers(db, q) {
  const res = await roster(db);
  const items = matchMembers(res.items, q).map((m) => ({
    id: m.bioguide,
    name: m.name,
    state: m.state,
    district: m.district,
    chamber: m.chamber,
    geoid: m.chamber === "house" ? houseGeoid(m.state, m.district) : null,
    party: m.party
  }));
  return { ok: true, source: res.source, asOf: res.asOf, latency: res.latency, items };
}
