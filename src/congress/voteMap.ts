import type { PartyFilter } from "../types";
import { houseCategory, senateCategory } from "../../shared/voteCategory.mjs";
import { STATE_NAME_TO_POSTAL } from "./states";

export type Seat = { state: string; district: string; vote: string; party?: string; geoid: string | null };

/** Map fill per category. Floor seats use the same Yea/Nay/Present colors. */
export const VOTE_FILL: Record<string, string> = {
  Yea: "#1f6b3a",
  Nay: "#7a3030",
  Split: "#6a5a28",
  Present: "#6f86a3",
  "Not voting": "#4b525b",
  "Half yea": "#6f9a78",
  "Half nay": "#a87a74",
  Vacant: "#3b2f4d",
  Delegate: "#1c242c"
};

export const VOTE_LABEL: Record<string, string> = {
  Yea: "Yea",
  Nay: "Nay",
  Split: "Split 1–1",
  Present: "Present",
  "Not voting": "Not voting",
  "Half yea": "1 yea, 1 absent",
  "Half nay": "1 nay, 1 absent",
  Vacant: "Vacant",
  Delegate: "Delegate (no floor vote)"
};

export const SENATE_LABEL: Record<string, string> = { ...VOTE_LABEL, Yea: "Both yea", Nay: "Both nay", "Not voting": "Neither voted" };

function tally(features: GeoJSON.Feature[]) {
  const counts: Record<string, number> = {};
  for (const f of features) {
    const v = String(f.properties?.vote || "");
    if (v) counts[v] = (counts[v] || 0) + 1;
  }
  return counts;
}

export function houseVoteMap(districts: GeoJSON.FeatureCollection, positions: Seat[], party: PartyFilter) {
  const byGeoid = new Map<string, Seat[]>();
  for (const p of positions) if (p.geoid) byGeoid.set(p.geoid, [...(byGeoid.get(p.geoid) || []), p]);
  const voted = positions.length > 0;
  const features = districts.features.map((f) => {
    const id = String(f.properties?.GEOID || "");
    const undefinedSeat = f.properties?.CD119 === "ZZ";
    return {
      ...f,
      properties: { ...f.properties, id: undefinedSeat ? "" : id, vote: voted && !undefinedSeat ? houseCategory(id, byGeoid.get(id) || [], party) : "" }
    };
  });
  return { geojson: { ...districts, features }, counts: tally(features) };
}

export function senateVoteMap(states: GeoJSON.FeatureCollection, positions: Seat[], party: PartyFilter) {
  const byState = new Map<string, string[]>();
  for (const p of positions) {
    if (party !== "all" && (p.party || "I") !== party) continue;
    byState.set(p.state, [...(byState.get(p.state) || []), p.vote]);
  }
  const voted = positions.length > 0;
  const features = states.features.map((f) => {
    const postal = STATE_NAME_TO_POSTAL[String(f.properties?.name || "")] || "";
    const seated = postal && postal !== "DC" && postal !== "PR";
    return { ...f, properties: { ...f.properties, id: postal, vote: voted && seated ? senateCategory(byState.get(postal) || [], party !== "all") : "" } };
  });
  return { geojson: { ...states, features }, counts: tally(features) };
}
