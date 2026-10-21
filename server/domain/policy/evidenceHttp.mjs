import { createHash } from "node:crypto";

const SECRET = /^(api[_-]?key|authorization|access[_-]?token|token)$/i;
export function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) if (SECRET.test(key)) url.searchParams.delete(key);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizePayload(value, secret = "") {
  if (Array.isArray(value)) return value.map((item) => sanitizePayload(item, secret));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET.test(key))
        .map(([key, item]) => [key, sanitizePayload(item, secret)]),
    );
  if (typeof value !== "string") return value;
  const clean = /^https?:\/\//i.test(value) ? safeUrl(value) || value : value;
  return secret ? clean.split(secret).join("[redacted]") : clean;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const evidenceHash = (value) => createHash("sha256").update(canonical(value)).digest("hex");
export function observationTime(now = () => new Date()) {
  const date = new Date(typeof now === "function" ? now() : now);
  if (!Number.isFinite(+date)) throw new Error("Invalid evidence observation clock");
  return date.toISOString();
}
export const boundedInt = (value, fallback, max) =>
  Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
function retryAfter(value) {
  if (typeof value !== "string") return null;
  if (/^\d{1,10}$/.test(value)) return value;
  return /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
    value,
  ) && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

async function limitedText(response, maxBytes) {
  if (Number(response.headers?.get("content-length")) > maxBytes) throw new Error("size-limit");
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error("size-limit");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("size-limit");
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Never return raw provider error text: it can echo credentials or request URLs. */
export async function evidenceRequest(url, provider, options = {}) {
  const { signal, now, apiKey = "", fetchImpl = fetch, timeoutMs = 12000 } = options;
  if (signal?.aborted) return { ok: false, status: "cancelled", observedAt: observationTime(now) };
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), boundedInt(timeoutMs, 12000, 30000));
  const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  let abort;
  const interrupted = new Promise((_, reject) => {
    abort = () => reject(new Error("interrupted"));
    requestSignal.addEventListener("abort", abort, { once: true });
  });
  try {
    const response = await Promise.race([
      fetchImpl(url, { signal: requestSignal, headers: { Accept: "application/json" } }),
      interrupted,
    ]);
    if (!response.ok)
      return {
        ok: false,
        status: response.status === 429 ? "rate-limited" : "http-error",
        httpStatus: response.status,
        retryAfter: retryAfter(response.headers?.get("retry-after")),
        observedAt: observationTime(now),
      };
    const text = await Promise.race([limitedText(response, 2_000_000), interrupted]);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, status: "invalid-response", observedAt: observationTime(now) };
    }
    payload = sanitizePayload(payload, apiKey);
    const observedAt = observationTime(now);
    return {
      ok: true,
      status: "ok",
      payload,
      observedAt,
      source: { provider, url: safeUrl(url), observedAt, contentHash: evidenceHash(payload), payload },
    };
  } catch (error) {
    return {
      ok: false,
      status: signal?.aborted
        ? "cancelled"
        : timeout.signal.aborted
          ? "timeout"
          : error.message === "size-limit"
            ? "response-too-large"
            : "network-error",
      observedAt: observationTime(now),
    };
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener("abort", abort);
  }
}

export function preservedObservation(previous, record, observedAt) {
  return (
    previous
      .filter((item) => item.sourceRecordId === record.sourceRecordId && item.sourceHash === record.sourceHash)
      .map((item) => item.firstSeenAt)
      .filter((time) => time && Number.isFinite(Date.parse(time)) && Date.parse(time) <= Date.parse(observedAt))
      .sort()[0] || observedAt
  );
}
