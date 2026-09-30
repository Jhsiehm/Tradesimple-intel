// Derive full joins (HQ district, LDA clients, PACs, contract recipient) for the largest S&P names
// that only have quotes. Every join is an exact normalized-name or address match; misses stay empty.
//   node scripts/joins.mjs [--count 75] [--refresh]
import fs from "node:fs";
import { fecBulk } from "../server/corporate.mjs";
import { districtCode, ldaMatches, norm, pacsByOrg } from "./joins-match.mjs";

const FILE = new URL("../data/tickers.json", import.meta.url);
const ENV = new URL("../.env.local", import.meta.url);
if (fs.existsSync(ENV)) {
  for (const line of fs.readFileSync(ENV, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const LDA_KEY = process.env.LDA_API_KEY || "";
const args = process.argv.slice(2);
const COUNT = Number(args[args.indexOf("--count") + 1]) || 75;
const REFRESH = args.includes("--refresh");
const SEC_UA = { "User-Agent": "TradeSimpleIntel/0.1 research contact@tradesimple.local" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url, headers = {}, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (res?.ok) return res.json();
    if (res && res.status !== 429 && res.status < 500) return null;
    await sleep(1500 * (i + 1));
  }
  return null;
}

async function pool(list, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < list.length) await fn(list[next++]);
  }));
}

async function secProfile(cik) {
  const body = await json(`https://data.sec.gov/submissions/CIK${cik}.json`, SEC_UA);
  if (!body) return null;
  return { name: body.name, address: body.addresses?.business || null };
}

async function district(address) {
  if (!address?.street1 || address.isForeignLocation === 1 || !/^[A-Z]{2}$/.test(address.stateOrCountry || "")) return null;
  const streets = [address.street1, address.street2].filter(Boolean);
  for (const street of streets) {
    const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/address");
    url.search = new URLSearchParams({
      street,
      city: address.city || "",
      state: address.stateOrCountry,
      zip: String(address.zipCode || "").slice(0, 5),
      benchmark: "Public_AR_Current",
      vintage: "ACS2025_Current",
      format: "json"
    });
    const body = await json(url);
    const match = body?.result?.addressMatches?.[0];
    if (!match) continue;
    const key = Object.keys(match.geographies || {}).find((k) => /119th Congressional/.test(k));
    const cd = key ? match.geographies[key][0] : null;
    const code = districtCode(address.stateOrCountry, cd);
    return {
      code,
      atLarge: cd && !code ? cd.BASENAME : null,
      lat: Number(match.coordinates.y.toFixed(4)),
      lon: Number(match.coordinates.x.toFixed(4)),
      matched: match.matchedAddress
    };
  }
  return null;
}

async function ldaClients(targets) {
  if (!LDA_KEY) return [];
  const names = [];
  for (const target of targets) {
    let url = `https://lda.gov/api/v1/clients/?client_name=${encodeURIComponent(target)}&page_size=25`;
    for (let page = 0; url && page < 4; page += 1) {
      const body = await json(url, { Authorization: `Token ${LDA_KEY}` });
      names.push(...(body?.results || []).map((c) => c.name));
      url = body?.next || null;
      await sleep(600);
    }
  }
  return ldaMatches(names, targets);
}

async function pacIndex() {
  const year = new Date().getUTCFullYear();
  const cycle = year % 2 ? year + 1 : year;
  const lines = [];
  for (const cy of [cycle, cycle - 2]) lines.push(...(await fecBulk(`cm${String(cy).slice(2)}`, cy, "cm.txt")).split("\n"));
  return pacsByOrg(lines);
}

async function marketCaps() {
  const body = await json("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true", { "User-Agent": "Mozilla/5.0", Accept: "application/json" });
  const caps = new Map();
  for (const r of body?.data?.rows || []) caps.set(String(r.symbol).trim().replace(/[/.^]/g, "-"), Number(String(r.marketCap || "").replace(/[$,]/g, "")) || 0);
  return caps;
}

const rows = JSON.parse(fs.readFileSync(FILE, "utf8"));
const caps = await marketCaps();
if (!caps.size) throw new Error("Nasdaq screener returned nothing; refusing to rank.");
const queue = rows
  .filter((r) => r.core === false || (REFRESH && r.joinBasis?.auto))
  .filter((r) => r.cik)
  .sort((a, b) => (caps.get(b.symbol) || 0) - (caps.get(a.symbol) || 0))
  .slice(0, COUNT);
