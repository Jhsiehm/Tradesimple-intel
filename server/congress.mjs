import { fetchJson, fetchText } from "./http.mjs";
import { readCache, writeCache } from "./db.mjs";
import { houseGeoid, ladderFromActions } from "./geo.mjs";
import { committees, lisMap, memberCommittees, roster } from "./roster.mjs";
import { memberPacs } from "./corporate.mjs";

const BASE = "https://api.congress.gov/v3";
const TTL = 15 * 60 * 1000;
const SESSION = new Date().getUTCFullYear() % 2 === 1 ? 1 : 2;
const SENATE_MENU = `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_${SESSION}.xml`;
const SENATE_VOTE = (congress, session, roll) => {
  const padded = String(roll).padStart(5, "0");
  return `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${padded}.xml`;
};

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
  const res = await congressGet(db, "/committee-meeting/119?limit=80", 30 * 60 * 1000);
  if (!res.ok) return res;
  const meetings = (res.body.committeeMeetings || res.body.meetings || []).slice(0, 80);
  const items = [];
  await pool(meetings, 4, async (meeting) => {
    const chamber = String(meeting.chamber || "house").toLowerCase();
    const detail = await congressGet(db, `/committee-meeting/119/${chamber}/${meeting.eventId}`).catch(() => ({ ok: false }));
    const row = detail.ok ? detail.body.committeeMeeting || detail.body : meeting;
    const room = [row.location?.building, row.location?.room].filter(Boolean).join(" ");
    const related = row.relatedItems || {};
    items.push({
      id: String(meeting.eventId),
      date: row.date || meeting.updateDate || "",
      chamber: meeting.chamber || "",
      title: cleanText(row.title) || "Committee meeting",
      location: room,
      status: row.meetingStatus || "",
      type: row.type || "",
      committees: (row.committees || []).map((c) => ({ name: c.name || "", system: String(c.systemCode || "").toLowerCase() })),
      bills: (related.bills || []).map((b) => ({
        id: `${String(b.type || "").toLowerCase()}-${b.congress || 119}-${b.number}`,
        label: `${String(b.type || "").toUpperCase()} ${b.number}`
      })),
      nominations: (related.nominations || []).length,
      documents: (row.meetingDocuments || []).slice(0, 6).map((d) => ({ name: d.name || d.documentType || "Document", url: d.url || "" })).filter((d) => d.url),
      videos: (row.videos || []).slice(0, 2).map((v) => ({ name: v.name || "Video", url: v.url || "" })).filter((v) => v.url),
      link: `https://www.congress.gov/event/119th-congress/${chamber}-event/${meeting.eventId}`
    });
  });
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return {
    ok: true,
    source: "Congress.gov committee meetings",
    asOf: new Date().toISOString(),
    latency: "Scheduled and recent meetings as posted by committee clerks. Times are UTC.",
    items
  };
}

export async function committeeList(db) {
  const res = await committees(db);
  return {
    ...res,
    items: res.items.map(({ members, subcommittees, jurisdiction, ...row }) => ({
      ...row,
      size: members.length,
      majority: members.filter((m) => m.side === "majority").length,
      minority: members.filter((m) => m.side === "minority").length,
      subs: subcommittees.length
    }))
  };
}

