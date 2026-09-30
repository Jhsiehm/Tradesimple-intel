import { fetchText, fetchJson } from "./http.mjs";
import { readCache, writeCache } from "./db.mjs";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const NASDAQ_HEADERS = { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } };

export const CCY_COUNTRIES = {
  USD: ["United States"],
  EUR: ["Euro Zone", "Germany", "France", "Italy", "Spain"],
  GBP: ["United Kingdom"],
  JPY: ["Japan"],
  CHF: ["Switzerland"],
  CAD: ["Canada"],
  AUD: ["Australia"],
  NZD: ["New Zealand"],
  CNY: ["China"],
  HKD: ["Hong Kong"],
  SGD: ["Singapore"],
  INR: ["India"],
  KRW: ["South Korea"],
  MXN: ["Mexico"],
  BRL: ["Brazil"],
  ZAR: ["South Africa"],
  TRY: ["Turkey"],
  SEK: ["Sweden"],
  NOK: ["Norway"],
  PLN: ["Poland"]
};

const HIGH = /(Interest Rate Decision|Rate Decision|Deposit Facility Rate|Main Refinancing Rate|Cash Rate|^CPI|\bCPI\b|Nonfarm Payrolls|Unemployment Rate|^GDP|\bGDP\b|PCE Price Index|FOMC Statement|FOMC Meeting Minutes|Monetary Policy Statement)/i;
const MEDIUM = /(Retail Sales|PPI|PMI|Employment Change|Trade Balance|Jobless Claims|Industrial Production|Consumer Confidence|Average Hourly Earnings|JOLTS|HICP|Durable Goods)/i;
const NOISE = /(GDPNow|Projection|speculative|MBA|Auction|Mortgage|Baker Hughes|OPEC|Crude|Gasoline|Distillate|Heating Oil|Refinery|Cushing|Natural Gas|Rig Count|Bill|Bond|Note|Index Price|Deflator|Ex Gas|Saxony|North Rhine|Hesse|Brandenburg|Bavaria|Baden|Westphalia|GDP Sales|GDP Price|GDP External|GDP Capital|GDP Government|Private Consumption|Fixed Investment|CPI Index|n\.s\.a|Cleveland|Median CPI|Trimmed|Tokyo Ex|CPI Tokyo Ex|Tobacco)/i;

export async function fomcMeetings(db) {
  const hit = readCache(db, "macro:fomc:v1");
  if (hit) return hit;
  const html = await fetchText("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", { headers: { "User-Agent": "Mozilla/5.0" } }, 30000);
  const meetings = [];
  const panels = html.split(/<h4><a id="\d+">/).slice(1);
  for (const panel of panels) {
    const year = Number(/^(\d{4}) FOMC Meetings/.exec(panel)?.[1]);
    if (!year) continue;
    const re = /fomc-meeting__month[^>]*><strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g;
    let m;
    while ((m = re.exec(panel))) {
      const monthText = m[1].trim();
      const dateText = m[2].trim();
      if (/notation|unscheduled/i.test(dateText)) continue;
      const months = monthText.toLowerCase().split("/").map((x) => MONTHS.findIndex((name) => name.startsWith(x.trim().slice(0, 3))));
      const days = dateText.replace(/[^\d-]/g, "").split("-").map(Number).filter(Boolean);
      if (!days.length || months[0] < 0) continue;
      const month = months[months.length - 1];
      const day = days[days.length - 1];
      const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      meetings.push({ date, sep: dateText.includes("*"), label: `${monthText} ${dateText.replace("*", "")}` });
    }
  }
  const rates = await fredSeries(db, "DFEDTARU").catch(() => []);
  const rateOn = (date) => {
    let value = null;
    for (const [d, v] of rates) {
      if (d > date) break;
      value = v;
    }
    return value;
  };
  const today = new Date().toISOString().slice(0, 10);
  for (const meeting of meetings) {
    if (meeting.date > today) continue;
    const before = rateOn(shift(meeting.date, -2));
    const after = rateOn(shift(meeting.date, 2));
    if (before == null || after == null) continue;
    meeting.upper = after;
    meeting.moveBp = Math.round((after - before) * 100);
  }
  meetings.sort((a, b) => a.date.localeCompare(b.date));
  const result = {
    ok: true,
    source: "Federal Reserve FOMC calendar · FRED DFEDTARU",
    asOf: new Date().toISOString(),
    latency: "Meeting schedule from federalreserve.gov. Rate move is the change in the target range upper bound across the decision day.",
    meetings
  };
  writeCache(db, "macro:fomc:v1", result, DAY);
  return result;
}

