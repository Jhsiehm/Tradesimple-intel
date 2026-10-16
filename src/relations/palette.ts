import type { CategoryId, NodeType } from "../../shared/relations.mjs";
import type { IconName } from "../ui/icons/names";

/**
 * One look per relationship category and node type, shared by the canvas, legend, chips, menu, list, and
 * dossier. Every color clears 4.5:1 on the panel (#0d1115); color is never alone: each entry also has an
 * icon, and edges a dash pattern.
 */
export type Look = { color: string; icon: IconName; label: string };
export type EdgeLook = Look & { dash: number[] };
export type NodeLook = Look & { shape: "circle" | "square" | "diamond" | "hex" };

/** Reversible Phase C pilot: hue families, icons, shapes and dash semantics stay intact. */
const chromaticPilot = import.meta.env?.VITE_CHROMATIC_MAP !== "0";
const chroma = {
  blue: "#2E7DF6", amber: "#FAA340", violet: "#986CFF", cyan: "#26E0D4",
  lime: "#A6E22E", orange: "#FF8A3C", pink: "#FF5CAB"
};
/** Same 68% pigment / 32% ivory mixture as the namespaced CSS light variants. */
function light(hex: string) {
  const a = parseInt(hex.slice(1), 16), b = 0xEAE4D6;
  return "#" + [16, 8, 0].map((n) => Math.round(((a >> n) & 255) * .68 + ((b >> n) & 255) * .32).toString(16).padStart(2, "0")).join("");
}
const pigment = (legacy: string, hue: keyof typeof chroma) => chromaticPilot ? light(chroma[hue]) : legacy;

export const PANEL = "#0d1115";

export const CATEGORY_LOOK: Record<CategoryId, EdgeLook> = {
  trade: { color: pigment("#4aa8ff", "blue"), icon: "trade", label: "Trades", dash: [] },
  committee: { color: "#6fdc8c", icon: "committees", label: "Committees", dash: [9, 3] },
  hearing: { color: "#94a8bb", icon: "hearing", label: "Hearings", dash: [2, 3] },
  vote: { color: "#d0d6db", icon: "roll", label: "Roll calls", dash: [1, 3] },
  contract: { color: pigment("#d9b45a", "amber"), icon: "contracts", label: "Contracts", dash: [] },
  lobbying: { color: pigment("#ff8552", "orange"), icon: "lobbying", label: "Lobbying", dash: [10, 3, 2, 3] },
  pac: { color: pigment("#b48cff", "violet"), icon: "pac", label: "PAC money", dash: [6, 2, 2, 2] },
  supply: { color: pigment("#3df0ff", "cyan"), icon: "supply", label: "Supply chain", dash: [] },
  hq: { color: pigment("#b9d95a", "lime"), icon: "hq", label: "HQ · district", dash: [4, 4] },
  insider: { color: "#2fbfa8", icon: "form4", label: "Form 4 insiders", dash: [2, 2] }
};

/** Your theories: a color no data category uses, a long animated dash, and the bulb badge. */
export const THEORY_LOOK: EdgeLook = { color: pigment("#ff4fd8", "pink"), icon: "theory", label: "Your theory — not from a data source", dash: [7, 5] };

export const NODE_LOOK: Record<NodeType, NodeLook> = {
  member: { color: "#e4e7e6", icon: "members", label: "Member", shape: "circle" },
  ticker: { color: pigment("#7cc4ff", "blue"), icon: "ticker", label: "Ticker", shape: "square" },
  company: { color: "#8fa5b9", icon: "company", label: "Company", shape: "square" },
  committee: { color: "#6fdc8c", icon: "committees", label: "Committee", shape: "hex" },
  hearing: { color: "#94a8bb", icon: "hearing", label: "Hearing", shape: "diamond" },
  vote: { color: "#d0d6db", icon: "roll", label: "Roll call", shape: "diamond" },
  agency: { color: pigment("#d9b45a", "amber"), icon: "agency", label: "Agency", shape: "hex" },
  pac: { color: pigment("#b48cff", "violet"), icon: "pac", label: "PAC", shape: "hex" },
  firm: { color: pigment("#ff8552", "orange"), icon: "firm", label: "Lobbying firm", shape: "square" },
  insider: { color: "#2fbfa8", icon: "insider", label: "Form 4 filer", shape: "circle" },
  district: { color: pigment("#b9d95a", "lime"), icon: "districts", label: "District", shape: "hex" },
  note: { color: THEORY_LOOK.color, icon: "user-node", label: "Added by you", shape: "circle" }
};

/** Relative luminance contrast, for the palette test and any tint that sits on text. */
export function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
