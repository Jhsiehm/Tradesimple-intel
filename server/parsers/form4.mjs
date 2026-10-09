/**
 * Owner, role, and non-derivative transactions from a Form 4 XML document. `plan10b5` is the filing's Rule 10b5-1
 * checkbox (aff10b5One) or a footnote naming a 10b5-1 plan. A line's `plan` is true when one of its footnotes names
 * the plan; when no footnote does, it follows the checkbox. `issuerCik` and `issuerSymbol` name the company whose
 * shares traded, which is not always the filer whose submissions list the form (Berkshire files Form 4s as the
 * owner of other companies' shares).
 */
export function parseForm4(xml) {
  const owner = xmlVal(xml, "rptOwnerName");
  const title = xmlVal(xml, "officerTitle") || (xmlVal(xml, "isDirector") === "1" || xmlVal(xml, "isDirector") === "true" ? "Director" : "") || (xmlVal(xml, "isTenPercentOwner") === "1" ? "10% owner" : "");
  const planNotes = new Set();
  for (const m of xml.matchAll(/<footnote\s+id="([^"]+)"\s*>([\s\S]*?)<\/footnote>/g)) if (/10b5-1/i.test(m[2])) planNotes.add(m[1]);
  const box = xmlVal(xml, "aff10b5One");
  const checked = box === "1" || box === "true";
  const lines = (xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g) || []).map((block) => ({
    date: xmlVal(block, "transactionDate"),
    code: xmlVal(block, "transactionCode"),
    shares: Number(xmlVal(block, "transactionShares")) || 0,
    price: Number(xmlVal(block, "transactionPricePerShare")) || null,
    ad: xmlVal(block, "transactionAcquiredDisposedCode"),
    owned: Number(xmlVal(block, "sharesOwnedFollowingTransaction")) || null,
    plan: planNotes.size ? [...block.matchAll(/<footnoteId\s+id="([^"]+)"/g)].some((m) => planNotes.has(m[1])) : checked
  }));
  return { owner: titleCase(owner), title, plan10b5: checked || planNotes.size > 0, issuerCik: xmlVal(xml, "issuerCik").replace(/\D/g, ""), issuerSymbol: xmlVal(xml, "issuerTradingSymbol").toUpperCase(), lines };
}

function xmlVal(xml, name) {
  const m = new RegExp(`<${name}>\\s*(?:<value>)?\\s*([^<]*?)\\s*(?:</value>)?\\s*(?:<footnoteId[^>]*/>\\s*)*</${name}>`).exec(xml);
  return m ? decodeXml(m[1].trim()) : "";
}

function decodeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function titleCase(value) {
  return String(value || "").toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Llc|Lp|Inc|Ltd|Plc)\b/g, (s) => s.toUpperCase());
}
