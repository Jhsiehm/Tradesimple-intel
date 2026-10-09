/**
 * How each backtest and leaderboard number is computed, as TeX, with a worked line that substitutes this run's own
 * figures. Pure: a result in, `{ id, title, tex, worked, note }[]` out. The math mirrors shared/backtest.mjs and
 * server/returns.mjs; test/replicate.test.mjs checks the generated scripts against the engine.
 */
import { SIZE_CAP, ENTRY_SLACK_DAYS } from "./backtest.mjs";

const fix = (v, d = 4) => (v == null || !Number.isFinite(v) ? "\\text{n/a}" : String(Math.round(v * 10 ** d) / 10 ** d));
const pct = (v, d = 2) => (v == null || !Number.isFinite(v) ? "\\text{n/a}" : `${(v * 100).toFixed(d)}\\%`);
const usd = (v) => `\\$${Number(v).toLocaleString("en-US")}`;
const tx = (s) => `\\text{${String(s).replace(/[\\{}$%&#_^~]/g, (c) => `\\${c}`)}}`;

/** The trade the worked lines use: the first by entry date with both prices. */
const sampleTrade = (trades = []) => [...trades].filter((t) => t.entryPrice > 0 && t.exitPrice > 0).sort((a, b) => a.entry.localeCompare(b.entry))[0] || null;

export function backtestFormulas(run) {
  const s = run?.stats;
  const r = run?.rules || run?.spec?.rules;
  if (!s || !r) return [];
  const t = sampleTrade(run.trades);
  const c = (r.costBps + r.slippageBps) / 10_000;
  const sign = t?.side === "sell" ? -1 : 1;
  const bench = r.benchmark === "SECTOR" ? "sector ETF" : r.benchmark;
  const n = s.trades;
  const wins = s.wins ?? Math.round((s.hitRate ?? 0) * n);
  const out = [];
  const add = (id, title, tex, worked, note = "") => out.push({ id, title, tex, worked, note });

  add("entry", "Entry rule",
    `t_{\\text{in}} = \\min\\{\\, d \\in \\text{trading days} : d > d_{\\text{public}} \\,\\},\\quad t_{\\text{in}} - d_{\\text{public}} \\le ${ENTRY_SLACK_DAYS},\\quad P_{\\text{in}} = \\text{${r.entry === "nextOpen" ? "Open" : "Close"}}(t_{\\text{in}})`,
    t ? `${tx(t.symbol)}:\\ d_{\\text{public}} = ${tx(t.signal)} \\Rightarrow t_{\\text{in}} = ${tx(t.entry)},\\ P_{\\text{in}} = ${fix(t.entryPrice)}` : "",
    "The public date is the filing or posting date, never the trade date, so nothing enters before it was knowable.");
  add("exit", "Exit rule",
    `t_{\\text{out}} = \\min\\{\\, d \\ge t_{\\text{in}} : d - t_{\\text{in}} \\ge H${r.stopLossPct ? `\\ \\lor\\ s\\,(C_d/P_{\\text{in}} - 1) \\le -${r.stopLossPct / 100}` : ""}${r.takeProfitPct ? `\\ \\lor\\ s\\,(C_d/P_{\\text{in}} - 1) \\ge ${r.takeProfitPct / 100}` : ""} \\,\\},\\quad P_{\\text{out}} = C_{t_{\\text{out}}}`,
    t ? `H = ${r.holdDays}\\ \\text{days}:\\ ${tx(t.entry)} \\to ${tx(t.exit)}\\ (${t.days}\\ \\text{days}, ${tx(t.why)}),\\ P_{\\text{out}} = ${fix(t.exitPrice)}` : `H = ${r.holdDays}`,
    r.openTrades === "mark" ? "Positions that have not reached their exit are marked at the last close (exit reason: open)." : "Positions that have not reached their exit are left out.");
  add("costs", "Costs and slippage",
    `c = \\frac{\\text{commission}_{\\text{bps}} + \\text{slippage}_{\\text{bps}}}{10^4}\\ \\text{per side},\\qquad \\text{round trip} = 2c`,
    `c = \\frac{${r.costBps} + ${r.slippageBps}}{10^4} = ${fix(c, 6)},\\quad 2c = ${pct(2 * c, 3)}`);
  add("trade", "Trade return",
    `r_i = s_i \\left( \\frac{P_{\\text{out}}}{P_{\\text{in}}} - 1 \\right) - 2c,\\qquad s_i = \\begin{cases} +1 & \\text{buy} \\\\ -1 & \\text{sell (short)} \\end{cases}`,
    t ? `r = ${sign > 0 ? "" : "-"}\\left(\\frac{${fix(t.exitPrice)}}{${fix(t.entryPrice)}} - 1\\right) - ${fix(2 * c, 6)} = ${pct(t.ret)}` : "");
  add("sizing", "Position weight",
    r.sizing === "amountMid" ? `w_i = \\min\\!\\left( \\frac{L_i + U_i}{2},\\ ${usd(SIZE_CAP)} \\right)\\quad \\text{(disclosed range } [L_i, U_i]\\text{)}` : "w_i = 1\\quad \\text{(equal weight)}",
    r.sizing === "amountMid" ? `\\text{e.g. } \\$15{,}001\\text{–}\\$50{,}000 \\Rightarrow w = \\frac{15001 + 50000}{2} = 32500.5${t?.weight ? `;\\ ${tx(t.symbol)}: w = ${fix(t.weight, 1)}` : ""}` : "w_i = 1\\ \\text{for all } i",
    r.sizing === "amountMid" ? "Ranges are disclosed, not amounts; the midpoint is an estimate. Missing amounts use the median size." : "");
  add("daily", "Daily portfolio return",
    `R_t = \\frac{\\sum_{i \\in O_t} w_i\\, r_{i,t}}{\\sum_{i \\in O_t} w_i},\\qquad R_t = 0 \\text{ when } O_t = \\varnothing`,
    `${s.sessions ?? "n"}\\ \\text{sessions},\\ \\text{average } ${fix(s.avgConcurrent, 2)}\\ \\text{open},\\ \\text{max } ${s.maxConcurrent}`,
    `O_t is the set of positions open on day t; r_{i,t} is that day's close-to-close return (net of cost on the entry and exit day). The ${bench} leg holds the same weights on the same days.`);
  add("total", "Total return",
    "S_T = \\prod_{t=1}^{T} (1 + R_t),\\qquad \\text{Total} = S_T - 1",
    `S_T = ${fix(s.total == null ? null : 1 + s.total)} \\Rightarrow \\text{Total} = ${pct(s.total)}`);
  add("annualized", "Annualized return",
    "\\text{Ann} = (1 + \\text{Total})^{365 / D} - 1,\\qquad D = \\text{last day} - \\text{first day} + 1",
    s.annualized == null ? `D = ${s.spanDays} < 90 \\Rightarrow \\text{not annualized}` : `(1 + ${fix(s.total)})^{365/${s.spanDays}} - 1 = ${pct(s.annualized)}`);
  add("excess", `Excess vs ${bench}`,
    "\\text{Excess} = \\text{Total} - \\text{Total}_B,\\qquad \\text{Total}_B = \\prod_t (1 + B_t) - 1",
    `${pct(s.total)} - ${pct(s.benchmarkTotal)} = ${pct(s.excessTotal)}`,
    r.benchmark === "^GSPC" ? "^GSPC is a price index without dividends; excess is tilted up by roughly the S&P yield." : "");
  add("hit", "Hit rate",
    "\\text{Hit} = \\frac{\\#\\{ i : r_i > 0 \\}}{N}",
    `\\frac{${wins}}{${n}} = ${pct(s.hitRate, 1)}`);
  add("avg", "Average and median trade",
    "\\bar r = \\frac{1}{N} \\sum_{i=1}^{N} r_i,\\qquad \\tilde r = \\operatorname{median}(r_1, \\dots, r_N)",
    `\\bar r = ${pct(s.avgTrade)},\\quad \\tilde r = ${pct(s.medianTrade)},\\quad N = ${n}`);
  add("drawdown", "Max drawdown",
    "\\text{MDD} = \\min_t \\left( \\frac{S_t}{\\max_{u \\le t} S_u} - 1 \\right)",
    s.drawdownPeak ? `\\frac{${fix(s.drawdownTrough)}}{${fix(s.drawdownPeak)}} - 1 = ${pct(s.maxDrawdown)}\\quad (${tx(s.drawdownFrom)} \\to ${tx(s.drawdownTo)})` : `${pct(s.maxDrawdown)}`);
  add("sharpe", "Sharpe-ish",
    "\\text{Sharpe} \\approx \\frac{\\overline{R}}{\\sigma_R} \\sqrt{252},\\qquad \\sigma_R = \\sqrt{\\tfrac{1}{T-1} \\sum_t (R_t - \\overline{R})^2}",
    s.dailySd ? `\\frac{${fix(s.dailyMean, 6)}}{${fix(s.dailySd, 6)}} \\times ${fix(Math.sqrt(252), 4)} = ${fix(s.sharpeish, 2)}` : "\\text{n/a}",
    "Risk-free rate taken as 0; a rough score on a short, overlapping sample.");
  return out;
}

