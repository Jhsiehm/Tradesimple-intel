import { sseEvents } from "./sse.mjs";

/**
 * Provider adapters. Each one is `{ name, model, chat(messages, tools, opts) }` where `chat` is an async generator of
 *   { type: "text", delta }
 *   { type: "tool_call", id, name, args }       args is an object ({} when the model sent none, null when it was not JSON)
 *   { type: "usage", input, output, cost? }     tokens, when the provider reports them; cost in USD (OpenRouter)
 *   { type: "end", reason }                     "stop" | "tool_calls" | "length"
 * Messages are neutral: { role: "system"|"user"|"assistant"|"tool", content, toolCalls?, toolCallId?, name? } and
 * tools are { name, description, parameters }. The key stays in a header and is scrubbed from any error text.
 */

export class ProviderError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

const scrub = (s, key) => (key ? String(s ?? "").split(key).join("[key]") : String(s ?? ""));

function parseJson(raw) {
  if (raw && typeof raw === "object") return raw;
  const s = String(raw ?? "").trim();
  if (!s) return {};
  try { return JSON.parse(s); } catch { return null; }
}

async function failure(res, key, who) {
  let body = "";
  try { body = await res.text(); } catch { body = ""; }
  let detail = "";
  try {
    const j = JSON.parse(body);
    const e = j?.error;
    detail = typeof e === "string" ? e : [e?.message, e?.type].filter(Boolean).join(": ") || j?.message || "";
  } catch { detail = body.replace(/<[^>]+>/g, " "); }
  detail = scrub(detail, key).replace(/\s+/g, " ").trim().slice(0, 200);
  return new ProviderError(`${who} returned ${res.status}${detail ? `: ${detail}` : " with no error text"}.`, res.status);
}

async function post(fetchFn, url, headers, payload, signal, key, who) {
  let res;
  try {
    res = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(payload), signal });
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") throw new ProviderError(`${who} did not answer in time.`, 0);
    throw new ProviderError(`${who} could not be reached: ${scrub(err?.message || "network error", key)}`, 0);
  }
  if (!res.ok) throw await failure(res, key, who);
  return res;
}

/* ---------- OpenAI chat completions (OpenAI, OpenRouter, AI Gateway, any compatible server) ---------- */

export function toOpenAI(messages) {
  return messages.map((m) => {
    if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } }))
      };
    }
    return { role: m.role, content: m.content };
  });
}

export function openaiProvider({ baseUrl, key, model, name = "openai", usage = true, fetchFn = fetch }) {
  const who = name === "openrouter" ? "OpenRouter" : name === "openai" ? "OpenAI" : "The model endpoint";
  return {
    name,
    model,
    async *chat(messages, tools, { signal, maxTokens, noTools } = {}) {
      const payload = { model, messages: toOpenAI(messages), stream: true, temperature: 0.2, ...(maxTokens ? { max_tokens: maxTokens } : {}) };
      if (tools?.length) payload.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      if (tools?.length && noTools) payload.tool_choice = "none";
      if (usage) payload.stream_options = { include_usage: true };
      if (usage && name === "openrouter") payload.usage = { include: true };
      const res = await post(fetchFn, `${baseUrl}/chat/completions`, { authorization: `Bearer ${key}` }, payload, signal, key, who);
      const calls = new Map();
      let reason = "stop";
      for await (const ev of sseEvents(res.body)) {
        if (ev.data === "[DONE]") break;
        let j;
        try { j = JSON.parse(ev.data); } catch { continue; }
        if (j.error) throw new ProviderError(`${who} stream error: ${scrub(j.error.message || JSON.stringify(j.error), key).slice(0, 200)}`, 0);
        if (j.usage) yield { type: "usage", input: j.usage.prompt_tokens || 0, output: j.usage.completion_tokens || 0, ...(typeof j.usage.cost === "number" ? { cost: j.usage.cost } : {}) };
        const choice = j.choices?.[0];
        if (!choice) continue;
        const d = choice.delta || {};
        if (d.content) yield { type: "text", delta: d.content };
        for (const tc of d.tool_calls || []) {
          const at = tc.index ?? 0;
          const cur = calls.get(at) || { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(at, cur);
        }
        if (choice.finish_reason) reason = choice.finish_reason === "tool_calls" || choice.finish_reason === "function_call" ? "tool_calls" : choice.finish_reason === "length" ? "length" : "stop";
      }
      for (const [at, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
        if (c.name) yield { type: "tool_call", id: c.id || `call_${at}`, name: c.name, args: parseJson(c.args) };
      }
      yield { type: "end", reason: calls.size ? "tool_calls" : reason };
    }
  };
}

/* ---------- Anthropic Messages ---------- */

export function toAnthropic(messages) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const out = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) last.content.push(block);
      else out.push({ role: "user", content: [block] });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      const content = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const c of m.toolCalls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.args ?? {} });
      out.push({ role: "assistant", content });
    } else {
      const last = out[out.length - 1];
      if (m.role === "user" && last && last.role === "user" && Array.isArray(last.content)) last.content.push({ type: "text", text: m.content });
      else out.push({ role: m.role, content: m.content });
    }
  }
  return { system, messages: out };
}

