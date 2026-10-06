import { useEffect, useMemo, useState } from "react";
import { api, when } from "../lib/api";
import { STATE_NAME_TO_POSTAL } from "../congress/states";
import type { RosterMember } from "../congress/useCongress";
import type { DrawerLink, DrawerModel, ListItem, Marker, StatusLine } from "../types";

type Site = {
  id: string;
  name: string;
  symbol: string;
  kind: string;
  district: string;
  state: string;
  lat: number;
  lon: number;
  note: string;
};

export type Hq = {
  symbol: string;
  name: string;
  cik: string;
  filer: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  foreign: boolean;
  country?: string;
  lat: number | null;
  lon: number | null;
  geocoder: string | null;
  matched: string;
  geoid: string | null;
  district: string | null;
  districtBy?: string;
  fetched: string;
  note: string;
};

export type DistrictLayer = "sites" | "hq";

type Seat = { code: string; geoid: string; lon: number; lat: number; zoom: number };

const SOURCE = "Curated HQ, plant, and regulation sites · Census 119th Congress boundaries · congress-legislators roster";
const HQ_FALLBACK = "SEC EDGAR submissions (business address) · US Census Geocoder, OpenStreetMap Nominatim fallback · Census 119th Congressional Districts";
const POSTAL_TO_NAME = Object.fromEntries(Object.entries(STATE_NAME_TO_POSTAL).map(([name, postal]) => [postal, name]));

