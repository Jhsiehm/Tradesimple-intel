/** Requirements the current calendar-day signal replay cannot silently approximate. */
export function unsupportedReplayRules(question) {
  const q = String(question || "").toLowerCase();
  const tradingHold =
    /\bhold(?:ing)?(?:\s+(?:for|period(?:\s+of)?))?\s+(?:\d+|one|two|thirty)\s+(?:trading|business|market)\s+days?\b|\b\d+[- ](?:trading|business|market)[- ]days?[- ]holds?\b/.test(
      q,
    );
  return tradingHold
    ? [
        "The replay engine measures holding periods in calendar days, not trading sessions. It cannot execute the requested trading-day hold without changing the rule.",
      ]
    : [];
}

/** Only explicit uppercase lists; prose and benchmarks outside the list are not symbols. */
export function replayTickerList(question) {
  const text = String(question || "");
  const list = /\b(?:for|tickers?)\s+((?:\$?[A-Z][A-Z0-9.-]{0,9}\s*,\s*)+(?:and\s+)?\$?[A-Z][A-Z0-9.-]{0,9})\b/.exec(
    text,
  );
  return list ? [...new Set(list[1].match(/\$?[A-Z][A-Z0-9.-]{0,9}/g).map((s) => s.replace(/^\$/, "")))] : [];
}

/** A limited news archive can establish only its own first observed coverage. */
export function preNewsRequirements(question) {
  const q = String(question || "").toLowerCase();
  if (!/\bpre[- ]news\b|\bbefore\b[^.!?]{0,100}\b(?:news|media|headlines|press)\b|\bbeat\b[^.!?]{0,50}\bnews\b/.test(q))
    return [];
  return [
    "Verified public-availability timestamps for legislative records are required. A vote/action time or calendar action date is not a public-availability timestamp.",
    "Company and sector exposure mappings must be fixed using information available before inspecting returns.",
    "A specified timestamped historical news archive and coverage audit are required. Earliest coverage found in that archive is not global first news; missing coverage is not evidence of no news.",
    "Entry must follow verified record availability plus processing/execution delay, and precede that archive’s earliest observed coverage. Daily price bars cannot establish an intraday pre-news advantage; timestamped intraday prices are required.",
    "Pre-news execution feasibility and evidence of higher returns are separate tests. The required point-in-time records, archive and intraday price pipeline are not connected to this replay.",
  ];
}
