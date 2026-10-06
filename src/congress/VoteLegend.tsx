import { when } from "../lib/api";
import type { Chamber } from "../types";
import { SENATE_LABEL, VOTE_FILL, VOTE_LABEL } from "./voteMap";

const HOUSE_ORDER = ["Yea", "Nay", "Present", "Not voting", "Vacant", "Delegate"];
const SENATE_ORDER = ["Yea", "Nay", "Split", "Half yea", "Half nay", "Present", "Not voting", "Vacant"];

/** Map legend with per-category counts of districts (House) or states (Senate), and the feed it came from. */
export function VoteLegend({ chamber, counts, source }: { chamber: Chamber; counts: Record<string, number>; source: { source: string; asOf: string; label: string } | null }) {
  const order = chamber === "house" ? HOUSE_ORDER : SENATE_ORDER;
  const labels = chamber === "house" ? VOTE_LABEL : SENATE_LABEL;
  const shown = order.filter((k) => counts[k] || k === "Yea" || k === "Nay");
  return (
    <div className="legend vote-legend">
      {shown.map((k) => (
        <span key={k}><i className="swatch" style={{ background: VOTE_FILL[k] }} />{labels[k]} <b>{counts[k] || 0}</b></span>
      ))}
      <small>
        {chamber === "house" ? "Districts" : "States"} colored by {chamber === "house" ? "their member's cast" : "both senators' casts"}
        {source ? ` · ${source.label} · ${source.source || "roll call"} · ${when(source.asOf)}` : " · no roll call loaded"}
      </small>
    </div>
  );
}
