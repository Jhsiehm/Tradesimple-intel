import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addSymbol, ageLabel, badgesOf, cleanTickers, congressEvent, contractEvent, filingEvent, groupRepeats, insiderEvents, namesTicker, lagDays, lobbyingEvent,
  matchTickers, mergeEvents, moveSymbol, newsEvent, removeSymbol, stakeEvent, watchAlertRows, whaleEvent, WATCH_MAX
} from "../shared/watchlist.mjs";
import { alertSeverity } from "../shared/intel.mjs";
import { buildAlerts } from "../server/alerts.mjs";
import { parseSchedule13 } from "../server/parsers/schedule13.mjs";
import { pickFilings } from "../server/domain/watchlist/sources.mjs";

const NOW = Date.parse("2026-10-09T14:00:00Z");

test("House PTR 20035491 (Kevin Hern, LMT): 'S (partial)' and 'S' stay two rows and read differently; identical lines show as one 2× row", () => {
  const row = { chamber: "house", person: "Kevin Hern", bioguide: "H001082", party: "R", state: "OK", symbol: "LMT", side: "sell", amount: "$15,001 - $50,000", amountLow: 15001, traded: "2026-09-02", filed: "2026-09-25", owner: "Joint", link: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035491.pdf" };
  const partial = congressEvent({ ...row, id: "h-20035491-49", type: "Sale (partial)" });
  const full = congressEvent({ ...row, id: "h-20035491-50", type: "Sale" });
  assert.equal(partial.title, "Kevin Hern sold (partial) $15,001 - $50,000");
  assert.equal(full.title, "Kevin Hern sold $15,001 - $50,000");
  assert.equal(groupRepeats([partial, full]).length, 2);
  const twin = congressEvent({ ...row, id: "h-20035491-51", type: "Sale" });
  const grouped = groupRepeats([partial, full, twin]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[1].repeat, 2);
  assert.deepEqual(grouped[1].ids, ["trade:h-20035491-50", "trade:h-20035491-51"]);
});

test("news joins a ticker only when the headline or summary names it (Yahoo tags market-wide stories with the symbol)", () => {
  const nvda = { symbol: "NVDA", name: "NVIDIA" };
  assert.equal(namesTicker({ title: "Nvidia's next chip slips a quarter" }, nvda), true);
  assert.equal(namesTicker({ title: "Chip stocks", summary: "Shares of NVDA rose 3%" }, nvda), true);
  assert.equal(namesTicker({ title: "TransDigm Group (TDG): Fundamental Resilience Outweighs Short-Term Aftermarket Sell-Off" }, nvda), false);
  assert.equal(namesTicker({ title: "Micron Has Evolved Into a Next Gen Player" }, nvda), false);
  assert.equal(namesTicker({ title: "Lockheed wins a Navy award" }, { symbol: "LMT", name: "Lockheed Martin" }), true);
  assert.equal(namesTicker({ title: "AT&T (T) raises its dividend" }, { symbol: "T", name: "AT&T" }), true);
  assert.equal(namesTicker({ title: "T-Mobile and Verizon cut prices" }, { symbol: "T", name: "AT&T" }), false);
  assert.equal(namesTicker({ title: "Apple's AI push" }, { symbol: "AAPL", name: "Apple" }), true);
});

test("USAspending $0 actions are labeled '$0 modification' and say no money was obligated", () => {
  const c = contractEvent({ id: "award:CONT_AWD_80GSFC24FA046:P00006:2026-09-29", agency: "National Aeronautics and Space Administration", amount: 0, mod: "P00006", date: "2026-09-29", description: "ATHENA CRYOCOOLER", recipient: "LOCKHEED MARTIN CORPORATION", link: "https://www.usaspending.gov/award/CONT_AWD_80GSFC24FA046_8000_GS00Q14OADU323_4732" }, "LMT");
  assert.equal(c.title, "National Aeronautics and Space Administration · $0 modification");
  assert.equal(c.amountLabel, "$0 modification");
  assert.match(c.detail, /mod P00006 · no money obligated by this action/);
  const back = contractEvent({ id: "award:CONT_AWD_PBGC01CT150031:9:2026-09-30", agency: "Pension Benefit Guaranty Corporation", amount: -1_200_000, date: "2026-09-30", link: "u" }, "JPM");
  assert.equal(back.title, "Pension Benefit Guaranty Corporation · −$1.2M deobligation");
});

test("tickers are checked against the join table, deduped, ordered, capped", () => {
  const known = new Set(["AAPL", "BRK.B", "LMT"]);
  assert.deepEqual(cleanTickers(["lmt", " aapl ", "LMT", "ZZZZ", "brk.b", "", "DROP TABLE"], known), { valid: ["LMT", "AAPL", "BRK.B"], invalid: ["ZZZZ", "DROP TABLE"] });
  const many = Array.from({ length: WATCH_MAX + 3 }, (_, i) => `T${i}`);
  const r = cleanTickers(many, new Set(many));
  assert.equal(r.valid.length, WATCH_MAX);
  assert.equal(r.invalid.length, 3, "over the cap is reported, not silently dropped");
});

test("add, remove and reorder keep one copy and clamp at the ends", () => {
  assert.deepEqual(addSymbol(["A"], "b"), ["A", "B"]);
  const same = ["A", "B"];
  assert.equal(addSymbol(same, "a"), same, "duplicate add returns the same list");
  assert.deepEqual(removeSymbol(["A", "B", "C"], "b"), ["A", "C"]);
  assert.deepEqual(moveSymbol(["A", "B", "C"], "C", -1), ["A", "C", "B"]);
  assert.deepEqual(moveSymbol(["A", "B", "C"], "A", 5), ["B", "C", "A"]);
  const list = ["A", "B"];
  assert.equal(moveSymbol(list, "A", -1), list, "already first");
  assert.equal(moveSymbol(list, "Z", 1), list, "unknown symbol");
});

test("typeahead ranks exact symbol, symbol prefix, then name words", () => {
  const t = [{ symbol: "LMT", name: "Lockheed Martin" }, { symbol: "L", name: "Loews" }, { symbol: "MRK", name: "Merck" }, { symbol: "MAR", name: "Marriott" }];
  assert.deepEqual(matchTickers(t, "l").map((x) => x.symbol), ["L", "LMT"]);
  assert.deepEqual(matchTickers(t, "mar").map((x) => x.symbol), ["MAR", "LMT"], "MAR symbol first, then 'Martin'");
  assert.deepEqual(matchTickers(t, ""), []);
});

test("lag is whole UTC days from event to disclosure; age labels read naturally", () => {
  assert.equal(lagDays("2026-08-01", "2026-09-20"), 50);
  assert.equal(lagDays("2026-08-24", "2026-08-27T23:31:09.000Z"), 3);
  assert.equal(lagDays("", "2026-08-27"), null);
  assert.equal(ageLabel("2026-10-09T13:15:00Z", NOW), "45m");
  assert.equal(ageLabel("2026-10-08T14:00:00Z", NOW), "24h");
  assert.equal(ageLabel("2026-09-25", NOW), "15d");
  assert.equal(ageLabel("2026-04-01", NOW), "6mo");
  assert.equal(ageLabel("", NOW), "");
});

test("congress rows keep chamber, party/state, amount range, and flag late filings", () => {
  const e = congressEvent({ id: "h-1-0", chamber: "house", person: "Kevin Hern", bioguide: "H001082", party: "R", state: "OK", symbol: "LMT", side: "sell", amount: "$15,001 - $50,000", amountLow: 15001, traded: "2026-08-01", filed: "2026-09-25", lag: 55, link: "x" });
  assert.equal(e.id, "trade:h-1-0", "same id as the Alerts congress row");
  assert.equal(e.feed, "House Clerk PTR");
  assert.equal(e.detail, "House · R-OK");
  assert.equal(e.late, true);
  assert.equal(e.eventAt, "2026-08-01");
  assert.equal(e.publishedAt, "2026-09-25");
  assert.equal(congressEvent({ id: "s", chamber: "senate", traded: "2026-09-01", filed: "2026-09-10" }).lag, 9, "lag computed when the row has none");
});

test("Form 4 lines fold into one event per filing with open-market value and plan flag", () => {
  const rows = [
    { id: "a", accession: "ACC1", symbol: "LMT", person: "Donovan John", title: "Director", code: "S", side: "sell", shares: 100, price: 500, plan: true, traded: "2026-08-13", filed: "2026-08-17", link: "l" },
    { id: "b", accession: "ACC1", symbol: "LMT", person: "Donovan John", title: "Director", code: "S", side: "sell", shares: 50, price: 500, plan: true, traded: "2026-08-12", filed: "2026-08-17", link: "l" },
    { id: "c", accession: "ACC2", symbol: "LMT", person: "Taiclet James", title: "CEO", code: "P", side: "buy", shares: 1000, price: 480, plan: false, traded: "2026-09-01", filed: "2026-09-02", link: "m" }
  ];
  const [sale, buy] = insiderEvents(rows);
  assert.equal(sale.id, "f4:LMT:ACC1", "same id as the Alerts Form 4 row");
  assert.equal(sale.lines.length, 2);
  assert.equal(sale.eventAt, "2026-08-12", "earliest transaction date");
  assert.equal(sale.lag, 5);
  assert.equal(sale.planned, true);
  assert.equal(sale.amount, null, "planned sales add no open-market value");
  assert.equal(sale.side, "sell");
  assert.equal(buy.buys, 1);
  assert.equal(buy.amount, 480000);
  assert.match(buy.title, /Taiclet James \(CEO\) · P · 1 open-market buy/);
});

test("13F, 13D/13G, contract, lobbying, 8-K and news rows carry event time, publish time and lag", () => {
  const w = whaleEvent({ id: "13f-acc-LMT", symbol: "LMT", person: "Two Sigma", action: "add", side: "buy", shares: 1569836, delta: 220664, value: 799768649, period: "2026-06-30", priorPeriod: "2026-03-31", filed: "2026-08-14", lag: 45, link: "w" });
  assert.equal(w.change, "increase");
  assert.equal(w.eventAt, "2026-06-30");
  assert.equal(w.lag, 45);
  assert.match(w.detail, /\+220,664 sh vs 2026-03-31/);

  const s = stakeEvent({ symbol: "LMT", form: "SCHEDULE 13D/A", accession: "0001-26-1", person: "Activist LP", eventDate: "2026-09-01", accepted: "2026-09-08T20:00:00.000Z", percent: 5.2, shares: 1e6, link: "s" });
  assert.equal(s.activist, true);
  assert.equal(s.amend, true);
  assert.equal(s.lag, 7);
  assert.match(s.title, /Activist LP · 13D amendment · 5.2% of class/);
  assert.equal(stakeEvent({ symbol: "X", form: "SC 13G", accession: "a" }).who, "Filer named in the filing");

  const c = contractEvent({ id: "award:x:0:2026-10-01", agency: "Department of Defense", subAgency: "Department of the Navy", amount: 12_500_000, date: "2026-10-01", description: "F-35 SUSTAINMENT", recipient: "LOCKHEED MARTIN CORP", link: "c" }, "LMT");
  assert.equal(c.publishedAt, "", "USAspending has no per-action publish date");
  assert.equal(c.lag, null);
  assert.match(c.title, /Department of Defense · Department of the Navy · \$12.5M/);

  const l = lobbyingEvent({ id: "lda:u1", registrant: "VENABLE LLP", amount: 30000, typeLabel: "3rd Quarter - Report", issues: ["Defense", "Budget"], periodEnd: "2026-09-30", posted: "2026-10-08", lag: 8 }, "LMT");
  assert.equal(l.id, "lda:lda:u1", "same id as the Alerts lobbying row");
  assert.equal(l.lag, 8);

  const k = filingEvent({ symbol: "LMT", form: "8-K", accession: "0001193125-26-371750", items: "1.01,9.01", reportDate: "2026-08-24", accepted: "2026-08-27T23:31:09.000Z", link: "k" });
  assert.equal(k.title, "8-K · Material agreement");
  assert.deepEqual(k.items, ["1.01", "9.01"]);
  assert.equal(k.lag, 3);

  const n = newsEvent({ id: "h1", title: "Lockheed wins", link: "n", published: "2026-10-09T13:00:00.000Z" }, "LMT");
  assert.equal(n.lag, null);
  assert.equal(n.id, "news:LMT:h1");
});

test("merge dedupes by id and sorts newest public time first; badges count the window", () => {
  const a = { id: "x", source: "news", publishedAt: "2026-10-09T10:00:00Z", eventAt: "" };
  const b = { id: "y", source: "congress", publishedAt: "2026-09-25", eventAt: "2026-08-01" };
  const c = { id: "z", source: "contracts", publishedAt: "", eventAt: "2026-10-01" };
  const old = { id: "o", source: "congress", publishedAt: "2026-05-01", eventAt: "2026-04-01" };
  const merged = mergeEvents([b, a, { ...a, title: "dup" }, c, old]);
  assert.deepEqual(merged.map((e) => e.id), ["x", "z", "y", "o"]);
  assert.equal(merged[0].title, undefined, "first copy wins");
  const badges = badgesOf(merged, 30, NOW);
  assert.deepEqual(Object.keys(badges).sort(), ["congress", "contracts", "news"]);
  assert.equal(badges.congress.count, 1, "the May filing is outside 30 days");
  assert.equal(badges.news.age, "4h");
});

test("severity: buys, contracts, 13D, 13F size and 8-K items", () => {
  assert.equal(alertSeverity({ kind: "symbol-trade", lag: 10, amountLow: 1001, buy: true }), "elevated");
  assert.equal(alertSeverity({ kind: "symbol-trade", lag: 10, amountLow: 1001 }), "routine");
  assert.equal(alertSeverity({ kind: "form4", value: 20000, buy: true }), "elevated");
  assert.equal(alertSeverity({ kind: "contract", amount: 2e8 }), "high");
  assert.equal(alertSeverity({ kind: "contract", amount: 1.5e7 }), "elevated");
  assert.equal(alertSeverity({ kind: "contract", amount: 2e6 }), "routine");
  assert.equal(alertSeverity({ kind: "stake", activist: true }), "elevated");
  assert.equal(alertSeverity({ kind: "stake", activist: false }), "routine");
  assert.equal(alertSeverity({ kind: "whale", change: "new", value: 2e8 }), "elevated");
  assert.equal(alertSeverity({ kind: "whale", change: "increase", value: 2e9 }), "routine");
  assert.equal(alertSeverity({ kind: "8-k", items: ["1.03"] }), "high");
  assert.equal(alertSeverity({ kind: "8-k", items: ["5.02", "9.01"] }), "elevated");
  assert.equal(alertSeverity({ kind: "8-k", items: ["2.02", "9.01"] }), "routine");
});

test("watch alert rows: only sources Alerts does not build, unchanged 13F and small contracts stay quiet", () => {
  const events = [
    congressEvent({ id: "t1", symbol: "LMT", person: "A", side: "buy", traded: "2026-09-01", filed: "2026-09-20" }),
    stakeEvent({ symbol: "LMT", form: "SCHEDULE 13D", accession: "acc1", person: "Fund", eventDate: "2026-09-25", accepted: "2026-10-01T12:00:00Z" }),
    contractEvent({ id: "big", agency: "DoD", amount: 1.2e8, date: "2026-09-30" }, "LMT"),
    contractEvent({ id: "small", agency: "DoD", amount: 4e5, date: "2026-09-30" }, "LMT"),
    whaleEvent({ id: "h", symbol: "LMT", person: "F", action: "hold", period: "2026-06-30", filed: "2026-08-14" }),
    whaleEvent({ id: "e", symbol: "LMT", person: "G", action: "exit", value: 0, period: "2026-06-30", filed: "2026-08-14" }),
    whaleEvent({ id: "small", symbol: "LMT", person: "H", action: "add", shares: 1100, delta: 100, period: "2026-06-30", filed: "2026-08-14" }),
    whaleEvent({ id: "big", symbol: "LMT", person: "I", action: "trim", shares: 600, delta: -400, period: "2026-06-30", filed: "2026-08-14" }),
    filingEvent({ symbol: "LMT", form: "8-K", accession: "k1", items: "4.02", reportDate: "2026-09-02", accepted: "2026-09-04T21:00:00Z" })
  ];
  const rows = watchAlertRows(events, "2026-08-01");
  assert.deepEqual(rows.map((r) => r.id).sort(), ["8k:k1", "contract:big", "stake:acc1", "whale:big", "whale:e"], "a +10% add stays quiet, a -40% trim alerts");
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId["stake:acc1"].severity, "elevated");
  assert.equal(byId["contract:big"].severity, "high");
  assert.equal(byId["8k:k1"].severity, "high");
  assert.equal(byId["8k:k1"].date, "2026-09-04");
  assert.equal(byId["stake:acc1"].action, "pos:LMT");
  assert.deepEqual(watchAlertRows(events, "2026-10-02").map((r) => r.id), [], "since filters on the public date");
  const headline = newsEvent({ id: "h", title: "Lockheed wins", link: "n", published: "2026-10-09T13:00:00.000Z" }, "LMT");
  assert.deepEqual(watchAlertRows([headline]), [], "headlines stay out of Alerts by default");
  const [n] = watchAlertRows([headline], "", { news: true });
  assert.deepEqual([n.id, n.kind, n.severity, n.source], ["news:LMT:h", "news", "routine", "Yahoo Finance RSS"]);
});

