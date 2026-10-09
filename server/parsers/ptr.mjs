import { extractText, getDocumentProxy } from "unpdf";
import { isoDate } from "./dates.mjs";

/** Transaction lines from an electronic House PTR PDF. */
export async function parsePtrPdf(bytes) {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return parsePtr(text);
}

const PTR_NOISE = /:|^(ID Owner|Owner Asset|Type$|Date$|Date Notification|Notification|Amount|Gains|\$200\?|Filing ID|\* For the complete|Yes No|I CERTIFY|Digitally Signed|Clerk of the House|P\s+T\s+R|F\s+I|T\s*$)/;

export function parsePtr(raw) {
  const text = String(raw || "").replace(/[^\x20-\x7E\n]/g, " ");
  const re = /\(([A-Z][A-Z0-9.\-]{0,7})\)\s*\[([A-Z]{2})\]\s+(P|S\s*\(partial\)|S|E)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(\$[\d,]+\s*-\s*\$[\d,]+|Over \$[\d,]+|\$[\d,]+)/g;
  const lines = [];
  let prev = 0;
  let m;
  while ((m = re.exec(text))) {
    const rows = text.slice(prev, m.index).split("\n").map((line) => line.replace(/\s+/g, " ").trim());
    const tail = [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (!rows[i]) {
        if (tail.length) break;
        continue;
      }
      if (PTR_NOISE.test(rows[i])) break;
      tail.unshift(rows[i]);
    }
    let asset = tail.join(" ").trim();
    const ownerHit = /^(SP|JT|DC)\s+/.exec(asset);
    if (ownerHit) asset = asset.slice(ownerHit[0].length);
    const type = m[3].replace(/\s+/g, " ");
    const amount = m[6].replace(/\s+/g, " ");
    lines.push({
      symbol: m[1].replace(/\.$/, ""),
      assetType: m[2],
      asset: asset.replace(/\s*-\s*$/, "").slice(0, 90),
      owner: ownerHit ? ownerName(ownerHit[1]) : "Self",
      type: type === "P" ? "Purchase" : type === "E" ? "Exchange" : type === "S (partial)" ? "Sale (partial)" : "Sale",
      side: type === "P" ? "buy" : type === "E" ? "exchange" : "sell",
      traded: isoDate(m[4]),
      notified: isoDate(m[5]),
      amount,
      amountLow: Number((amount.match(/\$([\d,]+)/)?.[1] || "0").replace(/,/g, "")) || 0
    });
    prev = m.index + m[0].length;
  }
  return lines;
}

function ownerName(code) {
  return code === "SP" ? "Spouse" : code === "JT" ? "Joint" : code === "DC" ? "Dependent" : "Self";
}
