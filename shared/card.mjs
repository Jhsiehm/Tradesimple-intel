/**
 * Pure share-card and link-preview builders, shared by the browser (Share image) and the static page
 * generator (scripts/member-pages.mjs). Input is a /api/congress/member/:id/timeline response.
 */

export const CARD_W = 1200;
export const CARD_H = 630;
export const LATE_DAYS = 45;
const DAY = 86_400_000;
const MONO = "IBM Plex Mono, Menlo, SF Mono, Consolas, Courier New, monospace";
const C = { bg: "#07090c", panel: "#0d1115", ink: "#e4e7e6", dim: "#8a949b", faint: "#56616a", line: "#232c34", amber: "#e8a33d", buy: "#b7e38a", sell: "#e07a72", dem: "#7aa7e6", rep: "#e07a72" };

const day = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const signed = (v, digits = 1) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(digits)}`);
const count = (n) => Number(n || 0).toLocaleString("en-US");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (iso) => {
  const d = new Date(day(iso));
  return Number.isNaN(d.getTime()) ? "—" : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};

export function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** "Cory A. Booker" → "cory-a-booker". Accents are folded; anything else non-alphanumeric becomes a dash. */
export function memberSlug(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "member";
}

export function seatLabel(m) {
  const district = m.chamber === "house" && m.district ? `-${String(m.district).replace(/^[A-Z]{2}-/, "")}` : "";
  return `${m.party || "—"}-${m.state || "—"}${district}`;
}

/** Everything the card, the page description, and the bot need, computed once from a timeline response. */
export function summarize(res) {
  if (!res?.ok || !res.member) return null;
  const m = res.member;
  const trades = (res.trades || []).filter((t) => t.traded);
  const lags = trades.map((t) => t.lag).filter((v) => v != null).sort((a, b) => a - b);
  const px = res.proximity || null;
  const hasLanes = (res.committees || []).length > 0;
  const r = res.returns || null;
  const asOf = String(res.asOf || res.range?.to || "").slice(0, 10);
  return {
    bioguide: m.bioguide,
    name: m.name,
    slug: memberSlug(m.name),
    party: m.party || "",
    state: m.state || "",
    chamber: m.chamber || "house",
    seat: seatLabel(m),
    title: m.chamber === "senate" ? "Sen." : "Rep.",
    trades: trades.length,
    buys: trades.filter((t) => t.side === "buy").length,
    sells: trades.filter((t) => t.side === "sell").length,
    first: trades[0]?.traded || "",
    last: trades.at(-1)?.traded || "",
    medianLag: lags.length ? lags[Math.floor(lags.length / 2)] : null,
    late: trades.filter((t) => t.lag != null && t.lag > LATE_DAYS).length,
    maxLag: lags.length ? lags.at(-1) : null,
    nearDays: res.nearDays || 14,
    hasLanes,
    dayShare: hasLanes && px ? px.dayShare : null,
    baseline: hasLanes && px ? px.baseline : null,
    returns: r && r.buys ? { buys: r.buys, priced: r.priced, excess: r.excessSince, excess90: r.excess90, hit: r.hitRate, basis: r.basis || "" } : null,
    range: { from: res.range?.from || trades[0]?.traded || asOf, to: res.range?.to || asOf },
    asOf,
    strip: trades.map((t) => ({ d: t.traded, side: t.side, near: Boolean(t.near), low: t.amountLow || 0 }))
  };
}

/** Facts only, one line, for og:description and post text. */
export function describe(s) {
  if (!s) return "";
  const parts = [`${count(s.trades)} disclosed trades${s.first ? ` since ${shortDate(s.first)}` : ""}`];
  if (s.dayShare != null) parts.push(`${pct(s.dayShare)} of trade days within ${s.nearDays} days of a hearing on their committees vs ${pct(s.baseline)} of all days`);
  if (s.medianLag != null) parts.push(`median filing lag ${s.medianLag}d`);
  if (s.late) parts.push(`${count(s.late)} filed more than ${LATE_DAYS} days late`);
  if (s.returns?.excess != null) parts.push(`disclosed buys ${signed(s.returns.excess)} pts vs S&P 500 since trade (equal-weighted)`);
  return `${s.title} ${s.name} (${s.seat}): ${parts.join(" · ")}. Calendar proximity only.`;
}

export function memberMeta(s, { pageUrl, imageUrl, site = "TradeSimple Intel" }) {
  return {
    title: `${s.name} (${s.seat}) · trades vs hearings · ${site}`,
    description: describe(s),
    url: pageUrl,
    image: imageUrl,
    site
  };
}

function strip(s, x0, y0, w, h) {
  const start = day(s.range.from);
  const end = Math.max(start + DAY, day(s.range.to));
  const weeks = Math.max(1, Math.ceil((end - start) / (7 * DAY)));
  const colW = w / weeks;
  const r = Math.max(1.6, Math.min(4, colW / 2.6));
  const step = r * 2 + 1;
  const half = h / 2 - 6;
  const cap = Math.max(1, Math.floor(half / step));
  const cols = new Map();
  for (const t of s.strip) {
    const wk = Math.min(weeks - 1, Math.max(0, Math.floor((day(t.d) - start) / (7 * DAY))));
    const key = `${t.side === "sell" ? "s" : "b"}${wk}`;
    cols.set(key, [...(cols.get(key) || []), t]);
  }
  const mid = y0 + h / 2;
  const out = [`<line x1="${x0}" x2="${x0 + w}" y1="${mid}" y2="${mid}" stroke="${C.line}" stroke-width="1.5"/>`];
  for (const [key, list] of cols) {
    const sell = key[0] === "s";
    const wk = Number(key.slice(1));
    const cx = (x0 + (wk + 0.5) * colW).toFixed(1);
    list.slice(0, cap).forEach((t, i) => {
      const cy = (sell ? mid + 6 + r + i * step : mid - 6 - r - i * step).toFixed(1);
      out.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${sell ? C.sell : C.buy}"${t.near ? ` stroke="${C.amber}" stroke-width="1.2"` : ""}/>`);
    });
    if (list.length > cap) {
      const cy = sell ? y0 + h + 2 : y0 - 2;
      out.push(`<text x="${cx}" y="${cy}" fill="${C.dim}" font-size="11" text-anchor="middle">+</text>`);
    }
  }
  const ticks = [];
  const cursor = new Date(start);
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  const span = (end - start) / DAY;
  const every = span > 500 ? 3 : span > 200 ? 2 : 1;
  while (cursor.getTime() <= end) {
    const m = cursor.getUTCMonth();
    if (m % every === 0) {
      const x = (x0 + ((cursor.getTime() - start) / (end - start)) * w).toFixed(1);
      const label = m === 0 ? String(cursor.getUTCFullYear()) : MONTHS[m].toUpperCase();
      ticks.push(`<line x1="${x}" x2="${x}" y1="${y0 + h + 6}" y2="${y0 + h + 12}" stroke="${C.faint}"/><text x="${x}" y="${y0 + h + 28}" fill="${m === 0 ? C.ink : C.faint}" font-size="14" text-anchor="middle">${label}</text>`);
    }
    cursor.setUTCMonth(m + 1);
  }
  return out.join("") + ticks.join("");
}

