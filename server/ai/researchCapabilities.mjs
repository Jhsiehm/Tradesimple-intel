/** Implementation/configuration inventory, not an audit of historical source coverage. Never returns keys. */
export function researchCapabilities(env = process.env) {
  const configured = (name) => Boolean(String(env[name] || "").trim());
  return [
    {
      domain: "legislation",
      label: "Bill metadata, legislative actions and votes",
      lookup: configured("CONGRESS_API_KEY") ? "configured" : "not-configured",
      analysis: "conditional-policy-pilot",
      coverage: "not-audited",
      limitation:
        "Policy research can freeze a bill-specific protocol, collect versioned action/news records and compare paired event returns on complete supplied minute-price, reviewed exposure and news-timing inputs. Full legislative text/PDF collection, OCR and AI document extraction are not connected. Historical public availability and archive completeness are not certified; collection alone cannot establish a pre-news edge.",
    },
    {
      domain: "regulation",
      label: "Regulatory changes",
      lookup: "no-dedicated-connector",
      analysis: "unavailable",
      coverage: "not-audited",
      limitation:
        "A versioned regulatory-event connector and company-exposure dataset are not connected to the backtest engine. Web discovery alone does not supply those inputs.",
    },
    {
      domain: "contracts",
      label: "Government contract actions",
      lookup: "available",
      analysis: "limited-replay",
      coverage: "not-audited",
      limitation:
        "The legacy replay samples the largest actions from the last 365 days (at most 100 per retrieval), with source/assumed availability delays. It does not establish which legislation caused an award or provide a complete two-year history.",
    },
    {
      domain: "lobbying",
      label: "Lobbying filings",
      lookup: configured("LDA_API_KEY") ? "configured" : "not-configured",
      analysis: "limited-replay",
      coverage: "not-audited",
      limitation:
        "A quarterly spending-spike replay exists for specified tickers. It does not encode bill-language changes, issue-to-company causal links or a validated combined policy strategy.",
    },
    {
      domain: "congress",
      label: "Officials’ disclosed stock trades",
      lookup: "available",
      analysis: "limited-replay",
      coverage: "not-audited",
      limitation:
        "Personal stock disclosures are a distinct signal source. They do not represent legislative activity. Retrieval and ticker caps can limit historical coverage.",
    },
    {
      domain: "form4",
      label: "Insider stock filings",
      lookup: "available",
      analysis: "limited-replay",
      coverage: "not-audited",
      limitation:
        "Form 4 transaction replay is available subject to filing and price coverage. It does not measure policy effects.",
    },
  ];
}
