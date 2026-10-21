import { readJson } from "../lib/body.mjs";
import { reply } from "../router.mjs";
import { POLICY_IMPORT_LIMIT } from "../domain/policy/imports.mjs";
import {
  listPolicyInvestigations,
  getPolicyInvestigation,
  createPolicyInvestigation,
  importPolicyEvidence,
  collectPolicyInvestigation,
  evaluatePolicyInvestigation,
  cancelPolicyCollection,
} from "../domain/policy/investigations.mjs";
import { exportPolicyInvestigation, exportPolicyArchive, replayPolicyInvestigation } from "../domain/policy/replay.mjs";

async function handle(ctx, methods, action) {
  if (!methods.includes(ctx.req.method)) return reply(405, { ok: false, error: `Use ${methods.join(" or ")}.` });
  try {
    let body = {};
    if (ctx.req.method === "POST") {
      const parsed = await readJson(ctx.req, POLICY_IMPORT_LIMIT + 128 * 1024);
      if (!parsed.ok) return reply(parsed.status, { ok: false, error: parsed.error });
      if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value))
        throw Error("Provide a JSON object.");
      body = parsed.value;
    }
    return await action(body);
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Policy investigation failed.";
    if (!error?.message) console.error("Policy investigation failed without a message", error);
    return reply(
      message.includes("not found") ? 404 : message.includes("changed") || message.includes("running") ? 409 : 400,
      { ok: false, error: message },
    );
  }
}

export const handlers = {
  "policy.investigations": (ctx) =>
    handle(ctx, ["GET", "POST"], async (body) =>
      ctx.req.method === "GET"
        ? listPolicyInvestigations(ctx.db)
        : { ok: true, investigation: await createPolicyInvestigation(ctx.db, body.protocol) },
    ),
  "policy.investigation": (ctx) =>
    handle(ctx, ["GET"], () => ({ ok: true, investigation: getPolicyInvestigation(ctx.db, ctx.params.id) })),
  "policy.import": (ctx) =>
    handle(ctx, ["POST"], async (body) => ({
      ok: true,
      investigation: await importPolicyEvidence(ctx.db, ctx.params.id, body),
    })),
  "policy.evaluate": (ctx) =>
    handle(ctx, ["POST"], async (body) => ({
      ok: true,
      investigation: await evaluatePolicyInvestigation(ctx.db, ctx.params.id, { revision: body.revision }),
    })),
  "policy.collect": (ctx) =>
    handle(ctx, ["POST"], async (body) => {
      const controller = new AbortController();
      const close = () => controller.abort();
      ctx.res.on("close", close);
      try {
        return {
          ok: true,
          investigation: await collectPolicyInvestigation(ctx.db, ctx.params.id, {
            signal: controller.signal,
            revision: body.revision,
          }),
        };
      } finally {
        ctx.res.off("close", close);
      }
    }),
  "policy.cancel": (ctx) => handle(ctx, ["POST"], () => cancelPolicyCollection(ctx.db, ctx.params.id)),
  "policy.replay": (ctx) => handle(ctx, ["POST"], () => replayPolicyInvestigation(ctx.db, ctx.params.id)),
  "policy.export": (ctx) =>
    handle(ctx, ["GET"], () => {
      const archive = exportPolicyInvestigation(ctx.db, ctx.params.id);
      ctx.res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${ctx.params.id}.json"`,
        "Cache-Control": "no-store",
      });
      ctx.res.end(JSON.stringify(archive, null, 2));
    }),
  "policy.archive": (ctx) =>
    handle(ctx, ["GET"], () => {
      const bytes = exportPolicyArchive(ctx.db, ctx.params.id);
      ctx.res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${ctx.params.id}.zip"`,
        "Cache-Control": "no-store",
      });
      ctx.res.end(bytes);
    }),
};
