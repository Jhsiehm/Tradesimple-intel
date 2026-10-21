import { interpretResearch } from '../../shared/researchIntent.mjs';
import { researchCapabilities } from './researchCapabilities.mjs';
import { preNewsRequirements, unsupportedReplayRules } from '../../shared/replayRequirements.mjs';

const LABELS = {
  legislation: 'legislative actions', regulation: 'regulatory changes',
  contracts: 'contract actions', lobbying: 'lobbying activity',
  congress: 'officials’ disclosed stock trades', form4: 'insider stock filings'
};

/** A bounded, deterministic feasibility receipt before any incompatible calculation or paid model call. */
export function researchRouting(question, options = {}) {
  const intent = interpretResearch(question, options);
  const scopedQuestion = [intent.contextQuestion, question].filter(Boolean).join('\n');
  const catalog = researchCapabilities(options.env);
  const scope = [...new Set([...intent.domains, ...intent.allowedSources])];
  const capabilities = catalog.filter(item => scope.includes(item.domain));
  const assessment = intent.route === 'assessment' ? {
    version: 1, kind: 'capability-assessment', status: scope.length ? 'unsupported-design' : 'needs-clarification',
    intent, capabilities, coverageAudited: false, executed: false,
    requirements: scope.length ? [
      'Define event types, company universe and exposure rules before looking at returns or later award winners.',
      'Freeze primary records, document versions, publication evidence and historical entity/security mappings.',
      'Audit requested-period completeness, price coverage, revisions and missing observations.',
      'Choose an event study, predictive test or executable strategy; specify comparison, timing, costs and holdout before calculation.',
      ...unsupportedReplayRules(scopedQuestion),
      ...(intent.domains.includes('legislation') ? preNewsRequirements(scopedQuestion) : [])
    ] : ['Identify the signal or event and the companies/universe to test. No default source has been selected.']
  } : null;
  return { intent, assessment };
}

export function assessmentAnswer(assessment) {
  const { intent, capabilities, requirements } = assessment;
  const domains = [...new Set([...intent.domains, ...intent.allowedSources])].map(d => LABELS[d] || d).join(', ');
  const scopedQuestion = [intent.contextQuestion, intent.question].filter(Boolean).join('\n');
  const unsupportedRules = unsupportedReplayRules(scopedQuestion);
  const lines = [
    '**Research capability assessment — no backtest executed.**', '',
    `**Your question:** ${intent.question}`,
    ...(intent.contextQuestion ? [`**Research context retained:** ${intent.contextQuestion}`] : []), '',
    domains
      ? `**Interpreted task:** ${intent.family === 'causal' ? 'Assess a causal policy relationship' : intent.family === 'predictive' ? 'Evaluate predictive information' : 'Evaluate an investment strategy'} using ${domains}.`
      : '**Interpreted task:** A strategy evaluation with an unresolved signal source. No default source has been selected.',
    ...(intent.windows.length ? [`**Requested periods:** ${intent.windows.join('; ')}. Evaluation periods do not establish a holding period.`] : []),
    ...(intent.benchmark ? ['**Requested benchmark:** S&P 500 (SPY).'] : []), '',
    '**Feasibility:** The requested design is not ready to execute through the current research tools. This is a software capability assessment; historical data coverage has not been audited.', ''
  ];
  if (unsupportedRules.length) lines.push('**Unsupported execution rules:**', ...unsupportedRules.map(rule => `- ${rule}`), 'No default holding period has been substituted.', '');
  const preNews = intent.domains.includes('legislation') ? preNewsRequirements(scopedQuestion) : [];
  if (preNews.length) lines.push('**Pre-news study gaps:**', ...preNews.map(gap => `- ${gap}`), '');
  if (intent.domains.includes('legislation')) lines.push('**Policy research workflow:** [Open Policy research](#research/policy) to lock the question and rules, collect cited legislative/news records, inspect exact gaps, and import reviewed exposures and one-minute prices. Complete inputs support a conditional paired event-return comparison and a frozen export with offline replay. This is not a verified historical strategy result.', '');
  if (capabilities.length) {
    lines.push('**Available pieces and exact gaps:**');
    for (const item of capabilities) {
      lines.push(`- **${item.label}** — lookup: ${item.lookup.replaceAll('-', ' ')}; analysis: ${item.analysis.replaceAll('-', ' ')}. ${item.limitation}`);
    }
    const plan = requirements.filter(r => !unsupportedRules.includes(r) && !preNews.includes(r));
    lines.push('', '**Proposed research plan:**', ...plan.map((text, i) => `${i + 1}. ${text}`));
    if (intent.outcome === 'procurement') lines.push('', 'The outcome is later procurement activity. A stock-return replay does not evaluate that prediction.');
    if (intent.family === 'causal') lines.push('', 'A causal conclusion additionally requires a defensible comparison and identification assumptions; before/after returns alone do not establish causality.');
    lines.push('', unsupportedRules.length
      ? '**Next step:** Implement and validate trading-session holding periods, or explicitly request a calendar-day approximation.' + (intent.domains.includes('contracts') ? ' Contract replay also uses assumed publication delays and a sampled award feed; it cannot certify actual historical availability or complete period coverage.' : '')
      : '**Next step:** Specify the company universe or policy/program and the event types to investigate. A supported evidence/coverage investigation can be scoped first. Any simpler contract-only or lobbying-only replay must be requested explicitly and would answer a narrower question.');
  } else {
    lines.push('**Clarification needed:** Which event or signal should trigger an investment, and for which companies? The existing replay sources are officials’ stock disclosures, insider filings, contract actions and ticker-specific lobbying spikes. Policy events require their own evidence and design.');
  }
  lines.push('', 'Officials’ personal stock portfolios have not been substituted for policy events. No strategy performance or investable edge has been established.');
  return lines.join('\n');
}

export function researchScopeNote(intent) {
  return `Research task guard: ${JSON.stringify(intent)}. Preserve this task. Do not replace policy actions with personal stock disclosures. Tool registration/configuration does not certify historical coverage. Only call run_backtest for an explicitly compatible source. Do not infer a causal or predictive result from an unrelated replay. A supported feasibility or evidence-gap answer is valid; do not invent results.`;
}
