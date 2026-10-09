import { reply } from "../router.mjs";
import { readJson } from "../lib/body.mjs";
import { notifierFor } from "../domain/notify/index.mjs";

const bad = (status, error) => reply(status, { ok: false, error, missing: "" });
const method = (req) => String(req?.method || "GET").toUpperCase();

export const handlers = {
  /** GET: phone-notification settings (topic masked, token as a flag), sends in the last hour, recent sends. PUT: save choices. */
  notify: async ({ db, req }) => {
    const n = notifierFor(db);
    if (method(req) === "GET") return n.view();
    if (method(req) !== "PUT") return bad(405, "Use GET or PUT.");
    const b = await readJson(req, 4 * 1024);
    if (!b.ok) return bad(b.status, b.error);
    if (!b.value || typeof b.value !== "object" || Array.isArray(b.value)) return bad(400, "Body must be an object: { enabled, minSeverity, kinds, quiet, quietHigh }.");
    return n.save(b.value);
  },

  /** POST: one labelled test notification, sent server-side to NTFY_TOPIC. */
  "notify.test": async ({ db, req }) => {
    if (method(req) !== "POST") return bad(405, "Use POST.");
    const out = await notifierFor(db).test();
    return out.ok ? out : bad(out.status || 502, out.error);
  }
};
