import { useMemo, useState } from "react";
import type { Chamber } from "../types";
import { FLOOR_VIEW, floorGuide, layoutFloor, partyStroke, voteFill, type FloorSeat } from "./floorLayout";

export type FloorMember = {
  name: string;
  state: string;
  district: string;
  vote: string;
  party?: string;
  bioguide?: string;
  geoid?: string | null;
};

type Props = {
  chamber: Chamber;
  members: FloorMember[];
  party?: string;
  caption?: string;
  highlight?: { label: string; ids: Set<string> } | null;
  onSelect?: (seat: FloorSeat) => void;
};

const PARTY_FILL: Record<string, string> = { D: "#3b5f86", R: "#8a3f3a", I: "#8a7a3a" };

export function FloorMap({ chamber, members, party = "all", caption, highlight, onSelect }: Props) {
  const seats = useMemo(() => layoutFloor(members, chamber), [members, chamber]);
  const [hover, setHover] = useState<FloorSeat | null>(null);
  const hasVote = members.some((m) => m.vote && m.vote !== "Seat");
  const [color, setColor] = useState<"vote" | "party">("vote");
  const byParty = color === "party" || !hasVote;
  const fill = (seat: FloorSeat) => (byParty ? PARTY_FILL[seat.party || "I"] || "#1e2831" : voteFill(seat.vote));
  const guide = floorGuide(chamber);
  const arcs = Array.from({ length: guide.rows }, (_, row) => {
    const t = guide.rows === 1 ? 0.5 : row / (guide.rows - 1);
    return guide.inner + (guide.outer - guide.inner) * t;
  });
  const focus = party === "all" ? members : members.filter((member) => (member.party || "I") === party);
  const yea = focus.filter((member) => member.vote === "Yea").length;
  const nay = focus.filter((member) => member.vote === "Nay").length;
  const dim = (seat: FloorSeat) => (party !== "all" && (seat.party || "I") !== party) || (!!highlight && !highlight.ids.has(seat.bioguide || ""));

  return (
    <div className="floor">
      <header className="floor-bar">
        <strong>{chamber === "senate" ? "SENATE FLOOR" : "HOUSE FLOOR"}</strong>
        <span>Democrats left</span>
        <span className="floor-aisle-label">aisle</span>
        <span>Republicans right</span>
        <span className="seg floor-color">
          <button aria-pressed={!byParty} disabled={!hasVote} onClick={() => setColor("vote")}>Vote</button>
          <button aria-pressed={byParty} onClick={() => setColor("party")}>Party</button>
        </span>
        {!members.length ? <em>Loading seats</em> : hasVote && !byParty ? <em>{party === "all" ? "" : `${party} only · `}{yea} yea · {nay} nay</em> : <em>{focus.length} seats · click any seat for the member card</em>}
      </header>
      {highlight ? <p className="floor-caption">Highlighting {highlight.label} · {highlight.ids.size} members</p> : null}
      {caption ? <p className="floor-caption">{caption}</p> : null}
      <svg
        viewBox={`0 0 ${FLOOR_VIEW.width} ${FLOOR_VIEW.height}`}
        className="floor-svg"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${chamber} floor vote map`}
        shapeRendering="geometricPrecision"
      >
        <path
          className="floor-well"
          d={wellPath(guide.cx, guide.cy, guide.outer + 28)}
        />
        {arcs.map((radius) => (
          <path key={radius} className="floor-arc" d={arcPath(guide.cx, guide.cy, radius)} />
        ))}
        <line
          className="floor-aisle"
          x1={guide.cx}
          y1={guide.cy - guide.inner + 36}
          x2={guide.cx}
          y2={guide.cy - guide.outer - 8}
        />
        <rect className="floor-rostrum" x={guide.cx - 54} y={guide.cy - 8} width="108" height="18" rx="2" />
        {seats.map((seat) => (
          <circle
            key={seat.id}
            className="floor-seat"
            cx={seat.x}
            cy={seat.y}
            r={hover?.id === seat.id ? seat.r + 1.4 : seat.r}
            fill={fill(seat)}
            opacity={dim(seat) ? 0.16 : 1}
            stroke={hover?.id === seat.id ? "#e2b657" : partyStroke(seat.party)}
            strokeWidth={hover?.id === seat.id ? 2.4 : 1.1}
            onMouseEnter={() => setHover(seat)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect?.(seat)}
          >
            <title>{`${seat.name} · ${seat.state}${seat.district ? `-${seat.district}` : ""} · ${seat.party || "—"}${hasVote ? ` · ${seat.vote}` : ""}`}</title>
          </circle>
        ))}
      </svg>
      <div className="floor-hud">
        {hover ? (
          <p className="floor-hover">
            {hover.bioguide ? <img src={`https://unitedstates.github.io/images/congress/225x275/${hover.bioguide}.jpg`} alt="" /> : null}
            <strong>{hover.name}</strong>
            <span>{hover.state}{hover.district ? `-${hover.district}` : ""} · {hover.party || "—"}{hasVote ? ` · ${hover.vote}` : ""}</span>
            <span className="dim">Click for committees, roles, PAC money, trades</span>
          </p>
        ) : members.length ? (
          <p>
            <strong>{members.length} seats</strong>
            <span>Hover a seat · vote color, party ring</span>
          </p>
        ) : (
          <p>
            <strong>Loading the latest roll call</strong>
            <span>Floor seats color by Yea / Nay</span>
          </p>
        )}
      </div>
    </div>
  );
}

function arcPath(cx: number, cy: number, radius: number) {
  const start = point(cx, cy, radius, Math.PI * 0.04);
  const end = point(cx, cy, radius, Math.PI * 0.96);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`;
}

function wellPath(cx: number, cy: number, radius: number) {
  const start = point(cx, cy, radius, Math.PI * 0.02);
  const end = point(cx, cy, radius, Math.PI * 0.98);
  return `M ${cx - 80} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y} L ${cx + 80} ${cy} Z`;
}

function point(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: cx + Math.cos(Math.PI - angle) * radius,
    y: cy - Math.sin(angle) * radius
  };
}
