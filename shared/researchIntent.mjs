/** Conservative task interpretation. Unresolved inputs never select a default trading source. */
export const RESEARCH_ROUTING_VERSION = 1;

const SPELLING = [
  [/\bbacktets|\bbackets|\bbacktst/g, 'backtest'],
  [/\blegislaiton|\blegisaltion|\blegilaiton|\blegislation/g, 'legislation'],
  [/\blegialative|\blegiasltive|\blegisaltive/g, 'legislative'],
  [/\bregultiona|\bregultion|\bregulaiton/g, 'regulation'],
  [/\blobbyin\b|\blobying\b/g, 'lobbying'],
  [/\baciton\b/g, 'action'],
  [/\baproapiete\b|\bappropriete\b/g, 'appropriated']
];
export function researchWords(question) {
  let text = String(question || '').toLowerCase().replace(/[’‘]/g, "'");
  for (const [pattern, replacement] of SPELLING) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, ' ').trim();
}

// Explicit exclusions do not become requested sources or policy triggers.
function positiveWords(question) {
  return researchWords(question)
    .replace(/\b(?:not|without|exclude|excluding|ignore|rather than)\s+(?:personal\s+|congressional\s+)?(?:stock\s+)?(?:trades?|portfolios?|legislation|legislative events?|regulation|regulatory changes?|lobbying|contracts?|insiders?)(?:\s+disclosures?)?/g, ' ');
}

export function policyDomains(question) {
  const q = positiveWords(question).replace(/\bappropriations committee\b|\bcommittee on appropriations\b/g, 'committee');
  const domains = [];
  if (/\blegislat\w*|\bmark[- ]?ups?\b|\bbills?\b|\bamendments?\b|\bappropriat\w*|\benact\w*|\blaws?\b|\b(?:committee|floor|house|senate|congress|congressional) (?:actions?|votes?|passage|language)\b|\broll[- ]calls?\b/.test(q)) domains.push('legislation');
  if (/\bregulat\w*|\brulemak\w*|\bfinal rules?\b|\bagency rules?\b/.test(q)) domains.push('regulation');
  if (/\blobby\w*/.test(q)) domains.push('lobbying');
  if (/\bcontracts?\b|\bawards?\b|\bprocurement\b|\busaspending\b/.test(q)) domains.push('contracts');
  return domains;
}

export function explicitSignalSources(question) {
  const q = positiveWords(question);
  const domains = policyDomains(question);
  // Preserve the legacy meaning of the explicit catalog-wide shortcut, never extend it to all policy events.
  if (/\b(?:all (?:data )?sources|every source|each source)\b/.test(q) && !domains.includes('legislation') && !domains.includes('regulation')) return ['congress', 'form4', 'contracts'];
  const sources = [];
  const officials = /\bcongress\w*|\bmembers?\b|\bsenators?\b|\brepresentatives?\b|\bhouse\b|\bsenate\b|\bpoliticians?\b|\bptrs?\b|\bpelosi\b/.test(q);
  const personal = /\btrades?\b|\bbuys?\b|\bsells?\b|\bpurchases?\b|\bportfolios?\b|\bdisclos\w*|\bptrs?\b/.test(q);
  if ((officials || /\bcommittee/.test(q)) && personal) sources.push('congress');
  if (/\binsiders?\b|\bform ?4\b|\bexecutives?\b|\bofficers?\b|\bceo\b/.test(q)) sources.push('form4');
  if (domains.includes('contracts')) sources.push('contracts');
  if (domains.includes('lobbying')) sources.push('lobbying');
  return sources;
}

const EMPIRICAL = /\bback-?test|\breplay\b|\bsimulat\w*|\bstrateg\w*|\bpredict\w*|\bcaus\w*|\bimpact\b|\beffect\b|\bprofit\w*|\binvest\w*|\btrading\b|\bhistorical (?:data|performance)\b|\bhow would .*performed\b/;
const REFINEMENT = /^(?:and |now |what if|what about|try |instead|same|rerun|re-run|hold|compare|exclude|excluding|without|include|only|use |switch|change|make it|with |vs\.? |versus|against|drop|just|go ahead|do it|yes\b)/;

