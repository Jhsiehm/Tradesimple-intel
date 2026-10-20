export const DAY = 86400000;
export const INTERVALS = ['1m','5m','15m','30m','1h','4h','1d','1wk','1mo'];
export const RANGES = ['1d','5d','1mo','3mo','6mo','ytd','1y','5y','max'];
export const retentionDays = interval => interval === '1m' ? 7 : ['5m','15m','30m'].includes(interval) ? 60 : interval === '1h' ? 730 : 365*100;
export function windowStart(range, now = Date.now()) {
  if (range === 'ytd') return Date.UTC(new Date(now).getUTCFullYear(),0,1);
  return Math.max(0, now - ({'1d':1,'5d':5,'1mo':31,'3mo':93,'6mo':183,'1y':366,'5y':1827,max:365*100}[range] || 31)*DAY);
}
export function intervalReason(interval, range, now = Date.now()) {
  if (interval === '4h') return 'Yahoo has no native 4-hour bars; session-aware aggregation is not available.';
  return now-windowStart(range,now) > retentionDays(interval)*DAY ? `Provider policy limits ${interval} history to ${retentionDays(interval)} calendar days. Choose a shorter range or coarser interval.` : '';
}
export function defaultInterval(range) { return ({'1d':'1m','5d':'5m','1mo':'1h','3mo':'1d','6mo':'1d',ytd:'1d','1y':'1d','5y':'1wk',max:'1mo'})[range] || '1d'; }
/** No candles are invented. Last valid duplicate wins, and gaps remain gaps. */
export function mergeBars(...sets) {
  const map = new Map();
  for (const b of sets.flat()) {
    if (![b.t,b.o,b.h,b.l,b.c].every(Number.isFinite) || b.t <= 0 || b.h < Math.max(b.o,b.c,b.l) || b.l > Math.min(b.o,b.c,b.h)) continue;
    map.set(b.t,{...b,v: Number.isFinite(b.v) && b.v >= 0 ? b.v : null});
  }
  return [...map.values()].sort((a,b)=>a.t-b.t);
}
export function sma(values, n) { let total=0; return values.map((v,i)=>{total+=v;if(i>=n)total-=values[i-n];return i>=n-1?total/n:null;}); }
export function ema(values,n) { const out=Array(values.length).fill(null); if(values.length<n)return out;let v=values.slice(0,n).reduce((a,b)=>a+b,0)/n;out[n-1]=v;for(let i=n;i<values.length;i++){v+=(values[i]-v)*2/(n+1);out[i]=v;}return out; }
export function rsi(values,n=14) { const out=Array(values.length).fill(null);let gain=0,loss=0;for(let i=1;i<values.length;i++){const d=values[i]-values[i-1];if(i<=n){gain+=Math.max(d,0);loss+=Math.max(-d,0);if(i<n)continue;gain/=n;loss/=n;}else{gain=(gain*(n-1)+Math.max(d,0))/n;loss=(loss*(n-1)+Math.max(-d,0))/n;}out[i]=loss===0?(gain===0?50:100):100-100/(1+gain/loss);}return out; }
export function indicators(bars, zone='UTC') {
 const closes=bars.map(b=>b.c), fast=ema(closes,12),slow=ema(closes,26);
 const macd=closes.map((_,i)=>fast[i]!=null&&slow[i]!=null?fast[i]-slow[i]:null);
 const signal=Array(25).fill(null).concat(ema(macd.slice(25),9)).slice(0,bars.length);
 let session='',pv=0,vol=0; const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone});
 const vwap=bars.map(b=>{const day=fmt.format(b.t);if(day!==session){session=day;pv=0;vol=0;}pv+=((b.h+b.l+b.c)/3)*(b.v||0);vol+=b.v||0;return vol?pv/vol:null;});
 return {sma:sma(closes,20),sma50:sma(closes,50),ema:ema(closes,20),rsi:rsi(closes),macd,signal,vwap};
}
export function cleanLayout(raw) {
 const modes=['single','evidence','two','four'];
 const symbol=v=>typeof v==='string'&&/^[A-Za-z0-9.^=\-]{1,24}$/.test(v)?v.toUpperCase():'AAPL';
 return {version:1,mode:modes.includes(raw?.mode)?raw.mode:'evidence',active:Math.min(3,Math.max(0,Math.floor(Number(raw?.active)||0))),panels:Array.from({length:4},(_,i)=>({symbol:symbol(raw?.panels?.[i]?.symbol||['AAPL','MSFT','NVDA','LMT'][i]),group:['A','B'].includes(raw?.panels?.[i]?.group)?raw.panels[i].group:'Independent'}))};
}
/** Generation token makes late results harmless even if a provider cannot cancel. */
export function requestGuard(){let generation=0;return {next:()=>++generation,current:id=>id===generation};}

/** A reviewed chart snapshot travels as explicit context, not through the 800-character question field. */
export function cleanChartContext(raw) {
 if(!raw||typeof raw!=='object'||!/^[A-Z0-9.^=\-]{1,24}$/.test(raw.symbol||'')||!INTERVALS.includes(raw.interval)||!Number.isFinite(Date.parse(raw.from))||!Number.isFinite(Date.parse(raw.to))||Date.parse(raw.from)>Date.parse(raw.to)||!Array.isArray(raw.events)||raw.events.length>20)return null;
 const fields=['symbol','label','eventDate','publicationDate','ingestedAt','datasetVersion','amount','source','dateBasis','limitation'];
 const events=[];for(const event of raw.events){if(!event||typeof event!=='object')return null;const out={};for(const key of fields){const value=event[key];if(value!=null&&(typeof value!=='string'||value.length>4096))return null;out[key]=value??null;}events.push(out);}
 return {symbol:raw.symbol,interval:raw.interval,from:raw.from,to:raw.to,events};
}

export function calendarBucket(t, interval, zone='UTC') {
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(t);
 const value=kind=>Number(parts.find(p=>p.type===kind).value);
 const date=Date.UTC(value('year'),value('month')-1,interval==='1mo'?1:value('day'));
 return interval==='1wk'?date-((new Date(date).getUTCDay()+6)%7)*DAY:date;
}
/** Aggregate observed daily bars by exchange-local calendar periods. No holiday/absent bars are inserted. */
export function aggregateCalendar(bars,interval,zone='UTC') {
 const groups=new Map();for(const b of mergeBars(bars)){const key=calendarBucket(b.t,interval,zone),prior=groups.get(key);groups.set(key,prior?{t:key,o:prior.o,h:Math.max(prior.h,b.h),l:Math.min(prior.l,b.l),c:b.c,v:prior.v==null||b.v==null?null:prior.v+b.v}:{...b,t:key});}return [...groups.values()];
}
/** Yahoo's zero-volume point quote inside the last native bar is not a new candle. */
export function mergeTrailingQuote(bars,interval) {
 const seconds=({'1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600})[interval];
 if(!seconds||bars.length<2)return bars;const last=bars.at(-1),prev=bars.at(-2);
 if(last.t-prev.t<seconds*1000&&last.v===0&&last.o===last.h&&last.h===last.l&&last.l===last.c)return [...bars.slice(0,-2),{...prev,h:Math.max(prev.h,last.c),l:Math.min(prev.l,last.c),c:last.c}];return bars;
}
