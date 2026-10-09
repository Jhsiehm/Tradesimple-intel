export function xmlTag(xml, tag) {
  const m = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

export function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function senateMenuDate(value, year) {
  const raw = cleanText(value);
  const m = raw.match(/^(\d{1,2})-([A-Za-z]{3})$/);
  if (!m) return raw;
  const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const mm = months[m[2]] || "01";
  return `${year}-${mm}-${m[1].padStart(2, "0")}`;
}
