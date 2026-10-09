import type { Glyph, IconName } from "./names";

/** Map views, layers, and imagery bases. */
export const MAP = {
  // Flat sheet with a grid.
  view2d: ["M2.5 2.5h11v11h-11z", "M2.5 8h11", "M8 2.5v11"],
  // Pitched camera: a cube.
  cube: ["M8 1.75l5.5 3v6.5L8 14.25l-5.5-3v-6.5z", "M2.5 4.75L8 7.75l5.5-3", "M8 7.75v6.5"],
  // Shipping lane: a route from a port to a heading.
  lanes: ["M2 12.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0", "M5 11.5C7.5 10.5 7 8 9 7s3 0 4.5-2.75", "M11.25 3.75l2.25.5.25 2.25"],
  // Imagery: a photo frame with a ridge and the sun.
  imagery: ["M2 3h12v10H2z", "M2 11l3.75-3.75 3 3 2-2L14 11.5", "M10 5.75a1.25 1.25 0 1 0 2.5 0a1.25 1.25 0 1 0 -2.5 0"],
  // Labels: a tag.
  labels: ["M2 2.5h5.5l6.5 6.5-5 5L2.5 7.5z", "M4.5 5.25a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"],
  // Headquarters: an office tower beside a low wing.
  hq: ["M3.5 14V2.5h6V14", "M9.5 6.5h3V14", "M2 14h12", "M5.5 5h2", "M5.5 7.5h2", "M5.5 10h2"],
  // Sites: a factory with a stack.
  sites: ["M2 14V7l3.5 2.5V7L9 9.5V2.5h3V14z", "M2 14h12"],
  // Aircraft, top view.
  air: ["M8 1.75c.7 0 1 .8 1 1.6V6.5l5 3V11l-5-1.5v3l1.5 1.25v1L8 14l-2.5.75v-1L7 12.5v-3L2 11V9.5l5-3V3.35c0-.8.3-1.6 1-1.6z"],
  // Military: a shield.
  military: ["M8 1.75l5.5 2v4c0 3.5-2.4 5.6-5.5 6.5-3.1-.9-5.5-3-5.5-6.5v-4z", "M8 5v5.5"],
  // Satellite: body between two panels.
  satellite: ["M6.25 8L8 6.25 9.75 8 8 9.75z", "M2 5.5L5.5 2l2 2L4 7.5z", "M8.5 12L12 8.5l2 2-3.5 3.5z", "M5.75 5.75l1.4 1.4", "M8.85 8.85l1.4 1.4"],
  // Live frames: a pulse.
  live: ["M1.5 8h3l1.5-4 3 8 1.5-4h4"],
  // Daily true color: the sun.
  daily: [
    "M5.25 8a2.75 2.75 0 1 0 5.5 0a2.75 2.75 0 1 0 -5.5 0", "M8 1.5V3", "M8 13v1.5", "M1.5 8H3", "M13 8h1.5",
    "M3.4 3.4l1.05 1.05", "M11.55 11.55l1.05 1.05", "M3.4 12.6l1.05-1.05", "M11.55 4.45l1.05-1.05"
  ],
  // Night lights: a crescent.
  night: ["M13.75 9.5A6 6 0 1 1 6.5 2.25a5 5 0 0 0 7.25 7.25z"],
  // Filter: a funnel.
  filter: ["M2 2.75h12L9.5 8.25v4.5l-3 1.5v-6z"],
  // Map link: an arc from an origin to a destination.
  arc: ["M2.5 12.5C4 5.5 12 5.5 13.5 12.5", "M11.5 10.75l2 1.75 1.25-2.25", { d: "M1.75 12.5a.75.75 0 1 0 1.5 0a.75.75 0 1 0 -1.5 0", fill: true }]
} satisfies Partial<Record<IconName, Glyph>>;