export async function fredSeries(db, id) {
  const key = `fred:${id}:v1`;
  const hit = readCache(db, key);
  if (hit) return hit;
  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, {}, 30000);
  const rows = csv.trim().split(/\r?\n/).slice(1).map((line) => {
    const [d, v] = line.split(",");
    return [d, Number(v)];
  }).filter(([d, v]) => d && Number.isFinite(v));
  writeCache(db, key, rows, 6 * HOUR);
  return rows;
}

export async function macroStrip(db) {
  const hit = readCache(db, "macro:strip:v2");
  if (hit) return hit;
  const series = ["DFEDTARU", "DFEDTARL", "CPIAUCSL", "CPILFESL", "UNRATE", "DGS2", "DGS10", "PCEPILFE"];
  const data = Object.fromEntries(await Promise.all(series.map(async (id) => [id, await fredSeries(db, id).catch(() => [])])));
  const last = (id) => data[id].at(-1) || null;
  const yoy = (id) => {
    const rows = data[id];
    const cur = rows.at(-1);
    if (!cur) return null;
    const target = shift(cur[0], -365).slice(0, 7);
    const prior = rows.find(([d]) => d.startsWith(target));
    return prior ? { date: cur[0], value: round(((cur[1] - prior[1]) / prior[1]) * 100, 2) } : null;
  };
  const fomc = await fomcMeetings(db).catch(() => ({ meetings: [] }));
  const today = new Date().toISOString().slice(0, 10);
  const next = fomc.meetings.find((m) => m.date >= today) || null;
  const lastMove = [...fomc.meetings].reverse().find((m) => m.date < today && m.moveBp) || null;
  const cal = await econCalendar(db, 0, 35).catch(() => ({ items: [] }));
  const nextCpi = cal.items.find((e) => e.country === "United States" && /^CPI/i.test(e.event) && e.date >= today) || null;
  const nextJobs = cal.items.find((e) => e.country === "United States" && /Nonfarm Payrolls/i.test(e.event) && e.date >= today) || null;
  const two = last("DGS2");
  const ten = last("DGS10");
  const result = {
    ok: true,
    source: "FRED (St. Louis Fed) · Federal Reserve · Nasdaq economic calendar",
    asOf: new Date().toISOString(),
    latency: "FRED series update on release; CPI is monthly, Treasury yields daily with a one-day lag.",
    items: [
      { id: "fed", label: "Fed funds target", value: last("DFEDTARL") && last("DFEDTARU") ? `${last("DFEDTARL")[1].toFixed(2)}–${last("DFEDTARU")[1].toFixed(2)}%` : "—", asOf: last("DFEDTARU")?.[0] },
      { id: "move", label: "Last move", value: lastMove ? `${lastMove.moveBp > 0 ? "+" : ""}${lastMove.moveBp}bp` : "hold", asOf: lastMove?.date },
      { id: "next", label: "Next FOMC", value: next ? next.date : "—", asOf: next ? `${next.label}${next.sep ? " · SEP" : ""}` : "" },
      { id: "cpi", label: "CPI YoY", value: yoy("CPIAUCSL") ? `${yoy("CPIAUCSL").value}%` : "—", asOf: yoy("CPIAUCSL")?.date },
      { id: "core", label: "Core CPI YoY", value: yoy("CPILFESL") ? `${yoy("CPILFESL").value}%` : "—", asOf: yoy("CPILFESL")?.date },
      { id: "pce", label: "Core PCE YoY", value: yoy("PCEPILFE") ? `${yoy("PCEPILFE").value}%` : "—", asOf: yoy("PCEPILFE")?.date },
      { id: "unrate", label: "Unemployment", value: last("UNRATE") ? `${last("UNRATE")[1]}%` : "—", asOf: last("UNRATE")?.[0] },
      { id: "2y", label: "UST 2Y", value: two ? `${two[1].toFixed(2)}%` : "—", asOf: two?.[0] },
      { id: "10y", label: "UST 10Y", value: ten ? `${ten[1].toFixed(2)}%` : "—", asOf: ten?.[0] },
      { id: "curve", label: "2s10s", value: two && ten ? `${Math.round((ten[1] - two[1]) * 100)}bp` : "—", asOf: ten?.[0] },
      { id: "nextcpi", label: "Next CPI", value: nextCpi ? nextCpi.date : "—", asOf: nextCpi ? `${nextCpi.time} ET` : "" },
      { id: "nextnfp", label: "Next payrolls", value: nextJobs ? nextJobs.date : "—", asOf: nextJobs ? `${nextJobs.time} ET` : "" }
    ]
  };
  writeCache(db, "macro:strip:v2", result, HOUR);
  return result;
}

