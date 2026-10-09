import { fecBulk } from "../../feeds/fec.mjs";
import { listTickers, readCache, writeCache } from "../../lib/db.mjs";
import { roster } from "../../roster.mjs";
import { HOUR, DAY } from "../../lib/time.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";

const ORG_TYPES = { C: "Corporation", L: "Labor", M: "Membership", T: "Trade association", V: "Cooperative", W: "Corp. w/o stock" };

let pacMemo = null;

let pacLoading = null;

export async function memberPacs(db, bioguide) {
  const data = await pacData(db);
  return { cycle: data.cycle, asOf: data.asOf, ...(data.members?.[bioguide] || { total: 0, count: 0, pacs: 0, top: [], recent: [] }) };
}

export async function pacData(db) {
  if (pacMemo && Date.now() - pacMemo.at < HOUR) return pacMemo.data;
  const hit = readCache(db, KEY.fecPac);
  if (hit) {
    pacMemo = { at: Date.now(), data: hit };
    return hit;
  }
  if (!pacLoading) pacLoading = buildPacData(db).finally(() => { pacLoading = null; });
  return pacLoading;
}

async function buildPacData(db) {
  const tickers = listTickers(db);
  const joined = new Map();
  for (const t of tickers) for (const id of t.pacs || []) joined.set(id, t.symbol);
  const year = new Date().getUTCFullYear();
  const cycle = year % 2 ? year + 1 : year;
  const cycles = [cycle, cycle - 2, cycle - 4];
  const people = await roster(db).catch(() => ({ items: [] }));
  const byFec = new Map();
  for (const p of people.items) for (const id of p.fec || []) byFec.set(id, p);

  const committees = new Map();
  const candidates = new Map();
  const contributions = [];
  const groups = new Map();
  const toMembers = new Map();
  for (const cy of cycles) {
    const yy = String(cy).slice(2);
    const [cm, cn, pas] = await Promise.all([
      fecBulk(`cm${yy}`, cy, "cm.txt"),
      fecBulk(`cn${yy}`, cy, "cn.txt"),
      fecBulk(`pas2${yy}`, cy, "itpas2.txt")
    ]);
    for (const line of cm.split("\n")) {
      const c = line.split("|");
      if (c[0] && !committees.has(c[0])) committees.set(c[0], { id: c[0], name: c[1], type: c[9], orgType: c[12], org: c[13] });
    }
    for (const line of cn.split("\n")) {
      const c = line.split("|");
      if (c[0] && !candidates.has(c[0])) candidates.set(c[0], { id: c[0], name: c[1], party: c[2], state: c[4], office: c[5], district: c[6] });
    }
    for (const line of pas.split("\n")) {
      const c = line.split("|");
      const cmte = c[0];
      if (!cmte || (c[5] !== "24K" && c[5] !== "24E" && c[5] !== "24A")) continue;
      const amount = Number(c[14]) || 0;
      const cand = candidates.get(c[16]);
      const party = partyCode(cand?.party);
      const meta = committees.get(cmte);
      if (meta && ORG_TYPES[meta.orgType] && cy === cycle) {
        const g = groups.get(cmte) || { id: cmte, name: meta.name, org: meta.org, orgType: ORG_TYPES[meta.orgType], total: 0, count: 0, dem: 0, rep: 0, recipients: new Set() };
        g.total += amount;
        g.count += 1;
        if (party === "D") g.dem += amount;
        if (party === "R") g.rep += amount;
        if (c[16]) g.recipients.add(c[16]);
        groups.set(cmte, g);
      }
      const member = byFec.get(c[16]);
      if (member && cy === cycle && c[5] === "24K") {
        const list = toMembers.get(member.bioguide) || [];
        list.push({ pac: cmte, pacName: meta?.name || cmte, orgType: ORG_TYPES[meta?.orgType] || "", org: meta?.org || "", symbol: joined.get(cmte) || "", amount, date: mdy(c[13]), filed: imageDate(c[4]), lag: lagDays(mdy(c[13]), imageDate(c[4])), link: c[4] ? `https://docquery.fec.gov/cgi-bin/fecimg/?${c[4]}` : "" });
        toMembers.set(member.bioguide, list);
      }
      const symbol = joined.get(cmte);
      if (!symbol) continue;
      contributions.push({
        id: `pac:${c[21] || c[17]}`,
        symbol,
        pac: cmte,
        pacName: meta?.name || cmte,
        date: mdy(c[13]),
        amount,
        kind: c[5] === "24K" ? "contribution" : c[5] === "24E" ? "independent exp. for" : "independent exp. against",
        recipient: c[7],
        candidate: cand?.name || "",
        candidateId: c[16] || "",
        party,
        office: cand?.office || "",
        state: cand?.state || c[9] || "",
        district: cand?.district || "",
        bioguide: member?.bioguide || "",
        member: member?.name || "",
        cycle: cy,
        filed: imageDate(c[4]),
        lag: lagDays(mdy(c[13]), imageDate(c[4])),
        link: c[4] ? `https://docquery.fec.gov/cgi-bin/fecimg/?${c[4]}` : ""
      });
    }
  }
  const seen = new Set();
  const rows = contributions.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const topGroups = [...groups.values()]
    .map((g) => ({ ...g, recipients: g.recipients.size, symbol: joined.get(g.id) || "" }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 60);
  const result = {
    ok: true,
    source: "FEC bulk data (committee master, candidate master, committee-to-candidate contributions)",
    asOf: new Date().toISOString(),
    latency: `FEC bulk files refresh weekly and are rechecked daily; lag is the filing image date minus the gift date. Cycles ${cycles.join(", ")}. PACs joined to tickers through data/tickers.json.`,
    cycle,
    rows,
    groups: topGroups,
    members: Object.fromEntries([...toMembers.entries()].map(([bioguide, list]) => {
      list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const byPac = new Map();
      for (const g of list) {
        const cur = byPac.get(g.pac) || { pac: g.pac, pacName: g.pacName, orgType: g.orgType, org: g.org, symbol: g.symbol, total: 0, count: 0, last: "" };
        cur.total += g.amount;
        cur.count += 1;
        if (g.date > cur.last) cur.last = g.date;
        byPac.set(g.pac, cur);
      }
      return [bioguide, {
        total: list.reduce((s, g) => s + g.amount, 0),
        count: list.length,
        pacs: byPac.size,
        top: [...byPac.values()].sort((a, b) => b.total - a.total).slice(0, 12),
        recent: list.slice(0, 25)
      }];
    }))
  };
  writeCache(db, KEY.fecPac, result, DAY);
  pacMemo = { at: Date.now(), data: result };
  return result;
}

function imageDate(image) {
  const m = /^(20\d{2})(\d{2})(\d{2})/.exec(String(image || ""));
  if (!m || Number(m[2]) > 12 || Number(m[3]) > 31) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function lagDays(from, to) {
  if (!from || !to) return null;
  const d = Math.round((Date.parse(to) - Date.parse(from)) / DAY);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

export async function pacFor(db, symbol) {
  const data = await pacData(db);
  const rows = data.rows.filter((r) => r.symbol === symbol);
  const cycleRows = rows.filter((r) => r.cycle === data.cycle);
  const sum = (list) => list.reduce((s, r) => s + r.amount, 0);
  return {
    ok: true,
    source: data.source,
    asOf: data.asOf,
    latency: data.latency,
    cycle: data.cycle,
    total: sum(cycleRows),
    dem: sum(cycleRows.filter((r) => r.party === "D")),
    rep: sum(cycleRows.filter((r) => r.party === "R")),
    recipients: new Set(cycleRows.map((r) => r.candidateId || r.recipient)).size,
    rows
  };
}

function partyCode(party) {
  const p = String(party || "").toUpperCase();
  if (p.startsWith("DEM") || p === "DFL") return "D";
  if (p.startsWith("REP")) return "R";
  if (!p) return "";
  return "I";
}

function mdy(value) {
  const v = String(value || "");
  return v.length === 8 ? `${v.slice(4)}-${v.slice(0, 2)}-${v.slice(2, 4)}` : "";
}
