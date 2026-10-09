import { congressGet } from "../../feeds/congressGov.mjs";

export async function memberIndex(db) {
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

export function memberName(m) {
  if (m.name) return m.name;
  const mem = m.member || m;
  return [mem.firstName, mem.lastName].filter(Boolean).join(" ") || mem.directOrderName || "Member";
}
