// Explicit maintenance job: no bulk network activity is triggered by opening the UI.
// node scripts/universe.mjs [--target 1500] [--fy 2025] [--write]
import fs from 'node:fs';
import { expandUniverse, mapContractorRecipients } from '../shared/universe.mjs';
import { nasdaqJson } from '../server/feeds/nasdaq.mjs';
import { secUserAgent } from '../server/lib/ua.mjs';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../server/lib/env.mjs';
const root = new URL('../', import.meta.url);
loadEnv(fileURLToPath(root));
const args = process.argv.slice(2);
const flag = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const target = Number(flag('--target', 1500)), fy = Number(flag('--fy', 2025));
if (!Number.isInteger(fy) || fy < 2008 || fy > new Date().getUTCFullYear()) throw Error('Invalid fiscal year');
const secUrl = 'https://www.sec.gov/files/company_tickers_exchange.json';
const spendingUrl = 'https://api.usaspending.gov/api/v2/search/spending_by_category/recipient/';
async function json(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw Error(`${new URL(url).hostname}: HTTP ${r.status}`);
  return r.json();
}
const [sec, nasdaq] = await Promise.all([
  args.includes('--sec-file') ? JSON.parse(fs.readFileSync(flag('--sec-file'), 'utf8')) : json(secUrl, { headers: { 'User-Agent': secUserAgent() } }),
  args.includes('--quotes-file') ? JSON.parse(fs.readFileSync(flag('--quotes-file'), 'utf8')) : nasdaqJson('screener/stocks?tableonly=true&limit=10000&download=true', 60000)
]);
const asOf = new Date().toISOString();
const current = JSON.parse(fs.readFileSync(new URL('data/tickers.json', root), 'utf8'));
const rows = expandUniverse(current.filter(r => r.universe?.tier !== 'on-demand' || r.core || r.contractParents?.length || r.ldaClients?.length || r.pacs?.length || r.insiderHistory !== false), sec, nasdaq?.data?.rows || [], target, asOf);
const filters = { time_period: [{ start_date: `${fy - 1}-10-01`, end_date: `${fy}-09-30` }], award_type_codes: ['A', 'B', 'C', 'D'] };
const recipients = [], requests = [];
for (let page = 1; page <= 5; page++) {
  const request = { filters, spending_level: 'transactions', limit: 100, page };
  const body = await json(spendingUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  if (body.results?.length !== 100) throw Error(`Incomplete contractor page ${page}; no files written.`);
  requests.push({ request, messages: body.messages || [] });
  recipients.push(...body.results);
  console.log(`Contractor page ${page}/5 received`);
}
if (new Set(recipients.map(r => r.recipient_id || r.uei || r.name)).size !== 500 || recipients.some((r, i) => !Number.isFinite(r.amount) || (i && r.amount > recipients[i - 1].amount))) throw Error('Contractor ranking changed during pagination or contains duplicates; rerun.');
const items = mapContractorRecipients(recipients, rows);
const metadata = { asOf, total: rows.length, core: rows.filter(r => r.core !== false).length, onDemand: rows.filter(r => r.universe?.tier === 'on-demand').length, historicalInsiderScope: rows.filter(r => r.insiderHistory !== false && r.cik).length, sources: [secUrl, 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true'], selection: 'Existing curated registry retained; additions ranked by current Nasdaq market capitalization with exact SEC exchange-symbol/CIK matching. Not a historical or survivorship-free index.', contractors: { fy, source: spendingUrl, asOf, count: items.length, mapped: items.filter(r => r.symbols.length).length, note: 'Top 500 recipient records by net prime-contract transaction obligations in this fiscal year, not 500 consolidated public companies. Subsidiaries may appear separately. Existing parent UEI joins are inherited, not independently reverified ownership. Unresolved does not mean private. Snapshot can be revised by USAspending.', requests, items } };
if (args.includes('--write')) {
  for (const [file, data] of [['tickers.json', rows], ['universe.json', metadata]]) {
    const dest = new URL(`data/${file}`, root), temp = new URL(`data/${file}.tmp`, root);
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n'); fs.renameSync(temp, dest);
  }
}
console.log(JSON.stringify({ written: args.includes('--write'), total: rows.length, additions: rows.length - current.length, core: metadata.core, contractors: items.length, mappedRecipients: metadata.contractors.mapped }));
