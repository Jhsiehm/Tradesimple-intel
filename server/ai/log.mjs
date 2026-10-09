import { appendFileSync } from "node:fs";

export const LOG_FILE = "/tmp/intel-ask.log";

/** One JSON line per tool call or error. Question text is cut short; keys never reach here. Off under INTEL_TEST=1. */
export function askLog(entry, file = LOG_FILE) {
  if (process.env.INTEL_TEST === "1") return;
  try {
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch { /* a full disk must not break an answer */ }
}
