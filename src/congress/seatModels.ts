import { districtCode } from "../districts/useDistricts";
import type { DrawerModel } from "../types";
import type { Chamber } from "../types";
import { STATE_NAME_TO_POSTAL } from "./states";

type Cast = { name: string; state: string; district: string; vote: string; party?: string; bioguide?: string; geoid?: string | null };
type Source = { source: string; asOf: string } | null;

const place = (state: string) => STATE_NAME_TO_POSTAL[state || ""] || state || "";

/** A floor-map seat with no bioguide id (a vacancy or a delegate): what the roll call says about it. */
export function seatModel(seat: Cast, chamber: Chamber, caption: string): DrawerModel {
  return {
    title: seat.name,
    meta: caption || seat.vote,
    rows: [
      { label: "Vote", value: seat.vote },
      { label: "Party", value: seat.party || "—" },
      { label: "State", value: seat.state || "—" },
      { label: "District", value: seat.district || (chamber === "senate" ? "Statewide" : "—") }
    ]
  };
}

/** A clicked state or district on the vote map: who voted from there, or why nobody did. `null` while no roll call is loaded. */
export function placeModel(placeId: string, chamber: Chamber, positions: Cast[], caption: string, source: Source): DrawerModel | null {
  const matches = positions.filter((member) => (chamber === "house" ? member.geoid === placeId : place(member.state) === placeId));
  const code = chamber === "house" ? districtCode(placeId) || placeId : placeId;
  if (!matches.length) {
    if (!positions.length) return null;
    return { title: code, meta: caption || "This roll call", rows: [{ label: "Vote", value: "No member cast this roll call here: vacant seat, or a delegate without a floor vote." }] };
  }
  return {
    title: chamber === "house" ? `${code} · ${matches[0].vote}` : `${code} senators`,
    meta: caption || "This roll call",
    rows: matches.map((member) => ({ label: member.vote, value: `${member.name} · ${member.party || "—"}-${place(member.state)}` })),
    links: matches.filter((member) => member.bioguide).map((member) => ({ label: "Member", value: `${member.name} record and recent votes`, action: `member:${member.bioguide}` })),
    source: source ? `${source.source} · ${source.asOf}` : undefined
  };
}
