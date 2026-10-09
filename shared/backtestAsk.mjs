/**
 * Backtests asked in plain words, pure. What a question says about the spec, the user's saved preferences, the
 * clarifying chips worth asking (only for result-changing fields nothing else settles), the spec a run starts from
 * with where each field came from, and what changed against the previous run. No env, no clock, no storage.
 */
import { BENCHMARKS, DEFAULT_FILTERS, DEFAULT_RULES, SOURCES, SOURCE_LABEL, cleanSpec } from "./backtestSpec.mjs";

export const PREFS_VERSION = 1;
export const PREFS_KEY = "intel:ask:prefs:v1";

/** Spec fields a preference may set, as "rules.x" / "filters.x" paths, with a plain label. */
export const PREF_FIELDS = {
  "rules.holdDays": "Hold",
  "rules.benchmark": "Benchmark",
  "rules.sides": "Sides",
  "rules.sizing": "Sizing",
  "rules.entry": "Entry",
  "rules.costBps": "Commission",
  "rules.slippageBps": "Slippage",
  "filters.include10b51": "10b5-1 plans",
  "filters.nearHearingDays": "Near a hearing",
  "filters.contractLagDays": "Contract lag"
};

const lc = (s) => String(s ?? "").toLowerCase();
const DAY_MS = 86_400_000;
const minus = (today, n) => new Date(Date.parse(`${today}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);

/** Hold, benchmark, sides, sizing, entry, costs, 10b5-1, hearing window, contract lag: what plain words set. */
function parseRuleWords(q) {
  const s = lc(q);
  const out = {};
  const hold = s.match(/\b(\d{1,3})[- ]?(day|d|week|wk|month|mo)s?\b[^.,;]{0,12}\bhold|\bhold(?:ing)?(?: (?:for|period of))? (\d{1,3})[- ]?(day|d|week|wk|month|mo)s?\b|\bhold(?:ing)?(?: for)? (?:a|one|1) (year|quarter|month)\b|\b(\d{1,3})[- ]?(day|week|month)s?[- ]holds?\b/);
  if (hold) {
    const n = Number(hold[1] || hold[3] || hold[6] || 1);
    const unit = hold[2] || hold[4] || hold[5] || hold[7] || "day";
    out["rules.holdDays"] = /^y/.test(unit) ? 365 : /^q/.test(unit) ? 90 : /^(w|wk)/.test(unit) ? n * 7 : /^(mo|month)/.test(unit) ? (hold[5] ? 30 : n * 30) : n;
  }
  if (/\bsector (etf|benchmark)s?\b|\bvs\.? (the )?sector\b|\bcompare (it )?to (the )?sector/.test(s)) out["rules.benchmark"] = "SECTOR";
  else if (/\^gspc|\bs&p (500 )?index\b|price index/.test(s)) out["rules.benchmark"] = "^GSPC";
  else if (/\b(vs\.?|versus|against|compared? to|benchmark(ed)?( to| against)?)\s+(the\s+)?(spy|s&p|s&p 500|sp500|the market)\b/.test(s)) out["rules.benchmark"] = "SPY";
  else {
    const etf = s.match(/\b(vs\.?|versus|against)\s+(xl[a-z]{1,2})\b/);
    if (etf && BENCHMARKS.includes(etf[2].toUpperCase())) out["rules.benchmark"] = etf[2].toUpperCase();
  }
  if (/\bbuys? only\b|\bonly (the )?(buys|purchases)\b|\bjust buys\b/.test(s)) out["rules.sides"] = "buy";
  else if (/\bsells? only\b|\bonly (the )?sells\b|\bshort (the )?sells\b/.test(s)) out["rules.sides"] = "sell";
  else if (/\bboth sides\b|\bbuys and sells\b/.test(s)) out["rules.sides"] = "both";
  if (/\bequal[- ]weight/.test(s)) out["rules.sizing"] = "equal";
  else if (/\b(mid ?point|size[- ]weight|weight(ed)? by (size|amount))/.test(s)) out["rules.sizing"] = "amountMid";
  if (/\b(enter|entry|buy) (at|on) the (next )?close\b/.test(s)) out["rules.entry"] = "nextClose";
  else if (/\b(enter|entry|buy) (at|on) the (next )?open\b/.test(s)) out["rules.entry"] = "nextOpen";
  const cost = s.match(/\b(\d{1,3}(?:\.\d+)?) ?bps? (of )?(costs?|commissions?|fees?)\b|\b(costs?|commissions?|fees?) (of )?(\d{1,3}(?:\.\d+)?) ?bps?\b/);
  if (cost) out["rules.costBps"] = Number(cost[1] || cost[6]);
  const slip = s.match(/\b(\d{1,3}(?:\.\d+)?) ?bps? (of )?slippage\b|\bslippage (of )?(\d{1,3}(?:\.\d+)?) ?bps?\b/);
  if (slip) out["rules.slippageBps"] = Number(slip[1] || slip[4]);
  if (/\b(exclude|excluding|without|no|drop|skip)\s+10b5-?1\b/.test(s)) out["filters.include10b51"] = false;
  else if (/\b(include|including|with|keep)\s+10b5-?1\b/.test(s)) out["filters.include10b51"] = true;
  const near = s.match(/\bwithin (\d{1,2}) ?(days?|d) of an? (committee )?hearing/);
  if (near) out["filters.nearHearingDays"] = Number(near[1]);
  const lag = s.match(/\b(\d{1,3}) ?(days?|d) (publication |posting )?lag\b|\blag of (\d{1,3}) ?days?\b/);
  if (lag) out["filters.contractLagDays"] = Number(lag[1] || lag[4]);
  return out;
}

/** "I usually want…", "my defaults are…", "remember…": a preference statement, not a question to answer. */
export function isPrefStatement(q) {
  return /\b(i usually|i (always|normally|generally) (want|use|like)|i prefer|my (default|preference)s?|by default|save (these|this|that) as (my )?defaults?|remember (that|this|my)|set (my )?defaults?)\b/i.test(String(q || "")) && Object.keys(parseRuleWords(q)).length > 0;
}

export const isPrefClear = (q) => /\b(clear|forget|reset|delete) (all )?(my )?(backtest )?(preferences|defaults|prefs)\b/i.test(String(q || ""));

/** Preference values a statement sets, by path. */
export const parsePrefs = (q) => parseRuleWords(q);

/** Stored preferences, cleaned: `{ v, values, updated }`. Unknown paths and bad values are dropped. */
export function cleanPrefs(raw) {
  const src = raw && typeof raw === "object" && raw.v === PREFS_VERSION && raw.values && typeof raw.values === "object" ? raw.values : {};
  const values = {};
  for (const [path, v] of Object.entries(src)) {
    if (!(path in PREF_FIELDS)) continue;
    const probe = cleanSpec(setPath({ source: "congress", filters: {}, rules: {} }, path, v));
    if (!probe.ok) continue;
    const kept = getPath(probe.spec, path);
    if (JSON.stringify(kept) === JSON.stringify(v)) values[path] = v;
  }
  return { v: PREFS_VERSION, values, updated: typeof raw?.updated === "string" ? raw.updated.slice(0, 30) : "" };
}

export function mergePrefs(prefs, values, updated = "") {
  return cleanPrefs({ v: PREFS_VERSION, values: { ...(cleanPrefs(prefs).values), ...values }, updated });
}

const BENCH_WORD = { SPY: "S&P 500 (SPY)", "^GSPC": "S&P 500 price index", SECTOR: "sector ETF" };
const SIDE_WORD = { buy: "buys only", sell: "sells only (shorted)", both: "buys and sells" };

/** One plain phrase per preference, for the list in the Ask panel and the saved-defaults reply. */
export function describeValue(path, v) {
  switch (path) {
    case "rules.holdDays": return v === 365 ? "hold 1 year" : `hold ${v} days`;
    case "rules.benchmark": return `vs ${BENCH_WORD[v] || v}`;
    case "rules.sides": return SIDE_WORD[v] || v;
    case "rules.sizing": return v === "amountMid" ? "weighted by disclosed range midpoint" : "equal weight";
    case "rules.entry": return v === "nextClose" ? "enter at the next close" : "enter at the next open";
    case "rules.costBps": return `${v} bps commission per side`;
    case "rules.slippageBps": return `${v} bps slippage per side`;
    case "filters.include10b51": return v ? "include 10b5-1 plan trades" : "exclude 10b5-1 plan trades";
    case "filters.nearHearingDays": return v ? `only trades within ${v} days of a hearing` : "any trade, hearing or not";
    case "filters.contractLagDays": return v ? `contracts public ${v} days after the award` : "agency-default contract lag";
    default: return `${path} = ${JSON.stringify(v)}`;
  }
}

function getPath(obj, path) {
  const [a, b] = path.split(".");
  return obj?.[a]?.[b];
}
function setPath(obj, path, v) {
  const [a, b] = path.split(".");
  return { ...obj, [a]: { ...(obj[a] || {}), [b]: v } };
}

/* ---------- what a question says ---------- */

const COMMITTEES = ["armed services", "financial services", "energy and commerce", "intelligence", "judiciary", "appropriations", "ways and means", "agriculture", "banking", "finance", "foreign affairs", "foreign relations", "homeland security", "commerce", "science", "transportation", "veterans", "budget", "health", "oversight", "small business", "natural resources", "energy and natural resources", "education and the workforce", "rules"];
const title = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bAnd\b/g, "and");

/** Sources a question names. "All data sources" → every source that runs without tickers. */
export function questionSources(q) {
  const s = lc(q);
  if (/\ball (data )?sources\b|\bevery source\b|\beach source\b/.test(s)) return ["congress", "form4", "contracts"];
  const out = [];
  if (/\binsiders?\b|\bform ?4\b|\bexecutives?\b|\bofficers?\b|\bceo\b/.test(s)) out.push("form4");
  if (/\bcontracts?\b|\bawards?\b|\busaspending\b/.test(s)) out.push("contracts");
  if (/\blobby(ing)?\b/.test(s)) out.push("lobbying");
  if (/\bcongress|\bmembers?\b|\bsenators?\b|\brepresentatives?\b|\bhouse\b|\bsenate\b|\bpoliticians?\b|\bdisclos|\bptrs?\b|\bcommittee/.test(s) || !out.length) out.unshift("congress");
  return [...new Set(out)];
}

/** Every spec field the words of a question set, by path, plus the sources it names. */
export function questionHints(q, today) {
  const s = lc(q);
  const fields = parseRuleWords(q);
  const win = s.match(/\b(?:last|past|previous|trailing) (\d{1,3}) ?(days?|weeks?|months?)\b|\b(?:last|past) (week|month|quarter|year)\b/);
  if (win && today) {
    const n = win[1] ? Number(win[1]) * (/^w/.test(win[2]) ? 7 : /^m/.test(win[2]) ? 30 : 1) : { week: 7, month: 30, quarter: 90, year: 365 }[win[3]];
    fields["filters.from"] = minus(today, n);
    fields["filters.to"] = today;
    if (n < 180) {
      fields["rules.openTrades"] = "mark";
      if (!("rules.holdDays" in fields)) fields["rules.holdDays"] = n;
    }
  }
  const since = s.match(/\bsince (\d{4})(?:-(\d{2}))?\b/);
  if (since) fields["filters.from"] = `${since[1]}-${since[2] || "01"}-01`;
  const year = s.match(/\bin (20\d{2})\b/);
  if (year && !since && !win) { fields["filters.from"] = `${year[1]}-01-01`; fields["filters.to"] = `${year[1]}-12-31`; }
  const committee = COMMITTEES.find((c) => new RegExp(`\\b${c}\\b`).test(s));
  if (committee) fields["filters.committee"] = title(committee);
  if (/\bdemocrats?\b/.test(s)) fields["filters.party"] = "D";
  else if (/\brepublicans?\b|\bgop\b/.test(s)) fields["filters.party"] = "R";
  if (/\bsenators?\b|\bsenate\b/.test(s)) fields["filters.chamber"] = "senate";
  else if (/\bhouse members?\b|\brepresentatives\b/.test(s)) fields["filters.chamber"] = "house";
  const ex = String(q || "").match(/\b(?:exclude|excluding|without|drop|minus)\s+([A-Z][\w'.-]+(?:\s+[A-Z][\w'.-]+)?)/);
  if (ex && !/^10b5/i.test(ex[1])) fields["filters.excludeMembers"] = [ex[1]];
  return { fields, sources: questionSources(q) };
}

/** A short follow-up that changes the previous run rather than asking a new one. */
export function isFollowUp(q, prior) {
  if (!prior) return false;
  const s = lc(q).trim();
  if (/\bback-?test\b/.test(s) && /\b(congress|insiders?|contracts?|members?|all|senators?|committee)\b/.test(s) && !/\b(instead|same|again|rerun|re-run)\b/.test(s)) return false;
  return /^(and |now |what if|try|instead|same|rerun|re-run|hold|compare|exclude|excluding|without|include|only|use|switch|change|make it|with |vs\.? |versus|against|drop|just)/.test(s) || /\binstead\b|\bsame (spec|run|backtest)\b/.test(s);
}

export const wantsBacktest = (q) => /\bback-?test|\breplay\b|\bhow would .* (have )?(done|performed)\b|\bwhat if (i|you|we) (had )?(bought|copied|followed)\b/i.test(String(q || ""));

/**
 * The spec a run starts from: defaults ← previous run (follow-ups) ← preferences (new runs) ← the question ← chip
 * answers, each field labeled with where it came from. `answers` are `{ path: value }`.
 */
export function buildSpec({ question, today, prefs = null, prior = null, answers = {} }) {
  const hints = questionHints(question, today);
  const follow = isFollowUp(question, prior);
  const sources = follow ? [prior.source] : hints.sources;
  let spec = follow ? JSON.parse(JSON.stringify(prior)) : { source: sources[0], filters: { ...DEFAULT_FILTERS }, rules: { ...DEFAULT_RULES } };
  const from = {};
  if (!follow) {
    for (const [path, v] of Object.entries(cleanPrefs(prefs).values)) { spec = setPath(spec, path, v); from[path] = "preference"; }
  } else {
    for (const path of Object.keys(PREF_FIELDS)) from[path] = "previous run";
  }
  for (const [path, v] of Object.entries(hints.fields)) {
    if (path === "filters.excludeMembers" && follow) spec = setPath(spec, path, [...new Set([...(getPath(spec, path) || []), ...v])]);
    else spec = setPath(spec, path, v);
    from[path] = "question";
  }
  for (const [path, v] of Object.entries(answers || {})) { spec = setPath(spec, path, v); from[path] = "your pick"; }
  const cleaned = cleanSpec(spec);
  return { spec: cleaned.ok ? cleaned.spec : spec, sources, from, followUp: follow, locked: Object.keys(from).filter((p) => from[p] === "question" || from[p] === "your pick") };
}

/* ---------- clarifying chips ---------- */

const CHIP_RULES = [
  { path: "rules.holdDays", when: () => true, prompt: "Hold for?", chips: [["30 days", 30], ["90 days", 90], ["1 year", 365]] },
  { path: "rules.benchmark", when: () => true, prompt: "Benchmark?", chips: [["S&P 500 (SPY)", "SPY"], ["Sector ETF", "SECTOR"]] },
  { path: "filters.nearHearingDays", when: (c) => c.sources.length === 1 && c.sources[0] === "congress" && Boolean(c.spec.filters.committee), prompt: "Only trades near a committee hearing?", chips: [["Any time", 0], ["Within 7 days", 7], ["Within 30 days", 30]] },
  { path: "filters.include10b51", when: (c) => c.sources.length === 1 && c.sources[0] === "form4", prompt: "Include 10b5-1 plan trades?", chips: [["No (scheduled trades out)", false], ["Yes", true]] },
  { path: "filters.contractLagDays", when: (c) => c.sources.length === 1 && c.sources[0] === "contracts", prompt: "When does an award become public?", chips: [["Agency default (DoD 90 d, civilian 7 d)", 0], ["30 days after", 30], ["Next day", 1]] }
];

/**
 * Chips worth asking before a new backtest: a result-changing field that neither the question, a preference, nor an
 * earlier pick settles. Follow-ups and "accept defaults" ask nothing. At most three, in a fixed order.
 */
export function clarifyQuestions({ question, prefs = null, prior = null, answers = {}, today = "" , acceptDefaults = false }) {
  if (acceptDefaults || !wantsBacktest(question) || isFollowUp(question, prior)) return [];
  const plan = buildSpec({ question, today, prefs, prior, answers });
  const ctx = { spec: plan.spec, sources: plan.sources };
  return CHIP_RULES
    .filter((r) => !plan.from[r.path] && r.when(ctx))
    .slice(0, 3)
    .map((r) => ({ path: r.path, prompt: r.prompt, chips: r.chips.map(([label, value]) => ({ label, value })), fallback: getPath(plan.spec, r.path) }));
}

/* ---------- what changed ---------- */

const FIELD_WORD = {
  "rules.holdDays": (v) => `hold ${v} d`, "rules.benchmark": (v) => `vs ${BENCH_WORD[v] || v}`, "rules.sides": (v) => SIDE_WORD[v] || v,
  "rules.sizing": (v) => (v === "amountMid" ? "range-midpoint weights" : "equal weight"), "rules.entry": (v) => (v === "nextClose" ? "next close" : "next open"),
  "rules.costBps": (v) => `${v} bps commission`, "rules.slippageBps": (v) => `${v} bps slippage`, "rules.stopLossPct": (v) => (v ? `stop −${v}%` : "no stop"),
  "rules.takeProfitPct": (v) => (v ? `take +${v}%` : "no take-profit"), "rules.openTrades": (v) => (v === "mark" ? "open trades marked" : "open trades left out"),
  "filters.excludeMembers": (v) => (v?.length ? `excluding ${v.join(", ")}` : "nobody excluded"), "filters.include10b51": (v) => (v ? "10b5-1 included" : "10b5-1 excluded"),
  "filters.nearHearingDays": (v) => (v ? `within ${v} d of a hearing` : "any time"), "filters.contractLagDays": (v) => (v ? `${v} d award lag` : "default award lag")
};

/** "hold 90 d → hold 30 d" lines between two specs. */
export function specDiff(rawPrev, rawNext) {
  const prev = rawPrev && cleanSpec(rawPrev).spec;
  const next = rawNext && cleanSpec(rawNext).spec;
  if (!prev || !next) return [];
  const out = [];
  if (prev.source !== next.source) out.push(`${SOURCE_LABEL[prev.source]} → ${SOURCE_LABEL[next.source]}`);
  for (const group of ["filters", "rules"]) {
    const keys = new Set([...Object.keys(prev[group] || {}), ...Object.keys(next[group] || {})]);
    for (const k of keys) {
      const a = prev[group]?.[k];
      const b = next[group]?.[k];
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      const word = FIELD_WORD[`${group}.${k}`] || ((v) => `${k} ${Array.isArray(v) ? v.join(", ") || "none" : v === "" || v == null ? "none" : v}`);
      out.push(`${word(a)} → ${word(b)}`);
    }
  }
  return out;
}

/** "Using: …" plus the fields that came from preferences or the previous run. */
export function provenanceLine(from) {
  const by = (kind) => Object.entries(from || {}).filter(([, v]) => v === kind).map(([p]) => (PREF_FIELDS[p] || p.split(".")[1]).toLowerCase());
  const pref = by("preference");
  const picked = by("your pick");
  return [pref.length ? `from your preferences: ${pref.join(", ")}` : "", picked.length ? `you picked: ${picked.join(", ")}` : ""].filter(Boolean).join(" · ");
}

/**
 * The spec a `run_backtest` call actually runs: the plan, then whatever the model set, then the plan's locked
 * fields again (the user's own words and picks; on new runs also their preferences). The model's source wins, so
 * "all data sources" can run one call per source.
 */
export function mergeModelSpec(plan, modelSpec) {
  const m = modelSpec && typeof modelSpec === "object" ? modelSpec : {};
  let spec = {
    source: SOURCES.includes(m.source) ? m.source : plan.spec.source,
    filters: { ...plan.spec.filters, ...(m.filters || {}) },
    rules: { ...plan.spec.rules, ...(m.rules || {}) }
  };
  const keep = new Set(plan.locked);
  if (!plan.followUp) for (const [p, v] of Object.entries(plan.from)) if (v === "preference") keep.add(p);
  for (const p of keep) spec = setPath(spec, p, getPath(plan.spec, p));
  const cleaned = cleanSpec(spec);
  return cleaned.ok ? cleaned.spec : plan.spec;
}

/** What the model is told about the planned spec. */
export function planNote(plan, prior = null) {
  const lines = [
    `Backtest spec to use (call run_backtest with it; keep every field unless the question asks for something it does not capture, such as a member name or tickers): ${JSON.stringify(plan.spec)}`,
    plan.sources.length > 1 ? `Sources to run, one run_backtest call each, in parallel: ${plan.sources.join(", ")}.` : "",
    plan.followUp && prior ? `This changes the previous run (${JSON.stringify(prior)}). Say what changed and compare the two runs side by side in a small table.` : "",
    "Start the answer with one line: \"Using: …\" in plain words (source, window, hold, benchmark, sides, costs)."
  ];
  return lines.filter(Boolean).join("\n");
}

export const KNOWN_SOURCES = SOURCES;
