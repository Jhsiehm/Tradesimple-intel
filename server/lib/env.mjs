import fs from "node:fs";
import path from "node:path";

export function loadEnv(root) {
  const file = path.join(root, ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

/** False when INTEL_NO_WARM is set (tests, offline runs): no scheduled or on-demand background builds. */
export function warmEnabled() {
  return !process.env.INTEL_NO_WARM;
}

/**
 * Start spacing for an upstream gate. INTEL_TEST=1 (the offline smoke test, where every fetch fails at once)
 * drops it to 0 so failing requests are not paced; concurrency limits stay. Read at module load.
 */
export function gateSpacing(ms) {
  return process.env.INTEL_TEST === "1" ? 0 : ms;
}
