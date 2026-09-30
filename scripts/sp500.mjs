// Merge the S&P 500 constituent list (Wikipedia, with SEC CIKs) into data/tickers.json.
// Curated rows keep their joins and get core: true; new rows carry no LDA/PAC/contract joins.
import fs from "node:fs";

const FILE = new URL("../data/tickers.json", import.meta.url);
const URL_ = "https://en.wikipedia.org/w/api.php?action=parse&page=List_of_S%26P_500_companies&prop=wikitext&format=json&section=1";
const STATES = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  "District of Columbia": "DC", "Washington, D.C.": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
  Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA",
  Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
  Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
  Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY"
};

const body = await (await fetch(URL_, { headers: { "User-Agent": "TradeSimpleIntel/0.1 (local research terminal)" } })).json();
const text = body.parse.wikitext["*"];
const table = text.slice(text.indexOf('id="constituents"'), text.indexOf("|}", text.indexOf('id="constituents"')));
const plain = (cell) => cell
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
  .replace(/\{\{[^}]*\|([^}|]*)\}\}/g, "$1")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&")
  .trim();

const rows = table.split("\n|-").slice(1).map((block) => {
  const cells = block.replace(/\n\|\|?/g, "||").split("||").map((c) => c.replace(/^\|+/, "").trim()).filter(Boolean);
  if (cells.length < 7) return null;
  const symbol = plain(cells[0]).replace(/\./g, "-").toUpperCase();
  const hq = plain(cells[4]);
  const tail = hq.split(",").map((s) => s.trim()).pop() || "";
  const state = STATES[tail] || STATES[hq] || "";
  return {
    symbol,
    name: plain(cells[1]),
    sector: plain(cells[2]),
    industry: plain(cells[3]),
    hq,
    state,
    cik: plain(cells[6]).replace(/\D/g, "").padStart(10, "0")
  };
}).filter((r) => r && /^[A-Z-]{1,6}$/.test(r.symbol));

if (rows.length < 480) throw new Error(`Parsed only ${rows.length} constituents; refusing to write.`);

const current = JSON.parse(fs.readFileSync(FILE, "utf8"));
const bySymbol = new Map(current.map((row) => [row.symbol, row]));
const sp = new Map(rows.map((r) => [r.symbol, r]));
const merged = current.map((row) => {
  const hit = sp.get(row.symbol);
  return { ...row, core: row.core ?? true, index: hit ? ["SP500"] : row.index || [], sector: hit?.sector || row.sector || "", industry: hit?.industry || row.industry || "", hq: hit?.hq || row.hq || "" };
});
for (const r of rows) {
  if (bySymbol.has(r.symbol)) continue;
  merged.push({
    symbol: r.symbol,
    name: r.name,
    cik: r.cik,
    ldaClients: [],
    recipients: [],
    districts: [],
    state: r.state || null,
    lat: null,
    lon: null,
    pacs: [],
    core: false,
    index: ["SP500"],
    sector: r.sector,
    industry: r.industry,
    hq: r.hq
  });
}
merged.sort((a, b) => Number(b.core) - Number(a.core) || a.symbol.localeCompare(b.symbol));
fs.writeFileSync(FILE, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`${rows.length} constituents · ${merged.length} rows · ${merged.filter((r) => r.core).length} curated`);