export function interpretResearch(question, { prior = null, priors = [], history = [], context = null } = {}) {
  const original = String(question || '');
  const current = positiveWords(original);
  const previous = [...history].reverse().find(turn => turn.role === 'user')?.content || '';
  const contextual = REFINEMENT.test(current) && previous && EMPIRICAL.test(researchWords(previous));
  const previousDomains = contextual ? policyDomains(previous) : [];
  // Only inherit unresolved policy research, never silently carry a personal-trade source into a new task.
  const explicitReplacement = explicitSignalSources(original).length > 0 && !policyDomains(original).some(d => ['legislation', 'regulation'].includes(d)) && /\bback-?test|\breplay\b|\binstead\b|\bonly\b/.test(current);
  const inherited = !explicitReplacement && previousDomains.some(d => ['legislation', 'regulation'].includes(d));
  const scoped = inherited ? `${previous}\n${original}` : original;
  const q = positiveWords(scoped);
  const domains = policyDomains(scoped);
  const sources = explicitSignalSources(original);
  const empirical = EMPIRICAL.test(q) || (domains.length > 0 && /\breturns?\b|\bstock prices?\b|\btest\b|\boutperform\w*|\bbeats?\b/.test(q)) || (contextual && domains.length > 0);
  const causal = /\bcaus\w*|\battribut\w*|\bimpact of\b|\beffect of\b/.test(q);
  const procurement = /\bpredict\w*[^?.;]*(?:contracts?|awards?|obligations?|procurement)|\b(?:contracts?|awards?)\b[^?.;]*\bpredicted? by\b/.test(q);
  const outcome = causal ? 'causal-effect' : procurement ? 'procurement' : /\bpredict\w*/.test(q) ? 'prediction' : empirical ? 'market-performance' : 'description';
  const combined = sources.length > 1 && /\bcombin\w*|\bjoint\w*|\btogether\b|\bconverg\w*|\bmulti[- ]factor/.test(q);
  const eventStudy = /\bevent stud(?:y|ies)\b|\babnormal returns?\b/.test(q);
  const policy = domains.some(d => ['legislation', 'regulation'].includes(d));
  const priorReference = prior && /\b(?:this|that|last|previous) (?:run|result|backtest)\b|\b(?:those|these) (?:trades|results|members|tickers|signals)\b/.test(current) && !policy;
  const chartReview = !!context?.chart && /\breview\b|\battached chart\b/.test(q);
  let route = 'conversation';
  let reason = '';
  if ((empirical && (policy || causal || procurement || combined || outcome === 'prediction')) || eventStudy) {
    route = 'assessment';
    reason = 'The requested policy, predictive or causal design is not an executable signal-replay specification.';
  } else if ((empirical || priorReference || (prior && REFINEMENT.test(current) && !policy)) && !chartReview) {
    if (sources.length || priorReference || (prior && REFINEMENT.test(current) && !domains.length)) route = 'legacy';
    else {
      route = 'assessment';
      reason = 'The strategy does not identify a supported signal source; no source was assumed.';
    }
  }
  const windows = [...q.matchAll(/\b(\d+|one|two)\s*[- ]?(years?|months?|weeks?|days?)\b/g)]
    .map(m => `${({ one: 1, two: 2 })[m[1]] || m[1]} ${m[2]}`);
  const inheritSources = prior && (REFINEMENT.test(current) || priorReference) && !/\bcongress\w*|\binsiders?\b|\bform ?4\b|\bcontracts?\b|\blobby\w*/.test(current);
  const allowedSources = route === 'legacy' && (inheritSources || !sources.length)
    ? [...new Set(priors.length ? priors.map(p => p.source) : [prior.source])] : sources;
  return {
    version: RESEARCH_ROUTING_VERSION, question: original,
    contextQuestion: inherited ? previous : null,
    family: causal ? 'causal' : outcome === 'prediction' || procurement ? 'predictive' : empirical ? 'strategy' : 'descriptive',
    domains, outcome, route, reason, allowedSources,
    windows: [...new Set(windows)], benchmark: /\bs&p\s*(?:500)?|\bspy\b|\bsp500\b/.test(q) ? 'SPY' : null
  };
}
