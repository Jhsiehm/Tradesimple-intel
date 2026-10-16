/** Registry growth never implies that lobbying/contract ownership or historical coverage is known. */
export const listingSymbol = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[/.^]/g, "-");
export function expandUniverse(current, sec, quotes, target = 1500, asOf = new Date().toISOString()) {
  if (!Number.isInteger(target) || target < current.length || target > 5000)
    throw Error("Target must be between the existing registry size and 5,000.");
  const fields = sec.fields;
  if (!["cik", "ticker", "exchange", "name"].every((f) => fields?.includes(f)))
    throw Error("Unexpected SEC listing schema");
  const secBySymbol = new Map();
  for (const values of sec.data || []) {
    const row = Object.fromEntries(fields.map((f, i) => [f, values[i]]));
    if (!["Nasdaq", "NYSE", "CBOE"].includes(row.exchange) || !Number(row.cik)) continue;
    const symbol = listingSymbol(row.ticker);
    if (!secBySymbol.has(symbol)) secBySymbol.set(symbol, row);
    else if (secBySymbol.get(symbol)?.cik !== row.cik) secBySymbol.set(symbol, null);
  }
  const rows = [...current],
    seen = new Set(rows.map((r) => r.symbol));
  const ranked = [...quotes].sort(
    (a, b) => Number(b.marketCap) - Number(a.marketCap) || String(a.symbol).localeCompare(String(b.symbol)),
  );
  for (const quote of ranked) {
    if (rows.length >= target) break;
    const symbol = listingSymbol(quote.symbol),
      issuer = secBySymbol.get(symbol);
    if (seen.has(symbol) || !issuer || !/^[A-Z]+(?:-[A-Z]+)?$/.test(symbol) || !(Number(quote.marketCap) > 0)) continue;
    // Screen out explicitly identified derivative/fund/preferred instruments. This is a listing
    // universe (including ADRs/REITs), not a claim of US domicile or historical index membership.
    if (/\b(warrants?|units?|preferred|ETF|ETN|fund|notes?|bonds?|debentures?)\b/i.test(quote.name)) continue;
    seen.add(symbol);
    rows.push({
      symbol,
      name: issuer.name,
      cik: String(issuer.cik).padStart(10, "0"),
      ldaClients: [],
      recipients: [],
      districts: [],
      state: null,
      lat: null,
      lon: null,
      pacs: [],
      core: false,
      index: [],
      sector: quote.sector || "",
      industry: quote.industry || "",
      contractParents: [],
      insiderHistory: false,
      universe: {
        source: "SEC exchange listings + Nasdaq screener",
        asOf,
        exchange: issuer.exchange,
        marketCap: Number(quote.marketCap),
        tier: "on-demand",
      },
    });
  }
  if (rows.length < target)
    throw Error(`Only ${rows.length} eligible listings; refusing an incomplete ${target}-ticker update.`);
  return rows.sort((a, b) => Number(b.core) - Number(a.core) || a.symbol.localeCompare(b.symbol));
}

export function mapContractorRecipients(recipients, tickers) {
  const byUei = new Map();
  for (const t of tickers)
    for (const p of t.contractParents || []) {
      if (!p.uei) continue;
      if (!byUei.has(p.uei)) byUei.set(p.uei, new Set());
      byUei.get(p.uei).add(t.symbol);
    }
  return recipients.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    recipientId: r.recipient_id,
    uei: r.uei || null,
    obligations: r.amount,
    symbols: [...(byUei.get(r.uei) || [])].sort(),
    mapping: byUei.has(r.uei) ? "existing-parent-uei" : "unresolved",
  }));
}

export const defaultWarmTickers = (rows) => rows.filter((r) => r.core !== false);
