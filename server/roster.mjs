import { fetchJson } from "./lib/http.mjs";
import { readCache, writeCache } from "./lib/db.mjs";
import { DAY } from "./lib/time.mjs";
import { KEY } from "./lib/cacheKeys.mjs";

const BASE = "https://unitedstates.github.io/congress-legislators";
const SOURCE = "unitedstates/congress-legislators";
const LATENCY = "Community-maintained from official records. Changes when a seat or assignment changes, not live.";

export async function roster(db) {
  const hit = readCache(db, KEY.roster);
  if (hit) return hit;
  const raw = await fetchJson(`${BASE}/legislators-current.json`, {}, 30000);
  const items = raw.map((person) => {
    const term = person.terms[person.terms.length - 1] || {};
    const senate = term.type === "sen";
    return {
      bioguide: person.id?.bioguide || "",
      lis: person.id?.lis || "",
      fec: person.id?.fec || [],
      name: person.name?.official_full || `${person.name?.first || ""} ${person.name?.last || ""}`.trim(),
      first: person.name?.first || "",
      last: person.name?.last || "",
      nickname: person.name?.nickname || "",
      party: partyCode(term.party),
      state: term.state || "",
      district: senate ? "" : String(term.district ?? ""),
      chamber: senate ? "senate" : "house",
      since: person.terms[0]?.start || "",
      terms: person.terms.length,
      url: term.url || "",
      phone: term.phone || "",
      office: term.address || "",
      contact: term.contact_form || "",
      birthday: person.bio?.birthday || "",
      leadership: (person.leadership_roles || [])
        .filter((role) => !role.end || role.end > new Date().toISOString().slice(0, 10))
        .map((role) => ({ title: role.title, since: role.start || "" })),
      stateRank: term.state_rank || "",
      senateClass: term.class || null,
      termEnds: term.end || ""
    };
  }).filter((row) => row.bioguide);
  items.sort((a, b) => a.last.localeCompare(b.last));
  const result = { ok: true, source: SOURCE, asOf: new Date().toISOString(), latency: LATENCY, items };
  writeCache(db, KEY.roster, result, DAY);
  return result;
}

export async function lisMap(db) {
  const res = await roster(db);
  return new Map(res.items.filter((row) => row.lis).map((row) => [row.lis, row]));
}

export async function committees(db) {
  const hit = readCache(db, KEY.committees);
  if (hit) return hit;
  const [list, membership, people] = await Promise.all([
    fetchJson(`${BASE}/committees-current.json`, {}, 30000),
    fetchJson(`${BASE}/committee-membership-current.json`, {}, 30000),
    roster(db)
  ]);
  const byId = new Map(people.items.map((row) => [row.bioguide, row]));
  const seat = (row) => {
    const known = byId.get(row.bioguide) || {};
    return {
      bioguide: row.bioguide || "",
      name: row.name || known.name || row.bioguide,
      side: row.party || "",
      party: known.party || "",
      state: known.state || "",
      district: known.district || "",
      rank: row.rank || 0,
      title: row.title || ""
    };
  };
  const items = list.map((committee) => {
    const id = committee.thomas_id;
    const members = (membership[id] || []).map(seat).sort((a, b) => a.side.localeCompare(b.side) || a.rank - b.rank);
    const chair = members.find((m) => /chair/i.test(m.title) && !/vice|ranking/i.test(m.title));
    const ranking = members.find((m) => /ranking/i.test(m.title));
    return {
      id,
      name: committee.name,
      chamber: committee.type,
      url: committee.url || "",
      minorityUrl: committee.minority_url || "",
      jurisdiction: committee.jurisdiction || "",
      address: committee.address || "",
      phone: committee.phone || "",
      system: `${id.toLowerCase()}00`,
      chair: chair ? { bioguide: chair.bioguide, name: chair.name, party: chair.party } : null,
      ranking: ranking ? { bioguide: ranking.bioguide, name: ranking.name, party: ranking.party } : null,
      members,
      subcommittees: (committee.subcommittees || []).map((sub) => {
        const subId = `${id}${sub.thomas_id}`;
        const subMembers = (membership[subId] || []).map(seat).sort((a, b) => a.side.localeCompare(b.side) || a.rank - b.rank);
        return {
          id: subId,
          name: sub.name,
          system: subId.toLowerCase(),
          members: subMembers
        };
      })
    };
  });
  items.sort((a, b) => a.chamber.localeCompare(b.chamber) || a.name.localeCompare(b.name));
  const result = { ok: true, source: SOURCE, asOf: new Date().toISOString(), latency: LATENCY, items };
  writeCache(db, KEY.committees, result, DAY);
  return result;
}

export async function memberCommittees(db, bioguide) {
  const res = await committees(db);
  const rows = [];
  for (const committee of res.items) {
    const hit = committee.members.find((m) => m.bioguide === bioguide);
    if (hit) rows.push({ id: committee.id, name: committee.name, title: hit.title, side: hit.side });
    for (const sub of committee.subcommittees) {
      const inner = sub.members.find((m) => m.bioguide === bioguide);
      if (inner) rows.push({ id: sub.id, name: `${committee.name} · ${sub.name}`, title: inner.title, side: inner.side });
    }
  }
  return rows;
}

function partyCode(value) {
  const v = String(value || "").toLowerCase();
  if (v.startsWith("democrat")) return "D";
  if (v.startsWith("republican")) return "R";
  return v ? "I" : "";
}
