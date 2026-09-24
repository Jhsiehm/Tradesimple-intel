import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { DrawerModel, ListItem, Marker, StatusLine } from "../types";

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

export function useDistricts(query: string, selectedId: string | null) {
  const [sites, setSites] = useState<Site[]>([]);
  const [districts, setDistricts] = useState<GeoJSON.FeatureCollection | null>(null);
  const [empty, setEmpty] = useState("Loading district sites…");

  useEffect(() => {
    api<{ items: Site[]; source: string }>("/api/sites")
      .then((res) => {
        setSites(res.items);
        setEmpty("No sites match.");
      })
      .catch((err: Error) => setEmpty(err.message));
    api<GeoJSON.FeatureCollection>("/geo/cd119.geojson").then(setDistricts).catch(() => null);
  }, []);

  const items: ListItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sites
      .filter((s) => `${s.name} ${s.symbol} ${s.district} ${s.kind}`.toLowerCase().includes(q))
      .map((s) => ({
        id: s.id,
        title: s.name,
        meta: `${s.symbol} · ${s.district} · ${s.kind}`
      }));
  }, [sites, query]);

  const selected = sites.find((s) => s.id === selectedId) || null;

  const geojson = useMemo(() => {
    if (!districts) return undefined;
    const active = new Set(sites.map((s) => geoid(s.district)));
    const focus = selected ? geoid(selected.district) : "";
    return {
      ...districts,
      features: districts.features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          id: f.properties?.GEOID,
          vote: String(f.properties?.GEOID) === focus ? "Yea" : active.has(String(f.properties?.GEOID)) ? "Present" : ""
        }
      }))
    };
  }, [districts, sites, selected]);

  const markers: Marker[] = useMemo(
    () => sites.map((s) => ({ id: s.id, lon: s.lon, lat: s.lat, label: s.symbol })),
    [sites]
  );

  const drawer: DrawerModel | null = selected
    ? {
        title: selected.name,
        meta: selected.note,
        rows: [
          { label: "Ticker", value: selected.symbol },
          { label: "District", value: selected.district },
          { label: "Kind", value: selected.kind }
        ]
      }
    : null;

  const status: StatusLine = {
    source: "Curated HQ, plant, and regulation sites",
    asOf: "maintained registry",
    latency: "Not a census of every factory."
  };

  return { items, empty, drawer, status, geojson, markers, selected };
}

function geoid(district: string) {
  const [state, num] = district.split("-");
  const fips = FIPS[state];
  if (!fips || !num) return "";
  return `${fips}${num.padStart(2, "0")}`;
}

const FIPS: Record<string, string> = {
  AL:"01",AK:"02",AZ:"04",AR:"05",CA:"06",CO:"08",CT:"09",DE:"10",DC:"11",FL:"12",GA:"13",
  HI:"15",ID:"16",IL:"17",IN:"18",IA:"19",KS:"20",KY:"21",LA:"22",ME:"23",MD:"24",MA:"25",
  MI:"26",MN:"27",MS:"28",MO:"29",MT:"30",NE:"31",NV:"32",NH:"33",NJ:"34",NM:"35",NY:"36",
  NC:"37",ND:"38",OH:"39",OK:"40",OR:"41",PA:"42",RI:"44",SC:"45",SD:"46",TN:"47",TX:"48",
  UT:"49",VT:"50",VA:"51",WA:"53",WV:"54",WI:"55",WY:"56"
};
