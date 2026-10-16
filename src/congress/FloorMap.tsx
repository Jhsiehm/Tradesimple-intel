import { useMemo, useState, type CSSProperties } from "react";
import type { Chamber } from "../types";
import { FLOOR_VIEW, floorGuide, layoutFloor, voteFill, type FloorSeat } from "./floorLayout";
import "./floor.css";
import { PARTY_COLOR, PARTY_LABEL, VOTE_FILL } from "./colors";

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
  source?: { source: string; asOf: string; label: string } | null;
  highlight?: { label: string; ids: Set<string> } | null;
  onSelect?: (seat: FloorSeat) => void;
};

export function FloorMap({ chamber, members, party = "all", caption, source, highlight, onSelect }: Props) {
  const seats = useMemo(() => layoutFloor(members, chamber), [members, chamber]);
  const [hover, setHover] = useState<FloorSeat | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const hasVote = members.some((m) => m.vote && m.vote !== "Seat");
  const [color, setColor] = useState<"vote" | "party">("vote");
  const byParty = color === "party" || !hasVote;
  const fill = (seat: FloorSeat) => (byParty ? PARTY_COLOR[seat.party] || "#78838e" : voteFill(seat.vote));
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
        <strong>{chamber === "senate" ? "Senate votes" : "House votes"}</strong>
        <span className="seg floor-color" role="group" aria-label="Seat color mode">
          <button style={{ "--mode-color": VOTE_FILL.Yea } as CSSProperties} aria-pressed={!byParty} disabled={!hasVote} title={hasVote ? "Color seats by their vote" : "Vote colors become available when a roll call loads"} onClick={() => setColor("vote")}>
            <span className="color-key" aria-hidden="true">{["Yea", "Nay"].map((v) => <i key={v} style={{ background: VOTE_FILL[v] }} />)}</span>Vote
          </button>
          <button style={{ "--mode-color": PARTY_COLOR.D } as CSSProperties} aria-pressed={byParty} onClick={() => setColor("party")} title="Color seats by party">
            <span className="color-key color-key-party" aria-hidden="true">{["D", "I", "R"].map((p) => <i key={p} style={{ background: PARTY_COLOR[p] }} />)}</span>Party
          </button>
        </span>
        {!members.length ? <em>Waiting for seats</em> : hasVote && !byParty ? <em>{party === "all" ? "" : `${party} only · `}{yea} yea · {nay} nay</em> : <em>{focus.length} seats · click any seat for the member card</em>}
      </header>
      {highlight ? <p className="floor-caption">Highlighting {highlight.label} · {highlight.ids.size} members</p> : null}
      {caption ? <p className="floor-caption">{caption}</p> : null}
      {source ? <p className="floor-source">{source.label} · {source.asOf} · {source.source}</p> : null}
      <svg
        viewBox={`0 0 ${FLOOR_VIEW.width} ${FLOOR_VIEW.height}`}
        className="floor-svg"
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={`${chamber} floor colored by ${byParty ? "party" : "vote"}${members.length ? "" : " · waiting for seats"}`}
        shapeRendering="geometricPrecision"
      >
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
        {seats.map((seat, index) => (
          <circle
            key={seat.id}
            className="floor-seat"
            cx={seat.x}
            cy={seat.y}
            r={hover?.id === seat.id ? seat.r + 1.4 : seat.r}
            fill={fill(seat)}
            opacity={dim(seat) ? 0.35 : 1}
            stroke={hover?.id === seat.id ? "#f0f1ee" : "none"}
            strokeWidth={1.8}
            role="button"
            tabIndex={focusedId === seat.id || (!seats.some((s) => s.id === focusedId) && index === 0) ? 0 : -1}
            aria-label={`${seat.name}, ${seat.state}${seat.district ? ` district ${seat.district}` : ""}, ${PARTY_LABEL[seat.party] || seat.party}${hasVote ? `, ${seat.vote}` : ""}. View member`}
            onFocus={() => { setFocusedId(seat.id); setHover(seat); }}
            onBlur={() => setHover(null)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect?.(seat); }
              const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
              if (direction) {
                event.preventDefault();
                const next = (index + direction + seats.length) % seats.length;
                event.currentTarget.parentElement?.querySelectorAll<SVGCircleElement>(".floor-seat")[next]?.focus();
              }
            }}
            onMouseEnter={() => setHover(seat)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect?.(seat)}
          >
            <title>{`${seat.name} · ${seat.state}${seat.district ? `-${seat.district}` : ""} · ${seat.party || "—"}${hasVote ? ` · ${seat.vote}` : ""}`}</title>
          </circle>
        ))}
      </svg>
      <div className="legend floor-legend" aria-label={byParty ? "Party color key" : "Vote color key"}>
        {byParty ? ["D", "R", "I"].map((p) => <span key={p}><i className="swatch" style={{ background: PARTY_COLOR[p], borderRadius: "50%" }} aria-hidden="true" />{PARTY_LABEL[p]}</span>) : <>
          {["Yea", "Nay", "Present", "Not voting"].map((v) => <span key={v}><i className="swatch" style={{ background: VOTE_FILL[v] }} aria-hidden="true" />{v}</span>)}

        </>}
      </div>
      <p className="floor-note">Schematic arrangement, not assigned seats. Democrats left · independents center · Republicans right.</p>
      <div className="floor-hud">
        {hover ? (
          <p className="floor-hover">
            {hover.bioguide ? <img src={`https://unitedstates.github.io/images/congress/225x275/${hover.bioguide}.jpg`} alt="" /> : null}
            <strong>{hover.name}</strong>
            <span>{hover.state}{hover.district ? `-${hover.district}` : ""} · {hover.party || "—"}{hasVote ? ` · ${hover.vote}` : ""}</span>
            <span className="dim">Select to view member details</span>
          </p>
        ) : members.length ? (
          <p>
            <strong>{members.length} seats</strong>
            <span>{byParty ? "Explore a seat · colored by party" : "Explore a seat · colored by vote"}</span>
          </p>
        ) : (
          <p>
            <strong>Party colors are ready</strong>
            <span>Seats appear when the roster loads</span>
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

function point(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: cx + Math.cos(Math.PI - angle) * radius,
    y: cy - Math.sin(angle) * radius
  };
}
