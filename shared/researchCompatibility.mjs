/** Enforced at dispatch as well as during planning. A model cannot expand the user's study silently. */
export function researchToolRefusal(intent, tool, args) {
  if (!['run_backtest', 'search_signals'].includes(tool)) return '';
  if (intent.route === 'assessment' || intent.domains.some(d => ['legislation', 'regulation'].includes(d))) {
    return 'This question requires a research design and evidence assessment. Stock-disclosure replay and signal optimization do not test the requested policy relationship.';
  }
  if (tool === 'search_signals') {
    const sources = args?.sources || ['congress', 'form4'];
    return Array.isArray(sources) && sources.length && sources.every(source => intent.allowedSources.includes(source)) ? '' : 'Signal optimization sources are outside the resolved research task. Specify compatible sources before searching.';
  }
  const source = args?.spec?.source;
  if (!intent.allowedSources.includes(source)) {
    return `Source ${String(source || '(missing)')} is outside the resolved research task. Requested sources: ${intent.allowedSources.join(', ') || 'unresolved'}. Ask for the intended source instead of substituting one.`;
  }
  return '';
}
