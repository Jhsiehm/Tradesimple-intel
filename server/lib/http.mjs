export async function fetchJson(url, options = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** Delay before retry `attempt` (1-based): exponential with jitter, longer when the server rate-limits. */
export function retryDelay(attempt, status, rand = Math.random) {
  const base = status === 429 ? 5000 : 1500;
  return Math.round(base * 2 ** (attempt - 1) * (0.75 + rand() * 0.5));
}

/** Timeouts, network errors, 429 and 5xx are worth another try; other 4xx are not. */
export function retryable(err) {
  if (!err) return false;
  if (err.name === "AbortError" || err.name === "TimeoutError" || !err.status) return true;
  return err.status === 429 || err.status >= 500;
}

/**
 * At most `concurrency` jobs in flight, started at least `spacingMs` apart. Priority jobs jump the queue,
 * so a user's request is not stuck behind a background warm.
 */
export function makeGate(concurrency, spacingMs) {
  let active = 0;
  let last = 0;
  let timer = null;
  const queue = [];
  const pump = () => {
    while (active < concurrency && queue.length) {
      const wait = last + spacingMs - Date.now();
      if (wait > 0) {
        if (!timer) timer = setTimeout(() => { timer = null; pump(); }, wait);
        return;
      }
      const job = queue.shift();
      active += 1;
      last = Date.now();
      Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { active -= 1; pump(); });
    }
  };
  return (run, { priority = false } = {}) => new Promise((resolve, reject) => {
    queue[priority ? "unshift" : "push"]({ run, resolve, reject });
    pump();
  });
}

/** fetchJson with retries. Errors carry a readable message naming the host and attempts. */
export async function fetchJsonRetry(url, options = {}, { timeoutMs = 30000, retries = 2, gate = null, priority = false } = {}) {
  let last;
  let tried = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    tried += 1;
    try {
      return await (gate ? gate(() => fetchJson(url, options, timeoutMs), { priority }) : fetchJson(url, options, timeoutMs));
    } catch (err) {
      last = err;
      if (attempt === retries || !retryable(err)) break;
      await new Promise((r) => setTimeout(r, retryDelay(attempt + 1, err.status)));
    }
  }
  const host = new URL(url).host;
  const tries = `${tried} attempt${tried > 1 ? "s" : ""}`;
  const why = last?.name === "AbortError" ? `did not answer within ${Math.round(timeoutMs / 1000)} s` : last?.status ? `returned HTTP ${last.status}` : `failed (${last?.message || "network error"})`;
  const err = new Error(`${host} ${why} after ${tries}`);
  err.status = last?.status;
  throw err;
}

/** fetch with a timeout that covers headers and body; the caller reads the Response (cookies, bytes, status). */
export function fetchResponse(url, options = {}, timeoutMs = 20000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

/** Response body as bytes; a non-2xx status throws `HTTP <status>`. */
export async function fetchBytes(url, options = {}, timeoutMs = 60000) {
  const res = await fetchResponse(url, options, timeoutMs);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function fetchText(url, options = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}
