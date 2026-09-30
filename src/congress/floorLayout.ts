export type FloorSeat = {
  id: string;
  name: string;
  state: string;
  district: string;
  party: string;
  vote: string;
  bioguide: string;
  x: number;
  y: number;
  r: number;
};

type MemberLike = {
  name: string;
  state: string;
  district: string;
  vote: string;
  party?: string;
  bioguide?: string;
  geoid?: string | null;
};

export const FLOOR_VIEW = { width: 1600, height: 920 };

type Guide = {
  cx: number;
  cy: number;
  inner: number;
  outer: number;
  rows: number;
};

const GUIDE: Record<"house" | "senate", Guide> = {
  house: { cx: 800, cy: 840, inner: 210, outer: 680, rows: 11 },
  senate: { cx: 800, cy: 840, inner: 250, outer: 560, rows: 4 }
};

export function floorGuide(chamber: "house" | "senate") {
  return GUIDE[chamber];
}

function partyRank(party: string) {
  if (party === "D") return 0;
  if (party === "R") return 2;
  return 1;
}

function seatId(m: MemberLike, index: number) {
  return m.bioguide || m.geoid || `${m.state}-${m.district || "AL"}-${m.name}-${index}`;
}

function radiiFor(guide: Guide, rows: number) {
  return Array.from({ length: rows }, (_, row) => {
    const t = rows === 1 ? 0.55 : row / (rows - 1);
    return guide.inner + (guide.outer - guide.inner) * t;
  });
}

function rowCounts(n: number, radii: number[]) {
  const weights = radii.map((radius) => radius);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const counts = weights.map((weight) => Math.floor((n * weight) / total));
  let leftover = n - counts.reduce((sum, count) => sum + count, 0);
  const order = counts.map((_, index) => index).sort((a, b) => radii[b] - radii[a]);
  let cursor = 0;
  while (leftover > 0 && order.length) {
    counts[order[cursor % order.length]] += 1;
    leftover -= 1;
    cursor += 1;
  }
  return counts;
}

function placeBlock(
  people: MemberLike[],
  angle0: number,
  angle1: number,
  guide: Guide,
  seatR: number
) {
  if (!people.length) return [];
  const rows = Math.min(guide.rows, people.length);
  const radii = radiiFor(guide, rows);
  const counts = rowCounts(people.length, radii);
  const seats: Omit<FloorSeat, "r">[] = [];
  let cursor = 0;
  for (let row = 0; row < rows; row += 1) {
    const count = counts[row];
    for (let i = 0; i < count; i += 1) {
      const member = people[cursor];
      if (!member) break;
      const angle = count === 1 ? (angle0 + angle1) / 2 : angle0 + ((angle1 - angle0) * i) / (count - 1);
      seats.push({
        id: seatId(member, cursor),
        name: member.name,
        state: member.state,
        district: member.district,
        party: member.party || "",
        vote: member.vote,
        bioguide: member.bioguide || "",
        x: guide.cx + Math.cos(Math.PI - angle) * radii[row],
        y: guide.cy - Math.sin(angle) * radii[row]
      });
      cursor += 1;
    }
  }
  return seats.map((seat) => ({ ...seat, r: seatR }));
}

/** Semicircle chamber: Democrats left, Independents on the aisle, Republicans right. */
export function layoutFloor(members: MemberLike[], chamber: "house" | "senate"): FloorSeat[] {
  if (!members.length) return [];
  const sorted = [...members].sort((a, b) => {
    const party = partyRank(a.party || "") - partyRank(b.party || "");
    if (party) return party;
    const place = `${a.state}${a.district}`.localeCompare(`${b.state}${b.district}`);
    if (place) return place;
    return a.name.localeCompare(b.name);
  });
  const dems = sorted.filter((member) => member.party === "D");
  const gop = sorted.filter((member) => member.party === "R");
  const center = sorted.filter((member) => member.party !== "D" && member.party !== "R");
  const guide = GUIDE[chamber];
  const left0 = Math.PI * 0.05;
  const left1 = Math.PI * 0.455;
  const right0 = Math.PI * 0.545;
  const right1 = Math.PI * 0.95;
  const draft = [
    ...placeBlock(dems, left0, left1, guide, 1),
    ...placeBlock(center, Math.PI * 0.475, Math.PI * 0.525, guide, 1),
    ...placeBlock(gop, right0, right1, guide, 1)
  ];
  let minD = Infinity;
  for (let i = 0; i < draft.length; i += 1) {
    for (let j = i + 1; j < draft.length; j += 1) {
      const dx = draft[i].x - draft[j].x;
      const dy = draft[i].y - draft[j].y;
      const dist = Math.hypot(dx, dy);
      if (dist < minD) minD = dist;
    }
  }
  const cap = chamber === "senate" ? 16 : 8.5;
  const seatR = Math.max(3.2, Math.min(cap, (Number.isFinite(minD) ? minD : 20) * 0.42));
  return draft.map((seat) => ({ ...seat, r: seatR }));
}

export function voteFill(vote: string) {
  if (vote === "Yea") return "#2f9a55";
  if (vote === "Nay") return "#c45c54";
  if (vote === "Present") return "#5d6d58";
  if (vote === "Split") return "#a08a3e";
  return "#1e2831";
}

export function partyStroke(party: string) {
  if (party === "D") return "#9eb892";
  if (party === "R") return "#c49a96";
  return "#e2b657";
}