export async function committeeDetail(db, id) {
  const all = await committees(db);
  const code = String(id || "").toUpperCase();
  let committee = all.items.find((row) => row.id === code);
  let parent = null;
  if (!committee) {
    parent = all.items.find((row) => row.subcommittees.some((sub) => sub.id === code));
    const sub = parent?.subcommittees.find((row) => row.id === code);
    if (sub) committee = { ...parent, ...sub, subcommittees: [], jurisdiction: "" };
  }
  if (!committee) return { ok: false, error: "Unknown committee" };
  const chamber = committee.chamber === "joint" ? "joint" : committee.chamber;
  let bills = [];
  let billCount = null;
  let website = committee.url;
  const head = await congressGet(db, `/committee/119/${chamber}/${committee.system}`, 6 * 60 * 60 * 1000).catch(() => ({ ok: false }));
  if (head.ok) {
    const body = head.body.committee || {};
    billCount = body.bills?.count ?? null;
    website = website || body.committeeWebsiteUrl || "";
    if (billCount) {
      const offset = Math.max(0, billCount - 12);
      const res = await congressGet(db, `/committee/119/${chamber}/${committee.system}/bills?offset=${offset}&limit=12`).catch(() => ({ ok: false }));
      const rows = res.ok ? res.body["committee-bills"]?.bills || [] : [];
      bills = rows.reverse().map((b) => ({
        id: `${String(b.type).toLowerCase()}-${b.congress}-${b.number}`,
        label: `${String(b.type).toUpperCase()} ${b.number}`,
        relation: b.relationshipType || "",
        date: b.actionDate || b.updateDate || "",
        title: ""
      }));
      await pool(bills, 4, async (bill) => {
        const [type, congress, number] = bill.id.split("-");
        const detail = await congressGet(db, `/bill/${congress}/${type}/${number}`, 6 * 60 * 60 * 1000).catch(() => ({ ok: false }));
        if (detail.ok) bill.title = detail.body.bill?.title || "";
      });
    }
  }
  const cal = await calendar(db).catch(() => ({ items: [] }));
  const systems = new Set([committee.system, parent?.system].filter(Boolean));
  const meetings = (cal.items || []).filter((m) => m.committees.some((c) => systems.has(c.system)));
  const today = new Date().toISOString().slice(0, 10);
  const scheduled = [];
  for (const m of meetings) {
    for (const b of m.bills) {
      if (!scheduled.some((row) => row.id === b.id)) scheduled.push({ ...b, meeting: m.title, date: m.date, upcoming: String(m.date).slice(0, 10) >= today, meetingId: m.id });
    }
  }
  const [onBills, onFloor] = chamber === "joint" ? [[], []] : await Promise.all([
    memberVotesOnBills(db, chamber, committee.members, [...scheduled, ...bills].filter((b, i, all) => all.findIndex((x) => x.id === b.id) === i).slice(0, 10)),
    floorVotesOnReferrals(db, chamber, parent?.system || committee.system, committee.members)
  ]);
  const votes = [...onFloor, ...onBills.filter((v) => !onFloor.some((f) => f.id === v.id))].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return {
    ok: true,
    source: `${SOURCE_LEGIS} · Congress.gov`,
    asOf: new Date().toISOString(),
    latency: "Membership is the current assignment list. Bills are the latest referrals and meeting agendas on Congress.gov. Member votes are floor roll calls cast by this committee's members; committee markup tallies are not published as data.",
    committee: {
      id: committee.id,
      name: parent ? `${parent.name} · ${committee.name}` : committee.name,
      chamber: committee.chamber,
      url: website,
      minorityUrl: committee.minorityUrl || "",
      jurisdiction: committee.jurisdiction || "",
      address: committee.address || "",
      phone: committee.phone || "",
      parent: parent ? { id: parent.id, name: parent.name } : null,
      members: committee.members,
      subcommittees: (committee.subcommittees || []).map((sub) => ({ id: sub.id, name: sub.name, size: sub.members.length })),
      billCount,
      bills,
      meetings,
      scheduled,
      votes
    }
  };
}

async function floorVotesOnReferrals(db, chamber, system, members) {
  const listed = await listVotes(db, chamber).catch(() => ({ ok: false }));
  if (!listed.ok) return [];
  const withBill = (listed.items || []).filter((v) => v.bill).slice(0, 24);
  const seats = new Map(members.map((m) => [m.bioguide, m]));
  const out = [];
  await pool(withBill, 4, async (v) => {
    const m = String(v.bill).match(/^([A-Za-z.]+)\s*(\d+)$/);
    if (!m) return;
    const type = m[1].replace(/\./g, "").toLowerCase();
    const refs = await congressGet(db, `/bill/${v.congress}/${type}/${m[2]}/committees`, 24 * 60 * 60 * 1000).catch(() => ({ ok: false }));
    const codes = refs.ok ? (refs.body.committees || []).map((c) => String(c.systemCode || "").toLowerCase()) : [];
    if (!codes.includes(system)) return;
    const detail = await voteDetail(db, chamber, v.congress, v.session, v.roll).catch(() => null);
    const positions = detail?.vote?.positions || [];
    const mine = positions.filter((p) => seats.has(p.bioguide)).map((p) => ({ bioguide: p.bioguide, name: p.name, party: p.party || seats.get(p.bioguide)?.party || "", vote: p.vote, side: seats.get(p.bioguide)?.side || "" }));
    if (!mine.length) return;
    const bill = await congressGet(db, `/bill/${v.congress}/${type}/${m[2]}`, 24 * 60 * 60 * 1000).catch(() => ({ ok: false }));
    const title = bill.ok ? bill.body.bill?.title || "" : "";
    const question = detail?.vote?.question && detail.vote.question !== v.bill ? detail.vote.question : "";
    out.push({ id: `${type}-${v.congress}-${m[2]}`, label: v.bill, title, question: question || title || v.question, result: detail?.vote?.result || v.result, date: v.date, tally: tallyOf(mine), members: mine });
  });
  return out;
}

function tallyOf(rows) {
  const tally = {};
  for (const p of rows) {
    const row = tally[p.vote] || { D: 0, R: 0, I: 0, total: 0 };
    row[p.party === "D" || p.party === "R" ? p.party : "I"] += 1;
    row.total += 1;
    tally[p.vote] = row;
  }
  return tally;
}

