import { readJson } from "../lib/body.mjs";
import { reply } from "../router.mjs";
import {
  createInvestigation,
  getInvestigation,
  listInvestigations,
  runInvestigation,
  exportInvestigation,
  exportInvestigationArchive,
} from "../domain/workflow/investigations.mjs";

async function handle(ctx, methods, action) {
  if (!methods.includes(ctx.req.method)) return reply(405, { ok: false, error: `Use ${methods.join(" or ")}.` });
  try {
    let body = {};
    if (ctx.req.method === "POST") {
      const parsed = await readJson(ctx.req, 128 * 1024);
      if (!parsed.ok) return reply(parsed.status, { ok: false, error: parsed.error });
      if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value))
        throw Error("Provide a JSON object.");
      body = parsed.value;
    }
    return await action(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow investigation failed.";
    return reply(message.includes("not found") ? 404 : message.includes("changed") ? 409 : 400, {
      ok: false,
      error: message,
    });
  }
}

export const handlers = {
  "workflow.investigations": (ctx) =>
    handle(ctx, ["GET", "POST"], (body) =>
      ctx.req.method === "GET"
        ? listInvestigations(ctx.db)
        : { ok: true, investigation: createInvestigation(ctx.db, body.protocol) },
    ),
  "workflow.investigation": (ctx) =>
    handle(ctx, ["GET"], () => ({ ok: true, investigation: getInvestigation(ctx.db, ctx.params.id) })),
  "workflow.run": (ctx) =>
    handle(ctx, ["POST"], async (body) => {
      const controller = new AbortController();
      const close = () => controller.abort();
      ctx.res.on("close", close);
      try {
        return {
          ok: true,
          investigation: await runInvestigation(ctx.db, ctx.params.id, {
            revision: body.revision,
            signal: controller.signal,
          }),
        };
      } finally {
        ctx.res.off("close", close);
      }
    }),
  "workflow.export": (ctx) =>
    handle(ctx, ["GET"], () => {
      const archive = exportInvestigation(ctx.db, ctx.params.id);
      ctx.res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${ctx.params.id}.json"`,
      });
      ctx.res.end(JSON.stringify(archive, null, 2));
    }),
  "workflow.archive": (ctx) =>
    handle(ctx, ["GET"], () => {
      const bytes = exportInvestigationArchive(ctx.db, ctx.params.id);
      ctx.res.writeHead(200, {
        "Content-Type": "application/zip",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${ctx.params.id}.zip"`,
      });
      ctx.res.end(bytes);
    }),
};
