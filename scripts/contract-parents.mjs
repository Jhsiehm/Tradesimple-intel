// Join S&P 500 rows to USAspending parent recipients so contract totals roll up subsidiaries the way
// USAspending does, instead of a substring search ("APPLE" also matches APPLETON MARINE).
// Tokens come from each row's existing recipients, its company name, and the curated ALIASES below.
//   node scripts/contract-parents.mjs [--only LMT,RTX]
import fs from "node:fs";
import { contractParentMatch, norm } from "./joins-match.mjs";

const FILE = new URL("../data/tickers.json", import.meta.url);
const args = process.argv.slice(2);
const ONLY = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1].split(",")) : null;

/** Government-facing subsidiaries filed under a name that does not start with the parent's. */
const ALIASES = {
  AMZN: ["AMAZON WEB SERVICES"],
  GOOGL: ["GOOGLE PUBLIC SECTOR", "GOOGLE"],
  GOOG: ["GOOGLE PUBLIC SECTOR", "GOOGLE"],
  RTX: ["RAYTHEON", "PRATT AND WHITNEY", "COLLINS AEROSPACE"],
  GD: ["ELECTRIC BOAT", "BATH IRON WORKS", "GENERAL DYNAMICS INFORMATION TECHNOLOGY", "GULFSTREAM AEROSPACE"],
  HII: ["HUNTINGTON INGALLS"],
  LHX: ["L3HARRIS TECHNOLOGIES", "AEROJET ROCKETDYNE"],
  TXT: ["BELL TEXTRON", "TEXTRON AVIATION", "TEXTRON SYSTEMS"],
  BA: ["BOEING"],
  J: ["JACOBS ENGINEERING GROUP", "JACOBS TECHNOLOGY"],
  CNC: ["HEALTH NET FEDERAL SERVICES"],
  UNH: ["OPTUM PUBLIC SECTOR SOLUTIONS", "UNITEDHEALTH MILITARY AND VETERANS SERVICES"],
  HUM: ["HUMANA GOVERNMENT BUSINESS", "HUMANA MILITARY HEALTHCARE SERVICES"],
  MCK: ["MCKESSON"],
  CAH: ["CARDINAL HEALTH"],
  COR: ["CENCORA", "AMERISOURCEBERGEN"],
  IBM: ["INTERNATIONAL BUSINESS MACHINES"],
  ORCL: ["ORACLE AMERICA"],
  MSFT: ["MICROSOFT"],
  DELL: ["DELL FEDERAL SYSTEMS"],
  HPE: ["HEWLETT PACKARD ENTERPRISE"],
  GE: ["GENERAL ELECTRIC", "GE AEROSPACE"]
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function recipients(keyword) {
  for (let i = 0; i < 3; i += 1) {
    const res = await fetch("https://api.usaspending.gov/api/v2/recipient/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, award_type: "contracts", limit: 50, page: 1, order: "desc", sort: "amount" }),
      signal: AbortSignal.timeout(45000)
    }).catch(() => null);
    if (res?.ok) return (await res.json()).results || [];
    if (res && res.status !== 429 && res.status < 500) return [];
    await sleep(2000 * (i + 1));
  }
  return null;
}

async function pool(list, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < list.length) await fn(list[next++]);
  }));
}

const rows = JSON.parse(fs.readFileSync(FILE, "utf8"));
const today = new Date().toISOString().slice(0, 10);
let failed = 0;
const targets = rows.filter((r) => !ONLY || ONLY.has(r.symbol));
await pool(targets, 4, async (row) => {
  const alias = ALIASES[row.symbol.replace("-", "_")] || [];
  const tokens = [...new Set([...(row.recipients || []), row.name, ...alias].map(norm).filter((t) => t.length >= 3))];
  const found = new Map();
  for (const token of tokens) {
    const list = await recipients(token);
    if (list == null) {
      failed += 1;
      return;
    }
    for (const r of list) {
      if (r.recipient_level !== "P" || !contractParentMatch(token, r.name)) continue;
      found.set(r.id, { id: r.id, name: r.name, uei: r.uei || "", token });
    }
  }
  const parents = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  row.contractParents = parents.map(({ id, name, uei }) => ({ id, name, uei }));
  row.joinBasis = {
    ...(row.joinBasis || {}),
    contracts: parents.length
      ? `USAspending parent recipients named ${[...new Set(parents.map((p) => p.token))].join(" / ")} plus legal-form or division words; derived ${today}${alias.length ? "; includes curated subsidiary aliases" : ""}`
      : `No USAspending parent recipient matched ${tokens.join(" / ")}; checked ${today}`
  };
  if (parents.length) console.log(`${row.symbol.padEnd(6)} ${parents.map((p) => p.name).join(" | ")}`);
});

fs.writeFileSync(FILE, `${JSON.stringify(rows, null, 2)}\n`);
console.log(`${targets.filter((r) => r.contractParents?.length).length} of ${targets.length} rows joined to contract parents${failed ? ` · ${failed} lookups failed (rerun with --only)` : ""}`);
