/** Only OS essentials pass into test servers; app credentials and settings are always explicit. */
export function serverEnv(overrides = {}) {
  const env = Object.fromEntries(["PATH", "SystemRoot", "HOME", "TMPDIR", "TMP", "TEMP"]
    .filter((key) => process.env[key] != null).map((key) => [key, process.env[key]]));
  return { ...env, INTEL_TEST: "1", INTEL_NO_WARM: "1", ...overrides };
}
