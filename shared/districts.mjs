/**
 * House seats of the 119th Congress: "CA-11", at-large and delegate seats as "AK-AL" / "DC-AL".
 * GEOID is the Census cd119 key: state FIPS + "00" at-large, "98" delegate, else the two-digit district.
 * `seats` is 0 for one-seat states and delegates; counts match data/geo/cd119.geojson.
 */
export const STATES = {
  AL: { fips: "01", name: "Alabama", seats: 7 }, AK: { fips: "02", name: "Alaska", seats: 0 },
  AZ: { fips: "04", name: "Arizona", seats: 9 }, AR: { fips: "05", name: "Arkansas", seats: 4 },
  CA: { fips: "06", name: "California", seats: 52 }, CO: { fips: "08", name: "Colorado", seats: 8 },
  CT: { fips: "09", name: "Connecticut", seats: 5 }, DE: { fips: "10", name: "Delaware", seats: 0 },
  DC: { fips: "11", name: "District of Columbia", seats: 0, delegate: true }, FL: { fips: "12", name: "Florida", seats: 28 },
  GA: { fips: "13", name: "Georgia", seats: 14 }, HI: { fips: "15", name: "Hawaii", seats: 2 },
  ID: { fips: "16", name: "Idaho", seats: 2 }, IL: { fips: "17", name: "Illinois", seats: 17 },
  IN: { fips: "18", name: "Indiana", seats: 9 }, IA: { fips: "19", name: "Iowa", seats: 4 },
  KS: { fips: "20", name: "Kansas", seats: 4 }, KY: { fips: "21", name: "Kentucky", seats: 6 },
  LA: { fips: "22", name: "Louisiana", seats: 6 }, ME: { fips: "23", name: "Maine", seats: 2 },
  MD: { fips: "24", name: "Maryland", seats: 8 }, MA: { fips: "25", name: "Massachusetts", seats: 9 },
  MI: { fips: "26", name: "Michigan", seats: 13 }, MN: { fips: "27", name: "Minnesota", seats: 8 },
  MS: { fips: "28", name: "Mississippi", seats: 4 }, MO: { fips: "29", name: "Missouri", seats: 8 },
  MT: { fips: "30", name: "Montana", seats: 2 }, NE: { fips: "31", name: "Nebraska", seats: 3 },
  NV: { fips: "32", name: "Nevada", seats: 4 }, NH: { fips: "33", name: "New Hampshire", seats: 2 },
  NJ: { fips: "34", name: "New Jersey", seats: 12 }, NM: { fips: "35", name: "New Mexico", seats: 3 },
  NY: { fips: "36", name: "New York", seats: 26 }, NC: { fips: "37", name: "North Carolina", seats: 14 },
  ND: { fips: "38", name: "North Dakota", seats: 0 }, OH: { fips: "39", name: "Ohio", seats: 15 },
  OK: { fips: "40", name: "Oklahoma", seats: 5 }, OR: { fips: "41", name: "Oregon", seats: 6 },
  PA: { fips: "42", name: "Pennsylvania", seats: 17 }, RI: { fips: "44", name: "Rhode Island", seats: 2 },
  SC: { fips: "45", name: "South Carolina", seats: 7 }, SD: { fips: "46", name: "South Dakota", seats: 0 },
  TN: { fips: "47", name: "Tennessee", seats: 9 }, TX: { fips: "48", name: "Texas", seats: 38 },
  UT: { fips: "49", name: "Utah", seats: 4 }, VT: { fips: "50", name: "Vermont", seats: 0 },
  VA: { fips: "51", name: "Virginia", seats: 11 }, WA: { fips: "53", name: "Washington", seats: 10 },
  WV: { fips: "54", name: "West Virginia", seats: 2 }, WI: { fips: "55", name: "Wisconsin", seats: 8 },
  WY: { fips: "56", name: "Wyoming", seats: 0 },
  PR: { fips: "72", name: "Puerto Rico", seats: 0, delegate: true }, VI: { fips: "78", name: "U.S. Virgin Islands", seats: 0, delegate: true },
  GU: { fips: "66", name: "Guam", seats: 0, delegate: true }, AS: { fips: "60", name: "American Samoa", seats: 0, delegate: true },
  MP: { fips: "69", name: "Northern Mariana Islands", seats: 0, delegate: true }
};

