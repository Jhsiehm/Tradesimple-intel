/**
 * Every icon name. Path data lives in the domain files beside this one; `paths.ts` merges them into a
 * `Record<IconName, Glyph>`, so a name without a drawing fails the type check and `test/icons.test.mjs`.
 */
export const ICON_NAMES = [
  // Sections
  "today", "congress", "markets", "contracts", "news", "districts", "strait", "map", "calendar", "globe", "city",
  // Congress and records
  "house", "senate", "votes", "bills", "members", "committees", "floor", "filings", "form4", "hearing", "roll", "trade", "pac", "leaders", "timeline",
  // Markets
  "chart", "board", "fx", "crypto", "positions", "supply", "star", "star-on",
  // Map layers and views
  "view2d", "cube", "lanes", "imagery", "labels", "hq", "sites", "air", "military", "satellite", "live", "daily", "night", "filter", "arc",
  // Actions
  "search", "back", "close", "collapse", "expand", "chevron-down", "chevron-right", "pin", "share", "link", "external", "check", "checks",
  "dismiss", "restore", "bell", "grip", "command", "panels", "dossier", "recent", "feed", "reset"
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/**
 * Drawn on a 16×16 grid with a 1.5 stroke in `currentColor`. A string is a stroked path; `{ fill: true }`
 * is a small solid accent (stroked too, so it lines up with outlines).
 */
export type Glyph = readonly (string | { readonly d: string; readonly fill: true })[];
