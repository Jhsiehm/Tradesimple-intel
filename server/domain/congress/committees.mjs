import { pool } from "../../lib/pool.mjs";
import { committees } from "../../roster.mjs";
import { congressGet } from "../../feeds/congressGov.mjs";
import { calendar } from "./calendar.mjs";
import { billVote } from "./bills.mjs";
import { listVotes, voteDetail } from "./votes.mjs";

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
