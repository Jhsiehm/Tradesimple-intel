import { isoDate } from "./dates.mjs";

/** Report period from a 13F primary_doc.xml, as YYYY-MM-DD. */
export function parse13fPeriod(doc) {
  return isoDate(/<periodOfReport>([^<]+)<\/periodOfReport>/.exec(doc)?.[1] || "");
}

/** Holdings rows from a 13F information table (namespaced or not). */
export function parse13fTable(xml) {
  return (xml.match(/<(?:\w+:)?infoTable>[\s\S]*?<\/(?:\w+:)?infoTable>/g) || []).map((block) => ({
    issuer: nsVal(block, "nameOfIssuer"),
    cls: nsVal(block, "titleOfClass"),
    cusip: nsVal(block, "cusip"),
    value: Number(nsVal(block, "value")) || 0,
    shares: Number(nsVal(block, "sshPrnamt")) || 0,
    putCall: nsVal(block, "putCall")
  }));
}

/** Issuer name reduced for matching across 13F filers and the join table. */
export function normIssuer(value) {
  let v = String(value || "").toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const tail = /\s+(INC|CORP|CORPORATION|CO|COMPANY|LTD|PLC|NEW|COM|GROUP|INTL|INTERNATIONAL|MFG|HLDGS|HOLDINGS|&|THE|CL A|CL C|CLASS A|CLASS C|SPONSORED ADR|ADR)$/;
  for (let i = 0; i < 6; i += 1) v = v.replace(tail, "").trim();
  return v;
}

function nsVal(block, name) {
  const m = new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`).exec(block);
  return m ? m[1].replace(/&amp;/g, "&").replace(/&apos;|&#39;/g, "'").trim() : "";
}
