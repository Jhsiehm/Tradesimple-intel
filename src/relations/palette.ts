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

export const PANEL = "#0d1115";

export const CATEGORY_LOOK: Record<CategoryId, EdgeLook> = {
  trade: { color: "#4aa8ff", icon: "trade", label: "Trades", dash: [] },
  committee: { color: "#6fdc8c", icon: "committees", label: "Committees", dash: [9, 3] },
  hearing: { color: "#94a8bb", icon: "hearing", label: "Hearings", dash: [2, 3] },
  vote: { color: "#d0d6db", icon: "roll", label: "Roll calls", dash: [1, 3] },
  contract: { color: "#d9b45a", icon: "contracts", label: "Contracts", dash: [] },
  lobbying: { color: "#ff8552", icon: "lobbying", label: "Lobbying", dash: [10, 3, 2, 3] },
  pac: { color: "#b48cff", icon: "pac", label: "PAC money", dash: [6, 2, 2, 2] },
  supply: { color: "#3df0ff", icon: "supply", label: "Supply chain", dash: [] },
  hq: { color: "#b9d95a", icon: "hq", label: "HQ · district", dash: [4, 4] },
  insider: { color: "#2fbfa8", icon: "form4", label: "Form 4 insiders", dash: [2, 2] }
};

/** Your theories: a color no data category uses, a long animated dash, and the bulb badge. */
export const THEORY_LOOK: EdgeLook = { color: "#ff4fd8", icon: "theory", label: "Your theory — not from a data source", dash: [7, 5] };

export const NODE_LOOK: Record<NodeType, NodeLook> = {
  member: { color: "#e4e7e6", icon: "members", label: "Member", shape: "circle" },
  ticker: { color: "#7cc4ff", icon: "ticker", label: "Ticker", shape: "square" },
  company: { color: "#8fa5b9", icon: "company", label: "Company", shape: "square" },
  committee: { color: "#6fdc8c", icon: "committees", label: "Committee", shape: "hex" },
  hearing: { color: "#94a8bb", icon: "hearing", label: "Hearing", shape: "diamond" },
  vote: { color: "#d0d6db", icon: "roll", label: "Roll call", shape: "diamond" },
  agency: { color: "#d9b45a", icon: "agency", label: "Agency", shape: "hex" },
  pac: { color: "#b48cff", icon: "pac", label: "PAC", shape: "hex" },
  firm: { color: "#ff8552", icon: "firm", label: "Lobbying firm", shape: "square" },
  insider: { color: "#2fbfa8", icon: "insider", label: "Form 4 filer", shape: "circle" },
  district: { color: "#b9d95a", icon: "districts", label: "District", shape: "hex" },
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