// Nasdaq's page for ?date=D lists the previous day's events, with clock times at a fixed UTC-4.
export async function econDay(db, page) {
  const key = `econ:day:v2:${page}`;
  const hit = readCache(db, key);
  if (hit) return hit;
  const body = await fetchJson(`https://api.nasdaq.com/api/calendar/economicevents?date=${page}`, NASDAQ_HEADERS, 20000);
  const rows = body?.data?.rows || [];
  const prior = shift(page, -1);
  const grouped = new Map();
  for (const row of rows) {
    const event = clean(row.eventName);
    if (!event || NOISE.test(event)) continue;
    const tier = HIGH.test(event) ? "high" : MEDIUM.test(event) ? "medium" : "";
    if (!tier) continue;
    const clock = /^\d{2}:\d{2}$/.test(String(row.gmt)) ? row.gmt : "12:00";
    const t = Date.parse(`${prior}T${clock}:00-04:00`);
    const { date, time } = easternParts(t);
    const id = `${date}|${row.country}|${event}|${time}`;
    const cur = grouped.get(id) || {
      id: `econ:${date}:${slug(row.country)}:${slug(event)}:${time.replace(":", "")}`,
      t,
      date,
      time,
      country: row.country,
      event,
      tier,
      actual: [],
      consensus: [],
      previous: [],
      description: clean(row.description).replace(/<br\s*\/?>/gi, " ")
    };
    const push = (list, v) => { const x = clean(v); if (x) list.push(x); };
    push(cur.actual, row.actual);
    push(cur.consensus, row.consensus);
    push(cur.previous, row.previous);
    grouped.set(id, cur);
  }
  const items = [...grouped.values()].map((e) => ({
    ...e,
    actual: e.actual.join(" / "),
    consensus: e.consensus.join(" / "),
    previous: e.previous.join(" / "),
    surprise: surprise(e.actual[0], e.consensus[0])
  }));
  const today = easternParts(Date.now()).date;
  const settled = prior < today && items.every((e) => e.actual || !e.consensus);
  writeCache(db, key, items, settled ? 400 * DAY : prior < today ? 6 * HOUR : 2 * HOUR);
  return items;
}

function easternParts(t) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export async function econCalendar(db, back = 3, ahead = 21) {
  const today = easternParts(Date.now()).date;
  const from = shift(today, -back);
  const to = shift(today, ahead);
  const pages = [];
  for (let i = -back; i <= ahead + 1; i += 1) pages.push(shift(today, i));
  const items = [];
  const failed = [];
  await pool(pages, 4, async (page) => {
    try {
      items.push(...(await econDay(db, page)).filter((e) => e.date >= from && e.date <= to && !NOISE.test(e.event)));
    } catch {
      failed.push(page);
    }
  });
  items.sort((a, b) => a.t - b.t);
  return {
    ok: true,
    source: "Nasdaq economic calendar",
    asOf: new Date().toISOString(),
    latency: `Times are US Eastern (converted from Nasdaq's fixed UTC-4 clock). Filtered to rate decisions, inflation, jobs, growth, and activity prints.${failed.length ? ` ${failed.length} days did not load.` : ""}`,
    items
  };
}

