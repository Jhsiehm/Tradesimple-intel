import { reply } from "../router.mjs";
import { readJson } from "../lib/body.mjs";
import { ASK_LIMITS, NOT_CONFIGURED, cleanAsk, makeLimiter } from "../../shared/ask.mjs";
import { modelOptions, resolveModel, smallModel } from "../../shared/agent.mjs";
import { askConfig, askKey } from "../ai/config.mjs";
import { createProvider } from "../ai/providers.mjs";
import { runAsk } from "../ai/run.mjs";
import { TOOLS, callRoute, labelOf, runTool, toolDefs } from "../ai/tools.mjs";
import { askLog } from "../ai/log.mjs";

export function askStatus(env = process.env) {
  const cfg = askConfig(env);
  const models = cfg.configured ? modelOptions(cfg) : [];
  return {
    ok: true,
    configured: cfg.configured,
    provider: cfg.provider,
    model: cfg.configured ? cfg.model : "",
    small: cfg.configured ? smallModel(cfg.model) : false,
    models: models.map((id) => ({ id, small: smallModel(id) })),
    missing: cfg.missing,
    notice: cfg.configured ? "" : cfg.error || NOT_CONFIGURED,
    tools: TOOLS.map((t) => t.name),
    limits: { toolCalls: ASK_LIMITS.toolCalls, totalSeconds: ASK_LIMITS.totalMs / 1000, tokenBudget: ASK_LIMITS.tokenBudget, perIp: ASK_LIMITS.perIp, perIpMinutes: ASK_LIMITS.perIpWindowMs / 60_000 }
  };
}

const clientOf = (req, env) => {
  const fwd = env.ASK_TRUST_PROXY === "1" ? String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim() : "";
  return fwd || req.socket?.remoteAddress || "local";
};

const runToolTraced = (db, name, args, hooks) => runTool(db, name, args, callRoute, hooks?.onRoute || null);

/** Everything the handler touches is injectable: env, the provider factory, the clock, the limiter, the log. */
export function makeAskHandler({ env = process.env, makeProvider = (cfg) => createProvider(cfg, askKey(cfg, env)), now = Date.now, limiter = makeLimiter({ max: ASK_LIMITS.perIp, windowMs: ASK_LIMITS.perIpWindowMs }), log = askLog, execute = runToolTraced } = {}) {
  let running = 0;
  return async ({ req, res, db }) => {
    if (!req || req.method !== "POST") return askStatus(env);
    const cfg = askConfig(env);
    if (!cfg.configured) return reply(503, { ok: false, error: cfg.error || NOT_CONFIGURED, missing: cfg.missing.join(","), notConfigured: true });
    const body = await readJson(req, 32 * 1024);
    if (!body.ok) return reply(body.status, { ok: false, error: body.error, missing: "" });
    const asked = cleanAsk(body.value);
    if (!asked.ok) return reply(400, { ok: false, error: asked.error, missing: "" });
    const client = clientOf(req, env);
    const slot = limiter.take(client, now());
    if (!slot.ok) return reply(429, { ok: false, error: `Ask is limited to ${ASK_LIMITS.perIp} questions per ${ASK_LIMITS.perIpWindowMs / 60_000} minutes. Try again in ${Math.ceil(slot.retryMs / 60_000)} min.`, missing: "", retryMs: slot.retryMs });
    if (running >= ASK_LIMITS.concurrent) return reply(429, { ok: false, error: "Ask is answering other questions. Try again in a moment.", missing: "" });

    const model = resolveModel(asked.model, cfg);
    running += 1;
    const ctl = new AbortController();
    res.on("close", () => ctl.abort());
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const emit = (event) => { if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
    log({ event: "ask", question: asked.question.slice(0, 160), provider: cfg.provider, model, context: asked.context?.node || (asked.context?.theory ? "theory" : ""), attached: Boolean(asked.attached) });
    try {
      const out = await runAsk({
        question: asked.question,
        history: asked.history,
        context: asked.context,
        attached: asked.attached,
        prefs: asked.prefs,
        prior: asked.prior,
        answers: asked.answers,
        acceptDefaults: asked.acceptDefaults,
        model,
        provider: makeProvider({ ...cfg, model }),
        tools: toolDefs(),
        execute: (name, args, hooks) => execute(db, name, args, hooks),
        labelOf,
        emit,
        signal: ctl.signal,
        log,
        now
      });
      if (out?.modelCalled === false) limiter.refund?.(client);
    } catch (err) {
      emit({ type: "error", code: "internal", error: err?.message || "Ask failed." });
    } finally {
      running -= 1;
      if (!res.writableEnded) res.end();
    }
    return undefined;
  };
}

export const handlers = { ask: makeAskHandler() };
