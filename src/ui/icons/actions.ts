import type { Glyph, IconName } from "./names";

/** Generic controls: navigation, card chrome, alert triage. */
export const ACTIONS = {
  search: ["M2.5 7a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0", "M10.25 10.25L14 14"],
  back: ["M13.5 8h-11", "M6.5 4L2.5 8l4 4"],
  close: ["M3.5 3.5l9 9", "M12.5 3.5l-9 9"],
  collapse: ["M3 8h10"],
  expand: ["M3 3h10v10H3z"],
  "chevron-down": ["M4 6l4 4 4-4"],
  "chevron-right": ["M6 4l4 4-4 4"],
  // Pushpin.
  pin: ["M5.5 1.75h5", "M6.75 1.75v4.5L4.5 9h7L9.25 6.25v-4.5", "M8 9v5.25"],
  // Share: out of the box.
  share: ["M8 1.75v8.5", "M5 4.5l3-3 3 3", "M5 7H3v7h10V7h-2"],
  // Copy link: two chain links.
  link: ["M6.5 9.5l3-3", "M7 4.75l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.5", "M9 11.25l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.5"],
  // Opens a source document in a new tab.
  external: ["M9.5 2.5h4v4", "M13.5 2.5L7.5 8.5", "M11.5 9.5v4h-9v-9h4"],
  check: ["M2.5 8.5L6 12l7.5-8"],
  checks: ["M1 8.75l3 3 7-7.75", "M7.5 11.25l.5.5 7-7.75"],
  // Dismiss: into the archive tray.
  dismiss: ["M2 2.5h12v3H2z", "M3 5.5v8h10v-8", "M6.5 8.5h3"],
  // Restore: undo.
  restore: ["M5.5 3.5l-3 3 3 3", "M2.5 6.5h7.25a3.75 3.75 0 0 1 0 7.5H7"],
  bell: ["M3.25 12.25h9.5", "M4.5 12.25V7a3.5 3.5 0 0 1 7 0v5.25", "M6.75 14.25h2.5", "M8 2v1.5"],
  // Drag handle: six dots.
  grip: [
    { d: "M5 3.5a.5.5 0 1 0 1 0a.5.5 0 1 0 -1 0", fill: true }, { d: "M10 3.5a.5.5 0 1 0 1 0a.5.5 0 1 0 -1 0", fill: true },
    { d: "M5 8a.5.5 0 1 0 1 0a.5.5 0 1 0 -1 0", fill: true }, { d: "M10 8a.5.5 0 1 0 1 0a.5.5 0 1 0 -1 0", fill: true },
    { d: "M5 12.5a.5.5 0 1 0 1 0a.5.5 0 1 0 -1 0", fill: true }, { d: "M10 12.5a.5.5 0 1 0 1 0a.5.5 0 1 0 -1 0", fill: true }
  ],
  // Command line: a prompt.
  command: ["M2.5 4.5L6 8l-3.5 3.5", "M8 11.5h5.5"],
  // Panels: a window with a side column.
  panels: ["M2 2.5h12v11H2z", "M10 2.5v11"],
  // Dossier: an ID card.
  dossier: ["M1.75 3.5h12.5v9H1.75z", "M4 7a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0", "M3.5 10.5c.3-1 1-1.5 2-1.5s1.7.5 2 1.5", "M9.5 6.5h3", "M9.5 9h3"],
  // Recent: a clock.
  recent: ["M2 8a6 6 0 1 0 12 0a6 6 0 1 0 -12 0", "M8 4.5V8l2.5 1.5"],
  // Feeds: a broadcast signal.
  feed: ["M3 2.75A10.25 10.25 0 0 1 13.25 13", "M3 6.75A6.25 6.25 0 0 1 9.25 13", { d: "M2.75 12.25a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", fill: true }],
  // Reset to everything: a loop back.
  reset: ["M4.3 4.3A5.25 5.25 0 1 1 2.75 8", "M1 9.75L2.75 8l1.75 1.75"]
} satisfies Partial<Record<IconName, Glyph>>;
