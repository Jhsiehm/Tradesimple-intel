import type { Glyph, IconName } from "./names";

/** Chambers, Congress modes, and the record kinds the scrubber and alerts lane by. */
export const CONGRESS = {
  // Wide portico, four columns: the larger chamber.
  house: ["M2 5.5L8 2.5l6 3z", "M4 7v5.5", "M6.7 7v5.5", "M9.3 7v5.5", "M12 7v5.5", "M2 13.5h12"],
  // Narrow portico, two columns, a star in the pediment.
  senate: ["M3.5 6L8 3l4.5 3z", "M5.5 7.5v5", "M10.5 7.5v5", "M3 13.5h10", { d: "M7.4 4.6h1.2v.9H7.4z", fill: true }],
  // Gavel over a sound block.
  votes: ["M5 4.5l3-3 3.5 3.5-3 3z", "M6.75 6.25L2 11", "M9.5 12.5h4.5v1.75H9.5z"],
  // Bill: page with text lines.
  bills: ["M3.5 1.75h6l3 3v9.5h-9z", "M9.5 1.75v3h3", "M5.5 5.5h2", "M5.5 8h5", "M5.5 10.5h5"],
  // One person.
  members: ["M5.5 5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0", "M3 14c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5"],
  // Three people around a table.
  committees: [
    "M6 4.5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M4.5 12c0-2 1.6-3.5 3.5-3.5s3.5 1.5 3.5 3.5",
    "M2 6.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0", "M1 12.5c0-1.6 1-2.75 2.5-2.75",
    "M11 6.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0", "M15 12.5c0-1.6-1-2.75-2.5-2.75", "M1.5 14.25h13"
  ],
  // Hemicycle: two rows of seats around the well.
  floor: ["M2 13a6 6 0 0 1 12 0", "M5 13a3 3 0 0 1 6 0", { d: "M7.5 12.5h1v1h-1z", fill: true }],
  // Filing: page with a seal.
  filings: ["M3.5 1.75h6l3 3v9.5h-9z", "M9.5 1.75v3h3", "M5.5 5.5h2", "M6 10a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"],
  // Form 4: page with a 4.
  form4: ["M3.5 1.75h6l3 3v9.5h-9z", "M9.5 1.75v3h3", "M9 12.25V6.5l-3.5 4h5"],
  // Hearing: microphone on a stand.
  hearing: ["M6 3.5a2 2 0 0 1 4 0v3.5a2 2 0 0 1-4 0z", "M4 7a4 4 0 0 0 8 0", "M8 11v3", "M5.5 14h5"],
  // Roll call: tally of four, struck through.
  roll: ["M3.5 3v10", "M6 3v10", "M8.5 3v10", "M11 3v10", "M1.75 10.75l12.5-5.5"],
  // Trade: buy and sell arrows.
  trade: ["M2.5 5h10", "M10 2.5L12.5 5 10 7.5", "M13.5 11h-10", "M6 8.5L3.5 11 6 13.5"],
  // PAC money: stacked coins.
  pac: [
    "M3 4.5c0-1 2.2-1.75 5-1.75s5 .75 5 1.75-2.2 1.75-5 1.75S3 5.5 3 4.5z",
    "M3 4.5v7c0 1 2.2 1.75 5 1.75s5-.75 5-1.75v-7", "M3 8c0 1 2.2 1.75 5 1.75S13 9 13 8"
  ],
  // Leaderboard: trophy.
  leaders: ["M4.75 2.5h6.5V6a3.25 3.25 0 0 1-6.5 0z", "M4.75 3.75H2.5c0 1.6 1 2.75 2.4 2.9", "M11.25 3.75h2.25c0 1.6-1 2.75-2.4 2.9", "M8 9.25v3.25", "M5.25 13.5h5.5"],
  // Timeline: a track with events of different weight.
  timeline: ["M1.5 8h13", "M4 5v6", "M8 6.25v3.5", "M12 3.5v9"]
} satisfies Partial<Record<IconName, Glyph>>;
