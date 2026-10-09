import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSpec, clarifyQuestions, cleanPrefs, describeValue, isFollowUp, isPrefClear, isPrefStatement, mergePrefs,
  parsePrefs, provenanceLine, questionHints, questionSources, specDiff, wantsBacktest, PREFS_VERSION
} from "../shared/backtestAsk.mjs";
import { cleanSpec } from "../shared/backtestSpec.mjs";
import { congressSignals, contractSignals, form4Signals } from "../server/domain/backtest/signals.mjs";

const TODAY = "2026-10-09";

test("plain words set hold, benchmark, sides, costs, 10b5-1, hearing window, lag", () => {
  assert.deepEqual(parsePrefs("I usually want 90-day holds vs SPY, buys only"), { "rules.holdDays": 90, "rules.benchmark": "SPY", "rules.sides": "buy" });
  assert.equal(parsePrefs("hold 30 days instead")["rules.holdDays"], 30);
  assert.equal(parsePrefs("hold for a year")["rules.holdDays"], 365);
  assert.equal(parsePrefs("2 week hold")["rules.holdDays"], 14);
  assert.equal(parsePrefs("compare to sector ETF")["rules.benchmark"], "SECTOR");
  assert.equal(parsePrefs("10 bps costs and 3 bps slippage")["rules.costBps"], 10);
  assert.equal(parsePrefs("10 bps costs and 3 bps slippage")["rules.slippageBps"], 3);
  assert.equal(parsePrefs("exclude 10b5-1 trades")["filters.include10b51"], false);
  assert.equal(parsePrefs("include 10b5-1")["filters.include10b51"], true);
  assert.equal(parsePrefs("only trades within 14 days of a hearing")["filters.nearHearingDays"], 14);
  assert.equal(parsePrefs("use a 30 day lag")["filters.contractLagDays"], 30);
});

test("preference statements and clears are told apart from questions", () => {
  assert.equal(isPrefStatement("I usually want 90-day holds vs SPY"), true);
  assert.equal(isPrefStatement("My default is equal weight"), true);
  assert.equal(isPrefStatement("I usually want something nice"), false);
  assert.equal(isPrefStatement("backtest congress buys with 90-day holds"), false);
  assert.equal(isPrefClear("clear my preferences"), true);
  assert.equal(isPrefClear("forget my defaults"), true);
});

test("prefs are versioned, cleaned, and merged; bad values drop", () => {
  const p = cleanPrefs({ v: PREFS_VERSION, values: { "rules.holdDays": 90, "rules.benchmark": "NOPE", "rules.evil": 1, "filters.include10b51": true }, updated: "x" });
  assert.deepEqual(p.values, { "rules.holdDays": 90, "filters.include10b51": true });
  assert.deepEqual(cleanPrefs({ v: 0, values: { "rules.holdDays": 90 } }).values, {});
  assert.deepEqual(cleanPrefs(null).values, {});
  const m = mergePrefs(p, { "rules.holdDays": 30, "rules.sides": "both" }, "now");
  assert.deepEqual(m.values, { "rules.holdDays": 30, "filters.include10b51": true, "rules.sides": "both" });
  assert.equal(describeValue("rules.holdDays", 365), "hold 1 year");
  assert.match(describeValue("rules.benchmark", "SPY"), /S&P 500/);
});

test("questions name sources and windows", () => {
  assert.deepEqual(questionSources("backtest the last 30 days from all data sources"), ["congress", "form4", "contracts"]);
  assert.deepEqual(questionSources("backtest insider buys"), ["form4"]);
  assert.deepEqual(questionSources("backtest contract awards"), ["contracts"]);
  assert.deepEqual(questionSources("backtest it"), ["congress"]);
  const h = questionHints("Backtest the last 30 days", TODAY).fields;
  assert.equal(h["filters.from"], "2026-09-09");
  assert.equal(h["filters.to"], TODAY);
  assert.equal(h["rules.openTrades"], "mark");
  assert.equal(h["rules.holdDays"], 30);
  const c = questionHints("backtest Armed Services Democrats excluding Cisneros", TODAY).fields;
  assert.equal(c["filters.committee"], "Armed Services");
  assert.equal(c["filters.party"], "D");
  assert.deepEqual(c["filters.excludeMembers"], ["Cisneros"]);
});

test("spec order: defaults ← preferences ← question ← picks, each labeled", () => {
  const prefs = { v: 1, values: { "rules.holdDays": 90, "rules.benchmark": "SECTOR" } };
  const plan = buildSpec({ question: "backtest congress buys, hold 30 days", today: TODAY, prefs, answers: { "rules.sides": "both" } });
  assert.equal(plan.spec.rules.holdDays, 30);
  assert.equal(plan.from["rules.holdDays"], "question");
  assert.equal(plan.spec.rules.benchmark, "SECTOR");
  assert.equal(plan.from["rules.benchmark"], "preference");
  assert.equal(plan.spec.rules.sides, "both");
  assert.equal(plan.from["rules.sides"], "your pick");
  assert.ok(plan.locked.includes("rules.holdDays") && !plan.locked.includes("rules.benchmark"));
  assert.ok(cleanSpec(plan.spec).ok);
  assert.match(provenanceLine(plan.from), /preferences: benchmark/);
});

