import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
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

type Seat = { code: string; geoid: string; lon: number; lat: number; zoom: number };

const SOURCE = "Curated HQ, plant, and regulation sites · Census 119th Congress boundaries · congress-legislators roster";
const POSTAL_TO_NAME = Object.fromEntries(Object.entries(STATE_NAME_TO_POSTAL).map(([name, postal]) => [postal, name]));

/** `selectedId` is a site id from the list or map, or a district GEOID from a boundary click. */
export function useDistricts(query: string, selectedId: string | null, roster: RosterMember[]) {
  const [sites, setSites] = useState<Site[]>([]);
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

  const site = sites.find((s) => s.id === selectedId) || null;
  const seat: Seat | null = useMemo(() => {
    const id = site ? geoid(site.district) : selectedId || "";
    const feature = districts?.features.find((f) => String(f.properties?.GEOID) === id);
    const [lon, lat, span] = feature ? middle(feature.geometry) : [0, 0, 1];
    const zoom = Math.min(8, Math.max(4, Math.log2(360 / span) - 1));
    if (site) return { code: site.district, geoid: id, lon: site.lon, lat: site.lat, zoom };
    const code = feature ? districtCode(id) : "";
    return code ? { code, geoid: id, lon, lat, zoom } : null;
  }, [site, selectedId, districts]);

  const items: ListItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inSeat = seat && !site ? sites.filter((s) => s.district === seat.code) : sites;
    return inSeat
      .filter((s) => `${s.name} ${s.symbol} ${s.district} ${s.kind}`.toLowerCase().includes(q))
      .map((s) => ({
        id: s.id,
        title: s.name,
        meta: `${s.symbol} · ${s.district} · ${s.kind}`
      }));
  }, [sites, query, seat, site]);

  const geojson = useMemo(() => {
    if (!districts) return undefined;
    const active = new Set(sites.map((s) => geoid(s.district)));
    const focus = seat?.geoid || "";
    return {
      ...districts,
      features: districts.features.map((f) => {
        const id = String(f.properties?.GEOID || "");
        return {
          ...f,
          properties: {
            ...f.properties,
            id: f.properties?.CD119 === "ZZ" ? "" : id,
            vote: id === focus ? "Focus" : active.has(id) ? "Site" : ""
          }
        };
      })
    };
  }, [districts, sites, seat]);

  const markers: Marker[] = useMemo(
    () => sites.map((s) => ({ id: s.id, lon: s.lon, lat: s.lat, label: s.symbol, hot: s.id === site?.id || (!site && s.district === seat?.code) })),
    [sites, site, seat]
  );

  const drawer: DrawerModel | null = seat ? districtDrawer(seat, site, sites, roster) : null;

  const status: StatusLine = {
    source: SOURCE,
    asOf: "site registry maintained by hand · 119th Congress district lines",
    latency: geoError || "Not a census of every factory. Representatives change when a seat changes, not live."
  };

  return {
    items,
    empty: seat && !site ? `No joined sites in ${seat.code}. Representative and contract links are in the dossier.` : empty,
    drawer,
    status,
    geojson,
    markers,
    selected: seat ? { lon: seat.lon, lat: seat.lat, zoom: seat.zoom } : null
  };
}

function districtDrawer(seat: Seat, site: Site | null, sites: Site[], roster: RosterMember[]): DrawerModel {
  const [state, num] = seat.code.split("-");
  const atLarge = num === "AL" || num === "00" || num === "98";
  const district = atLarge ? "0" : String(Number(num));
  const rep = roster.find((m) => m.chamber === "house" && m.state === state && m.district === district);
  const senators = roster.filter((m) => m.chamber === "senate" && m.state === state);
  const here = sites.filter((s) => s.district === seat.code);
  const symbols = [...new Set(here.map((s) => s.symbol))];
  const who = (m: RosterMember) => `${m.name} (${m.party})`;

  const links: DrawerLink[] = [];
  if (site) {
    links.push({ label: "Chart", value: site.symbol, action: `ticker:${site.symbol}` });
    links.push({ label: "Positions", value: `${site.symbol} holders and trades`, action: `pos:${site.symbol}` });
    links.push({ label: "Contracts", value: `${site.symbol} federal awards`, action: `contracts:symbol:${site.symbol}` });
  }
  if (rep) {
    links.push({ label: "Representative", value: who(rep), action: `member:${rep.bioguide}` });
    links.push({ label: "Timeline", value: `${rep.name} votes and trades`, action: `timeline:${rep.bioguide}` });
  }
  senators.forEach((m) => links.push({ label: "Senator", value: who(m), action: `member:${m.bioguide}` }));
  links.push({ label: "Contracts", value: `Awards performed in ${seat.code}`, action: `contracts:place:${seat.code}` });
  if (!site) symbols.forEach((s) => links.push({ label: "Company", value: `${s} federal awards`, action: `contracts:symbol:${s}` }));

  const rows = [
    ...(site ? [{ label: "Ticker", value: site.symbol }, { label: "Kind", value: site.kind }] : []),
    { label: "District", value: `${seat.code} · ${POSTAL_TO_NAME[state] || state}` },
    { label: "Representative", value: rep ? `${who(rep)} · since ${rep.since.slice(0, 4)}` : roster.length ? "Vacant or not in roster" : "Loading roster…" },
    ...(rep?.phone ? [{ label: "Office", value: `${rep.office || "—"} · ${rep.phone}` }] : []),
    { label: "Senators", value: senators.length ? senators.map(who).join(" · ") : state === "DC" || state === "PR" ? "None (non-voting delegate seat)" : "—" },
    { label: "Joined sites", value: here.length ? `${here.length} · ${symbols.join(", ")}` : "None in the registry" }
  ];

  return {
    title: site ? site.name : `${seat.code} · ${atLarge ? "at-large" : `district ${district}`}`,
    meta: site ? site.note : `${POSTAL_TO_NAME[state] || state} · 119th Congress`,
    rows,
    links,
    tables: !site && here.length
      ? [{ title: "Sites in this district", cols: ["Site", "Ticker", "Kind"], rows: here.map((s) => ({ cells: [s.name, s.symbol, s.kind] })) }]
      : undefined,
    source: SOURCE
  };
}

function geoid(district: string) {
  const [state, num] = district.split("-");
  const fips = FIPS[state];
  if (!fips || !num) return "";
  return `${fips}${num === "AL" ? "00" : num.padStart(2, "0")}`;
}

function districtCode(id: string) {
  const state = Object.keys(FIPS).find((k) => FIPS[k] === id.slice(0, 2));
  const num = id.slice(2);
  if (!state || !/^\d\d$/.test(num)) return "";
  return `${state}-${num === "00" || num === "98" ? "AL" : num}`;
}

/** Bounding-box center and its larger side in degrees. */
function middle(geometry: GeoJSON.Geometry): [number, number, number] {
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
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
