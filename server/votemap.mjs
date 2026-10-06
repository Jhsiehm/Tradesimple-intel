import { cleanText, congressGet, listBills } from "./congress.mjs";
import { ladderFromActions } from "./geo.mjs";
import { indexedVotes, indexStatus } from "./timeline.mjs";

const DAY = 24 * 60 * 60 * 1000;

const BILL_TYPES = /^(HR|HRES|HJRES|HCONRES|S|SRES|SJRES|SCONRES)(\d+)$/;
const SOURCE = "House Clerk EVS roll call XML · Senate.gov LIS roll call XML · Congress.gov bill actions";

const plain = (text) => cleanText(String(text || "").replace(/<[^>]+>/g, ""));

/** "H.R. 2400", "HR 2400" and "hr2400" all key to "HR2400". */
export function billKey(label) {
  return String(label || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Higher is closer to final passage; procedural votes (rules, cloture, tabling, amendments) rank 0. Clearing the other chamber's version outranks first passage. */
export function passageRank(question) {
  const q = String(question || "").toLowerCase();
  if (/veto/.test(q)) return 5;
  if (/concur|agree to the (senate|house) amendment/.test(q)) return 4;
  if (/recommit|table|cloture|amendment|previous question|adjourn|motion to proceed|point of order|waive|quorum/.test(q)) return 0;
  if (/passage|suspend the rules and (pass|agree)|(on|agreeing to) the (joint |concurrent )?resolution|on the bill/.test(q)) return 3;
  return 1;
}

/** Flags the final-passage roll call in each chamber: highest rank, then latest. */
export function markFinal(rolls) {
  for (const chamber of ["house", "senate"]) {
    const best = rolls
      .filter((r) => r.chamber === chamber)
      .sort((a, b) => passageRank(b.question) - passageRank(a.question) || String(b.date).localeCompare(String(a.date)) || b.roll - a.roll)[0];
    if (best) best.final = true;
  }
  return rolls;
}

function indexRow(chamber, v) {
  const [, congress, session, roll] = v.id.split("-").map((x, i) => (i ? Number(x) : x));
  const casts = Object.values(v.casts || {});
  return {
    id: v.id,
    chamber,
    congress,
    session,
    roll,
    date: v.date,
    question: plain(v.question),
    result: v.result,
    yea: casts.filter((c) => c === "Y").length,
    nay: casts.filter((c) => c === "N").length,
    final: false
  };
}

/** Every recorded roll call on one bill, both chambers, newest first. */
export async function billRolls(db, id) {
  const m = String(id || "").toLowerCase().match(/^([a-z]+)-(\d+)-(\d+)$/);
  if (!m) return { ok: false, error: "Unknown bill id", items: [] };
  const [, type, congress, number] = m;
  const key = billKey(type + number);
  const found = new Map();
  if (Number(congress) === 119) {
    for (const chamber of ["house", "senate"]) {
      for (const v of indexedVotes(chamber)) if (billKey(v.bill) === key) found.set(v.id, indexRow(chamber, v));
    }
  }
  const act = await congressGet(db, `/bill/${congress}/${type}/${number}/actions?limit=250`).catch(() => null);
  for (const action of act?.ok ? act.body.actions || [] : []) {
    for (const rv of action.recordedVotes || []) {
      const blob = `${rv.chamber || ""} ${rv.url || ""}`.toLowerCase();
      const chamber = blob.includes("senate") ? "senate" : blob.includes("house") ? "house" : "";
      if (!chamber || !rv.rollNumber) continue;
      const session = Number(rv.sessionNumber || rv.session || 1);
      const rid = `${chamber}-${rv.congress || congress}-${session}-${rv.rollNumber}`;
      const text = plain(action.text).replace(/\s*\(Roll no\.\s*\d+\)\.?$/i, "").slice(0, 160);
      const known = found.get(rid);
      if (known) {
        if (/^roll call$/i.test(known.question)) known.question = text;
        continue;
      }
      found.set(rid, {
        id: rid,
        chamber,
        congress: Number(rv.congress || congress),
        session,
        roll: Number(rv.rollNumber),
        date: String(rv.date || action.actionDate || "").slice(0, 10),
        question: text,
        result: "",
        yea: null,
        nay: null,
        final: false
      });
    }
  }
  const items = markFinal([...found.values()]).sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.roll - a.roll);
  const index = indexStatus();
  return {
    ok: true,
    source: SOURCE,
    asOf: index.builtAt || new Date().toISOString(),
    latency: index.builtAt ? "Roll-call index refreshes every 6 h; today's votes come from Congress.gov actions." : "Roll-call index still building; showing Congress.gov actions only.",
    items
  };
}

/** Bills with recorded roll calls in the index, most recently voted first. */
export function votedBills(limit = 25) {
  const byBill = new Map();
  for (const chamber of ["house", "senate"]) {
    for (const v of indexedVotes(chamber)) {
      const hit = billKey(v.bill).match(BILL_TYPES);
      if (!hit) continue;
      const id = `${hit[1].toLowerCase()}-119-${hit[2]}`;
      const row = byBill.get(id) || { id, type: hit[1], number: hit[2], votes: 0, lastVote: "", question: "", result: "" };
      row.votes += 1;
      if (String(v.date) >= row.lastVote) Object.assign(row, { lastVote: v.date, question: plain(v.question), result: v.result });
      byBill.set(id, row);
    }
  }
  return [...byBill.values()].sort((a, b) => b.lastVote.localeCompare(a.lastVote)).slice(0, limit);
}

/** Latest-action bills plus the most recently voted ones, so the list always has bills with a map to show. */
export async function billsWithVotes(db) {
  const base = await listBills(db);
  if (!base.ok) return base;
  const voted = votedBills();
  const counts = new Map(voted.map((v) => [v.id, v]));
  const items = base.items.map((b) => (counts.has(b.id) ? { ...b, votes: counts.get(b.id).votes, lastVote: counts.get(b.id).lastVote } : b));
  const have = new Set(items.map((b) => b.id));
  const extra = voted.filter((v) => !have.has(v.id));
  const queue = [...extra];
  const worker = async () => {
    while (queue.length) {
      const v = queue.shift();
      const res = await congressGet(db, `/bill/119/${v.type.toLowerCase()}/${v.number}`, DAY).catch(() => null);
      const bill = res?.ok ? res.body.bill || {} : {};
      items.push({
        id: v.id,
        title: bill.title || `${v.question} · ${v.result}`,
        type: v.type,
        number: v.number,
        congress: 119,
        chamber: bill.originChamber || "",
        updated: [bill.updateDate || "", v.lastVote].sort().pop(),
        latest: bill.latestAction?.text || `${v.question} · ${v.result}`,
        stage: ladderFromActions(bill.latestAction ? [bill.latestAction] : []).current,
        votes: v.votes,
        lastVote: v.lastVote
      });
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return { ...base, items };
}