/** Leaderboard rows: disclosed buys scored against SPY since the trade. `row` is one excessTop entry when known. */
export function leadersFormulas(row = null) {
  const r = row && typeof row === "object" ? row : null;
  return [
    {
      id: "buy",
      title: "One disclosed buy against SPY",
      tex: "r = \\frac{C_{\\text{latest}}}{C_{\\text{trade}}} - 1,\\qquad r_{\\text{SPY}} = \\frac{\\text{SPY}_{\\text{latest}}}{\\text{SPY}_{\\text{trade}}} - 1,\\qquad e = r - r_{\\text{SPY}}",
      worked: "",
      note: "Adjusted closes; entry is the trade date (or the next trading day). Sells are not scored."
    },
    {
      id: "member",
      title: "A member's excess since disclosure",
      tex: "\\bar e = \\frac{1}{n} \\sum_{k=1}^{n} e_k,\\qquad \\bar e_{\\text{mid}} = \\frac{\\sum_k m_k e_k}{\\sum_k m_k}",
      worked: r && Number.isFinite(r.excessSince) ? `${tx(r.name || r.bioguide || "member")}:\\ n = ${r.priced ?? "?"},\\ \\bar e = ${pct(r.excessSince)}${Number.isFinite(r.excessMid) ? `,\\ \\bar e_{\\text{mid}} = ${pct(r.excessMid)}` : ""}` : "",
      note: "Equal-weighted over priced buys, not the member's portfolio; m_k is the disclosed range midpoint."
    }
  ];
}

/** How a figure from a tool is written in an answer. */
export const PERCENT_FORMULA = { id: "pct", title: "Fractions shown as percent", tex: "x\\% = 100 \\times x", worked: "0.0834 \\Rightarrow 8.34\\%", note: "Tools return fractions; answers may show them as percent. Nothing else is computed in the answer." };
