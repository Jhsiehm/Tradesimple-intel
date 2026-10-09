import type { Glyph, IconName } from "./names";

/** Market views and the watchlist star. */
export const MARKETS = {
  // Two candles.
  chart: ["M5 2v12", "M3.75 4.5h2.5V10h-2.5z", "M11 3v10", "M9.75 6h2.5v5h-2.5z"],
  // Equity board: a 2×2 heat grid, one cell lit.
  board: ["M2 2h5v5H2z", "M9 2h5v5H9z", "M2 9h5v5H2z", "M9 9h5v5H9z", { d: "M3.5 3.5h2v2h-2z", fill: true }],
  // FX: two overlapping coins.
  fx: ["M2 6a4 4 0 1 0 8 0a4 4 0 1 0 -8 0", "M10 6a4 4 0 1 1-4 4"],
  // Crypto: a hexagonal block with a node.
  crypto: ["M8 1.75l5.5 3.1v6.3L8 14.25l-5.5-3.1v-6.3z", { d: "M7 8a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", fill: true }],
  // Positions: pie of holders.
  positions: ["M2 8a6 6 0 1 0 12 0a6 6 0 1 0 -12 0", "M8 2v6h6"],
  // Supply chain: one company linked to two others.
  supply: [
    "M1.75 8a1.75 1.75 0 1 0 3.5 0a1.75 1.75 0 1 0 -3.5 0", "M10.75 3.5a1.75 1.75 0 1 0 3.5 0a1.75 1.75 0 1 0 -3.5 0",
    "M10.75 12.5a1.75 1.75 0 1 0 3.5 0a1.75 1.75 0 1 0 -3.5 0", "M5.1 7.2l5.8-2.9", "M5.1 8.8l5.8 2.9"
  ],
  star: ["M8 1.75l1.9 3.95 4.3.55-3.15 2.95.8 4.3L8 11.45 4.15 13.5l.8-4.3L1.8 6.25l4.3-.55z"],
  "star-on": [{ d: "M8 1.75l1.9 3.95 4.3.55-3.15 2.95.8 4.3L8 11.45 4.15 13.5l.8-4.3L1.8 6.25l4.3-.55z", fill: true }]
} satisfies Partial<Record<IconName, Glyph>>;
