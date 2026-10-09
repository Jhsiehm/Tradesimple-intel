/**
 * Ask spend, pure: what a model call costs, the month it counts toward (US Eastern), and where this month stands
 * against the budget. The server keeps the ledger; nothing here reads env, the clock, or the network.
 */
import { etParts } from "./taskSchedule.mjs";

/** USD per million tokens, [input, output], list prices. First match wins; used when the provider reports no cost. */
export const PRICES = [
  [/opus-4[.-]?[5-9]|opus-[5-9]/i, 5, 25],
  [/opus/i, 15, 75],
  [/sonnet/i, 3, 15],
  [/haiku-?4|haiku-[5-9]/i, 1, 5],
  [/haiku/i, 0.8, 4],
  [/gpt-4o-mini/i, 0.15, 0.6],
  [/gpt-4o/i, 2.5, 10],
  [/gpt-4\.1-nano/i, 0.1, 0.4],
  [/gpt-4\.1-mini/i, 0.4, 1.6],
  [/gpt-4\.1/i, 2, 8],
  [/gpt-5[\w.]*-nano/i, 0.05, 0.4],
  [/gpt-5[\w.]*-mini/i, 0.25, 2],
  [/gpt-5/i, 1.25, 10],
  [/gemini-[\d.]+-flash-lite/i, 0.1, 0.4],
  [/gemini-[\d.]+-flash/i, 0.3, 2.5],
  [/gemini-[\d.]+-pro/i, 1.25, 10]
];
/** A model the table does not know is priced like Sonnet, so an estimate errs high. */
export const FALLBACK_PRICE = [3, 15];
export const BUDGET_DEFAULT_USD = 20;
export const WARN_AT = 0.8;
/** The model Ask falls back to once the month's budget is spent, per provider (ASK_CHEAP_MODEL overrides). */
export const CHEAP_MODEL = { openrouter: "openai/gpt-4o-mini", anthropic: "claude-haiku-4-5", openai: "gpt-4.1-mini" };

/** `{ input, output, known }` in USD per million tokens. */
export function priceOf(model) {
  const id = String(model || "");
  const hit = PRICES.find(([re]) => re.test(id));
  return hit ? { input: hit[1], output: hit[2], known: true } : { input: FALLBACK_PRICE[0], output: FALLBACK_PRICE[1], known: false };
}

/**
 * What one call cost. `cost` is the provider's own figure (OpenRouter reports it in USD); without it the price table
 * prices the tokens. `priced`: "reported" | "table" | "fallback".
 */
export function callCost({ model, input = 0, output = 0, cost } = {}) {
  if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) return { usd: cost, priced: "reported" };
  const p = priceOf(model);
  const usd = (Math.max(0, Number(input) || 0) * p.input + Math.max(0, Number(output) || 0) * p.output) / 1e6;
  return { usd, priced: p.known ? "table" : "fallback" };
}

/** "2026-10" for the month New York is in at `ms`. */
export function monthKey(ms) {
  const p = etParts(ms);
  return `${p.y}-${String(p.m).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 1": the day the budget resets. */
export function resetDay(month) {
  const m = Number(String(month).slice(5, 7)) || 1;
  return `${MONTHS[m % 12]} 1`;
}

/** Budget settings from env-shaped values: `{ budget, hardStop, cheap }`. A budget of 0 turns the cap off. */
export function budgetSettings(env = {}, provider = "") {
  const raw = String(env.ASK_MONTHLY_BUDGET_USD ?? "").trim();
  const n = raw === "" ? BUDGET_DEFAULT_USD : Number(raw);
  const budget = Number.isFinite(n) && n >= 0 ? n : BUDGET_DEFAULT_USD;
  const hardStop = /^(1|true|yes|on)$/i.test(String(env.ASK_BUDGET_HARD_STOP ?? "").trim());
  const cheap = String(env.ASK_CHEAP_MODEL ?? "").trim() || CHEAP_MODEL[provider] || "";
  return { budget, hardStop, cheap };
}

/**
 * Where the month stands. `level`: "ok"; "warn" from 80%; "over" at 100% (everything runs on the cheap model);
 * "stop" at 100% with the hard stop on (Ask refuses new questions).
 */
export function budgetLevel({ spent = 0, budget = BUDGET_DEFAULT_USD, hardStop = false } = {}) {
  if (!(budget > 0)) return { level: "ok", pct: 0 };
  const pct = spent / budget;
  if (pct >= 1) return { level: hardStop ? "stop" : "over", pct };
  return { level: pct >= WARN_AT ? "warn" : "ok", pct };
}

const usd = (v) => `$${(Number(v) || 0).toFixed(Number(v) >= 100 ? 0 : 2)}`;

/** The sentence an answer carries when the budget matters, or "". */
export function budgetNote({ level, spent, budget, cheap, month }) {
  const of = `${usd(spent)} of the ${usd(budget)} monthly Ask budget`;
  if (level === "stop") return `Ask is paused: ${of} is spent (ASK_BUDGET_HARD_STOP is on). It resets ${resetDay(month)}.`;
  if (level === "over") return `${of} is spent, so every answer uses ${cheap || "the cheap model"} until ${resetDay(month)}. Answers may be less thorough.`;
  if (level === "warn") return `Ask has used ${of} (${Math.round((spent / budget) * 100)}%). At 100% every answer moves to ${cheap || "the cheap model"}.`;
  return "";
}

/** "$3.21 of $20 this month" for the sheet header; "" with no spend record. */
export function spendLine(spend) {
  if (!spend) return "";
  if (!(spend.budget > 0)) return `${usd(spend.spent)} this month · no cap`;
  return `${usd(spend.spent)} of ${usd(spend.budget)} this month`;
}
