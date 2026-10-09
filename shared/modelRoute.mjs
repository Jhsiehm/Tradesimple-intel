/**
 * Which model answers a turn, pure. The sheet sends "auto" (the default) or a model the user pinned. Under Auto a
 * greeting or a simple lookup uses the server's model, and heavy work (backtests, several sources, web research, the
 * revision pass) uses the strong model. A pinned model is never overridden; the server still checks it is allowed.
 */
import { resolveModel, smallModel } from "./agent.mjs";

export const AUTO = "auto";

/** Words that name one of the terminal's sources; two or more in one question make it a multi-source question. */
const SOURCES = [
  /\b(congress(ional)?|senators?|representatives?|house members?|ptrs?|disclosures?)\b/i,
  /\b(form ?4|insiders?)\b/i,
  /\b(contracts?|usaspending|awards?)\b/i,
  /\blobby(ing|ists?)?\b/i,
  /\b(prices?|returns?|spy|benchmark)\b/i,
  /\b(bills?|votes?|committees?|hearings?)\b/i
];
const ALL_SOURCES = /\b(all|every|each|multiple|several) (of the )?(data )?(sources|feeds)\b|\bcross-?reference\b/i;

/**
 * Why a question is heavy, or "". `backtest` / `web` are what the server already planned for the turn (a backtest
 * plan or re-runs; a web or world-markets pre-run).
 */
export function heavyReason({ question = "", backtest = false, web = false } = {}) {
  if (backtest) return "backtest";
  if (web) return "web research";
  const q = String(question || "");
  if (ALL_SOURCES.test(q) || SOURCES.filter((re) => re.test(q)).length >= 2) return "multi-source";
  return "";
}

/**
 * `{ model, auto, pinned }` for what the sheet asked for. "auto", empty, or a model the server does not offer is Auto
 * (the server's model until the turn turns out heavy); an allowed id is pinned.
 */
export function routeModel(requested, cfg) {
  const want = typeof requested === "string" ? requested.trim() : "";
  if (want && want.toLowerCase() !== AUTO) {
    const model = resolveModel(want, cfg);
    if (model === want) return { model, auto: false, pinned: true };
  }
  return { model: String(cfg?.model || ""), auto: true, pinned: false };
}

/** The model a turn ends up on: the strong one under Auto when the turn is heavy, otherwise the routed one. */
export function turnModel(route, strong, reason) {
  return route.auto && reason && strong ? strong : route.model;
}

/** Whether to show the one-time nudge: the saved choice is a pinned small model. */
export function nudgeToAuto(choice) {
  const c = String(choice || "").trim();
  return Boolean(c) && c.toLowerCase() !== AUTO && smallModel(c);
}

/** "anthropic/claude-sonnet-4.6" → "Sonnet 4.6", "openai/gpt-4.1-mini" → "GPT-4.1 mini", "google/gemini-2.5-pro" → "Gemini 2.5 Pro". */
export function modelShort(id) {
  const base = String(id || "").split("/").pop().replace(/:.*$/, "");
  if (!base) return "";
  const claude = base.match(/^claude-(?:(\d+(?:[.-]\d+)?)-)?(opus|sonnet|haiku)(?:-(\d+(?:[.-]\d+)?))?/i);
  if (claude) {
    const v = (claude[3] || claude[1] || "").replace("-", ".");
    return `${claude[2][0].toUpperCase()}${claude[2].slice(1).toLowerCase()}${v ? ` ${v}` : ""}`;
  }
  const gpt = base.match(/^gpt-([\w.]+?)(?:-(mini|nano|turbo))?$/i);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].toLowerCase()}` : ""}`;
  return base.split("-").map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
}
