/**
 * When the API restarts (`node --watch` reloads it on every server save), requests fail for a second or two:
 * the browser cannot connect, or the Vite proxy answers 502 (Ask) or an empty 500 (everything else).
 * These helpers decide whether a failure looks like that and how long to wait. No fetch, no timers.
 */

export type Failure = {
  /** HTTP status, when a response came back. */
  status?: number;
  /** Response body text, possibly empty. */
  body?: string;
  /** The thrown error, when fetch itself failed. */
  error?: unknown;
};

const NETWORK = /failed to fetch|fetch failed|networkerror|load failed|econnrefused|econnreset|socket hang up|network connection was lost/i;
const PROXY_DOWN = /refused the connection|is it restarting|connection dropped|econnrefused|econnreset|socket hang up/i;

/** True when the failure looks like the API process is down or restarting, not like a real error from it. */
export function isRestart(f: Failure): boolean {
  if (f.error != null) {
    if (f.error instanceof Error && f.error.name === "AbortError") return false;
    const msg = f.error instanceof Error ? `${f.error.name} ${f.error.message}` : String(f.error);
    return NETWORK.test(msg);
  }
  const status = f.status ?? 0;
  const body = (f.body || "").trim();
  if (status === 503 || status === 504) return !/timed out/i.test(body);
  if (status === 502) return !body || PROXY_DOWN.test(body) || !body.startsWith("{");
  // Vite's generic proxy answers an empty (or plain-text) 500 when the target refuses the connection.
  if (status === 500) return !body || (!body.startsWith("{") && NETWORK.test(body)) || /^internal server error$/i.test(body);
  return false;
}

/** Waits before each health poll: 1 s, 2 s, 4 s, … capped per wait, stopping once the total would pass the budget. */
export function retryDelays(budgetMs = 30_000, firstMs = 1_000, capMs = 8_000): number[] {
  const out: number[] = [];
  let total = 0;
  let next = firstMs;
  while (next > 0 && total + next <= budgetMs) {
    out.push(next);
    total += next;
    next = Math.min(capMs, next * 2);
  }
  const rest = budgetMs - total;
  if (rest >= firstMs) out.push(rest);
  return out;
}

/**
 * Ask resends a question at most once, and only while no answer text arrived: a stream that already
 * wrote tokens (or finished) would be answered twice.
 */
export function mayResend(seen: { tokens: number; done: boolean; resent: boolean }): boolean {
  return !seen.resent && !seen.done && seen.tokens === 0;
}
