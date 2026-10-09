import { ladderFromActions } from "../../geo.mjs";
import { congressGet } from "../../feeds/congressGov.mjs";
import { voteDetail } from "./votes.mjs";

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
