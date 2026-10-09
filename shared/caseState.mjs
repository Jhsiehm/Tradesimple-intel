/** localStorage key for which dossier sections are folded. */
export const CASE_OPEN_KEY = "intel:case:open:v1";
const MAX_KEYS = 200;

/** Stable id for a dossier section: subject kind plus a slug of its title, so "PAC money" folds for every member. */
export function sectionId(kind, title) {
  const slug = String(title || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${kind || "dossier"}:${slug || "section"}`;
}

/** Stored fold state; anything malformed reads as "nothing folded". */
export function parseOpen(raw) {
  try {
    const value = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "boolean"));
  } catch {
    return {};
  }
}

export function isOpen(state, id, fallback = true) {
  return typeof state[id] === "boolean" ? state[id] : fallback;
}

/** New state with `id` set; the most recently touched ids are kept, oldest dropped past the cap. */
export function withOpen(state, id, open) {
  const rest = Object.entries(state).filter(([k]) => k !== id);
  return Object.fromEntries([...rest, [id, open]].slice(-MAX_KEYS));
}