test("Alerts: a watched Congress buy and an insider open-market buy are elevated", () => {
  const out = buildAlerts({
    trades: [{ id: "t1", person: "Rep. A", bioguide: "A000001", symbol: "LMT", side: "buy", amount: "$1,001 - $15,000", amountLow: 1001, traded: "2026-09-01", filed: "2026-09-10", lag: 9 }],
    insiders: [{ id: "f", accession: "ACC", symbol: "LMT", person: "CEO", code: "P", side: "buy", shares: 10, price: 500, traded: "2026-09-01", filed: "2026-09-02" }],
    symbols: ["LMT"],
    members: []
  });
  assert.equal(out.find((a) => a.id === "trade:t1").severity, "elevated");
  assert.equal(out.find((a) => a.id === "f4:LMT:ACC").severity, "elevated");
});

test("13D/13G XML cover page: reporting person, event date, percent, shares", () => {
  const xml = `<edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13g"><headerData><submissionType>SCHEDULE 13G</submissionType></headerData>
    <formData><coverPageHeader><eventDateRequiresFilingThisStatement>03/31/2026</eventDateRequiresFilingThisStatement><issuerInfo><issuerCik>0000320193</issuerCik></issuerInfo></coverPageHeader>
    <coverPageHeaderReportingPersonDetails><reportingPersonName>Vanguard Capital Management &amp; Co</reportingPersonName>
    <reportingPersonBeneficiallyOwnedAggregateNumberOfShares>1099168953</reportingPersonBeneficiallyOwnedAggregateNumberOfShares><classPercent>7.48</classPercent></coverPageHeaderReportingPersonDetails></formData></edgarSubmission>`;
  assert.deepEqual(parseSchedule13(xml), { form: "SCHEDULE 13G", person: "Vanguard Capital Management & Co", eventDate: "2026-03-31", percent: 7.48, shares: 1099168953, issuerCik: "0000320193" });
  assert.deepEqual(parseSchedule13("<html>old text filing</html>"), { form: "", person: "", eventDate: "", percent: null, shares: null, issuerCik: "" });
});