console.log(`Deriving joins for ${queue.length} names (${queue.slice(0, 8).map((r) => r.symbol).join(", ")}…)`);

const pacs = await pacIndex();
console.log(`FEC committee master: ${pacs.size} corporate connected orgs`);

const today = new Date().toISOString().slice(0, 10);
let done = 0;
await pool(queue, 3, async (row) => {
  const sec = await secProfile(row.cik);
  if (!sec) return console.warn(`  ${row.symbol}: SEC submissions missing`);
  const targets = [...new Set([norm(sec.name), norm(row.name)])].filter((t) => t.length >= 4);
  const [geo, clients] = await Promise.all([district(sec.address), ldaClients(targets)]);
  const pacIds = [...new Set(targets.flatMap((t) => [...(pacs.get(t) || [])]))];
  row.districts = geo?.code ? [geo.code] : [];
  if (geo) {
    row.lat = geo.lat;
    row.lon = geo.lon;
  }
  if (sec.address?.stateOrCountry && /^[A-Z]{2}$/.test(sec.address.stateOrCountry)) row.state = sec.address.stateOrCountry;
  row.ldaClients = clients;
  row.recipients = (targets.length ? targets : [norm(sec.name)]).map((t) => t.replace(/ AND /g, " & "));
  row.pacs = pacIds;
  row.core = true;
  row.joinBasis = {
    auto: true,
    derived: today,
    secName: sec.name,
    district: geo?.code ? `SEC business address → Census geocoder (${geo.matched}) → 119th CD` : geo?.atLarge ? `${geo.atLarge}; no voting seat joined` : sec.address?.isForeignLocation === 1 || !/^[A-Z]{2}$/.test(sec.address?.stateOrCountry || "") ? "SEC business address is outside the US" : "Census geocoder has no street match for the SEC business address (campus or P.O. box); left empty",
    lda: clients.length ? `LDA client names equal to "${targets.join('" / "')}" after suffix stripping` : "No exact LDA client name match",
    pacs: pacIds.length ? "FEC committee master: connected organization equals company name (corporate SSF)" : "No FEC connected-organization match",
    recipients: "SEC conformed and index names without corporate suffix (USAspending text search)"
  };
  done += 1;
  console.log(`  ${String(done).padStart(3)} ${row.symbol.padEnd(6)} ${row.districts[0] || "—"}  lda:${clients.length}  pacs:${pacIds.length}  ${sec.name}`);
});

const curatedByCik = new Map(rows.filter((r) => r.core && !r.joinBasis?.auto).map((r) => [r.cik, r]));
for (const row of rows) {
  const twin = curatedByCik.get(row.cik);
  if (!twin || twin === row || (row.core && !row.joinBasis?.auto)) continue;
  Object.assign(row, {
    ldaClients: twin.ldaClients,
    recipients: twin.recipients,
    districts: twin.districts,
    state: twin.state,
    lat: twin.lat,
    lon: twin.lon,
    pacs: twin.pacs,
    core: true,
    joinBasis: { auto: true, derived: today, shareClassOf: twin.symbol, district: `Same SEC CIK as ${twin.symbol}; joins copied`, lda: `Same as ${twin.symbol}`, pacs: `Same as ${twin.symbol}`, recipients: `Same as ${twin.symbol}` }
  });
  console.log(`  ${row.symbol}: share class of ${twin.symbol} (CIK ${row.cik})`);
}

rows.sort((a, b) => Number(b.core) - Number(a.core) || a.symbol.localeCompare(b.symbol));
fs.writeFileSync(FILE, `${JSON.stringify(rows, null, 2)}\n`);
const auto = rows.filter((r) => r.joinBasis?.auto);
console.log(`${rows.filter((r) => r.core).length} full-join rows (${auto.length} derived) · districts ${auto.filter((r) => r.districts.length).length} · LDA ${auto.filter((r) => r.ldaClients.length).length} · PACs ${auto.filter((r) => r.pacs.length).length}`);
