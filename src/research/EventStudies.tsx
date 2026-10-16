import {useEffect,useState} from 'react';
import type {EventStudySpec,EventStudyReport} from '../../shared/eventStudy.mjs';
import {EventStudyResults} from './EventStudyResults';
import {read,write,message,type ExperimentSummary} from './api';
type Summary={id:string;title:string;createdAt:string;evaluated:boolean};
type Plan={id:string;title:string;hypothesis:string;createdAt:string;spec:EventStudySpec;sourceRunId:string;sourceInputHash:string;priorPlans:number;run:null|{id:string;result:{eventStudy:EventStudyReport}}};
export function EventStudies(){
 const [experiments,setExperiments]=useState<ExperimentSummary[]>([]),[plans,setPlans]=useState<Summary[]>([]),[selected,setSelected]=useState<Plan|null>(null);
 const [experimentId,setExperimentId]=useState(''),[title,setTitle]=useState(''),[hypothesis,setHypothesis]=useState('');
 const [spec,setSpec]=useState<EventStudySpec>({from:'',to:'',before:5,after:10,sides:'both'});
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async()=>{const [e,p]=await Promise.all([read<{items:ExperimentSummary[]}>('experiments'),read<{items:Summary[]}>('event-studies')]);setExperiments(e.items.filter(x=>x.status==='complete'));setPlans(p.items);};
 useEffect(()=>{void load().catch(e=>setError(message(e))).finally(()=>setLoading(false));},[]);
 const action=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(message(e));}finally{setBusy(false);}};
 const register=()=>action(async()=>{const out=await write<{plan:Plan}>('event-studies',{experimentId,title,hypothesis,spec});setSelected(out.plan);await load();setNotice('Study conditions are locked. Evaluate to calculate the registered event windows.');});
 const evaluate=()=>action(async()=>{if(!selected)return;setSelected((await write<{plan:Plan}>(`event-studies/${selected.id}/evaluate`,{})).plan);await load();setNotice('Saved event windows and exclusions using frozen source evidence. No prices were fetched.');});
 const valid=experimentId&&title.trim()&&hypothesis.trim()&&spec.from&&spec.to&&spec.from<=spec.to&&Number.isInteger(spec.before)&&spec.before>=0&&spec.before<=20&&Number.isInteger(spec.after)&&spec.after>=0&&spec.after<=60;
 return <section className="research-content">
  <h2>Event studies</h2><p>Inspect how security returns differ from SPY around public disclosures. Register a fixed window before calculating it. This is a descriptive study of previously observed data, not evidence of causality or a new holdout test.</p>
  {loading&&<p role="status">Loading source experiments and studies…</p>}
  <details open={!selected}><summary>Register an event study</summary><fieldset className="research-form" disabled={busy||loading}><legend>Study conditions</legend>
   <label>Source experiment<select value={experimentId} onChange={e=>setExperimentId(e.target.value)}><option value="">Choose a completed experiment</option>{experiments.map(e=><option value={e.id} key={e.id}>{e.title}</option>)}</select></label>
   <p>The source must use SPY and current timing checks. Original signal selection and price coverage stay frozen. No additional history is fetched.</p>
   <label>Study title<input value={title} maxLength={200} onChange={e=>setTitle(e.target.value)}/></label><label>Research hypothesis<textarea value={hypothesis} maxLength={4000} onChange={e=>setHypothesis(e.target.value)}/></label>
   <div className="research-mapping"><label>Publications from<input type="date" value={spec.from} onInput={e=>{const from=e.currentTarget.value;setSpec(current=>({...current,from}));}}/></label><label>Publications through<input type="date" value={spec.to} onInput={e=>{const to=e.currentTarget.value;setSpec(current=>({...current,to}));}}/></label><label>Sessions before anchor<input type="number" min={0} max={20} step={1} value={Number.isFinite(spec.before)?spec.before:''} onChange={e=>setSpec({...spec,before:e.target.value===''?NaN:Number(e.target.value)})}/></label><label>Sessions after anchor<input type="number" min={0} max={60} step={1} value={Number.isFinite(spec.after)?spec.after:''} onChange={e=>setSpec({...spec,after:e.target.value===''?NaN:Number(e.target.value)})}/></label><label>Publication sides<select value={spec.sides} onChange={e=>setSpec({...spec,sides:e.target.value as EventStudySpec['sides']})}><option value="both">Buys and sells</option><option value="buy">Buys only</option><option value="sell">Sells only</option></select></label></div>
   <p>The anchor is the first saved SPY session after publication. The full window includes the anchor and needs one preceding close. Incomplete windows are excluded; same-ticker publications sharing an anchor become one event.</p>
   <button className="bt-run" disabled={!valid} onClick={()=>void register()}>Lock event study</button>
  </fieldset></details>
  {busy&&<p role="status">Working with frozen study records…</p>}{error&&<p className="bt-note warn" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <h3>Registered studies</h3>{!loading&&!plans.length?<p>No event studies yet. Choose a completed source experiment to begin.</p>:<div className="research-list">{plans.map(p=><button key={p.id} className="research-item" disabled={busy} aria-pressed={selected?.id===p.id} onClick={()=>void action(async()=>setSelected((await read<{plan:Plan}>(`event-studies/${p.id}`)).plan))}><strong>{p.title}</strong><span>{p.evaluated?'Evaluated':'Registered'} · {p.createdAt.slice(0,10)}</span></button>)}</div>}
  {selected&&<section className="research-content"><h3>{selected.title}</h3><p>{selected.hypothesis}</p><p>Publications {selected.spec.from} → {selected.spec.to} · {selected.spec.sides} sides · relative sessions −{selected.spec.before} through +{selected.spec.after}.</p><p>Registered {selected.createdAt} · {selected.priorPlans} earlier studies of this exact source. Registration cannot establish that the researcher has never seen the data.</p><details><summary>Frozen source and conditions</summary><p className="research-hash">Source run: {selected.sourceRunId}<br/>Input checksum: {selected.sourceInputHash}</p><pre>{JSON.stringify(selected.spec,null,2)}</pre></details>
   {selected.run?<><EventStudyResults key={selected.run.id} report={selected.run.result.eventStudy}/><div className="research-actions"><a className="panels-btn" href={`/api/research/runs/${selected.run.id}/export`}>Export study and source evidence</a><button className="panels-btn" disabled={busy} onClick={()=>void action(async()=>{const out=await write<{matches:boolean}>(`runs/${selected.run!.id}/replay`,{});setNotice(out.matches?'Event study replay verified: all outputs match the frozen record.':'Replay mismatch. Inspect the exported record.');})}>Verify event study replay</button></div></>:<button className="bt-run" disabled={busy} onClick={()=>void evaluate()}>Evaluate locked event study</button>}
  </section>}
 </section>;
}
