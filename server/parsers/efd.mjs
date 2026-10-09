import { isoDate } from "./dates.mjs";

/** Rows of a Senate eFD periodic transaction report page. Throws if the page has no transaction table. */
export function parseEfd(html) {
  if (!/<tbody>/.test(html)) throw new Error("Report page had no table");
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] || "";
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    const text = (value) => String(value || "").replace(/<div[\s\S]*?<\/div>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const ticker = text(cells[3]);
    const type = text(cells[6]);
    const amount = text(cells[7]);
    return {
      traded: isoDate(text(cells[1])),
      owner: text(cells[2]) || "Self",
      symbol: /^[A-Z][A-Z0-9.\-]{0,7}$/.test(ticker) ? ticker : "",
      asset: text(cells[4]),
      assetType: text(cells[5]),
      type,
      side: /purchase/i.test(type) ? "buy" : /sale/i.test(type) ? "sell" : "exchange",
      amount,
      amountLow: Number((amount.match(/\$([\d,]+)/)?.[1] || "0").replace(/,/g, "")) || 0
    };
  });
}
