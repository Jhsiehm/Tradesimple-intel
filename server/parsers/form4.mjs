/** Owner, role, and non-derivative transactions from a Form 4 XML document. */
export function parseForm4(xml) {
  const owner = xmlVal(xml, "rptOwnerName");
  const title = xmlVal(xml, "officerTitle") || (xmlVal(xml, "isDirector") === "1" || xmlVal(xml, "isDirector") === "true" ? "Director" : "") || (xmlVal(xml, "isTenPercentOwner") === "1" ? "10% owner" : "");
  const lines = (xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g) || []).map((block) => ({
    date: xmlVal(block, "transactionDate"),
    code: xmlVal(block, "transactionCode"),
    shares: Number(xmlVal(block, "transactionShares")) || 0,
    price: Number(xmlVal(block, "transactionPricePerShare")) || null,
    ad: xmlVal(block, "transactionAcquiredDisposedCode"),
    owned: Number(xmlVal(block, "sharesOwnedFollowingTransaction")) || null
  }));
  return { owner: titleCase(owner), title, lines };
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
