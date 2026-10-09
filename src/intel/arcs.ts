import { bundleArcs, dayIso, dayNum, greatCircle, type ArcKind } from "../../shared/intel.mjs";
import type { IntelData } from "./useIntel";

export const ARC_COLOR: Record<ArcKind, string> = { trade: "#4aa8ff", contract: "#d9b45a", pac: "#b48cff" };
export const ARC_LABEL: Record<ArcKind, string> = { trade: "Trades", contract: "Contracts", pac: "PAC $" };
const NOUN: Record<ArcKind, [string, string]> = { trade: ["trade", "trades"], contract: ["contract action", "contract actions"], pac: ["PAC gift", "PAC gifts"] };
export const ARC_CAP = 160;

export type ArcView = {
  lines: GeoJSON.FeatureCollection;
  ends: GeoJSON.FeatureCollection;
  shown: number;
  hidden: number;
  local: number;
  links: number;
};

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function money(v: number) {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

/** Window-bundled great-circle arcs plus their endpoints; each line carries a tooltip with source and as-of. */
export function arcView(data: IntelData | null, window: [number, number] | null, kinds: Set<ArcKind>): ArcView {
  if (!data?.ok || !window || !kinds.size) return { lines: EMPTY, ends: EMPTY, shown: 0, hidden: 0, local: 0, links: 0 };
  const { places, actions, links, sources } = data.arcs;
  const start = dayNum(data.from);
  const out = bundleArcs(links, { from: window[0], to: window[1], kinds, cap: ARC_CAP });
  const top = Math.max(1, ...out.arcs.map((a) => a.n));
  const used = new Map<number, number>();
  const lines: GeoJSON.Feature[] = out.arcs.map((a) => {
    const f = places[a.from];
    const t = places[a.to];
    used.set(a.from, (used.get(a.from) || 0) + a.n);
    used.set(a.to, (used.get(a.to) || 0) + a.n);
    const [one, many] = NOUN[a.kind];
    const span = a.first === a.last ? dayIso(start + a.first) : `${dayIso(start + a.first)} → ${dayIso(start + a.last)}`;
    const amount = a.kind === "trade" ? `${money(a.amount)}+ disclosed range floors` : money(a.amount);
    return {
      type: "Feature",
      properties: {
        kind: a.kind,
        color: ARC_COLOR[a.kind],
        w: 0.8 + 2.6 * Math.sqrt(a.n / top),
        action: actions[a.action] || "",
        tip: `${f.label} → ${t.label}\n${a.n} ${a.n === 1 ? one : many} · ${amount} · ${span}\n${sources[a.kind]}`
      },
      geometry: { type: "LineString", coordinates: greatCircle([f.lon, f.lat], [t.lon, t.lat], 40) }
    };
  });
  const ends: GeoJSON.Feature[] = [...used.entries()].map(([i, n]) => ({
    type: "Feature",
    properties: { kind: places[i].kind, label: places[i].label, n, action: places[i].action },
    geometry: { type: "Point", coordinates: [places[i].lon, places[i].lat] }
  }));
  return { lines: { type: "FeatureCollection", features: lines }, ends: { type: "FeatureCollection", features: ends }, shown: out.arcs.length, hidden: out.hidden, local: out.local, links: out.links };
}
