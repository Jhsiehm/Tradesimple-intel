/**
 * Your theories on the relationship map: links you draw and nodes you add. Stored only in this browser
 * (localStorage) or carried in a share link; never sent to the server and never counted as data.
 */

export const THEORY_KEY = "intel:relations:theories";
export const THEORY_VERSION = 2;
export const MAX_THEORIES = 200;
export const MAX_NOTES = 100;
const MAX_TEXT = 280;

const text = (v, max = MAX_TEXT) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const conf = (v) => (["low", "medium", "high"].includes(v) ? v : "medium");
const endpoint = (v) => (v && typeof v === "object" && typeof v.id === "string" && v.id.includes(":") ? { id: v.id.slice(0, 160), type: text(v.type, 20) || v.id.split(":")[0], label: text(v.label, 120) || v.id } : null);

/** A clean theory, or null. Endpoints keep id, type, and label so a theory can bring its nodes back. */
export function cleanTheory(raw) {
  if (!raw || typeof raw !== "object") return null;
  const a = endpoint(raw.a);
  const b = endpoint(raw.b);
  if (!a || !b || a.id === b.id) return null;
  return {
    id: text(raw.id, 80) || `t-${a.id}-${b.id}`,
    a, b,
    label: text(raw.label, 80),
    note: text(raw.note),
    confidence: conf(raw.confidence),
    created: text(raw.created, 30),
    updated: text(raw.updated, 30)
  };
}

export function cleanNote(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = text(raw.id, 80);
  if (!/^note:[A-Za-z0-9\-_]{1,60}$/.test(id)) return null;
  return { id, type: "note", label: text(raw.label, 80) || "Untitled", note: text(raw.note), kind: ["person", "event", "company", "other"].includes(raw.kind) ? raw.kind : "other", created: text(raw.created, 30) };
}

/** Newest kept first when over the cap. */
export function cleanDoc(raw) {
  const theories = (Array.isArray(raw?.theories) ? raw.theories : []).map(cleanTheory).filter(Boolean);
  const notes = (Array.isArray(raw?.notes) ? raw.notes : []).map(cleanNote).filter(Boolean);
  const dedupe = (list) => [...new Map(list.map((x) => [x.id, x])).values()];
  return { v: THEORY_VERSION, theories: dedupe(theories).slice(-MAX_THEORIES), notes: dedupe(notes).slice(-MAX_NOTES) };
}

/**
 * Stored document → current version. v1 was { theories } with `from`/`to` ids and no labels; v2 adds
 * endpoint labels, confidence, and notes.
 */
export function migrate(raw) {
  if (!raw || typeof raw !== "object") return cleanDoc({});
  if (raw.v === THEORY_VERSION) return cleanDoc(raw);
  if (raw.v === 1 || Array.isArray(raw.theories)) {
    const theories = (raw.theories || []).map((t) => ({
      ...t,
      a: t.a || { id: t.from, label: t.from },
      b: t.b || { id: t.to, label: t.to }
    }));
    return cleanDoc({ theories, notes: raw.notes });
  }
  return cleanDoc({});
}

export function parseDoc(json) {
  try {
    return migrate(JSON.parse(json || "null"));
  } catch {
    return cleanDoc({});
  }
}

export const serialize = (doc) => JSON.stringify(cleanDoc(doc));

/** Import: theories and notes from a file join the current ones; same id, the file wins. */
export function mergeDocs(current, incoming) {
  return cleanDoc({ theories: [...current.theories, ...incoming.theories], notes: [...current.notes, ...incoming.notes] });
}

// Share links: the document as base64url JSON after `#rel=`. Nothing is uploaded.

function toB64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Share links stay under ~8 KB; past that, export a file instead. */
export const SHARE_MAX = 8000;

export function encodeShare(doc) {
  const out = toB64url(serialize(doc));
  return out.length > SHARE_MAX ? "" : out;
}

export function decodeShare(token) {
  try {
    return migrate(JSON.parse(fromB64url(String(token || ""))));
  } catch {
    return null;
  }
}
