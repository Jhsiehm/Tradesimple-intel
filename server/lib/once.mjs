const inflight = new Map();

/** Share one in-flight promise per key; the slot clears when it settles. */
export function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const job = fn().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