function stat(x, y, label, value, note, color = C.ink) {
  return `<text x="${x}" y="${y}" fill="${C.faint}" font-size="15" letter-spacing="1.5">${escapeXml(label)}</text>`
    + `<text x="${x}" y="${y + 44}" fill="${color}" font-size="40" font-weight="600">${escapeXml(value)}</text>`
    + `<text x="${x}" y="${y + 72}" fill="${C.dim}" font-size="15">${escapeXml(note)}</text>`;
}

/** 1200×630 summary card as an SVG string (rasterized by resvg at build time, or by a canvas in the browser). */
export function cardSvg(s, { site = "TRADESIMPLE INTEL", host = "" } = {}) {
  const party = s.party === "D" ? C.dem : s.party === "R" ? C.rep : C.dim;
  const name = s.name.length > 34 ? `${s.name.slice(0, 33)}…` : s.name;
  const stats = [
    ["DISCLOSED TRADES", count(s.trades), `${count(s.buys)} buys · ${count(s.sells)} sells`, C.ink],
    s.dayShare != null
      ? ["NEAR A HEARING", pct(s.dayShare), `of trade days · baseline ${pct(s.baseline)}`, s.dayShare > s.baseline + 0.1 ? C.amber : C.ink]
      : ["NEAR A HEARING", "—", "no current committee seats", C.dim],
    ["MEDIAN FILING LAG", s.medianLag == null ? "—" : `${s.medianLag}d`, s.late ? `${count(s.late)} filed > ${LATE_DAYS} days late` : `none filed > ${LATE_DAYS} days late`, s.late ? C.amber : C.ink]
  ];
  if (s.returns?.excess != null) {
    stats.push(["BUYS VS S&P 500", `${signed(s.returns.excess)} pts`, `${count(s.returns.priced)} buys · hit rate ${pct(s.returns.hit)}`, s.returns.excess >= 0 ? C.buy : C.sell]);
  }
  const colW = 1080 / stats.length;
  const span = s.first ? `${shortDate(s.first)} – ${shortDate(s.last)}` : "No disclosed trades";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" font-family="${MONO}">`
    + `<rect width="${CARD_W}" height="${CARD_H}" fill="${C.bg}"/>`
    + `<rect x="0" y="0" width="${CARD_W}" height="6" fill="${C.amber}"/>`
    + `<text x="60" y="62" fill="${C.amber}" font-size="17" letter-spacing="3" font-weight="600">MEMBER TIMELINE · TRADES VS COMMITTEE HEARINGS</text>`
    + `<text x="60" y="118" fill="${C.ink}" font-size="48" font-weight="600">${escapeXml(name)}</text>`
    + `<rect x="60" y="136" width="${s.seat.length * 13 + 22}" height="32" fill="none" stroke="${party}" stroke-opacity="0.6"/>`
    + `<text x="71" y="158" fill="${party}" font-size="19">${escapeXml(s.seat)}</text>`
    + `<text x="${60 + s.seat.length * 13 + 40}" y="158" fill="${C.dim}" font-size="18">${escapeXml(`${s.chamber === "senate" ? "SENATE" : "HOUSE"} · ${span}`)}</text>`
    + `<text x="1140" y="62" fill="${C.amber}" font-size="18" letter-spacing="3" font-weight="600" text-anchor="end">${escapeXml(site)}</text>`
    + strip(s, 60, 192, 1080, 150)
    + `<text x="1140" y="402" fill="${C.faint}" font-size="14" text-anchor="end">${escapeXml(`one dot per trade, by week · buys above the line, sells below · amber ring: within ${s.nearDays} days of a hearing`)}</text>`
    + stats.map(([label, value, note, color], i) => stat(60 + i * colW, 440, label, value, note, color)).join("")
    + `<line x1="60" x2="1140" y1="546" y2="546" stroke="${C.line}"/>`
    + `<text x="60" y="574" fill="${C.dim}" font-size="15">${escapeXml(`Calendar proximity only; not evidence of wrongdoing.${s.returns ? " Returns: disclosed buys, equal-weighted, not their actual portfolio." : ""}`)}</text>`
    + `<text x="60" y="600" fill="${C.faint}" font-size="14">${escapeXml(`Source: House Clerk PTRs · Senate eFD · Congress.gov${s.returns ? " · Yahoo Finance" : ""} · as of ${s.asOf || "—"}`)}</text>`
    + (host ? `<text x="1140" y="600" fill="${C.faint}" font-size="14" text-anchor="end">${escapeXml(host)}</text>` : "")
    + `</svg>`;
}