async function memberVotesOnBills(db, chamber, members, bills) {
  const seats = new Map(members.map((m) => [m.bioguide, m]));
  const out = [];
  await pool(bills, 3, async (bill) => {
    const res = await billVote(db, bill.id, chamber).catch(() => null);
    const vote = res?.vote;
    if (!vote?.positions?.length) return;
    const mine = vote.positions.filter((p) => seats.has(p.bioguide)).map((p) => ({ bioguide: p.bioguide, name: p.name, party: p.party || seats.get(p.bioguide)?.party || "", vote: p.vote, side: seats.get(p.bioguide)?.side || "" }));
    if (!mine.length) return;
    out.push({ id: bill.id, label: bill.label, title: bill.title || "", question: vote.question || "", result: vote.result || "", date: vote.date || "", tally: tallyOf(mine), members: mine });
  });
  out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return out;
}

const SOURCE_LEGIS = "unitedstates/congress-legislators";

export async function memberRoster(db) {
  return roster(db);
}

export async function billVote(db, id, chamber) {
  const parsed = parseBillId(id);
  if (!parsed) return { ok: false, error: "Unknown bill id" };
  const act = await congressGet(db, `/bill/${parsed.congress}/${parsed.type}/${parsed.number}/actions?limit=50`);
  if (!act.ok) return act;
  const rolls = [];
  for (const action of act.body.actions || []) {
    for (const rv of action.recordedVotes || []) {
      const side = chamberOf(rv, action);
      if (side && side !== chamber) continue;
      if (!rv.rollNumber) continue;
      rolls.push({
        congress: rv.congress || parsed.congress,
        session: rv.sessionNumber || rv.session || 1,
        roll: rv.rollNumber,
        date: rv.date || action.actionDate || ""
      });
    }
  }
  rolls.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = rolls[0];
  if (!latest) {
    return {
      ok: true,
      source: "Congress.gov",
      vote: null,
      note: `No recorded ${chamber} roll call on this bill.`
    };
  }
  const detail = await voteDetail(db, chamber, latest.congress, latest.session, latest.roll);
  if (detail.vote) detail.vote.note = "Latest recorded roll call for this bill. Seats are members, not a full roster in the list.";
  return detail;
}

function chamberOf(recorded, action) {
  const blob = `${recorded.chamber || ""} ${recorded.url || ""} ${action.text || ""}`.toLowerCase();
  if (blob.includes("senate")) return "senate";
  if (blob.includes("house")) return "house";
  return "";
}

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

async function pool(items, size, fn) {
  const queue = [...items];
  async function worker() {
    while (queue.length) await fn(queue.shift());
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => worker()));
}

export async function voteDetail(db, chamber, congress, session, roll) {
  if (chamber === "senate") return senateVoteDetail(db, congress, session, roll);
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

async function listSenateVotes(db) {
  const cacheKey = `senate:vote-menu-119-${SESSION}`;
  const hit = readCache(db, cacheKey);
  let xml = hit?.xml;
  if (!xml) {
    xml = await fetchText(SENATE_MENU);
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
  const cacheKey = `senate:vote:${congress}:${session}:${roll}`;
  const hit = readCache(db, cacheKey);
  let xml = hit?.xml;
  if (!xml) {
    xml = await fetchText(url);
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

function xmlTag(xml, tag) {
  const m = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function senateMenuDate(value, year) {
  const raw = cleanText(value);
  const m = raw.match(/^(\d{1,2})-([A-Za-z]{3})$/);
  if (!m) return raw;
  const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const mm = months[m[2]] || "01";
  return `${year}-${mm}-${m[1].padStart(2, "0")}`;
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
  const [recent, seats, people, pacs] = await Promise.all([
    recentCasts(db, id, chamber === "senate" ? "senate" : "house"),
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
      chamber: String(latest.chamber || chamber || ""),
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
  const index = await memberIndex(db);
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
        name: m.name || "",
        state: m.state,
        district: m.district == null ? "" : String(m.district),
        party: m.partyName || m.party || ""
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

function normalizeParty(value) {
  const v = String(value || "").toLowerCase();
  if (v.startsWith("d") || v.includes("democrat")) return "D";
  if (v.startsWith("r") || v.includes("republican")) return "R";
  if (v.startsWith("i") || v.includes("independent")) return "I";
  return v ? "I" : "";
}

function countVotes(positions) {
  const totals = { Yea: 0, Nay: 0, Present: 0, "Not voting": 0 };
  for (const p of positions) totals[p.vote] = (totals[p.vote] || 0) + 1;
  return totals;
}