export async function macroMarks(db, ccys, fromMs) {
  const set = new Set(ccys.flatMap((c) => (c === "EUR" ? ["Euro Zone", "Germany"] : CCY_COUNTRIES[c] || [])));
  const marks = [];
  if (ccys.includes("USD")) {
    const fomc = await fomcMeetings(db).catch(() => ({ meetings: [] }));
    for (const m of fomc.meetings) {
      const t = Date.parse(`${m.date}T18:00:00Z`);
      if (t < fromMs || t > Date.now()) continue;
      const move = m.moveBp == null ? "" : m.moveBp === 0 ? " hold" : ` ${m.moveBp > 0 ? "+" : ""}${m.moveBp}bp`;
      marks.push({ t, label: `FOMC${move}${m.upper != null ? ` ${m.upper.toFixed(2)}%` : ""}`, tone: "fomc", detail: `FOMC decision ${m.date}${m.sep ? " with projections" : ""}` });
    }
  }
  const cached = cachedEconDays(db, fromMs);
  for (const e of cached) {
    if (!set.has(e.country) || e.tier !== "high" || !e.actual) continue;
    if (ccys.includes("USD") && /Fed Interest Rate Decision|FOMC/i.test(e.event)) continue;
    const t = e.t;
    if (!Number.isFinite(t) || t < fromMs) continue;
    const tone = /CPI|PCE|HICP/i.test(e.event) ? "cpi" : /Rate Decision|Deposit|Refinancing|Cash Rate|Monetary Policy/i.test(e.event) ? "fomc" : "macro";
    marks.push({ t, label: `${countryCode(e.country)} ${shortEvent(e.event)} ${e.actual.split(" / ")[0]}`, tone, detail: `${e.country} ${e.event}: ${e.actual} vs ${e.consensus || "—"} (prev ${e.previous || "—"})` });
  }
  marks.sort((a, b) => a.t - b.t);
  return marks;
}

function cachedEconDays(db, fromMs) {
  const rows = db.prepare("SELECT key, body FROM cache WHERE key LIKE 'econ:day:v2:%'").all();
  const out = [];
  for (const row of rows) {
    const date = row.key.slice("econ:day:v2:".length);
    if (Date.parse(date) < fromMs - DAY) continue;
    out.push(...JSON.parse(row.body).filter((e) => !NOISE.test(e.event)));
  }
  return out;
}

export async function warmMacro(db, days = 400) {
  const dates = [];
  const today = easternParts(Date.now()).date;
  for (let i = 0; i <= days; i += 1) {
    const date = shift(today, -i);
    if (!readCache(db, `econ:day:v2:${date}`)) dates.push(date);
  }
  await pool(dates, 2, async (date) => {
    await econDay(db, date).catch(() => null);
    await new Promise((r) => setTimeout(r, 250));
  });
  return dates.length;
}

function surprise(actual, consensus) {
  const a = parseFloat(String(actual || "").replace(/[^\d.-]/g, ""));
  const c = parseFloat(String(consensus || "").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(a) || !Number.isFinite(c)) return null;
  return a > c ? "above" : a < c ? "below" : "inline";
}

function countryCode(country) {
  return { "United States": "US", "Euro Zone": "EZ", "United Kingdom": "UK", Germany: "DE", France: "FR", Italy: "IT", Spain: "ES", Japan: "JP", China: "CN", Canada: "CA", Australia: "AU", "New Zealand": "NZ", Switzerland: "CH", "South Korea": "KR", India: "IN", Brazil: "BR", Mexico: "MX", "South Africa": "ZA", Singapore: "SG", "Hong Kong": "HK", Turkey: "TR", Sweden: "SE", Norway: "NO", Poland: "PL", Russia: "RU" }[country] || country.slice(0, 2).toUpperCase();
}

function shortEvent(event) {
  return event
    .replace(/Interest Rate Decision/i, "rate")
    .replace(/Nonfarm Payrolls/i, "NFP")
    .replace(/Unemployment Rate/i, "Unemp")
    .replace(/\(YoY\)|\(MoM\)|\(QoQ\)/gi, "")
    .replace(/Price Index/i, "Prices")
    .replace(/Gross Domestic Product/i, "GDP")
    .replace(/^(German|UK|US|Japanese|Chinese|Canadian|Australian|French|Italian|Spanish|Swiss)\s+/i, "")
    .trim()
    .split(/\s+/)
    .reduce((out, word) => (out.length + word.length < 16 ? `${out} ${word}`.trim() : out), "");
}

function clean(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function shift(date, days) {
  return new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}
