import type { Glyph, IconName } from "./names";

/** Top-nav sections. Circles are written as two arcs so these files need no runtime imports. */
export const NAV = {
  // Sunrise over a horizon: this week, starting today.
  today: ["M2 12.5h12", "M4.5 12.5a3.5 3.5 0 0 1 7 0", "M8 3.5V6", "M3.2 6.2l1.3 1.3", "M12.8 6.2l-1.3 1.3"],
  // Capitol: dome, spire, three columns, steps.
  congress: ["M8 6V3", "M4.5 9.5a3.5 3.5 0 0 1 7 0", "M3 9.5h10", "M5 9.5v4", "M8 9.5v4", "M11 9.5v4", "M2 13.5h12"],
  // Axis with a rising line.
  markets: ["M2.5 2.5v11h11", "M5 10.5l2.75-3.25 2.25 1.75 3.5-4.5"],
  // Contract page with a dollar sign.
  contracts: [
    "M3.5 1.75h6l3 3v9.5h-9z", "M9.5 1.75v3h3",
    "M9.6 7.4c-.3-.5-.9-.8-1.6-.8-.9 0-1.6.5-1.6 1.15 0 1.5 3.3.9 3.3 2.4 0 .7-.7 1.15-1.7 1.15-.7 0-1.4-.3-1.7-.85", "M8 5.6v1", "M8 11.45v1"
  ],
  // Folded front page: headline, two lines, photo block.
  news: ["M2.5 3h11v10h-11z", "M4.5 5.5h7", "M4.5 8h2.5", "M4.5 10.5h2.5", "M9 8h2.5v2.5H9z"],
  // Location pin.
  districts: ["M8 14.25S3.5 10.2 3.5 6.75a4.5 4.5 0 0 1 9 0c0 3.45-4.5 7.5-4.5 7.5z", "M6.5 6.75a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0"],
  // Ship: hull, cabin, mast.
  strait: ["M1.5 9.5h13l-2.25 4h-8.5z", "M4.5 9.5V6.25h6V9.5", "M7.5 6.25V2", "M7.5 2.25l3 1.25-3 1.25"],
  // Folded paper map.
  map: ["M1.75 3.5l4-1.5 4.5 1.5 4-1.5v10.5l-4 1.5-4.5-1.5-4 1.5z", "M5.75 2v10.5", "M10.25 3.5V14"],
  // Calendar page: rings, header rule, three day marks.
  calendar: [
    "M2.5 3.5h11v10h-11z", "M2.5 6.5h11", "M5.5 2v3", "M10.5 2v3",
    { d: "M4.9 9h1.2v1.2H4.9z", fill: true }, { d: "M7.4 9h1.2v1.2H7.4z", fill: true }, { d: "M9.9 9h1.2v1.2H9.9z", fill: true }
  ],
  // Globe: outline, meridian, equator.
  globe: ["M2 8a6 6 0 1 0 12 0a6 6 0 1 0 -12 0", "M8 2C6 3.8 5.2 5.8 5.2 8s.8 4.2 2.8 6c2-1.8 2.8-3.8 2.8-6S10 3.8 8 2z", "M2 8h12"],
  // Skyline: three towers on a street line.
  city: ["M1.5 14h13", "M3 14V7.5h3V14", "M6 14V3h4v11", "M10 14V8.5h3V14", "M7.5 5.5h1", "M7.5 8h1"]
} satisfies Partial<Record<IconName, Glyph>>;
