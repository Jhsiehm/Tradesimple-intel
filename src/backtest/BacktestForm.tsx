import type { ReactNode } from "react";
import { LIMITS, SECTOR_ETF, type BacktestFilters, type BacktestRules, type BacktestSource, type BacktestSpec } from "../../shared/backtestSpec.mjs";
import { Icon } from "../ui/icons/Icon";
import type { BtOptions } from "./types";

const AMOUNTS: [number, string][] = [[0, "any size"], [1001, "$1,001+"], [15001, "$15,001+"], [50001, "$50,001+"], [100001, "$100,001+"], [250001, "$250,001+"], [1000001, "$1,000,001+"]];
const FALLBACK_BENCH = [{ id: "SPY", label: "SPY (S&P 500 ETF)" }, { id: "^GSPC", label: "^GSPC (S&P 500 index, price only)" }, { id: "SECTOR", label: "Sector ETF of each ticker" }];

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? "bt-field wide" : "bt-field"} title={hint}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Plain controls for one spec. Every change goes up as a whole new spec; running is the caller's call. */
export function BacktestForm({ spec, options, onChange, onRun, running }: {
  spec: BacktestSpec;
  options: BtOptions | null;
  onChange: (next: BacktestSpec) => void;
  onRun: () => void;
  running: boolean;
}) {
  const f = spec.filters;
  const r = spec.rules;
  const setF = (patch: Partial<BacktestFilters>) => onChange({ ...spec, filters: { ...f, ...patch } });
  const setR = (patch: Partial<BacktestRules>) => onChange({ ...spec, rules: { ...r, ...patch } });
  const congress = spec.source === "congress";
  const bench = options?.benchmarks.length ? options.benchmarks : FALLBACK_BENCH;
  const sectors = options?.sectors?.length ? options.sectors : Object.keys(SECTOR_ETF);
  const optNum = (v: string) => (v === "" ? null : Number(v));
  return (
    <form className="bt-form" onSubmit={(e) => { e.preventDefault(); onRun(); }} aria-label="Backtest settings">
      <fieldset>
        <legend>Signals · public date, never the trade date</legend>
        <Field label="Source" hint="Each source dates a signal by when it became public.">
          <select value={spec.source} onChange={(e) => onChange({ ...spec, source: e.target.value as BacktestSource })}>
            {(options?.sources || [{ id: "congress", label: "Congressional trades" }, { id: "form4", label: "Form 4 insider trades" }, { id: "contracts", label: "Contract awards" }, { id: "lobbying", label: "Lobbying spikes" }]).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        {congress ? (
          <>
            <Field label="Committee" hint="Current assignments (parent and subcommittees) applied to every past trade.">
              <input list="bt-committees" value={f.committee} placeholder="Armed Services, HSAS…" onChange={(e) => setF({ committee: e.target.value })} />
              <datalist id="bt-committees">{(options?.committees || []).map((c) => <option key={c.id} value={c.name.replace(/^(House|Senate|Joint) Committee on /, "")} label={`${c.id} · ${c.chamber}`} />)}</datalist>
            </Field>
            <Field label="Member" hint="Name fragment or bioguide id."><input value={f.member} placeholder="Pelosi or P000197" onChange={(e) => setF({ member: e.target.value })} /></Field>
            <Field label="Party">
              <select value={f.party} onChange={(e) => setF({ party: e.target.value as BacktestFilters["party"] })}><option value="">any</option><option value="D">Democrat</option><option value="R">Republican</option><option value="I">Independent</option></select>
            </Field>
            <Field label="Chamber">
              <select value={f.chamber} onChange={(e) => setF({ chamber: e.target.value as BacktestFilters["chamber"] })}><option value="">both</option><option value="house">House</option><option value="senate">Senate</option></select>
            </Field>
            <Field label="Min amount" hint="Low end of the disclosed range.">
              <select value={f.minAmount} onChange={(e) => setF({ minAmount: Number(e.target.value) })}>{AMOUNTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </Field>
            <Field label="Near a hearing (days)" hint="Trade date within N days of a hearing of a committee the member sits on. Calendar distance only; 0 is off.">
              <input type="number" min={0} max={LIMITS.hearingDays[1]} value={f.nearHearingDays} onChange={(e) => setF({ nearHearingDays: Number(e.target.value) })} />
            </Field>
            {f.nearHearingDays ? (
              <label className="bt-check wide" title="Without this the filter may use a hearing held after the filing, which nobody could have known.">
                <input type="checkbox" checked={f.hearingKnown} onChange={(e) => setF({ hearingKnown: e.target.checked })} /> Only hearings held on or before the filing date
              </label>
            ) : null}
          </>
        ) : null}
        {spec.source === "form4" ? <Field label="Insider" hint="Name fragment."><input value={f.member} onChange={(e) => setF({ member: e.target.value })} /></Field> : null}
        {spec.source === "form4" || spec.source === "contracts" || spec.source === "lobbying" ? (
          <Field label={spec.source === "lobbying" ? "Min quarter total ($)" : "Min value ($)"}>
            <input type="number" min={0} step={1000} value={f.minAmount} onChange={(e) => setF({ minAmount: Number(e.target.value) })} />
          </Field>
        ) : null}
        {spec.source === "contracts" ? <Field label="Agency" hint="Name fragment, e.g. Defense."><input value={f.contractAgency} onChange={(e) => setF({ contractAgency: e.target.value })} /></Field> : null}
        {spec.source === "lobbying" ? <Field label="Spike ≥ % over prior quarter"><input type="number" min={1} value={f.spikePct} onChange={(e) => setF({ spikePct: Number(e.target.value) })} /></Field> : null}
        <Field label="Tickers" hint="data/tickers.json symbols only. Lobbying needs a list (max 40)." wide>
          <input value={f.tickers.join(" ")} placeholder="LMT RTX NOC (blank = all joined)" onChange={(e) => setF({ tickers: e.target.value.toUpperCase().split(/[\s,]+/).filter(Boolean) })} />
        </Field>
        <Field label="Sector">
          <select value={f.sector} onChange={(e) => setF({ sector: e.target.value })}><option value="">any</option>{sectors.map((s) => <option key={s}>{s}</option>)}</select>
        </Field>
        <Field label="Public from"><input type="date" value={f.from} onChange={(e) => setF({ from: e.target.value })} /></Field>
        <Field label="Public to"><input type="date" value={f.to} onChange={(e) => setF({ to: e.target.value })} /></Field>
      </fieldset>
      <fieldset>
        <legend>Rules</legend>
        <Field label="Side" hint="Sells are scored as shorts with no borrow cost.">
          <select value={r.sides} onChange={(e) => setR({ sides: e.target.value as BacktestRules["sides"] })}><option value="buy">buys</option><option value="sell">sells (short)</option><option value="both">buys and sells</option></select>
        </Field>
        <Field label="Entry" hint="Always the first trading day after the public date, never the same day.">
          <select value={r.entry} onChange={(e) => setR({ entry: e.target.value as BacktestRules["entry"] })}><option value="nextOpen">next open after filing</option><option value="nextClose">next close after filing</option></select>
        </Field>
        <Field label="Hold (days)"><input type="number" min={LIMITS.holdDays[0]} max={LIMITS.holdDays[1]} value={r.holdDays} onChange={(e) => setR({ holdDays: Number(e.target.value) })} /></Field>
        <Field label="Stop loss %" hint="Exit at the first close this far below entry. Blank = none."><input type="number" min={1} max={95} value={r.stopLossPct ?? ""} onChange={(e) => setR({ stopLossPct: optNum(e.target.value) })} /></Field>
        <Field label="Take profit %" hint="Exit at the first close this far above entry. Blank = none."><input type="number" min={1} max={95} value={r.takeProfitPct ?? ""} onChange={(e) => setR({ takeProfitPct: optNum(e.target.value) })} /></Field>
        <Field label="Sizing" hint="Range midpoints are estimates: Congress discloses dollar ranges.">
          <select value={r.sizing} onChange={(e) => setR({ sizing: e.target.value as BacktestRules["sizing"] })}><option value="equal">equal weight</option><option value="amountMid">range midpoint</option></select>
        </Field>
        <Field label="Benchmark" hint="The benchmark holds the same positions on the same days. SPY includes dividends; ^GSPC does not.">
          <select value={r.benchmark} onChange={(e) => setR({ benchmark: e.target.value })}>{bench.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
        </Field>
        <Field label="Commission (bps/side)"><input type="number" min={0} max={LIMITS.bps[1]} value={r.costBps} onChange={(e) => setR({ costBps: Number(e.target.value) })} /></Field>
        <Field label="Slippage (bps/side)"><input type="number" min={0} max={LIMITS.bps[1]} value={r.slippageBps} onChange={(e) => setR({ slippageBps: Number(e.target.value) })} /></Field>
        <label className="bt-check wide" title="Trades whose hold has not finished are left out, or marked at the last close.">
          <input type="checkbox" checked={r.openTrades === "mark"} onChange={(e) => setR({ openTrades: e.target.checked ? "mark" : "exclude" })} /> Mark unfinished holds at the last close
        </label>
      </fieldset>
      <div className="bt-actions">
        <button type="submit" className="bt-run" disabled={running}><Icon name="play" /> {running ? "Running…" : "Run backtest"}</button>
      </div>
    </form>
  );
}