test("pickFilings reads 13D/13G and 8-K rows from slim submissions with acceptance time and items", () => {
  const subs = { filings: { recent: {
    form: ["8-K", "4", "SCHEDULE 13G", "SC 13G/A", "8-K/A", "8-K"],
    accessionNumber: ["a1", "a2", "a3", "a4", "a5", "a6"],
    filingDate: ["2026-10-01", "2026-09-30", "2026-04-30", "2025-02-10", "2026-09-01", "2025-01-01"],
    acceptanceDateTime: ["2026-10-01T20:00:00.000Z", "", "2026-04-30T15:16:15.000Z", "", "", ""],
    reportDate: ["2026-09-29", "", "", "", "2026-08-28", ""],
    items: ["5.02", "", "", "", "2.02", ""],
    primaryDocument: ["d1.htm", "x.xml", "xslSCHEDULE_13G_X02/primary_doc.xml", "t.txt", "d5.htm", "d6.htm"]
  } } };
  const stakes = pickFilings(subs, /^(SC 13[DG]|SCHEDULE 13[DG])(\/A)?$/, "2025-10-01");
  assert.deepEqual(stakes.map((f) => f.accession), ["a3"]);
  const eightK = pickFilings(subs, /^8-K(\/A)?$/, "2026-06-01");
  assert.deepEqual(eightK.map((f) => [f.accession, f.items, f.reportDate]), [["a1", "5.02", "2026-09-29"], ["a5", "2.02", "2026-08-28"]]);
  assert.equal(eightK[0].accepted, "2026-10-01T20:00:00.000Z");
});
