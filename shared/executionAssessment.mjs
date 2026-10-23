/** Execution interpretation for the daily signal-return engine. No external evidence is inferred. */
export function assessExecution({ rules, trades = [], calendar = null }) {
  const shortTrades = trades.filter(t => t.side === 'sell').length;
  const markedOpenTrades = trades.filter(t => t.open).length;
  const oneWayBps = rules.costBps + rules.slippageBps;
  const gates = [
    { id: 'capital', status: 'unverified', detail: 'No account capital, share quantities, cash ledger, financing, settlement or allocation rejection is simulated. Size hints are relative weights, not dollar orders.' },
    { id: 'turnover', status: 'unmodeled', detail: 'Weights normalize daily over contributing signal paths. Only signal entry and exit costs are charged; allocation changes and daily rebalancing turnover are not charged.' },
    { id: 'liquidity', status: 'unverified', detail: 'No historical volume, spread, order participation, market impact, capacity or partial-fill evidence is supplied.' },
    { id: 'fills', status: 'assumed', detail: 'Open/close fills are assumed. Stops and targets are checked at the close and filled at that close; they are not executable intraday orders. Missing stock opens fall back to the close.' },
    { id: 'calendar', status: 'unverified', detail: calendar?.length ? 'A supplied bar calendar adds idle days; it is not a validated exchange calendar. Missing stock bars remove that path from the daily weight denominator until its next bar.' : 'No calendar was supplied. Dates come from contributing paths; missing sessions and absent positions cannot be validated.' },
    { id: 'shorts', status: shortTrades ? 'unmodeled' : 'not_applicable', detail: shortTrades ? 'Sell signals use negative price returns without borrow availability, borrow fees, collateral, margin calls or forced buy-ins. Dividend-adjusted bars do not provide a separate cash dividend liability ledger. Daily-reset short curve returns differ from fixed-entry-notional trade returns.' : 'No included sell signals are scored as shorts.' },
    { id: 'valuation', status: markedOpenTrades ? 'assumed' : 'not_applicable', detail: markedOpenTrades ? 'Open trades are marked at the final bar and charged an assumed exit cost; they are not observed completed fills.' : 'No included trades are marked open.' },
    { id: 'prospective', status: 'unverified', detail: 'This historical calculation does not establish prospective execution or broker-reconciled performance.' },
  ];
  // Exact sensitivity of the engine's arithmetic trade return, not a rerun of its compounded curve.
  const meanGross = trades.length ? trades.reduce((sum, t) => sum + t.ret + 2 * oneWayBps / 10000, 0) / trades.length : null;
  return {
    version: 1,
    classification: 'exploratory_signal_return_simulation',
    executablePortfolio: false,
    liveTradingValidated: false,
    curveBasis: 'Daily normalized weighted signal-path returns, compounded; not a holdings-and-cash account.',
    tradeBasis: 'Fixed-entry-notional signed price return less two one-way costs. This differs from curve compounding, especially for shorts and costs.',
    shortTrades,
    markedOpenTrades,
    gates,
    costSensitivity: {
      scope: 'mean_trade_return_only',
      currentOneWayBps: oneWayBps,
      includesRebalancing: false,
      includesBorrowOrImpact: false,
      scenarios: [...new Set([0, 5, 10, 25, 50, 100, oneWayBps])].sort((a, b) => a - b).map(bps => ({
        oneWayBps: bps,
        meanTradeReturn: meanGross == null ? null : Math.round((meanGross - 2 * bps / 10000) * 1e8) / 1e8,
      })),
    },
  };
}