const BY_FIPS = Object.fromEntries(Object.entries(STATES).map(([postal, s]) => [s.fips, postal]));
const BY_NAME = Object.fromEntries([
  ...Object.entries(STATES).map(([postal, s]) => [s.name.toUpperCase().replace(/\./g, ""), postal]),
  ["VIRGIN ISLANDS", "VI"], ["US VIRGIN ISLANDS", "VI"], ["WASHINGTON DC", "DC"], ["NORTHERN MARIANAS", "MP"]
]);

/** "CA-11" → "0611", "AK-AL" → "0200", "DC-AL" → "1198"; "" when the seat does not exist. */
export function districtGeoid(code) {
  const m = /^([A-Z]{2})-(\d\d|AL)$/.exec(String(code || ""));
  const state = m && STATES[m[1]];
  if (!state) return "";
  if (!state.seats) return m[2] === "AL" ? `${state.fips}${state.delegate ? "98" : "00"}` : "";
  const n = Number(m[2]);
  return n >= 1 && n <= state.seats ? `${state.fips}${m[2]}` : "";
}

/** "0611" → "CA-11"; "0200" / "1198" → "AK-AL" / "DC-AL"; null for "ZZ" water areas and unknown states. */
export function districtFromGeoid(geoid) {
  const id = String(geoid || "");
  const postal = BY_FIPS[id.slice(0, 2)];
  const num = id.slice(2);
  if (!postal || !/^\d\d$/.test(num)) return null;
  return `${postal}-${num === "00" || num === "98" ? "AL" : num}`;
}

function seat(postal, num) {
  const state = STATES[postal];
  if (!state) return null;
  if (!state.seats) return num === "AL" || Number(num) <= 1 || num === "98" ? `${postal}-AL` : null;
  if (num === "AL") return null;
  const n = Number(num);
  return n >= 1 && n <= state.seats ? `${postal}-${String(n).padStart(2, "0")}` : null;
}

/**
 * Free text to a seat code: "CA-11", "ca 11", "ca11", "California 11", "California's 11th district",
 * "AK-AL", "Alaska at-large", "DC delegate", "Guam". Two-letter codes need a number or AL so tickers
 * like DE or VT stay tickers; full names of one-seat states and territories resolve on their own.
 */
export function parseDistrict(text) {
  const t = String(text || "")
    .toUpperCase()
    .replace(/DISTRICT OF COLUMBIA/g, "WASHINGTON DC")
    .replace(/[.#]/g, "")
    .replace(/[’']S\b/g, "")
    .replace(/(\d+)(ST|ND|RD|TH)\b/g, "$1")
    .replace(/\b(CONGRESSIONAL|DISTRICT|CD|NO|SEAT)\b/g, " ")
    .replace(/\bAT[\s-]*LARGE\b|\bDELEGATE\b/g, " AL ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  const m = /^([A-Z][A-Z ]*?)(?:\s*-?\s*(\d{1,2})|[\s-]+(AL))$/.exec(t);
  if (m) {
    const head = m[1].trim();
    const postal = head.length === 2 ? head : BY_NAME[head];
    return postal ? seat(postal, m[2] || m[3]) : null;
  }
  const postal = t.length > 2 ? BY_NAME[t] : undefined;
  return postal && !STATES[postal].seats ? `${postal}-AL` : null;
}

/** "CA-11" → "California · district 11"; "AK-AL" → "Alaska · at-large"; "DC-AL" → "District of Columbia · delegate". */
export function districtName(code) {
  const [postal, num] = String(code || "").split("-");
  const state = STATES[postal];
  if (!state) return String(code || "");
  if (num === "AL") return `${state.name} · ${state.delegate ? "delegate" : "at-large"}`;
  return `${state.name} · district ${Number(num)}`;
}