/** `selectedId` is a site id, `hq:SYMBOL`, or a district GEOID from a boundary click. */
export function useDistricts(query: string, selectedId: string | null, roster: RosterMember[], layer: DistrictLayer) {
  const [sites, setSites] = useState<Site[]>([]);
  const [hqs, setHqs] = useState<Hq[]>([]);
  const [hqMeta, setHqMeta] = useState<{ source: string; asOf: string | null; latency: string } | null>(null);
  const [extra, setExtra] = useState<Hq | null>(null);
  const [districts, setDistricts] = useState<GeoJSON.FeatureCollection | null>(null);
  const [empty, setEmpty] = useState("Loading district sites…");
  const [geoError, setGeoError] = useState("");

  useEffect(() => {
    api<{ items: Site[]; source: string }>("/api/sites")
      .then((res) => {
        setSites(res.items);
        setEmpty("No sites match.");
      })
      .catch((err: Error) => setEmpty(err.message));
    api<GeoJSON.FeatureCollection>("/geo/cd119.geojson")
      .then(setDistricts)
      .catch((err: Error) => setGeoError(`District boundaries failed to load: ${err.message}`));
  }, []);

  const hqSymbol = selectedId?.startsWith("hq:") ? selectedId.slice(3) : "";
  const wantHq = layer === "hq" || Boolean(hqSymbol);
  useEffect(() => {
    if (!wantHq || hqMeta) return;
    api<{ ok: boolean; items: Hq[]; source: string; asOf: string | null; latency: string }>("/api/hq")
      .then((res) => {
        setHqs(res.items || []);
        setHqMeta({ source: res.source, asOf: res.asOf, latency: res.latency });
      })
      .catch((err: Error) => setHqMeta({ source: HQ_FALLBACK, asOf: null, latency: err.message }));
  }, [wantHq, hqMeta]);

  useEffect(() => {
    if (!hqSymbol || !hqMeta || hqs.some((h) => h.symbol === hqSymbol) || extra?.symbol === hqSymbol) return;
    api<{ ok: boolean; item?: Hq }>(`/api/hq/${hqSymbol}`).then((res) => { if (res.item) setExtra(res.item); }).catch(() => null);
  }, [hqSymbol, hqMeta, hqs, extra]);

  const allHq = useMemo(() => (extra && !hqs.some((h) => h.symbol === extra.symbol) ? [...hqs, extra] : hqs), [hqs, extra]);
  const hq = hqSymbol ? allHq.find((h) => h.symbol === hqSymbol) || null : null;
  const site = sites.find((s) => s.id === selectedId) || null;

  const seat: Seat | null = useMemo(() => {
    const id = site ? geoid(site.district) : hq ? hq.geoid || "" : selectedId || "";
    const feature = districts?.features.find((f) => String(f.properties?.GEOID) === id);
    const [lon, lat, span] = feature ? middle(feature.geometry) : [0, 0, 1];
    const zoom = Math.min(8, Math.max(4, Math.log2(360 / span) - 1));
    if (site) return { code: site.district, geoid: id, lon: site.lon, lat: site.lat, zoom };
    if (hq) return hq.district && hq.lat != null && hq.lon != null ? { code: hq.district, geoid: id, lon: hq.lon, lat: hq.lat, zoom } : null;
    const code = feature ? districtCode(id) : "";
    return code ? { code, geoid: id, lon, lat, zoom } : null;
  }, [site, hq, selectedId, districts]);

  const placed = useMemo(() => allHq.filter((h) => h.district && h.lat != null && h.lon != null), [allHq]);
  const hqCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of placed) counts.set(h.geoid!, (counts.get(h.geoid!) || 0) + 1);
    return counts;
  }, [placed]);

  const items: ListItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const district = seat && !site && !hq ? seat.code : "";
    if (layer === "hq") {
      return allHq
        .filter((h) => !district || h.district === district)
        .filter((h) => `${h.symbol} ${h.name} ${h.city} ${h.state} ${h.district || ""}`.toLowerCase().includes(q))
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
        .map((h) => ({
          id: `hq:${h.symbol}`,
          title: `${h.symbol} · ${h.name}`,
          meta: h.foreign ? `${h.city}, ${h.country || h.state} · outside the US` : `${h.district || `${h.state} · no district`} · ${titleCase(h.city)}, ${h.state}`
        }));
    }
    return sites
      .filter((s) => !district || s.district === district)
      .filter((s) => `${s.name} ${s.symbol} ${s.district} ${s.kind}`.toLowerCase().includes(q))
      .map((s) => ({ id: s.id, title: s.name, meta: `${s.symbol} · ${s.district} · ${s.kind}` }));
  }, [layer, allHq, sites, query, seat, site, hq]);

  const geojson = useMemo(() => {
    if (!districts) return undefined;
    const active = new Set(sites.map((s) => geoid(s.district)));
    const focus = seat?.geoid || "";
    const statePrefix = focus.slice(0, 2);
    return {
      ...districts,
      features: districts.features.map((f) => {
        const id = String(f.properties?.GEOID || "");
        const n = hqCount.get(id) || 0;
        const base = layer === "hq" ? (n >= 5 ? "HQ3" : n >= 2 ? "HQ2" : n ? "HQ1" : "") : active.has(id) ? "Site" : "";
        return {
          ...f,
          properties: {
            ...f.properties,
            id: f.properties?.CD119 === "ZZ" ? "" : id,
            vote: id === focus ? "Focus" : focus && id.startsWith(statePrefix) ? "State" : base
          }
        };
      })
    };
  }, [districts, sites, seat, layer, hqCount]);

  const markers: Marker[] = useMemo(() => {
    if (layer === "hq") {
      return placed.map((h) => ({
        id: `hq:${h.symbol}`,
        lon: h.lon!,
        lat: h.lat!,
        label: h.symbol,
        size: h.symbol === hq?.symbol ? 7 : 3.5,
        color: "#e2b657",
        hot: h.symbol === hq?.symbol || (!hq && !site && Boolean(seat) && h.district === seat?.code)
      }));
    }
    const pins: Marker[] = sites.map((s) => ({ id: s.id, lon: s.lon, lat: s.lat, label: s.symbol, hot: s.id === site?.id || (!site && !hq && s.district === seat?.code) }));
    if (hq?.lat != null && hq.lon != null) pins.push({ id: `hq:${hq.symbol}`, lon: hq.lon, lat: hq.lat, label: `${hq.symbol} HQ`, size: 7, hot: true });
    return pins;
  }, [layer, placed, sites, site, hq, seat]);

  const drawer: DrawerModel | null = hq
    ? hqDrawer(hq, allHq, roster, hqMeta?.source || HQ_FALLBACK)
    : seat ? districtDrawer(seat, site, sites, roster, layer === "hq" ? placed : []) : null;

  const counted = allHq.length;
  const status: StatusLine = layer === "hq" || hq
    ? {
        source: hqMeta?.source || HQ_FALLBACK,
        asOf: hq ? `HQ fetched ${when(hq.fetched)}` : hqMeta?.asOf ? `precomputed ${when(hqMeta.asOf)}` : "—",
        latency: `${placed.length} of ${counted} placed in a district · ${allHq.filter((h) => h.foreign).length} abroad · ${counted - placed.length - allHq.filter((h) => h.foreign).length} unplaced · ${hqMeta?.latency || ""}`
      }
    : {
        source: SOURCE,
        asOf: "site registry maintained by hand · 119th Congress district lines",
        latency: geoError || "Not a census of every factory. Representatives change when a seat changes, not live."
      };

  const top = useMemo(() => [...hqCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => ({ code: districtCode(id), n })), [hqCount]);

  return {
    items,
    empty: seat && !site && !hq
      ? `No ${layer === "hq" ? "index HQs" : "joined sites"} in ${seat.code}. Representative and contract links are in the dossier.`
      : layer === "hq" && !hqMeta ? "Loading SEC headquarters…" : empty,
    drawer,
    status,
    geojson,
    markers,
    top,
    selected: seat ? { lon: seat.lon, lat: seat.lat, zoom: seat.zoom } : null
  };
}