test("follow-ups change the previous run and diff against it", () => {
  const prior = buildSpec({ question: "backtest congress buys with 90-day holds vs SPY", today: TODAY }).spec;
  assert.equal(isFollowUp("hold 30 days instead", prior), true);
  assert.equal(isFollowUp("exclude Cisneros", prior), true);
  assert.equal(isFollowUp("compare to sector ETF", prior), true);
  assert.equal(isFollowUp("backtest insider buys", prior), false);
  assert.equal(isFollowUp("hold 30 days instead", null), false);
  const next = buildSpec({ question: "hold 30 days instead", today: TODAY, prior });
  assert.equal(next.followUp, true);
  assert.equal(next.spec.rules.holdDays, 30);
  assert.equal(next.spec.rules.benchmark, "SPY");
  assert.deepEqual(specDiff(prior, next.spec), ["hold 90 d → hold 30 d"]);
  const ex = buildSpec({ question: "exclude Cisneros", today: TODAY, prior: next.spec });
  assert.deepEqual(ex.spec.filters.excludeMembers, ["Cisneros"]);
  assert.deepEqual(specDiff(next.spec, ex.spec), ["nobody excluded → excluding Cisneros"]);
  const sec = buildSpec({ question: "compare to sector ETF", today: TODAY, prior });
  assert.deepEqual(specDiff(prior, sec.spec), ["vs S&P 500 (SPY) → vs sector ETF"]);
});

test("chips only for result-changing fields nothing settles", () => {
  const q = clarifyQuestions({ question: "backtest congress buys", today: TODAY });
  assert.deepEqual(q.map((x) => x.path), ["rules.holdDays", "rules.benchmark"]);
  assert.deepEqual(q[0].chips.map((c) => c.value), [30, 90, 365]);
  assert.equal(q[0].fallback, 90);
  assert.deepEqual(clarifyQuestions({ question: "backtest congress buys", today: TODAY, prefs: { v: 1, values: { "rules.holdDays": 90, "rules.benchmark": "SPY" } } }), []);
  assert.deepEqual(clarifyQuestions({ question: "backtest congress buys, 30-day hold vs SPY", today: TODAY }), []);
  assert.deepEqual(clarifyQuestions({ question: "backtest congress buys", today: TODAY, acceptDefaults: true }), []);
  assert.deepEqual(clarifyQuestions({ question: "what did Pelosi buy?", today: TODAY }), []);
  const last30 = clarifyQuestions({ question: "backtest the last 30 days from all data sources", today: TODAY });
  assert.deepEqual(last30.map((x) => x.path), ["rules.benchmark"]);
  const committee = clarifyQuestions({ question: "backtest Armed Services members, hold 90 days vs SPY", today: TODAY });
  assert.deepEqual(committee.map((x) => x.path), ["filters.nearHearingDays"]);
  assert.deepEqual(clarifyQuestions({ question: "backtest insider buys, hold 90 days vs SPY", today: TODAY }).map((x) => x.path), ["filters.include10b51"]);
  assert.deepEqual(clarifyQuestions({ question: "backtest contract awards, hold 90 days vs SPY", today: TODAY }).map((x) => x.path), ["filters.contractLagDays"]);
  const prior = buildSpec({ question: "backtest congress buys", today: TODAY }).spec;
  assert.deepEqual(clarifyQuestions({ question: "hold 30 days instead", prior, today: TODAY }), []);
  assert.deepEqual(clarifyQuestions({ question: "backtest congress buys", today: TODAY, answers: { "rules.holdDays": 30, "rules.benchmark": "SPY" } }), []);
  assert.equal(wantsBacktest("How would Pelosi's buys have done?"), true);
});

test("new filters change signals: exclude members, 10b5-1, contract lag", () => {
  const f = (x) => cleanSpec({ source: "congress", filters: x }).spec.filters;
  const trades = [
    { id: "a", side: "buy", symbol: "NVDA", inJoin: true, filed: "2026-01-10", traded: "2026-01-02", person: "Gilbert Cisneros", bioguide: "C001123" },
    { id: "b", side: "buy", symbol: "NVDA", inJoin: true, filed: "2026-01-10", traded: "2026-01-02", person: "Nancy Pelosi", bioguide: "P000197" }
  ];
  const sec = () => "Information Technology";
  assert.equal(congressSignals({ trades, filters: f({}), sectorOf: sec }).signals.length, 2);
  const out = congressSignals({ trades, filters: f({ excludeMembers: ["cisneros"] }), sectorOf: sec });
  assert.deepEqual(out.signals.map((s) => s.id), ["b"]);
  assert.equal(out.dropped.excludedMember, 1);
  const rows = [{ id: "p", side: "buy", code: "P", plan: true, filed: "2026-01-10", traded: "2026-01-08", symbol: "NVDA", person: "X", value: 1 }];
  assert.equal(form4Signals({ rows, filters: f({}), sectorOf: sec }).signals.length, 0);
  assert.equal(form4Signals({ rows, filters: f({ include10b51: true }), sectorOf: sec }).signals.length, 1);
  const awards = [{ id: "c", symbol: "LMT", agency: "Department of Defense", date: "2026-01-01", amount: 1e6 }];
  assert.equal(contractSignals({ rows: awards, filters: f({}), sectorOf: sec }).signals[0].signalDate, "2026-04-01");
  assert.equal(contractSignals({ rows: awards, filters: f({ contractLagDays: 1 }), sectorOf: sec }).signals[0].signalDate, "2026-01-02");
});