/** Static landing page for one member: link-preview meta, then straight into the app's timeline. */
export function memberPageHtml(s, { pageUrl, imageUrl, appPath, site = "TradeSimple Intel" }) {
  const meta = memberMeta(s, { pageUrl, imageUrl, site });
  const target = `${appPath}#timeline/${s.bioguide}`;
  const e = escapeXml;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${e(meta.title)}</title>
<meta name="description" content="${e(meta.description)}" />
<link rel="canonical" href="${e(pageUrl)}" />
<meta property="og:type" content="profile" />
<meta property="og:site_name" content="${e(site)}" />
<meta property="og:title" content="${e(`${s.name} (${s.seat}) · trades vs hearings`)}" />
<meta property="og:description" content="${e(meta.description)}" />
<meta property="og:url" content="${e(pageUrl)}" />
<meta property="og:image" content="${e(imageUrl)}" />
<meta property="og:image:width" content="${CARD_W}" />
<meta property="og:image:height" content="${CARD_H}" />
<meta property="og:image:alt" content="${e(`${s.name}: disclosed trades by week, filing lag, and calendar proximity to committee hearings`)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${e(`${s.name} (${s.seat}) · trades vs hearings`)}" />
<meta name="twitter:description" content="${e(meta.description)}" />
<meta name="twitter:image" content="${e(imageUrl)}" />
<meta http-equiv="refresh" content="0; url=${e(target)}" />
<script>location.replace(${JSON.stringify(target)});</script>
<style>body{background:#07090c;color:#e4e7e6;font:14px Menlo,monospace;padding:32px}a{color:#e8a33d}img{max-width:100%;margin-top:16px}</style>
</head>
<body>
<p><a href="${e(target)}">Open ${e(s.name)}'s timeline in ${e(site)}</a></p>
<p>${e(meta.description)}</p>
<img src="card.png" width="${CARD_W}" height="${CARD_H}" alt="" />
</body>
</html>
`;
}