function who(m: RosterMember) {
  return `${m.name} (${m.party})`;
}

function members(code: string, roster: RosterMember[]) {
  const [state, num] = code.split("-");
  const atLarge = num === "AL" || num === "00" || num === "98";
  const district = atLarge ? "0" : String(Number(num));
  return {
    state,
    atLarge,
    district,
    rep: num ? roster.find((m) => m.chamber === "house" && m.state === state && m.district === district) : undefined,
    senators: roster.filter((m) => m.chamber === "senate" && m.state === state)
  };
}

function seatLinks(code: string, roster: RosterMember[]) {
  const { rep, senators } = members(code, roster);
  const links: DrawerLink[] = [];
  if (rep) {
    links.push({ label: "Representative", value: who(rep), action: `member:${rep.bioguide}` });
    links.push({ label: "Timeline", value: `${rep.name} votes and trades`, action: `timeline:${rep.bioguide}` });
  }
  senators.forEach((m) => links.push({ label: "Senator", value: who(m), action: `member:${m.bioguide}` }));
  return links;
}

function hqDrawer(hq: Hq, all: Hq[], roster: RosterMember[], source: string): DrawerModel {
  const code = hq.district || (hq.foreign ? "" : hq.state);
  const { state, rep, senators, atLarge, district } = members(code, roster);
  const neighbors = hq.district ? all.filter((h) => h.district === hq.district && h.symbol !== hq.symbol) : [];
  const address = [hq.street, `${titleCase(hq.city)}, ${hq.state} ${hq.zip}`].filter(Boolean).join(" · ");
  return {
    title: `${hq.symbol} ${hq.name} · headquarters`,
    meta: hq.foreign ? `Business address outside the US · ${hq.country || hq.state}` : hq.district ? `${hq.district} · ${POSTAL_TO_NAME[state] || state}${atLarge ? " at-large" : ` district ${district}`}` : hq.note,
    watch: hq.symbol,
    rows: [
      { label: "Address", value: address || "—" },
      ...(hq.foreign ? [] : [
        { label: "District", value: hq.district ? `${hq.district} · 119th Congress` : `Not placed · ${hq.note}` },
        ...(hq.district ? [{ label: "Representative", value: rep ? `${who(rep)} · since ${rep.since.slice(0, 4)}` : roster.length ? "Vacant or not in roster" : "Loading roster…" }] : []),
        { label: "Senators", value: senators.length ? senators.map(who).join(" · ") : state === "DC" || state === "PR" ? "None (non-voting delegate seat)" : "—" }
      ]),
      ...(hq.matched ? [{ label: "Geocoded", value: `${hq.geocoder} · ${hq.matched}` }] : []),
      ...(hq.districtBy ? [{ label: "District by", value: hq.districtBy }] : []),
      { label: "SEC filer", value: `${hq.filer || hq.name} · CIK ${hq.cik}` },
      { label: "As of", value: `${when(hq.fetched)} · address as last filed` },
      ...(neighbors.length ? [{ label: "Same district", value: neighbors.map((h) => h.symbol).join(", ") }] : [])
    ],
    links: [
      { label: "Chart", value: hq.symbol, action: `ticker:${hq.symbol}` },
      { label: "Positions", value: `${hq.symbol} holders and trades`, action: `pos:${hq.symbol}` },
      ...(hq.foreign ? [] : seatLinks(code, roster)),
      ...(hq.district ? [{ label: "Contracts", value: `Awards performed in ${hq.district}`, action: `contracts:place:${hq.district}` }] : []),
      { label: "Filing", value: "SEC EDGAR company page", href: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${hq.cik}` }
    ],
    source
  };
}

function districtDrawer(seat: Seat, site: Site | null, sites: Site[], roster: RosterMember[], hqs: Hq[]): DrawerModel {
  const { state, rep, senators, atLarge, district } = members(seat.code, roster);
  const here = sites.filter((s) => s.district === seat.code);
  const hqHere = hqs.filter((h) => h.district === seat.code);
  const symbols = [...new Set(here.map((s) => s.symbol))];

  const links: DrawerLink[] = [];
  if (site) {
    links.push({ label: "Chart", value: site.symbol, action: `ticker:${site.symbol}` });
    links.push({ label: "Positions", value: `${site.symbol} holders and trades`, action: `pos:${site.symbol}` });
    links.push({ label: "Contracts", value: `${site.symbol} federal awards`, action: `contracts:symbol:${site.symbol}` });
  }
  links.push(...seatLinks(seat.code, roster));
  links.push({ label: "Contracts", value: `Awards performed in ${seat.code}`, action: `contracts:place:${seat.code}` });
  if (!site) symbols.forEach((s) => links.push({ label: "Company", value: `${s} federal awards`, action: `contracts:symbol:${s}` }));

  const rows = [
    ...(site ? [{ label: "Ticker", value: site.symbol }, { label: "Kind", value: site.kind }] : []),
    { label: "District", value: `${seat.code} · ${POSTAL_TO_NAME[state] || state}` },
    { label: "Representative", value: rep ? `${who(rep)} · since ${rep.since.slice(0, 4)}` : roster.length ? "Vacant or not in roster" : "Loading roster…" },
    ...(rep?.phone ? [{ label: "Office", value: `${rep.office || "—"} · ${rep.phone}` }] : []),
    { label: "Senators", value: senators.length ? senators.map(who).join(" · ") : state === "DC" || state === "PR" ? "None (non-voting delegate seat)" : "—" },
    { label: "Joined sites", value: here.length ? `${here.length} · ${symbols.join(", ")}` : "None in the registry" },
    ...(hqs.length ? [{ label: "Index HQs", value: hqHere.length ? `${hqHere.length} · ${hqHere.map((h) => h.symbol).join(", ")}` : "None" }] : [])
  ];

  return {
    title: site ? site.name : `${seat.code} · ${atLarge ? "at-large" : `district ${district}`}`,
    meta: site ? site.note : `${POSTAL_TO_NAME[state] || state} · 119th Congress`,
    rows,
    links,
    tables: [
      ...(!site && here.length ? [{ title: "Sites in this district", cols: ["Site", "Ticker", "Kind"], rows: here.map((s) => ({ cells: [s.name, s.symbol, s.kind] })) }] : []),
      ...(hqHere.length ? [{ title: "Headquarters in this district", note: "SEC EDGAR business address.", cols: ["Ticker", "Company", "City"], rows: hqHere.map((h) => ({ cells: [h.symbol, h.name, titleCase(h.city)], action: `hq:${h.symbol}` })) }] : [])
    ],
    source: SOURCE
  };
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function geoid(district: string) {
  const [state, num] = district.split("-");
  const fips = FIPS[state];
  if (!fips || !num) return "";
  return `${fips}${num === "AL" ? "00" : num.padStart(2, "0")}`;
}

/** "0617" → "CA-17"; at-large and delegate seats → "AK-AL". */
export function districtCode(id: string) {
  const state = Object.keys(FIPS).find((k) => FIPS[k] === id.slice(0, 2));
  const num = id.slice(2);
  if (!state || !/^\d\d$/.test(num)) return "";
  return `${state}-${num === "00" || num === "98" ? "AL" : num}`;
}

/** Bounding-box center and its larger side in degrees. */
function middle(geometry: GeoJSON.Geometry): [number, number, number] {
  let minX = 180, minY = 90, maxX = -360, maxY = -90;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  if ("coordinates" in geometry) walk(geometry.coordinates);
  return [(minX + maxX) / 2, (minY + maxY) / 2, Math.max(maxX - minX, maxY - minY, 0.05)];
}

const FIPS: Record<string, string> = {
  AL:"01",AK:"02",AZ:"04",AR:"05",CA:"06",CO:"08",CT:"09",DE:"10",DC:"11",FL:"12",GA:"13",
  HI:"15",ID:"16",IL:"17",IN:"18",IA:"19",KS:"20",KY:"21",LA:"22",ME:"23",MD:"24",MA:"25",
  MI:"26",MN:"27",MS:"28",MO:"29",MT:"30",NE:"31",NV:"32",NH:"33",NJ:"34",NM:"35",NY:"36",
  NC:"37",ND:"38",OH:"39",OK:"40",OR:"41",PA:"42",RI:"44",SC:"45",SD:"46",TN:"47",TX:"48",
  UT:"49",VT:"50",VA:"51",WA:"53",WV:"54",WI:"55",WY:"56",PR:"72"
};
