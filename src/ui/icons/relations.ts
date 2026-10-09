import type { Glyph, IconName } from "./names";

/** Relationship map: node kinds that have no section icon, your theories, and the canvas tools. */
export const RELATIONS = {
  // Lobbying: a megaphone.
  lobbying: ["M2 6.5h2.5l6-3.5v10l-6-3.5H2z", "M4.5 9.5l1 4h2l-1-4", "M12.5 6.25a2 2 0 0 1 0 3.5"],
  // Agency: a pediment on three columns under a flag.
  agency: ["M2.5 7l5.5-2.5L13.5 7z", "M4.5 8.5v4", "M8 8.5v4", "M11.5 8.5v4", "M2 14h12", "M8 4.5V1.75", { d: "M8 1.75h3l-.75 1 .75 1H8z", fill: true }],
  // Lobbying registrant: a briefcase.
  firm: ["M2 5h12v8.5H2z", "M5.5 5V3h5v2", "M2 8.5h12", { d: "M7.25 8h1.5v1.5h-1.5z", fill: true }],
  // Company outside the join table: a block with windows.
  company: ["M3 14V2.5h10V14", "M2 14h12", "M5.5 5h1.5", "M9 5h1.5", "M5.5 8h1.5", "M9 8h1.5", "M7 14v-3h2v3"],
  // Ticker: a rising line with its arrowhead.
  ticker: ["M2 12.5l3.5-3.5 2.5 2.5L13.5 6", "M10.5 6h3v3", "M2 14.25h12"],
  // Form 4 filer: a person inside the company.
  insider: ["M2 14V3h7v11", "M9 7h5v7", "M1.5 14h13", "M4.25 7a1.25 1.25 0 1 0 2.5 0a1.25 1.25 0 1 0 -2.5 0", "M3.5 11.75c0-1.2.9-2 2-2s2 .8 2 2"],
  // Your theory: a light bulb.
  theory: ["M5.5 10.5C4.2 9.5 3.5 8.2 3.5 6.75a4.5 4.5 0 0 1 9 0c0 1.45-.7 2.75-2 3.75V12h-5z", "M6 14h4", "M8 10V8"],
  // A node you added: a person with a plus.
  "user-node": ["M3.5 5a2.25 2.25 0 1 0 4.5 0a2.25 2.25 0 1 0 -4.5 0", "M1.5 13.5c0-2.5 1.9-4 4.25-4s4.25 1.5 4.25 4", "M12.5 4v5", "M10 6.5h5"],
  // Draw a theory: a pen over a link.
  draw: ["M2.5 13.5l1-3.5 7.5-7.5 2.5 2.5-7.5 7.5z", "M9.5 4l2.5 2.5"],
  // Fit to view: four corners.
  fit: ["M2 5.5V2h3.5", "M10.5 2H14v3.5", "M14 10.5V14h-3.5", "M5.5 14H2v-3.5"],
  undo: ["M5.5 3.5l-3 3 3 3", "M2.5 6.5h7a3.5 3.5 0 0 1 0 7H6"],
  redo: ["M10.5 3.5l3 3-3 3", "M13.5 6.5h-7a3.5 3.5 0 0 0 0 7H10"],
  "zoom-in": ["M2.5 7a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0", "M10.25 10.25L14 14", "M5 7h4", "M7 5v4"],
  "zoom-out": ["M2.5 7a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0", "M10.25 10.25L14 14", "M5 7h4"],
  // Export: down into the tray.
  export: ["M8 2v8.5", "M5 7.5l3 3 3-3", "M2.5 11v2.5h11V11"],
  // Import: up out of the tray.
  import: ["M8 10.5V2", "M5 5l3-3 3 3", "M2.5 11v2.5h11V11"],
  // Re-layout: two boxes joined by an elbow.
  layout: ["M2 2.5h4.5v3.5H2z", "M9.5 10h4.5v3.5H9.5z", "M6.5 4.25h2a1.5 1.5 0 0 1 1.5 1.5V10"],
  // Show more: three dots.
  more: [{ d: "M2.5 8a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", fill: true }, { d: "M7 8a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", fill: true }, { d: "M11.5 8a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", fill: true }],
  trash: ["M2.5 4h11", "M6 4V2.5h4V4", "M3.75 4l.75 9.5h7l.75-9.5", "M6.5 6.5v4.5", "M9.5 6.5v4.5"]
} satisfies Partial<Record<IconName, Glyph>>;
