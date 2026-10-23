import{n as e,t}from"./jsx-runtime-vKRSicjO.js";import{Mt as n,ft as r}from"./index-DKdUD2VB.js";var i=e(),a=t(),o=864e5,s=1e6,c=e=>new Date(e*o).toISOString().slice(0,10),l=(e,t=4)=>e==null||!Number.isFinite(e)?`\\text{n/a}`:String(Math.round(e*10**t)/10**t),u=(e,t=2)=>e==null||!Number.isFinite(e)?`\\text{n/a}`:`${(e*100).toFixed(t)}\\%`,d=e=>`\\$${Number(e).toLocaleString(`en-US`)}`,f=e=>`\\text{${String(e).replace(/[\\{}$%&#_^~]/g,e=>`\\${e}`)}}`,p=(e=[])=>[...e].filter(e=>e.entryPrice>0&&e.exitPrice>0).sort((e,t)=>e.entry.localeCompare(t.entry))[0]||null;function m(e){let t=e?.stats,n=e?.rules||e?.spec?.rules;if(!t||!n)return[];let r=p(e.trades),i=(n.costBps+n.slippageBps)/1e4,a=r?.side===`sell`?-1:1,o=n.benchmark===`SECTOR`?`sector ETF`:n.benchmark,c=t.trades,m=t.wins??Math.round((t.hitRate??0)*c),h=[],g=(e,t,n,r,i=``)=>h.push({id:e,title:t,tex:n,worked:r,note:i});g(`entry`,`Entry rule`,`t_{\\text{in}} = \\min\\{\\, d \\in \\text{trading days} : d > d_{\\text{public}} \\,\\},\\quad t_{\\text{in}} - d_{\\text{public}} \\le 7,\\quad P_{\\text{in}} = \\text{${n.entry===`nextOpen`?`Open`:`Close`}}(t_{\\text{in}})`,r?`${f(r.symbol)}:\\ d_{\\text{public}} = ${f(r.signal)} \\Rightarrow t_{\\text{in}} = ${f(r.entry)},\\ P_{\\text{in}} = ${l(r.entryPrice)}`:``,`The public date is the filing or posting date, never the trade date, so nothing enters before it was knowable.`),g(`exit`,`Exit rule`,`t_{\\text{out}} = \\min\\{\\, d \\ge t_{\\text{in}} : d - t_{\\text{in}} \\ge H${n.stopLossPct?`\\ \\lor\\ s\\,(C_d/P_{\\text{in}} - 1) \\le -${n.stopLossPct/100}`:``}${n.takeProfitPct?`\\ \\lor\\ s\\,(C_d/P_{\\text{in}} - 1) \\ge ${n.takeProfitPct/100}`:``} \\,\\},\\quad P_{\\text{out}} = C_{t_{\\text{out}}}`,r?`H = ${n.holdDays}\\ \\text{days}:\\ ${f(r.entry)} \\to ${f(r.exit)}\\ (${r.days}\\ \\text{days}, ${f(r.why)}),\\ P_{\\text{out}} = ${l(r.exitPrice)}`:`H = ${n.holdDays}`,n.openTrades===`mark`?`Positions that have not reached their exit are marked at the last close (exit reason: open).`:`Positions that have not reached their exit are left out.`),g(`costs`,`Costs and slippage`,`c = \\frac{\\text{commission}_{\\text{bps}} + \\text{slippage}_{\\text{bps}}}{10^4}\\ \\text{per side},\\qquad \\text{round trip} = 2c`,`c = \\frac{${n.costBps} + ${n.slippageBps}}{10^4} = ${l(i,6)},\\quad 2c = ${u(2*i,3)}`),g(`trade`,`Trade return`,`r_i = s_i \\left( \\frac{P_{\\text{out}}}{P_{\\text{in}}} - 1 \\right) - 2c,\\qquad s_i = \\begin{cases} +1 & \\text{buy} \\\\ -1 & \\text{sell (short)} \\end{cases}`,r?`r = ${a>0?``:`-`}\\left(\\frac{${l(r.exitPrice)}}{${l(r.entryPrice)}} - 1\\right) - ${l(2*i,6)} = ${u(r.ret)}`:``),g(`sizing`,`Position weight`,n.sizing===`amountMid`?`w_i = \\min\\!\\left( \\frac{L_i + U_i}{2},\\ ${d(s)} \\right)\\quad \\text{(disclosed range } [L_i, U_i]\\text{)}`:`w_i = 1\\quad \\text{(equal weight)}`,n.sizing===`amountMid`?`\\text{e.g. } \\$15{,}001\\text{–}\\$50{,}000 \\Rightarrow w = \\frac{15001 + 50000}{2} = 32500.5${r?.weight?`;\\ ${f(r.symbol)}: w = ${l(r.weight,1)}`:``}`:`w_i = 1\\ \\text{for all } i`,n.sizing===`amountMid`?`Ranges are disclosed, not amounts; the midpoint is an estimate. Missing amounts use the median size.`:``),g(`daily`,`Daily portfolio return`,`R_t = \\frac{\\sum_{i \\in O_t} w_i\\, r_{i,t}}{\\sum_{i \\in O_t} w_i},\\qquad R_t = 0 \\text{ when } O_t = \\varnothing`,`${t.sessions??`n`}\\ \\text{sessions},\\ \\text{average } ${l(t.avgConcurrent,2)}\\ \\text{open},\\ \\text{max } ${t.maxConcurrent}`,`O_t is the set of positions open on day t; r_{i,t} is that day's close-to-close return (net of cost on the entry and exit day). The ${o} leg holds the same weights on the same days.`),g(`total`,`Total return`,`S_T = \\prod_{t=1}^{T} (1 + R_t),\\qquad \\text{Total} = S_T - 1`,`S_T = ${l(t.total==null?null:1+t.total)} \\Rightarrow \\text{Total} = ${u(t.total)}`),g(`annualized`,`Annualized return`,`\\text{Ann} = (1 + \\text{Total})^{365 / D} - 1,\\qquad D = \\text{last day} - \\text{first day} + 1`,t.annualized==null?`D = ${t.spanDays} < 90 \\Rightarrow \\text{not annualized}`:`(1 + ${l(t.total)})^{365/${t.spanDays}} - 1 = ${u(t.annualized)}`),g(`excess`,`Excess vs ${o}`,`\\text{Excess} = \\text{Total} - \\text{Total}_B,\\qquad \\text{Total}_B = \\prod_t (1 + B_t) - 1`,`${u(t.total)} - ${u(t.benchmarkTotal)} = ${u(t.excessTotal)}`,n.benchmark===`^GSPC`?`^GSPC is a price index without dividends; excess is tilted up by roughly the S&P yield.`:``),g(`hit`,`Hit rate`,`\\text{Hit} = \\frac{\\#\\{ i : r_i > 0 \\}}{N}`,`\\frac{${m}}{${c}} = ${u(t.hitRate,1)}`),g(`avg`,`Average and median trade`,`\\bar r = \\frac{1}{N} \\sum_{i=1}^{N} r_i,\\qquad \\tilde r = \\operatorname{median}(r_1, \\dots, r_N)`,`\\bar r = ${u(t.avgTrade)},\\quad \\tilde r = ${u(t.medianTrade)},\\quad N = ${c}`),g(`drawdown`,`Max drawdown`,`\\text{MDD} = \\min_t \\left( \\frac{S_t}{\\max_{u \\le t} S_u} - 1 \\right)`,t.drawdownPeak?`\\frac{${l(t.drawdownTrough)}}{${l(t.drawdownPeak)}} - 1 = ${u(t.maxDrawdown)}\\quad (${f(t.drawdownFrom)} \\to ${f(t.drawdownTo)})`:`${u(t.maxDrawdown)}`),g(`sharpe`,`Sharpe-ish`,`\\text{Sharpe} \\approx \\frac{\\overline{R}}{\\sigma_R} \\sqrt{252},\\qquad \\sigma_R = \\sqrt{\\tfrac{1}{T-1} \\sum_t (R_t - \\overline{R})^2}`,t.dailySd?`\\frac{${l(t.dailyMean,6)}}{${l(t.dailySd,6)}} \\times ${l(Math.sqrt(252),4)} = ${l(t.sharpeish,2)}`:`\\text{n/a}`,`Risk-free rate taken as 0; a rough score on a short, overlapping sample.`);let _=e.reality;if(_?.bootstrap){let e=_.bootstrap;g(`bootstrap`,`Block-bootstrap 95% interval`,`\\bar e^{*(b)} = \\frac{\\sum_{j=1}^{W} \\sum_{i \\in w^{*}_{j}} e_i}{\\sum_{j=1}^{W} |w^{*}_{j}|},\\quad w^{*}_{j} \\sim \\text{Uniform}\\{w_1,\\dots,w_W\\},\\qquad \\text{CI} = \\big[\\bar e^{*}_{(0.025)},\\ \\bar e^{*}_{(0.975)}\\big]`,`W = ${e.blocks}\\ \\text{entry weeks},\\ B = ${e.iters}:\\ \\bar r \\in [${u(e.meanTrade.lo)}, ${u(e.meanTrade.hi)}],\\ \\bar e \\in [${u(e.meanExcess.lo)}, ${u(e.meanExcess.hi)}]`,`Whole entry weeks (Monday-based) are resampled with replacement, so trades bunched in one week stay together. Seed ${_.seed} (mulberry32); the Replicate scripts draw the same sequence.`)}if(_?.placebo){let e=_.placebo,t=e.window?.tradingDays;g(`placebo`,`Random-entry placebo`,`p = \\frac{1 + \\#\\{k : \\bar e^{\\text{rand}}_k \\ge \\bar e\\}}{K + 1},\\qquad \\text{pct} = \\frac{\\#\\{k : \\bar e^{\\text{rand}}_k < \\bar e\\}}{K}`,`\\bar e = ${u(e.actual)},\\ K = ${e.iters},\\ \\text{placebo mean } ${u(e.placeboMean)}\\ \\Rightarrow\\ \\text{pct} = ${u(e.pct,1)},\\ p = ${l(e.p)}`,`Each trade keeps its ticker, side, benchmark and exit rules; its public date is redrawn from the ${t} trading days between the first and last real public date (up to 10 draws until the trade completes). Prices end at the last real exit. Seed ${e.seed}.`)}if(_?.cluster&&_.cluster.t!=null){let e=_.cluster;g(`cluster`,`t-statistic clustered by member`,`\\text{SE}_{\\text{cl}} = \\frac{1}{N} \\sqrt{\\frac{G}{G-1} \\sum_{g=1}^{G} \\Big( \\sum_{i \\in g} (e_i - \\bar e) \\Big)^2},\\qquad t = \\frac{\\bar e}{\\max(\\text{SE}_{\\text{cl}},\\, \\text{SE}_{\\text{iid}})},\\ \\ \\text{df} = G - 1`,`G = ${e.members},\\ \\text{SE}_{\\text{cl}} = ${l(e.seCluster??e.se)},\\ \\text{SE}_{\\text{iid}} = ${l(e.seIid)}:\\ t = \\frac{${l(_.bootstrap?.meanExcess.mean??null)}}{${l(e.se)}} = ${l(e.t,2)},\\ p_{\\text{two-sided}} = ${l(e.pTwo)}`,`Trades by the same person are not independent; this standard error lets them move together. With few or very unequal members the clustered SE can come out too small, so the larger of the two is used. With few members the t distribution is wide.`),g(`neff`,`Effective sample size`,`N_{\\text{eff}} = \\min_{c \\in \\{\\text{member},\\,\\text{week}\\}} N \\left( \\frac{\\text{SE}_{\\text{iid}}}{\\text{SE}_{c}} \\right)^{2},\\qquad \\text{SE}_{\\text{iid}} = \\frac{s_e}{\\sqrt N}`,`N = ${_.n},\\ \\text{SE}_{\\text{iid}} = ${l(e.seIid)} \\Rightarrow N_{\\text{eff}} \\approx ${e.nEff??`n/a`}`,`${e.members} members and ${e.weeks} entry weeks. A design-effect estimate: how many independent trades would carry the same information.`)}return h}var h=760,g=260,_={l:52,r:12,t:12,b:24},v=e=>`${e>=0?`+`:`−`}${Math.abs(e*100).toFixed(1)}%`;function y({curve:e,benchmark:t}){let n=(0,i.useRef)(null),[r,o]=(0,i.useState)(null),s=(0,i.useMemo)(()=>{let t=e.filter(e=>e.s!=null&&e.b!=null);if(t.length<2)return null;let n=t.flatMap(e=>[e.s-1,e.b-1,0]),r=Math.min(...n),i=Math.max(...n),a=Math.max(.02,i-r);r-=a*.06,i+=a*.06;let o=e=>_.l+e/(t.length-1)*(h-_.l-_.r),s=e=>_.t+(1-(e-r)/(i-r))*(g-_.t-_.b),c=e=>t.map((t,n)=>`${n?`L`:`M`}${o(n).toFixed(1)} ${s(t[e]-1).toFixed(1)}`).join(``),l=b(i-r),u=[];for(let e=Math.ceil(r/l)*l;e<=i;e+=l)u.push(Math.round(e*1e6)/1e6);let d=t.flatMap((e,t)=>e.d.slice(8,10)===`01`||t===0?[{i:t,label:e.d.slice(0,7)}]:[]).filter((e,t,n)=>n.length<=8||t%Math.ceil(n.length/8)===0);return{pts:t,x:o,y:s,s:c(`s`),b:c(`b`),ticks:u,months:d}},[e]);if(!s)return(0,a.jsx)(`p`,{className:`bt-empty`,children:`Not enough days to draw a curve.`});let c=r==null?null:s.pts[r];return(0,a.jsxs)(`figure`,{className:`bt-chart`,children:[(0,a.jsxs)(`svg`,{ref:n,viewBox:`0 0 ${h} ${g}`,role:`img`,"aria-label":`Strategy against ${t}, growth since the first entry`,onPointerMove:e=>{let t=n.current.getBoundingClientRect(),r=(e.clientX-t.left)/t.width*h,i=Math.round((r-_.l)/(h-_.l-_.r)*(s.pts.length-1));o(Math.max(0,Math.min(s.pts.length-1,i)))},onPointerLeave:()=>o(null),children:[s.ticks.map(e=>(0,a.jsxs)(`g`,{children:[(0,a.jsx)(`line`,{x1:_.l,x2:h-_.r,y1:s.y(e),y2:s.y(e),className:e===0?`zero`:`grid`}),(0,a.jsx)(`text`,{x:_.l-6,y:s.y(e)+3,textAnchor:`end`,children:v(e)})]},e)),s.months.map(e=>(0,a.jsx)(`text`,{x:s.x(e.i),y:254,textAnchor:`middle`,children:e.label},e.label)),(0,a.jsx)(`path`,{d:s.b,className:`bench`}),(0,a.jsx)(`path`,{d:s.s,className:`strat`}),c&&r!=null?(0,a.jsxs)(`g`,{children:[(0,a.jsx)(`line`,{x1:s.x(r),x2:s.x(r),y1:_.t,y2:g-_.b,className:`cross`}),(0,a.jsx)(`circle`,{cx:s.x(r),cy:s.y(c.s-1),r:3,className:`dot-s`}),(0,a.jsx)(`circle`,{cx:s.x(r),cy:s.y(c.b-1),r:3,className:`dot-b`})]}):null]}),(0,a.jsxs)(`figcaption`,{children:[(0,a.jsxs)(`span`,{className:`key s`,children:[`Strategy`,c?` ${v(c.s-1)}`:``]}),(0,a.jsxs)(`span`,{className:`key b`,children:[t===`SECTOR`?`Sector ETFs`:t,c?` ${v(c.b-1)}`:``]}),(0,a.jsx)(`span`,{className:`when`,children:c?c.d:`${s.pts[0].d} → ${s.pts.at(-1).d}`})]})]})}function b(e){let t=e/5,n=10**Math.floor(Math.log10(t)),r=t/n;return(r>=5?5:r>=2?2:1)*n}var x=null;function S(){return x||=n(()=>import(`./katex-nLxf_RlZ.js`).then(e=>t=>e.default.renderToString(t,{output:`mathml`,throwOnError:!1,displayMode:!1})),[]),x}function C({tex:e,render:t}){return e?t?(0,a.jsx)(`span`,{className:`fx-math`,dangerouslySetInnerHTML:{__html:t(e)}}):(0,a.jsx)(`code`,{className:`fx-raw`,children:e}):null}function w({formulas:e,open:t=!1}){let[n,r]=(0,i.useState)(null),[o,s]=(0,i.useState)(t);return(0,i.useEffect)(()=>{if(!o||n)return;let e=!0;return S().then(t=>{e&&r(()=>t)}).catch(()=>null),()=>{e=!1}},[o,n]),e.length?(0,a.jsxs)(`details`,{className:`fx`,open:t,onToggle:e=>s(e.currentTarget.open),children:[(0,a.jsxs)(`summary`,{children:[`How each number is computed `,(0,a.jsxs)(`small`,{children:[e.length,` formulas, worked with this run's figures`]})]}),o?(0,a.jsx)(`dl`,{children:e.map(e=>(0,a.jsxs)(`div`,{className:`fx-row`,children:[(0,a.jsx)(`dt`,{children:e.title}),(0,a.jsxs)(`dd`,{children:[(0,a.jsx)(`div`,{className:`fx-line`,children:(0,a.jsx)(C,{tex:e.tex,render:n})}),e.worked?(0,a.jsxs)(`div`,{className:`fx-line fx-worked`,children:[(0,a.jsx)(`em`,{children:`this run`}),(0,a.jsx)(C,{tex:e.worked,render:n})]}):null,e.note?(0,a.jsx)(`p`,{className:`fx-note`,children:e.note}):null]})]},e.id))}):null]}):null}var T={version:3,seed:12345,bootIters:2e3,placeboIters:1e3,alpha:.05,draws:10,minTrades:10},E=e=>e==null?`n/a`:e<.001?`p<0.001`:`p=${e<.01?e.toFixed(3):e.toFixed(2)}`,D=(e,t=1)=>e==null?`—`:`${e>=0?`+`:`−`}${Math.abs(e*100).toFixed(t)}%`,O={beat:`up`,worse:`down`};function k({reality:e,compact:t=!1}){if(!e)return null;let{bootstrap:n,placebo:r,cluster:i,verdict:o}=e;return(0,a.jsxs)(`section`,{className:`bt-real${t?` compact`:``}`,"aria-label":`Is it real?`,children:[(0,a.jsxs)(`h3`,{children:[`Is it real? `,(0,a.jsxs)(`small`,{children:[`bootstrap, placebo, clustered t · seed `,e.seed]})]}),(0,a.jsx)(`p`,{className:`bt-verdict ${O[o.level]||``}`,children:o.text}),n?(0,a.jsxs)(`dl`,{children:[(0,a.jsxs)(`div`,{title:`Resampling ${n.blocks} entry weeks, ${n.iters} times`,children:[(0,a.jsx)(`dt`,{children:`Mean trade, 95% CI`}),(0,a.jsxs)(`dd`,{children:[D(n.meanTrade.lo),` to `,D(n.meanTrade.hi)]})]}),(0,a.jsxs)(`div`,{title:`Per-trade return minus the benchmark over the same days`,children:[(0,a.jsx)(`dt`,{children:`Mean excess, 95% CI`}),(0,a.jsxs)(`dd`,{children:[D(n.meanExcess.lo),` to `,D(n.meanExcess.hi)]})]}),r?(0,a.jsxs)(`div`,{title:`Same tickers, side, hold; random public dates in the window. Placebo mean ${D(r.placeboMean)} (middle 95%: ${D(r.placeboLo)} to ${D(r.placeboHi)})`,children:[(0,a.jsx)(`dt`,{children:`vs random entries`}),(0,a.jsxs)(`dd`,{children:[`beat `,Math.floor((r.pct??0)*100),`% of `,r.iters,` · `,E(r.p)]})]}):null,i?(0,a.jsxs)(`div`,{title:`Standard error clustered by ${i.members} members, df ${i.df}`,children:[(0,a.jsx)(`dt`,{children:`t, clustered by member`}),(0,a.jsx)(`dd`,{children:i.t==null?`n/a (one member)`:`${i.t.toFixed(2)} · ${E(i.pTwo)} two-sided`})]}):null,i?.nEff==null?null:(0,a.jsxs)(`div`,{title:`${i.members} members, ${i.weeks} entry weeks`,children:[(0,a.jsx)(`dt`,{children:`Effective sample`}),(0,a.jsxs)(`dd`,{children:[`≈ `,i.nEff,` of `,e.n,` trades`]})]})]}):null,t?null:(0,a.jsx)(`p`,{className:`bt-basis`,children:`In-sample checks on one run. If this spec was picked after trying others, the p-value is too small: see Search for a multiple-testing-corrected view.`})]})}var A=[`trades`,`total`,`annualized`,`benchmarkTotal`,`excessTotal`,`hitRate`,`avgTrade`,`medianTrade`,`maxDrawdown`,`sharpeish`,`spanDays`],j=e=>{let t=e==null?``:String(e);return/[",\n\r]/.test(t)?`"${t.replace(/"/g,`""`)}"`:t},M=(e,t)=>[e.join(`,`),...t.map(e=>e.map(j).join(`,`))].join(`
`)+`
`;function N(e){return Object.fromEntries(A.map(t=>[t,e?.[t]??null]))}function P(e){return e?.bootstrap?{meanTradeLo:e.bootstrap.meanTrade.lo,meanTradeHi:e.bootstrap.meanTrade.hi,meanExcessLo:e.bootstrap.meanExcess.lo,meanExcessHi:e.bootstrap.meanExcess.hi,placeboPct:e.placebo?.pct??null,placeboP:e.placebo?.p??null,clusterT:e.cluster?.t??null,clusterPTwo:e.cluster?.pTwo??null,nEff:e.cluster?.nEff??null}:null}var F=(e,t,n)=>M([`symbol`,`date`,`open_adj`,`close_adj`,`source`,`as_of`],e.flatMap(({symbol:e,bars:r})=>r.map(([r,i,a])=>[e,c(r),i??``,a,t,n])));function I(e){let t=e.trades||[],n={spec:e.spec,description:e.description,expected:N(e.stats),...P(e.reality)?{expectedReality:P(e.reality),realitySettings:{seed:e.reality.seed,bootIters:e.reality.bootstrap.iters,placeboIters:T.placeboIters,draws:T.draws,alpha:T.alpha}}:{},counts:e.counts,window:e.window||null,sources:(e.feeds||[]).map(e=>({label:e.label,source:e.source,asOf:e.asOf,latency:e.latency})),ranAt:e.ranAt,missingPrices:e.missing||[]},r=M([`id`,`symbol`,`side`,`actor`,`public_date`,`trade_date`,`entry`,`exit`,`entry_price`,`exit_price`,`ret`,`bench`,`excess`,`days`,`why`,`open`,`benchmark`,`weight`],t.map(e=>[e.id,e.symbol,e.side,e.actorLabel||e.actor,e.signal,e.traded,e.entry,e.exit,e.entryPrice,e.exitPrice,e.ret,e.bench,e.excess,e.days,e.why,e.open,e.benchmark,e.weight??1]));return[{name:`spec.json`,mime:`application/json`,text:`${JSON.stringify(n,null,2)}\n`},{name:`trades.csv`,mime:`text/csv`,text:r},{name:`prices.csv`,mime:`text/csv`,text:F(e.prices||[],e.priceSource,e.priceAsOf)},{name:`benchmark.csv`,mime:`text/csv`,text:F(e.benchmarks||[],e.priceSource,e.priceAsOf)},{name:`METHODS.md`,mime:`text/markdown`,text:L(e)}]}function L(e){let t=m({stats:e.stats||{},rules:e.spec?.rules,trades:e.trades,reality:e.reality});return[`# Backtest replication`,``,`**Spec:** ${e.description||``}`,``,`Run at ${e.ranAt||`?`} by TradeSimple Intel. Research only; not investment advice and not an order.`,``,`## Files`,"- `spec.json` — the cleaned spec, the app's headline numbers (`expected`), and every feed's source, as-of, and latency.","- `trades.csv` — each trade the run used: public date (filing/posting), entry, exit, prices, return, benchmark leg, weight.","- `prices.csv` / `benchmark.csv` — daily bars the engine read (adjusted open and close), with source and as-of.","- `replicate.mjs` (Node 18+, no packages) and `replicate.py` (Python 3, pandas optional) recompute the headline numbers from the CSVs and exit 1 on any mismatch over 0.0001.",'- Both scripts also recompute the "Is it real?" checks (block-bootstrap intervals, random-entry placebo, clustered t, effective sample) with the same seed and draw order (`realitySettings` in spec.json), so they match the app exactly.',``,`## Run`,"```",`node replicate.mjs`,`python3 replicate.py`,"```",``,`## Formulas`,...t.flatMap(e=>[`### ${e.title}`,``,`$$${e.tex}$$`,``,e.worked?`This run: $${e.worked}$`:``,e.note?`\n${e.note}`:``,``]),`## Sources`,...(e.feeds||[]).map(e=>`- **${e.label}:** ${e.source} — as of ${e.asOf||`?`}. ${e.latency||``}`),``,`## Caveats`,`- Entry is the first trading day strictly after the public date (within 7 days); the trade date is never used for entry.`,`- Disclosed amounts are ranges; range-midpoint sizing is an estimate.`,`- Prices come from Yahoo Finance for symbols that still trade; delisted or renamed symbols are excluded (survivorship).`,`- Trades overlap and cluster; the sample is smaller than the trade count suggests.`,...e.missing?.length?[`- No cached bars were available for: ${e.missing.join(`, `)}; those trades cannot be re-run from these files.`]:[],``].join(`
`)}var R=(()=>{let e=new Uint32Array(256);for(let t=0;t<256;t+=1){let n=t;for(let e=0;e<8;e+=1)n=n&1?3988292384^n>>>1:n>>>1;e[t]=n>>>0}return e})();function z(e){let t=4294967295;for(let n=0;n<e.length;n+=1)t=R[(t^e[n])&255]^t>>>8;return(t^4294967295)>>>0}function B(e,t=new Date(Date.UTC(2026,0,1))){let n=new TextEncoder,r=t.getUTCHours()<<11|t.getUTCMinutes()<<5|t.getUTCSeconds()>>1,i=t.getUTCFullYear()-1980<<9|t.getUTCMonth()+1<<5|t.getUTCDate(),a=[],o=[],s=0;for(let t of e){let e=n.encode(t.name),c=typeof t.text==`string`?n.encode(t.text):t.text,l=z(c),u=new Uint8Array(30+e.length),d=new DataView(u.buffer);d.setUint32(0,67324752,!0),d.setUint16(4,20,!0),d.setUint16(6,2048,!0),d.setUint16(8,0,!0),d.setUint16(10,r,!0),d.setUint16(12,i,!0),d.setUint32(14,l,!0),d.setUint32(18,c.length,!0),d.setUint32(22,c.length,!0),d.setUint16(26,e.length,!0),d.setUint16(28,0,!0),u.set(e,30);let f=new Uint8Array(46+e.length),p=new DataView(f.buffer);p.setUint32(0,33639248,!0),p.setUint16(4,20,!0),p.setUint16(6,20,!0),p.setUint16(8,2048,!0),p.setUint16(10,0,!0),p.setUint16(12,r,!0),p.setUint16(14,i,!0),p.setUint32(16,l,!0),p.setUint32(20,c.length,!0),p.setUint32(24,c.length,!0),p.setUint16(28,e.length,!0),p.setUint32(42,s,!0),f.set(e,46),a.push(u,c),o.push(f),s+=u.length+c.length}let c=o.reduce((e,t)=>e+t.length,0),l=new Uint8Array(22),u=new DataView(l.buffer);u.setUint32(0,101010256,!0),u.setUint16(8,e.length,!0),u.setUint16(10,e.length,!0),u.setUint32(12,c,!0),u.setUint32(16,s,!0);let d=[...a,...o,l],f=new Uint8Array(d.reduce((e,t)=>e+t.length,0)),p=0;for(let e of d)f.set(e,p),p+=e.length;return f}var V=`// Re-runs a TradeSimple Intel backtest from the files next to this script, with no packages. Node 18+.
//   node replicate.mjs [folder]
// Reads spec.json, trades.csv, prices.csv, benchmark.csv; prints the recomputed headline numbers next to the app's,
// and exits 1 if any differs by more than 0.0001.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2] || dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(dir, name), "utf8");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\\n" || ch === "\\r") {
      if (ch === "\\r" && text[i + 1] === "\\n") i += 1;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const DAY_MS = 86_400_000;
const ENTRY_SLACK_DAYS = 7;
const dayOf = (iso) => Math.floor(Date.parse(\`\${iso.slice(0, 10)}T00:00:00Z\`) / DAY_MS);
const isoOf = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10_000) / 10_000);
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stdev = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/** symbol -> [[day, open|null, close]] ascending. Prices are adjusted for splits and dividends. */
function barsBySymbol(rows) {
  const out = {};
  for (const r of rows) {
    const open = r.open_adj === "" ? null : Number(r.open_adj);
    (out[r.symbol] ||= []).push([dayOf(r.date), open, Number(r.close_adj)]);
  }
  for (const s of Object.keys(out)) out[s].sort((a, b) => a[0] - b[0]);
  return out;
}

/** First bar strictly after \`day\`, or -1. */
function firstAfter(bars, day) {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid][0] <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo < bars.length ? lo : -1;
}
function lastOnOrBefore(bars, day) {
  const i = firstAfter(bars, day);
  return i === -1 ? bars.length - 1 : i - 1;
}
const levelOn = (bars, day) => {
  const i = lastOnOrBefore(bars, day);
  return i < 0 ? null : bars[i][2];
};
const benchEntry = (bars, day) => {
  const i = lastOnOrBefore(bars, day);
  if (i < 0) return null;
  return bars[i][0] === day && bars[i][1] > 0 ? bars[i][1] : bars[i][2];
};

/** One trade: entry the first bar after the public date, exit at the hold horizon (or stop/take), costs each side. */
function simulate(series, bench, rules, signalDay, sign) {
  const c = (rules.costBps + rules.slippageBps) / 10_000;
  const entryAt = firstAfter(series, signalDay);
  if (entryAt === -1 || series[entryAt][0] - signalDay > ENTRY_SLACK_DAYS) return null;
  const atOpen = rules.entry === "nextOpen";
  const entryBar = series[entryAt];
  const openMissing = atOpen && !(entryBar[1] > 0);
  const entryPrice = atOpen && !openMissing ? entryBar[1] : entryBar[2];
  const startDay = entryBar[0];
  const horizon = startDay + rules.holdDays;
  const firstCheck = atOpen && !openMissing ? entryAt : entryAt + 1;
  let exitAt = -1;
  let why = "";
  for (let j = firstCheck; j < series.length; j += 1) {
    const pnl = sign * (series[j][2] / entryPrice - 1);
    if (rules.stopLossPct && pnl <= -rules.stopLossPct / 100) { exitAt = j; why = "stop"; break; }
    if (rules.takeProfitPct && pnl >= rules.takeProfitPct / 100) { exitAt = j; why = "take"; break; }
    if (series[j][0] >= horizon) { exitAt = j; why = "hold"; break; }
  }
  if (exitAt === -1) {
    if (rules.openTrades === "exclude" || series.length - 1 < firstCheck) return null;
    exitAt = series.length - 1;
    why = "open";
  }
  const benchStart = atOpen && !openMissing ? benchEntry(bench, startDay) : levelOn(bench, startDay);
  if (!(benchStart > 0)) return null;
  const path = [];
  let prevStock = entryPrice;
  let prevBench = benchStart;
  for (let k = firstCheck; k <= exitAt; k += 1) {
    const close = series[k][2];
    const level = levelOn(bench, series[k][0]);
    path.push([series[k][0], sign * (close / prevStock - 1), sign * (level / prevBench - 1)]);
    prevStock = close;
    prevBench = level;
  }
  if (!path.length) return null;
  path[0][1] -= c;
  path[path.length - 1][1] -= c;
  const ret = sign * (series[exitAt][2] / entryPrice - 1) - 2 * c;
  const benchRet = sign * (prevBench / benchStart - 1);
  return { entry: isoOf(startDay), exit: isoOf(series[exitAt][0]), entryPrice, exitPrice: series[exitAt][2], ret, bench: benchRet, excess: ret - benchRet, why, path };
}

function maxDrawdown(values) {
  let peak = values[0];
  let worst = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    worst = Math.min(worst, v / peak - 1);
  }
  return worst;
}

function replicate({ spec, trades, prices, benchmarks }) {
  const rules = spec.rules;
  const bars = barsBySymbol(prices);
  const benchBars = barsBySymbol(benchmarks);
  const calendarId = rules.benchmark === "SECTOR" ? "SPY" : rules.benchmark;
  const sims = [];
  for (const t of trades) {
    const sim = simulate(bars[t.symbol] || [], benchBars[t.benchmark] || [], rules, dayOf(t.public_date), t.side === "sell" ? -1 : 1);
    if (sim) sims.push({ ...sim, id: t.id, weight: Number(t.weight) || 1 });
  }
  if (!sims.length) return { trades: 0 };

  // Calendar-time portfolio: each day, the weighted average return of the positions open that day; idle days earn 0.
  const byDay = new Map();
  for (const t of sims) for (const [d, rs, rb] of t.path) {
    const row = byDay.get(d) || { w: 0, s: 0, b: 0 };
    row.w += t.weight;
    row.s += t.weight * rs;
    row.b += t.weight * rb;
    byDay.set(d, row);
  }
  const first = Math.min(...byDay.keys());
  const last = Math.max(...byDay.keys());
  const daySet = new Set(byDay.keys());
  for (const b of benchBars[calendarId] || []) if (b[0] >= first && b[0] <= last) daySet.add(b[0]);
  const days = [...daySet].sort((a, b) => a - b);
  const S = [1];
  const Bc = [1];
  const R = [];
  for (const d of days) {
    const row = byDay.get(d);
    const rs = row ? row.s / row.w : 0;
    const rb = row ? row.b / row.w : 0;
    R.push(rs);
    S.push(S.at(-1) * (1 + rs));
    Bc.push(Bc.at(-1) * (1 + rb));
  }
  const spanDays = days.at(-1) - days[0] + 1;
  const total = S.at(-1) - 1;
  const btotal = Bc.at(-1) - 1;
  const annual = (v) => (spanDays >= 90 && v > -1 ? (1 + v) ** (365 / spanDays) - 1 : null);
  const rets = sims.map((t) => t.ret);
  const sd = stdev(R);
  return {
    trades: sims.length,
    total: r4(total),
    annualized: r4(annual(total)),
    benchmarkTotal: r4(btotal),
    excessTotal: r4(total - btotal),
    hitRate: r4(rets.filter((v) => v > 0).length / rets.length),
    avgTrade: r4(mean(rets)),
    medianTrade: r4(median(rets)),
    maxDrawdown: r4(maxDrawdown(S)),
    sharpeish: sd ? r2((mean(R) / sd) * Math.sqrt(252)) : null,
    spanDays
  };
}

/* ---------- "Is it real?": block bootstrap, random-entry placebo, clustered t (same seed, same draws as the app) ---------- */

function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const weekOf = (day) => Math.floor((day + 3) / 7);
function groupsOf(keys) {
  const by = new Map();
  keys.forEach((k, i) => { if (!by.has(k)) by.set(k, []); by.get(k).push(i); });
  return [...by.values()];
}

/** Resample whole entry weeks with replacement; pooled mean of each series; 95% percentile interval. */
function blockBootstrap(series, keys, iters, seed, alpha) {
  const groups = groupsOf(keys);
  const G = groups.length;
  const sums = groups.map((idx) => series.map((xs) => sum(idx.map((i) => xs[i]))));
  const rnd = mulberry32(seed);
  const draws = series.map(() => []);
  for (let b = 0; b < iters; b += 1) {
    const acc = series.map(() => 0);
    let n = 0;
    for (let j = 0; j < G; j += 1) {
      const k = Math.floor(rnd() * G);
      for (let s = 0; s < series.length; s += 1) acc[s] += sums[k][s];
      n += groups[k].length;
    }
    for (let s = 0; s < series.length; s += 1) draws[s].push(acc[s] / n);
  }
  return draws.map((d) => {
    const s = [...d].sort((x, y) => x - y);
    return { lo: s[Math.floor((alpha / 2) * iters)], hi: s[Math.ceil((1 - alpha / 2) * iters) - 1] };
  });
}

const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function lnGamma(z) {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  const x0 = z - 1;
  let x = LANCZOS[0];
  for (let i = 1; i < 9; i += 1) x += LANCZOS[i] / (x0 + i);
  const t = x0 + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x0 + 0.5) * Math.log(t) - t + Math.log(x);
}
function betaCf(a, b, x) {
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}
function betaInc(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaCf(a, b, x)) / a : 1 - (front * betaCf(b, a, 1 - x)) / b;
}
function tCdf(t, df) {
  const tail = 0.5 * betaInc(df / (df + t * t), df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}
/** Mean over a standard error clustered by \`keys\`: sqrt(G/(G-1) * sum_g (sum_i in g (x_i - mean))^2) / n, floored at the iid SE. */
function clusteredT(xs, keys) {
  const n = xs.length;
  const groups = groupsOf(keys);
  const G = groups.length;
  const m = sum(xs) / n;
  const seIid = Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (n - 1)) / Math.sqrt(n);
  if (G < 2) return { t: null, pTwo: null, se: null, seIid };
  const se = Math.sqrt((G / (G - 1)) * sum(groups.map((idx) => sum(idx.map((i) => xs[i] - m)) ** 2))) / n;
  // Conservative: the t uses max(clustered, iid) SE; few or unequal clusters can make the clustered one too small.
  const used = Math.max(se, seIid);
  if (!(used > 0)) return { t: null, pTwo: null, se, seIid };
  const t = m / used;
  return { t, pTwo: 2 * (1 - tCdf(Math.abs(t), G - 1)), se, seIid };
}

/** Each trade keeps ticker, side, benchmark and rules; its public date is a random trading day of the run's window. */
function placebo(trades, bars, benchBars, rules, calendar, iters, seed, draws) {
  const signalDays = trades.map((t) => dayOf(t.public_date));
  const lo = Math.min(...signalDays);
  const hi = Math.max(...signalDays);
  const lastExit = Math.max(...trades.map((t) => dayOf(t.exit)));
  const days = calendar.filter((b) => b[0] >= lo && b[0] <= hi).map((b) => b[0]);
  if (days.length < 2) return null;
  const cut = (s) => (s || []).filter((b) => b[0] <= lastExit);
  const memo = new Map();
  const legs = trades.map((t) => {
    const k = \`\${t.symbol}|\${t.side}|\${t.benchmark}\`;
    if (!memo.has(k)) memo.set(k, new Map());
    const bench = benchBars[t.benchmark] || (rules.benchmark === "SECTOR" ? benchBars.SPY : null);
    return { cache: memo.get(k), series: cut(bars[t.symbol]), bench: cut(bench), sign: t.side === "sell" ? -1 : 1 };
  });
  const outcome = (leg, d) => {
    if (!leg.cache.has(d)) {
      const sim = leg.series.length && leg.bench.length ? simulate(leg.series, leg.bench, rules, d, leg.sign) : null;
      leg.cache.set(d, sim ? sim.ret - sim.bench : null);
    }
    return leg.cache.get(d);
  };
  const rnd = mulberry32(seed);
  const means = [];
  for (let it = 0; it < iters; it += 1) {
    let s = 0;
    let n = 0;
    for (const leg of legs) {
      let got = null;
      for (let k = 0; k < draws && got == null; k += 1) got = outcome(leg, days[Math.floor(rnd() * days.length)]);
      if (got == null) continue;
      s += got;
      n += 1;
    }
    if (n) means.push(s / n);
  }
  const actual = sum(trades.map((t) => Number(t.excess))) / trades.length;
  const below = means.filter((m) => m < actual).length;
  return { pct: below / means.length, p: (1 + means.length - below) / (means.length + 1) };
}

function reality({ spec, trades, prices, benchmarks, settings }) {
  const rules = spec.rules;
  const rows = trades.filter((t) => t.ret !== "" && t.excess !== "");
  const n = rows.length;
  if (n < 2) return {};
  const rets = rows.map((t) => Number(t.ret));
  const ex = rows.map((t) => Number(t.excess));
  const weeks = rows.map((t) => weekOf(dayOf(t.entry)));
  const members = rows.map((t) => t.actor);
  const [mt, me] = blockBootstrap([rets, ex], weeks, settings.bootIters, settings.seed, settings.alpha);
  const byMember = clusteredT(ex, members);
  const byWeek = clusteredT(ex, weeks);
  const eff = (c) => (c.se > 0 && c.seIid > 0 ? Math.min(n, n * (c.seIid / c.se) ** 2) : null);
  const effs = [eff(byMember), eff(byWeek)].filter((v) => v != null);
  const benchBars = barsBySymbol(benchmarks);
  const calendar = benchBars[rules.benchmark === "SECTOR" ? "SPY" : rules.benchmark] || [];
  const pl = placebo(rows, barsBySymbol(prices), benchBars, rules, calendar, settings.placeboIters, settings.seed + 1, settings.draws);
  return {
    meanTradeLo: r4(mt.lo), meanTradeHi: r4(mt.hi), meanExcessLo: r4(me.lo), meanExcessHi: r4(me.hi),
    placeboPct: pl ? r4(pl.pct) : null, placeboP: pl ? r4(pl.p) : null,
    clusterT: r4(byMember.t), clusterPTwo: r4(byMember.pTwo), nEff: effs.length ? Math.max(1, Math.round(Math.min(...effs))) : null
  };
}

{
  const meta = JSON.parse(read("spec.json"));
  const files = {
    spec: meta.spec,
    trades: parseCsv(read("trades.csv")),
    prices: parseCsv(read("prices.csv")),
    benchmarks: parseCsv(read("benchmark.csv"))
  };
  const got = replicate(files);
  const want = meta.expected || {};
  if (meta.realitySettings && meta.expectedReality) {
    Object.assign(got, reality({ ...files, settings: meta.realitySettings }));
    Object.assign(want, meta.expectedReality);
  }
  const rows = Object.keys(got).map((k) => {
    const a = got[k];
    const b = want[k];
    const same = a == null || b == null ? a == b : Math.abs(a - b) <= 1e-4 + 1e-9 || (k === "sharpeish" && Math.abs(a - b) <= 0.011) || (k === "nEff" && Math.abs(a - b) <= 1);
    return { metric: k, replicated: a, app: b ?? null, match: same };
  });
  console.table(rows);
  console.log(JSON.stringify({ replicated: got, app: want, match: rows.every((r) => r.match) }));
  process.exit(rows.every((r) => r.match) ? 0 : 1);
}
`,H=`"""Re-runs a TradeSimple Intel backtest from the files next to this script.

    python3 replicate.py [folder]

Reads spec.json, trades.csv, prices.csv, benchmark.csv with pandas (or the csv module when pandas is not installed),
prints the recomputed headline numbers next to the app's, and exits 1 if any differs by more than 0.0001.
"""
import bisect
import json
import math
import os
import statistics
import sys
from datetime import date, timedelta

try:
    import pandas as pd
except ImportError:  # the math below does not need pandas; it only reads the CSVs
    pd = None
    import csv

DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
ENTRY_SLACK_DAYS = 7
EPOCH = date(1970, 1, 1)


def read_rows(name):
    path = os.path.join(DIR, name)
    if pd is not None:
        return pd.read_csv(path, dtype=str, keep_default_na=False).to_dict("records")
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def day_of(iso):
    return (date.fromisoformat(iso[:10]) - EPOCH).days


def round_js(v, digits):
    # Same rounding as JavaScript's Math.round(v * 10^d) / 10^d.
    k = 10 ** digits
    return math.floor(v * k + 0.5) / k


def r4(v):
    return None if v is None or not math.isfinite(v) else round_js(v, 4)


def r2(v):
    return None if v is None or not math.isfinite(v) else round_js(v, 2)


def bars_by_symbol(rows):
    out = {}
    for r in rows:
        opened = None if r["open_adj"] == "" else float(r["open_adj"])
        out.setdefault(r["symbol"], []).append((day_of(r["date"]), opened, float(r["close_adj"])))
    for s in out:
        out[s].sort(key=lambda b: b[0])
    return out


_DAYS = {}


def first_after(bars, day):
    hit = _DAYS.get(id(bars))
    if hit is None or hit[0] is not bars or len(hit[1]) != len(bars):
        hit = (bars, [b[0] for b in bars])
        _DAYS[id(bars)] = hit
    i = bisect.bisect_right(hit[1], day)
    return i if i < len(bars) else -1


def last_on_or_before(bars, day):
    i = first_after(bars, day)
    return len(bars) - 1 if i == -1 else i - 1


def level_on(bars, day):
    i = last_on_or_before(bars, day)
    return None if i < 0 else bars[i][2]


def bench_entry(bars, day):
    i = last_on_or_before(bars, day)
    if i < 0:
        return None
    if bars[i][0] == day and bars[i][1] and bars[i][1] > 0:
        return bars[i][1]
    return bars[i][2]


def simulate(series, bench, rules, signal_day, sign):
    """Entry the first bar after the public date, exit at the hold horizon (or stop/take), costs on each side."""
    c = (rules["costBps"] + rules["slippageBps"]) / 10_000
    entry_at = first_after(series, signal_day)
    if entry_at == -1 or series[entry_at][0] - signal_day > ENTRY_SLACK_DAYS:
        return None
    at_open = rules["entry"] == "nextOpen"
    entry_bar = series[entry_at]
    open_missing = at_open and not (entry_bar[1] and entry_bar[1] > 0)
    entry_price = entry_bar[1] if at_open and not open_missing else entry_bar[2]
    start_day = entry_bar[0]
    horizon = start_day + rules["holdDays"]
    first_check = entry_at if at_open and not open_missing else entry_at + 1
    exit_at = -1
    for j in range(first_check, len(series)):
        pnl = sign * (series[j][2] / entry_price - 1)
        if rules.get("stopLossPct") and pnl <= -rules["stopLossPct"] / 100:
            exit_at = j
            break
        if rules.get("takeProfitPct") and pnl >= rules["takeProfitPct"] / 100:
            exit_at = j
            break
        if series[j][0] >= horizon:
            exit_at = j
            break
    if exit_at == -1:
        if rules["openTrades"] == "exclude" or len(series) - 1 < first_check:
            return None
        exit_at = len(series) - 1
    bench_start = bench_entry(bench, start_day) if at_open and not open_missing else level_on(bench, start_day)
    if not bench_start or bench_start <= 0:
        return None
    path = []
    prev_stock, prev_bench = entry_price, bench_start
    for k in range(first_check, exit_at + 1):
        close = series[k][2]
        level = level_on(bench, series[k][0])
        path.append([series[k][0], sign * (close / prev_stock - 1), sign * (level / prev_bench - 1)])
        prev_stock, prev_bench = close, level
    if not path:
        return None
    path[0][1] -= c
    path[-1][1] -= c
    ret = sign * (series[exit_at][2] / entry_price - 1) - 2 * c
    return {"ret": ret, "bench": sign * (prev_bench / bench_start - 1), "path": path}


def max_drawdown(values):
    peak, worst = values[0], 0.0
    for v in values:
        peak = max(peak, v)
        worst = min(worst, v / peak - 1)
    return worst


def replicate(spec, trades, prices, benchmarks):
    rules = spec["rules"]
    bars = bars_by_symbol(prices)
    bench_bars = bars_by_symbol(benchmarks)
    calendar_id = "SPY" if rules["benchmark"] == "SECTOR" else rules["benchmark"]
    sims = []
    for t in trades:
        sim = simulate(bars.get(t["symbol"], []), bench_bars.get(t["benchmark"], []), rules, day_of(t["public_date"]), -1 if t["side"] == "sell" else 1)
        if sim:
            sim["weight"] = float(t["weight"] or 1)
            sims.append(sim)
    if not sims:
        return {"trades": 0}

    # Calendar-time portfolio: each day, the weighted average return of the positions open that day; idle days earn 0.
    by_day = {}
    for t in sims:
        for d, rs, rb in t["path"]:
            row = by_day.setdefault(d, [0.0, 0.0, 0.0])
            row[0] += t["weight"]
            row[1] += t["weight"] * rs
            row[2] += t["weight"] * rb
    first, last = min(by_day), max(by_day)
    days = set(by_day)
    for b in bench_bars.get(calendar_id, []):
        if first <= b[0] <= last:
            days.add(b[0])
    days = sorted(days)
    S, B, R = [1.0], [1.0], []
    for d in days:
        row = by_day.get(d)
        rs = row[1] / row[0] if row else 0.0
        rb = row[2] / row[0] if row else 0.0
        R.append(rs)
        S.append(S[-1] * (1 + rs))
        B.append(B[-1] * (1 + rb))
    span = days[-1] - days[0] + 1
    total, btotal = S[-1] - 1, B[-1] - 1
    annual = (1 + total) ** (365 / span) - 1 if span >= 90 and total > -1 else None
    rets = [t["ret"] for t in sims]
    sd = statistics.stdev(R) if len(R) > 1 else None
    return {
        "trades": len(sims),
        "total": r4(total),
        "annualized": r4(annual) if annual is not None else None,
        "benchmarkTotal": r4(btotal),
        "excessTotal": r4(total - btotal),
        "hitRate": r4(sum(1 for v in rets if v > 0) / len(rets)),
        "avgTrade": r4(statistics.fmean(rets)),
        "medianTrade": r4(statistics.median(rets)),
        "maxDrawdown": r4(max_drawdown(S)),
        "sharpeish": r2(statistics.fmean(R) / sd * math.sqrt(252)) if sd else None,
        "spanDays": span,
    }


# ---------- "Is it real?": block bootstrap, random-entry placebo, clustered t (same seed, same draws as the app) ----------

M32 = 0xFFFFFFFF


def mulberry32(seed):
    state = [seed & M32]

    def rnd():
        a = (state[0] + 0x6D2B79F5) & M32
        state[0] = a
        t = ((a ^ (a >> 15)) * (1 | a)) & M32
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & M32)) & M32) ^ t
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return rnd


def plain_sum(xs):
    # Left to right like JavaScript's reduce; Python 3.12's sum() compensates float error and would differ.
    s = 0
    for x in xs:
        s += x
    return s


def week_of(day):
    return (day + 3) // 7


def groups_of(keys):
    by = {}
    for i, k in enumerate(keys):
        by.setdefault(k, []).append(i)
    return list(by.values())


def block_bootstrap(series, keys, iters, seed, alpha):
    groups = groups_of(keys)
    G = len(groups)
    sums = [[plain_sum([xs[i] for i in idx]) for xs in series] for idx in groups]
    rnd = mulberry32(seed)
    draws = [[] for _ in series]
    for _ in range(iters):
        acc = [0] * len(series)
        n = 0
        for _ in range(G):
            k = int(rnd() * G)
            for s in range(len(series)):
                acc[s] += sums[k][s]
            n += len(groups[k])
        for s in range(len(series)):
            draws[s].append(acc[s] / n)
    out = []
    for d in draws:
        d = sorted(d)
        out.append((d[math.floor(alpha / 2 * iters)], d[math.ceil((1 - alpha / 2) * iters) - 1]))
    return out


LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]


def ln_gamma(z):
    if z < 0.5:
        return math.log(math.pi / math.sin(math.pi * z)) - ln_gamma(1 - z)
    x0 = z - 1
    x = LANCZOS[0]
    for i in range(1, 9):
        x += LANCZOS[i] / (x0 + i)
    t = x0 + 7.5
    return 0.5 * math.log(2 * math.pi) + (x0 + 0.5) * math.log(t) - t + math.log(x)


def beta_cf(a, b, x):
    tiny = 1e-300
    c = 1.0
    d = 1 - (a + b) * x / (a + 1)
    d = 1 / (tiny if abs(d) < tiny else d)
    h = d
    for m in range(1, 301):
        m2 = 2 * m
        aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2))
        d = 1 + aa * d
        d = tiny if abs(d) < tiny else d
        c = 1 + aa / c
        c = tiny if abs(c) < tiny else c
        d = 1 / d
        h *= d * c
        aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1))
        d = 1 + aa * d
        d = tiny if abs(d) < tiny else d
        c = 1 + aa / c
        c = tiny if abs(c) < tiny else c
        d = 1 / d
        delta = d * c
        h *= delta
        if abs(delta - 1) < 1e-14:
            break
    return h


def beta_inc(x, a, b):
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    front = math.exp(ln_gamma(a + b) - ln_gamma(a) - ln_gamma(b) + a * math.log(x) + b * math.log(1 - x))
    return front * beta_cf(a, b, x) / a if x < (a + 1) / (a + b + 2) else 1 - front * beta_cf(b, a, 1 - x) / b


def t_cdf(t, df):
    tail = 0.5 * beta_inc(df / (df + t * t), df / 2, 0.5)
    return 1 - tail if t > 0 else tail


def clustered_t(xs, keys):
    """Mean over a standard error clustered by keys: sqrt(G/(G-1) * sum_g (sum_i in g (x_i - mean))^2) / n, floored at the iid SE."""
    n = len(xs)
    groups = groups_of(keys)
    G = len(groups)
    m = plain_sum(xs) / n
    se_iid = math.sqrt(plain_sum([(x - m) ** 2 for x in xs]) / (n - 1)) / math.sqrt(n)
    if G < 2:
        return {"t": None, "p": None, "se": None, "se_iid": se_iid}
    se = math.sqrt(G / (G - 1) * plain_sum([plain_sum([xs[i] - m for i in idx]) ** 2 for idx in groups])) / n
    # Conservative: the t uses max(clustered, iid) SE; few or unequal clusters can make the clustered one too small.
    used = max(se, se_iid)
    if not used > 0:
        return {"t": None, "p": None, "se": se, "se_iid": se_iid}
    t = m / used
    return {"t": t, "p": 2 * (1 - t_cdf(abs(t), G - 1)), "se": se, "se_iid": se_iid}


def placebo(trades, bars, bench_bars, rules, calendar, iters, seed, draws):
    """Each trade keeps ticker, side, benchmark and rules; its public date is a random trading day of the run's window."""
    signal_days = [day_of(t["public_date"]) for t in trades]
    lo, hi = min(signal_days), max(signal_days)
    last_exit = max(day_of(t["exit"]) for t in trades)
    days = [b[0] for b in calendar if lo <= b[0] <= hi]
    if len(days) < 2:
        return None
    memo = {}
    cut_cache = {}

    def cut(key, s):
        if key not in cut_cache:
            cut_cache[key] = [b for b in (s or []) if b[0] <= last_exit]
        return cut_cache[key]

    legs = []
    for t in trades:
        k = f"{t['symbol']}|{t['side']}|{t['benchmark']}"
        bench = bench_bars.get(t["benchmark"]) or (bench_bars.get("SPY") if rules["benchmark"] == "SECTOR" else None)
        legs.append((memo.setdefault(k, {}), cut("s:" + t["symbol"], bars.get(t["symbol"])), cut("b:" + t["benchmark"], bench), -1 if t["side"] == "sell" else 1))

    def outcome(leg, d):
        cache, series, bench, sign = leg
        if d not in cache:
            sim = simulate(series, bench, rules, d, sign) if series and bench else None
            cache[d] = sim["ret"] - sim["bench"] if sim else None
        return cache[d]

    rnd = mulberry32(seed)
    means = []
    for _ in range(iters):
        s, n = 0, 0
        for leg in legs:
            got = None
            k = 0
            while k < draws and got is None:
                got = outcome(leg, days[int(rnd() * len(days))])
                k += 1
            if got is None:
                continue
            s += got
            n += 1
        if n:
            means.append(s / n)
    actual = plain_sum([float(t["excess"]) for t in trades]) / len(trades)
    below = sum(1 for m in means if m < actual)
    return {"pct": below / len(means), "p": (1 + len(means) - below) / (len(means) + 1)}


def reality(spec, trades, prices, benchmarks, settings):
    rules = spec["rules"]
    rows = [t for t in trades if t["ret"] != "" and t["excess"] != ""]
    n = len(rows)
    if n < 2:
        return {}
    rets = [float(t["ret"]) for t in rows]
    ex = [float(t["excess"]) for t in rows]
    weeks = [week_of(day_of(t["entry"])) for t in rows]
    members = [t["actor"] for t in rows]
    (mt_lo, mt_hi), (me_lo, me_hi) = block_bootstrap([rets, ex], weeks, settings["bootIters"], settings["seed"], settings["alpha"])
    by_member = clustered_t(ex, members)
    by_week = clustered_t(ex, weeks)
    effs = [min(n, n * (c["se_iid"] / c["se"]) ** 2) for c in (by_member, by_week) if c["se"] and c["se"] > 0 and c["se_iid"] > 0]
    bench_bars = bars_by_symbol(benchmarks)
    calendar = bench_bars.get("SPY" if rules["benchmark"] == "SECTOR" else rules["benchmark"], [])
    pl = placebo(rows, bars_by_symbol(prices), bench_bars, rules, calendar, settings["placeboIters"], settings["seed"] + 1, settings["draws"])
    return {
        "meanTradeLo": r4(mt_lo), "meanTradeHi": r4(mt_hi), "meanExcessLo": r4(me_lo), "meanExcessHi": r4(me_hi),
        "placeboPct": r4(pl["pct"]) if pl else None, "placeboP": r4(pl["p"]) if pl else None,
        "clusterT": r4(by_member["t"]), "clusterPTwo": r4(by_member["p"]),
        "nEff": max(1, math.floor(min(effs) + 0.5)) if effs else None,
    }


def main():
    with open(os.path.join(DIR, "spec.json"), encoding="utf-8") as f:
        meta = json.load(f)
    files = (meta["spec"], read_rows("trades.csv"), read_rows("prices.csv"), read_rows("benchmark.csv"))
    got = replicate(*files)
    want = meta.get("expected", {})
    if meta.get("realitySettings") and meta.get("expectedReality"):
        got.update(reality(*files, meta["realitySettings"]))
        want.update(meta["expectedReality"])
    ok = True
    print(f"{'metric':<16}{'replicated':>14}{'app':>14}  match")
    for k, a in got.items():
        b = want.get(k)
        if a is None or b is None:
            same = a == b
        else:
            same = abs(a - b) <= 1e-4 + 1e-9 or (k == "sharpeish" and abs(a - b) <= 0.011) or (k == "nEff" and abs(a - b) <= 1)
        ok = ok and same
        print(f"{k:<16}{str(a):>14}{str(b):>14}  {'yes' if same else 'NO'}")
    print(json.dumps({"replicated": got, "app": want, "match": ok}))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
`;function U(e,t,n){let r=URL.createObjectURL(new Blob([t],{type:n})),i=document.createElement(`a`);i.href=r,i.download=e,document.body.appendChild(i),i.click(),i.remove(),window.setTimeout(()=>URL.revokeObjectURL(r),2e3)}async function W(e,t){for(let n=0;n<6;n++){let n=await fetch(`/api/backtest/replicate?spec=${r(e)}${t?`&runId=${encodeURIComponent(t)}`:``}`),i=await n.json().catch(()=>({ok:!1,error:`HTTP ${n.status}`}));if(n.ok&&i.ok)return i;if(n.status!==429&&n.status!==503)throw Error(i.error||`HTTP ${n.status}`);await new Promise(e=>setTimeout(e,4e3))}throw Error(`The server is busy with other backtests. Try again in a minute.`)}function G({spec:e,runId:t,compact:n=!1}){let[r,o]=(0,i.useState)({phase:`idle`}),s=async()=>{o({phase:`loading`});try{let n=await W(e,t),r=[...I(n),{name:`replicate.mjs`,mime:`text/javascript`,text:V},{name:`replicate.py`,mime:`text/x-python`,text:H}];o({phase:`ready`,files:r,stamp:String(n.ranAt||new Date().toISOString()).slice(0,10)})}catch(e){o({phase:`error`,error:e instanceof Error?e.message:`Could not load the run's data.`})}},c=(t,n)=>U(`backtest-${e.source}-${n}.zip`,B(t.map(e=>({name:e.name,text:e.text}))),`application/zip`);return(0,a.jsxs)(`section`,{className:n?`rep compact`:`rep`,"aria-label":`Replicate`,children:[r.phase===`idle`?(0,a.jsx)(`button`,{className:`panels-btn`,onClick:s,children:`Replicate…`}):null,r.phase===`loading`?(0,a.jsx)(`p`,{className:`rep-note`,children:`Collecting the run's trades and daily prices…`}):null,r.phase===`error`?(0,a.jsxs)(`p`,{className:`rep-note warn`,children:[r.error,` `,(0,a.jsx)(`button`,{className:`link`,onClick:s,children:`Retry`})]}):null,r.phase===`ready`?(0,a.jsxs)(a.Fragment,{children:[(0,a.jsxs)(`header`,{children:[(0,a.jsx)(`b`,{children:`Replicate this run`}),(0,a.jsx)(`button`,{className:`panels-btn`,onClick:()=>c(r.files,r.stamp),children:`Download all (.zip)`})]}),(0,a.jsx)(`ul`,{children:r.files.map(e=>(0,a.jsxs)(`li`,{children:[(0,a.jsx)(`button`,{className:`link`,onClick:()=>U(e.name,e.text,e.mime),children:e.name}),` `,(0,a.jsxs)(`small`,{children:[(e.text.length/1024).toFixed(1),` KB`]})]},e.name))}),(0,a.jsxs)(`p`,{className:`rep-note`,children:[`Unzip, then `,(0,a.jsx)(`code`,{children:`node replicate.mjs`}),` (Node 18+, no packages) or `,(0,a.jsx)(`code`,{children:`python3 replicate.py`}),` `,`(pandas optional). Both re-simulate from the CSVs and check the headline numbers against`,` `,(0,a.jsx)(`code`,{children:`spec.json`}),`. METHODS.md lists every rule and caveat.`]})]}):null]})}export{y as a,w as i,k as n,m as o,E as r,G as t};