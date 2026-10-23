# Execution realism audit — 2026-10-22

The current backtest is an exploratory signal-return simulation. It does not establish an executable, capital-constrained portfolio. New runs carry `executionAssessment` with a versioned classification, explicit false execution-validation flags, per-topic gates, and arithmetic trade-cost sensitivity. Existing UI caveats include the same boundary. Historical archived engines must continue to replay their frozen semantics; this change does not revise historical return arithmetic.

## Accounting findings

- `simulateTrade` scores signed endpoint price returns minus two one-way costs. Each daily path uses signed consecutive price returns; entry and exit costs are deducted on the first and final path days.
- `buildCurve` normalizes weights independently each day over the paths with a bar that day. Idle calendar dates earn zero. It compounds these daily averages. Weight changes and drift imply turnover that is not charged.
- A 100 → 110 → 100 short has a zero endpoint return but daily-reset compounded performance of `(1 − .1) × (1 + 1/11) − 1 = −1.81818%`. These are different economic objects; neither proves a feasible short account.
- A flat long with 100 bps costs per side has a −2% trade return but a −1.99% curve return when the costs occur on separate days. No reconciliation to shares and cash currently exists.
- If one of two otherwise equally weighted positions has no bar on a day, the other receives all the weight on that day. Missing observations do not establish a real liquidation or zero allocation.
- Sizing by disclosed amount provides relative weights capped at $1 million, not investment dollars. Repeated signals for one symbol remain separate paths and can increase its normalized exposure. Capital, lot sizes, cash availability, margin and settlement do not constrain these returns.
- Stops and targets are checked at the close and filled at that close. They cannot support intraday execution claims. Missing opens fall back to closing prices. Open marks charge a hypothetical exit cost.
- Sell-signal paths lack borrow inventory, borrow fees, collateral, margin calls and forced buy-ins. Adjusted prices are not a separate cash dividend-liability ledger.
- A benchmark bar calendar adds idle sessions, but it does not validate exchange-specific sessions, halts or missing stock observations.

These findings are preserved and made explicit rather than patched with invented execution inputs. Changing the curve into a holdings ledger is a separate versioned model requiring an allocation policy and historical execution evidence.

## Cost sensitivity

`executionAssessment.costSensitivity.scenarios` reports unweighted mean trade returns at 0, 5, 10, 25, 50 and 100 bps per side, plus the selected cost. The transformation restores the original two-sided cost, then deducts the scenario's two-sided cost. It is exact for the current arithmetic trade calculation. It does not rerun portfolio equity, change exits, charge rebalancing, or estimate borrow and market impact. Empty samples return null for every scenario.

## Paper-account audit

`server/domain/paper-engine.mjs` independently enforces nonnegative integer cash, per-order limits including fees, per-symbol share limits, no selling beyond holdings, and halt controls. Its hash-chained event replay protects accounting consistency. Fills still accept an assumed user-supplied price and textual price basis. Therefore those controls establish ledger consistency, not broker execution, historical fill availability or strategy feasibility. The paper engine was not changed.

## Validation and remaining work

`test/executionAssessment.test.mjs` includes hand-calculated short compounding, flat-position cost accounting, and missing-bar allocation examples. It verifies conservative gates on empty and long-only results and hypothetical open marks. Existing backtest tests retain the numerical behavior.

To graduate to executable portfolio research, preregister capital, cash allocation, symbol aggregation, turnover, borrowing, exchange sessions and order timing. Obtain historical spread/volume/borrow evidence, implement a separate versioned holdings-and-cash simulator with rejects and partial fills, reconcile every cash flow independently, then conduct locked prospective paper execution with immutable quotes and fills. None of these provider-dependent or prospective requirements is marked complete by this audit.