export function anthropicProvider({ baseUrl, key, model, name = "anthropic", fetchFn = fetch }) {
  return {
    name,
    model,
    async *chat(messages, tools, { signal, maxTokens = 1400, noTools } = {}) {
      const { system, messages: conv } = toAnthropic(messages);
      const payload = { model, max_tokens: maxTokens, temperature: 0.2, stream: true, system, messages: conv };
      if (tools?.length) payload.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
      if (tools?.length && noTools) payload.tool_choice = { type: "none" };
      const res = await post(fetchFn, `${baseUrl}/v1/messages`, { "x-api-key": key, "anthropic-version": "2023-06-01" }, payload, signal, key, "Anthropic");
      const blocks = new Map();
      let reason = "stop";
      let input = 0;
      let output = 0;
      for await (const ev of sseEvents(res.body)) {
        let j;
        try { j = JSON.parse(ev.data); } catch { continue; }
        const type = j.type || ev.event;
        if (type === "error") throw new ProviderError(`Anthropic stream error: ${scrub(j.error?.message || "unknown", key).slice(0, 200)}`, 0);
        if (type === "message_start") input = j.message?.usage?.input_tokens || 0;
        else if (type === "content_block_start") {
          const b = j.content_block || {};
          blocks.set(j.index, b.type === "tool_use" ? { tool: true, id: b.id, name: b.name, json: "" } : { tool: false });
        } else if (type === "content_block_delta") {
          const d = j.delta || {};
          if (d.type === "text_delta" && d.text) yield { type: "text", delta: d.text };
          else if (d.type === "input_json_delta") {
            const cur = blocks.get(j.index);
            if (cur?.tool) cur.json += d.partial_json || "";
          }
        } else if (type === "message_delta") {
          output = j.usage?.output_tokens ?? output;
          if (j.delta?.stop_reason) reason = j.delta.stop_reason === "tool_use" ? "tool_calls" : j.delta.stop_reason === "max_tokens" ? "length" : "stop";
        }
      }
      for (const [, b] of [...blocks.entries()].sort((a, c) => a[0] - c[0])) {
        if (b.tool) yield { type: "tool_call", id: b.id, name: b.name, args: parseJson(b.json) };
      }
      if (input || output) yield { type: "usage", input, output };
      yield { type: "end", reason };
    }
  };
}

/** Build the adapter `askConfig` describes. `fetchFn` is injected so tests never touch the network. */
export function createProvider(cfg, key, fetchFn = fetch) {
  if (cfg.provider === "anthropic") return anthropicProvider({ baseUrl: cfg.baseUrl, key, model: cfg.model, fetchFn });
  if (cfg.provider === "openai") return openaiProvider({ baseUrl: cfg.baseUrl, key, model: cfg.model, name: "openai", fetchFn });
  return openaiProvider({ baseUrl: cfg.baseUrl, key, model: cfg.model, name: cfg.provider, usage: cfg.provider === "openrouter", fetchFn });
}
