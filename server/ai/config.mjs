import { NOT_CONFIGURED } from "../../shared/ask.mjs";

/**
 * Which model Ask talks to, read from env. The operator names the provider in ASK_PROVIDER, and the key it needs must
 * be set too. One exception: with ASK_PROVIDER empty and only OPENROUTER_API_KEY set (the older Ask sheet's setup),
 * the provider is openrouter.
 *
 *   anthropic   ANTHROPIC_API_KEY                    Messages API
 *   openai      OPENAI_API_KEY                       Chat Completions
 *   compat      ASK_BASE_URL + ASK_API_KEY           any OpenAI-compatible endpoint (AI Gateway, vLLM, LM Studio…)
 *   openrouter  OPENROUTER_API_KEY                   compat preset at openrouter.ai
 *
 * ASK_MODEL overrides the default model (AGENT_MODEL is read as an alias).
 */
const ALIASES = { "openai-compatible": "compat", compatible: "compat", gateway: "compat", vercel: "compat" };
export const DEFAULT_MODEL = { anthropic: "claude-sonnet-4-5", openai: "gpt-4.1", openrouter: "anthropic/claude-sonnet-4.6" };
const DEFAULT_BASE = { anthropic: "https://api.anthropic.com", openai: "https://api.openai.com/v1", openrouter: "https://openrouter.ai/api/v1" };
const KEY_NAME = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", compat: "ASK_API_KEY", openrouter: "OPENROUTER_API_KEY" };
export const PROVIDERS = ["anthropic", "openai", "compat", "openrouter"];

const clean = (v) => String(v ?? "").trim();

/** `{ configured, provider, model, baseUrl, keyName, missing[], error, inferred }`. The key itself is never part of this. */
export function askConfig(env = process.env) {
  const raw = clean(env.ASK_PROVIDER).toLowerCase();
  const inferred = !raw && Boolean(clean(env.OPENROUTER_API_KEY));
  const provider = inferred ? "openrouter" : ALIASES[raw] || raw;
  if (!provider) return { configured: false, provider: "", model: "", baseUrl: "", keyName: "", missing: ["ASK_PROVIDER"], error: NOT_CONFIGURED, inferred };
  if (!PROVIDERS.includes(provider)) return { configured: false, provider, model: "", baseUrl: "", keyName: "", missing: ["ASK_PROVIDER"], error: `ASK_PROVIDER must be one of ${PROVIDERS.join(", ")}.`, inferred };
  const keyName = KEY_NAME[provider];
  const baseUrl = clean(provider === "compat" ? env.ASK_BASE_URL : env.ASK_BASE_URL || DEFAULT_BASE[provider]).replace(/\/+$/, "");
  const model = clean(env.ASK_MODEL) || clean(env.AGENT_MODEL) || DEFAULT_MODEL[provider] || "";
  const missing = [];
  if (!clean(env[keyName])) missing.push(keyName);
  if (provider === "compat" && !baseUrl) missing.push("ASK_BASE_URL");
  if (!model) missing.push("ASK_MODEL");
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) missing.push("ASK_BASE_URL");
  return { configured: missing.length === 0, provider, model, baseUrl, keyName, missing, error: missing.length ? NOT_CONFIGURED : "", inferred };
}

/** Server-side only. Callers pass this to a provider and never log or return it. */
export const askKey = (cfg, env = process.env) => clean(env[cfg.keyName]);
