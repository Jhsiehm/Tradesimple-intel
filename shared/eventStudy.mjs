/** Descriptive market-adjusted event windows over immutable daily close snapshots. */
import {dayOf,isoOf} from './backtest.mjs';
export const EVENT_STUDY_VERSION=1;
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&dayOf(s)!==null&&isoOf(dayOf(s))===s;
export function cleanEventStudy(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['from','to','before','after','sides'].includes(k)))throw Error('Provide only event dates, before/after sessions and sides.');
 if(!date(raw.from)||!date(raw.to)||raw.from>raw.to)throw Error('Use valid publication dates with start on or before end.');
 const before=raw.before??5,after=raw.after??10,sides=raw.sides??'both';
 if(!Number.isInteger(before)||before<0||before>20||!Number.isInteger(after)||after<0||after>60)throw Error('Use 0–20 sessions before and 0–60 sessions after the anchor.');
 if(!['buy','sell','both'].includes(sides))throw Error('Select buy, sell or both publication sides.');
 return {from:raw.from,to:raw.to,before,after,sides};
}
const validClose=row=>Array.isArray(row)&&Number.isInteger(row[0])&&typeof row[2]==='number'&&Number.isFinite(row[2])&&row[2]>0;
function indexBars(rows){
 const map=new Map();
 for(const row of rows||[]){if(!Array.isArray(row)||!Number.isInteger(row[0]))throw Error('Price snapshots contain an invalid session date.');if(map.has(row[0]))throw Error('Price snapshots contain duplicate sessions.');map.set(row[0],row);}
 return map;
}
export function runEventStudy({base,spec:raw}){
 const spec=cleanEventStudy(raw);
 if(!base||base.kind||!Array.isArray(base.signals)||base.signals.length>1500||new Set(base.signals.map(s=>s.id)).size!==base.signals.length)throw Error('Event studies require a single-source snapshot with at most 1,500 unique signals.');
 const benchmark=indexBars(base.benchBars?.SPY),sessions=[...benchmark.keys()].sort((a,b)=>a-b);
 if(sessions.length<2)throw Error('The frozen source must contain SPY prices. Run the source experiment with SPY first.');
 const stocks=new Map(),groups=new Map(),decisions=[];
 for(const signal of [...base.signals].sort((a,b)=>String(a.id).localeCompare(String(b.id)))){
  if(!date(signal.signalDate)||!['buy','sell'].includes(signal.side)||typeof signal.symbol!=='string')throw Error('Invalid frozen source signal.');
  const decision={signalId:signal.id,symbol:signal.symbol,publicDate:signal.signalDate,side:signal.side,anchorDate:null,eventId:null,reason:'included'};decisions.push(decision);
  if(signal.signalDate<spec.from||signal.signalDate>spec.to){decision.reason='outside-publication-window';continue;}
  if(spec.sides!=='both'&&signal.side!==spec.sides){decision.reason='side-filter';continue;}
  const anchor=sessions.findIndex(d=>d>dayOf(signal.signalDate));
  if(anchor<0){decision.reason='no-anchor-session';continue;}
  decision.anchorDate=isoOf(sessions[anchor]);decision.eventId=`${signal.symbol}:${decision.anchorDate}`;
  if(!groups.has(decision.eventId))groups.set(decision.eventId,{id:decision.eventId,symbol:signal.symbol,anchor,anchorDate:decision.anchorDate,records:[]});
  groups.get(decision.eventId).records.push(decision);
 }
 const events=[];
 for(const group of [...groups.values()].sort((a,b)=>a.anchor-b.anchor||a.symbol.localeCompare(b.symbol))){
  const start=group.anchor-spec.before,end=group.anchor+spec.after;
  let reason=start<1||end>=sessions.length?'incomplete-calendar-window':null;
  if(!stocks.has(group.symbol))stocks.set(group.symbol,indexBars(base.bars[group.symbol]));
  const prices=stocks.get(group.symbol);
  if(!reason)for(let i=start-1;i<=end;i++){
   if(!validClose(benchmark.get(sessions[i]))){reason='missing-benchmark-close';break;}
   if(!validClose(prices.get(sessions[i]))){reason='missing-security-close';break;}
  }
  if(reason){for(const record of group.records)record.reason=reason;continue;}
  let car=0,stockGrowth=1,marketGrowth=1;
  const path=[];
  for(let i=start;i<=end;i++){
   const securityReturn=prices.get(sessions[i])[2]/prices.get(sessions[i-1])[2]-1;
   const benchmarkReturn=benchmark.get(sessions[i])[2]/benchmark.get(sessions[i-1])[2]-1;
   const abnormalReturn=securityReturn-benchmarkReturn;car+=abnormalReturn;stockGrowth*=1+securityReturn;marketGrowth*=1+benchmarkReturn;
   path.push({offset:i-group.anchor,date:isoOf(sessions[i]),securityReturn,benchmarkReturn,abnormalReturn,cumulativeAbnormalReturn:car});
  }
  events.push({id:group.id,symbol:group.symbol,anchorDate:group.anchorDate,from:isoOf(sessions[start]),to:isoOf(sessions[end]),signalIds:group.records.map(r=>r.signalId),sides:[...new Set(group.records.map(r=>r.side))].sort(),path,car,buyHoldAbnormalReturn:stockGrowth-marketGrowth,overlappingEventIds:[]});
 }
 // Retain dependent windows and expose them; no independence-based significance claims.
 for(let i=0;i<events.length;i++)for(let j=i+1;j<events.length;j++)if(events[i].symbol===events[j].symbol&&events[i].from<=events[j].to&&events[j].from<=events[i].to){events[i].overlappingEventIds.push(events[j].id);events[j].overlappingEventIds.push(events[i].id);}
 const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
 const curve=events.length?events[0].path.map((p,i)=>({offset:p.offset,n:events.length,meanSecurityReturn:mean(events.map(e=>e.path[i].securityReturn)),meanBenchmarkReturn:mean(events.map(e=>e.path[i].benchmarkReturn)),aar:mean(events.map(e=>e.path[i].abnormalReturn)),caar:mean(events.map(e=>e.path[i].cumulativeAbnormalReturn))})):[];
 const exclusions={};for(const d of decisions)if(d.reason!=='included')exclusions[d.reason]=(exclusions[d.reason]||0)+1;
 return {version:EVENT_STUDY_VERSION,spec,benchmark:'SPY',counts:{publications:base.signals.length,eligiblePublications:[...groups.values()].reduce((n,g)=>n+g.records.length,0),candidateEvents:groups.size,completeEvents:events.length,excludedEvents:groups.size-events.length,includedPublications:events.reduce((n,e)=>n+e.signalIds.length,0),overlappingEvents:events.filter(e=>e.overlappingEventIds.length).length},exclusions,decisions,events,curve,summary:events.length?{meanCar:mean(events.map(e=>e.car)),meanBuyHoldAbnormalReturn:mean(events.map(e=>e.buyHoldAbnormalReturn))}:null,caveats:[
  'Descriptive association around public disclosure, not a causal estimate, trading strategy, factor model or new out-of-sample evaluation.',
  'Session zero is the first saved SPY session strictly after the publication date. Intraday release times are unavailable; same-day reactions can precede session zero.',
  'Windows use saved SPY session dates and close-to-close returns. A complete window requires each security and benchmark close plus the preceding close; missing windows are excluded as a whole without imputation. Calendar completeness is not independently certified.',
  'One equal-weight event per ticker and anchor session; all contributing publication IDs and sides remain visible. Sell disclosures are not sign-inverted. Both sides may share an event.',
  'Daily abnormal return is security return minus SPY return. CAR is their arithmetic sum; buy-and-hold abnormal return is the difference of compounded security and benchmark returns. These are different estimands.',
  'Every relative-session mean uses the same complete-event cohort. Excluded coverage can bias that cohort. No transaction costs, portfolio capital allocation or investability claims apply.',
  'Overlapping same-ticker windows are flagged and retained. Cross-security and time dependence also remain; no independent-event p-values or confidence intervals are reported.',
  'The original source selection, caps, public-date assertions, current security identities and saved price-adjustment limitations remain. Pre-event observations are descriptive and must not enter historical decision rules.'
 ]};
}
