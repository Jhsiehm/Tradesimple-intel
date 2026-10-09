import { askConfig, askKey } from "./config.mjs";
import { createProvider } from "./providers.mjs";
import { runAsk } from "./run.mjs";
import { callRoute, labelOf, runTool, toolDefs } from "./tools.mjs";
import { askLog } from "./log.mjs";
import { metered, spendState } from "./spend.mjs";
import { blankTurn, collectEvent, promptLabels } from "../domain/tasks/results.mjs";

/** The model a scheduled prompt uses: ASK_STRONG_MODEL when set, else the Ask default. */
export const taskModel = (cfg, env = process.env) => String(env.ASK_STRONG_MODEL || "").trim() || cfg.model;

/**
 * One scheduled free-form prompt through the same pipeline as POST /api/ask, with no browser on the other end: the
 * events are folded into a stored turn. Chips are settled with defaults (`acceptDefaults`) since nobody can pick one.
 */
export async function runPromptTask({ db, task, env = process.env, now = Date.now, signal, makeProvider = (cfg) => createProvider(cfg, askKey(cfg, env)), execute = runTool }) {
  const cfg = askConfig(env);
  if (!cfg.configured) return { ok: false, skipped: true, error: cfg.error || "Ask is not configured — add a key to .env.local" };
  // Scheduled runs count toward the monthly Ask budget and follow its fallback and hard stop.
  const spend = spendState(db, env, now(), cfg.provider);
  if (spend?.level === "stop") return { ok: false, skipped: true, error: spend.note };
  const model = spend?.level === "over" && spend.cheap ? spend.cheap : taskModel(cfg, env);
  const startedAt = now();
  const turn = { ...blankTurn(task.prompt, startedAt), model };
  if (spend?.note) collectEvent(turn, { type: "plan_note", note: spend.note });
  askLog({ event: "task_ask", task: task.id, question: task.prompt.slice(0, 160), provider: cfg.provider, model, budget: spend?.level || "" });
  try {
    await runAsk({
      question: task.prompt,
      model,
      provider: metered(makeProvider({ ...cfg, model }), { db, kind: "task", askId: task.id, now }),
      tools: toolDefs("both"),
      execute: (name, args, hooks) => execute(db, name, args, callRoute, hooks?.onRoute || null),
      labelOf,
      emit: (e) => collectEvent(turn, e),
      acceptDefaults: true,
      signal,
      log: askLog,
      now
    });
  } catch (err) {
    collectEvent(turn, { type: "error", error: err?.message || "Ask failed." });
  }
  if (turn.phase !== "done" && turn.phase !== "error") collectEvent(turn, { type: "error", error: "The answer stopped before it finished." });
  const finishedAt = now();
  return { ok: turn.phase === "done", error: turn.error, turn, model, ...promptLabels(turn, { startedAt, finishedAt, model }) };
}
