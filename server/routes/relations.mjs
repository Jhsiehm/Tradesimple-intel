import { disclosureExpansion, expand, nodeInfo } from "../domain/relations.mjs";
import { reply } from "../router.mjs";

const answer = (body) => (body.ok ? body : reply(body.status || 500, { ok: false, error: body.error }));

export const handlers = {
  "relations.node": async ({ db, query }) => answer(await nodeInfo(db, query.params)),
  "relations.expand": async ({ db, query }) => answer(await expand(db, query.params)),
  "relations.path": async ({ db, query }) => answer(await disclosureExpansion(db, query.params))
};
