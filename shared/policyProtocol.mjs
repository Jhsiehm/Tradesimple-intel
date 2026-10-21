const EVENT_TYPES = new Set(["vote", "markup", "introduced", "passed", "enacted"]);
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,14}$/;
const BILL = /^(hr|s|hjres|sjres|hconres|sconres|hres|sres)-\d{1,3}-\d{1,6}$/;
export const POLICY_PROTOCOL_VERSION = 1;
export function policyDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function policyInstant(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && policyDate(value.slice(0, 10)) ? ms : null;
}
function text(value, min, max) {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}
function uniqueStrings(value, min, max, pattern, normalize = (s) => s) {
  if (!Array.isArray(value) || value.length < min || value.length > max || value.some((v) => typeof v !== "string"))
    return null;
  const cleaned = value.map((v) => normalize(v.trim()));
  return cleaned.every((v) => pattern.test(v)) && new Set(cleaned).size === cleaned.length ? cleaned : null;
}
/** Registration time comes from the server, never an asserted client timestamp. */
export function cleanPolicyProtocol(input, { now = new Date(), registeredAt } = {}) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("A study protocol object is required.");
    if (input.schemaVersion !== POLICY_PROTOCOL_VERSION) throw new Error("schemaVersion must be 1.");
    if (!text(input.title, 3, 200) || !text(input.question, 10, 6000))
      throw new Error("Provide a title (3–200 characters) and question (10–6000 characters).");
    const nowAt = new Date(now).toISOString();
    if (
      !policyDate(input.from) ||
      !policyDate(input.to) ||
      input.from > input.to ||
      input.to > new Date(Date.parse(nowAt) + 366 * 86400000).toISOString().slice(0, 10)
    )
      throw new Error(
        "Study dates must be valid, ordered calendar dates, with a planned end no more than 366 days after registration.",
      );
    if (!policyDate(input.holdoutFrom) || input.holdoutFrom <= input.from || input.holdoutFrom > input.to)
      throw new Error("holdoutFrom must be after from and no later than to.");
    const billIds = uniqueStrings(input.billIds, 1, 100, BILL, (s) => s.toLowerCase());
    const universe = uniqueStrings(input.universe, 1, 100, SYMBOL, (s) => s.toUpperCase());
    if (!billIds || !universe)
      throw new Error("Supply 1–100 unique bill IDs (for example hr-119-1968) and security symbols.");
    if (
      !Array.isArray(input.eventTypes) ||
      !input.eventTypes.length ||
      input.eventTypes.length > EVENT_TYPES.size ||
      new Set(input.eventTypes).size !== input.eventTypes.length ||
      input.eventTypes.some((v) => !EVENT_TYPES.has(v))
    )
      throw new Error("eventTypes must contain unique supported legislative event types.");
    const benchmark = typeof input.benchmark === "string" ? input.benchmark.trim().toUpperCase() : "";
    const sectorBenchmark =
      input.sectorBenchmark == null || input.sectorBenchmark === ""
        ? null
        : String(input.sectorBenchmark).trim().toUpperCase();
    if (benchmark !== "SPY" || (sectorBenchmark !== null && !SYMBOL.test(sectorBenchmark)))
      throw new Error("benchmark must be SPY; sectorBenchmark must be a security symbol or null.");
    for (const [name, min, max] of [
      ["latencySeconds", 0, 3600],
      ["holdingMinutes", 1, 390],
      ["costBps", 0, 1000],
    ]) {
      if (
        typeof input[name] !== "number" ||
        !Number.isFinite(input[name]) ||
        input[name] < min ||
        input[name] > max ||
        (name !== "costBps" && !Number.isInteger(input[name]))
      )
        throw new Error(`${name} must be a finite ${name === "costBps" ? "number" : "integer"} from ${min} to ${max}.`);
    }
    if (!text(input.newsArchive, 1, 100) || !["publication", "archive-first-seen"].includes(input.newsTimeBasis))
      throw new Error("Specify a named newsArchive and newsTimeBasis: publication or archive-first-seen.");
    const registration = registeredAt ?? nowAt;
    if (policyInstant(registration) === null || Date.parse(registration) > Date.parse(nowAt))
      throw new Error("Server registration time must be a valid instant no later than now.");
    return {
      ok: true,
      protocol: {
        schemaVersion: 1,
        title: input.title.trim(),
        question: input.question.trim(),
        billIds,
        from: input.from,
        to: input.to,
        universe,
        eventTypes: [...input.eventTypes],
        benchmark,
        sectorBenchmark,
        latencySeconds: input.latencySeconds,
        holdingMinutes: input.holdingMinutes,
        costBps: input.costBps,
        holdoutFrom: input.holdoutFrom,
        newsArchive: input.newsArchive.trim(),
        newsTimeBasis: input.newsTimeBasis,
        registeredAt: new Date(registration).toISOString(),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid study protocol." };
  }
}
