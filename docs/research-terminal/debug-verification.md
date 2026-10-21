# Research request debugging — October 20, 2026

## Confirmed defects and corrections

The supplied contract question requested LMT, RTX, NOC, GD and HII, two evaluation periods, and a 30-trading-day hold. Before this correction, the live API returned a clarification with an empty ticker universe, a 90-day fallback, and an unrelated Rules Committee filter inferred from “these rules.”

- Explicit uppercase comma-separated ticker lists are preserved and locked against model substitution.
- Committee filters are limited to applicable sources; “rules” requires explicit committee wording.
- Trading-day holds are rejected before model execution or default selection because the current engine measures calendar days. This does not add trading-session execution support.
- Capability receipts retain “past month” as a second requested period and explain the unsupported hold, sampled award coverage, and assumed publication delays.

The supplied legislation-before-news question also incorrectly listed Congress stock disclosures as an allowed source because it mentioned them in an exclusion. Negated personal-stock instructions no longer create that source, and generic trade execution language near legislative events does not imply officials’ trades.

Legislative pre-news receipts now identify missing public-availability evidence, historical exposure mappings, a specified timestamped news archive and its coverage audit, processing/execution delays, and intraday prices. They distinguish archive-first coverage from global first news, missing coverage from absence of news, and executable timing from higher returns. Follow-up assessment receipts preserve these requirements.

Answer cache identity version 5 prevents reuse of the older interpretation. Saved conversation text is retained.

## Verification

- Full offline regression suite: 1,005 tests pass.
- TypeScript and production build pass; final diff and staged content reviewed before commit.
- Live API acceptance, through the Vite proxy: the original policy question, exact supplied contract question, and exact supplied legislative pre-news question each return HTTP 200, an explicit unsupported-design receipt, zero backtests, zero model tokens, and zero calculation tool calls. Requested windows and SPY remain intact; no Congress stock source is substituted.
- Supported calendar-day replay remains covered by existing execution and follow-up tests. This verification does not claim an actual policy or pre-news strategy was tested for performance.

## Preview refresh investigation

Normal automatic cache warming and the live poller were restored without persisting any environment change. Sixty health requests through the preview proxy over two minutes all succeeded (maximum 321 ms, including hot reloads). The restored refresh also ingested 44 Form 4/4A records without failures and completed the price-cache warm. A separate API process and a synthetic news-feed workload were used while investigating the earlier regular-expression stall; neither reproduced it. Native sampling of the prior stalled process establishes regular-expression work, but does not identify its JavaScript call site.

The previous stall’s root cause remains unconfirmed. A successful restart and bounded health monitoring are not a permanent root-cause fix or a guarantee of upstream availability. No speculative parser or background-worker rewrite was included in this commit. If the stall recurs, capture a JavaScript profile while it is blocked before changing refresh architecture.

## Remaining scope

These changes prevent misleading substitutions and report precise feasibility limits. They do not supply validated two-year policy-event history, actual contract publication timestamps, trading-session holds, a complete historical news archive, or the point-in-time intraday execution pipeline needed to measure a pre-news advantage. Rule recognition remains conservative and pattern based.
