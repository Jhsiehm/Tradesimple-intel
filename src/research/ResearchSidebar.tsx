import { useEffect, useRef, useState } from 'react';
import type { AskApi } from '../ask/useAsk';
import type { AgentContext } from '../agent/context';
import { contextLine } from '../agent/context';
import { hasContext } from '../ask/useAsk';
import { SavedChats } from '../ask/SavedChats';
import { ScheduledTaskList } from '../tasks/ScheduledTasks';
import { useTasks } from '../tasks/useTasks';
import { Icon, type IconName } from '../ui/icons/Icon';
export type ResearchTool = 'experiments'|'data'|'convergence'|'notebooks'|'guided'|'contractEvidence'|'memory'|'stress'|'eventStudies';
export type Registry = { asOf: string; experiments: {id:string}[]; datasets: {id:string}[]; notebooks: {id:string;status?:string}[]; plans: {id:string;evaluated?:boolean}[] };
const groups: {title:string;items:{id:ResearchTool;title:string;icon:IconName}[]}[] = [
 {title:'Evidence',items:[{id:'data',title:'Data Hub',icon:'feed'},{id:'contractEvidence',title:'Contract evidence',icon:'contracts'}]},
 {title:'Experimentation',items:[{id:'guided',title:'Design an experiment',icon:'draw'},{id:'experiments',title:'Experiments',icon:'backtest'},{id:'convergence',title:'Convergence',icon:'arc'},{id:'eventStudies',title:'Event studies',icon:'timeline'},{id:'stress',title:'Stress tests',icon:'filter'}]},
 {title:'Knowledge',items:[{id:'notebooks',title:'Notebooks',icon:'dossier'},{id:'memory',title:'Research memory',icon:'research'}]}
];
export function useResearchSidebar() {
 const [desktopOpen,setDesktopOpen]=useState(()=>{try{return localStorage.getItem('intel:research-sidebar')!=='closed';}catch{return true;}});
 const [mobile,setMobile]=useState(()=>window.matchMedia('(max-width: 760px)').matches),[mobileOpen,setMobileOpen]=useState(false);
 const trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const media=window.matchMedia('(max-width: 760px)');const change=()=>{setMobile(media.matches);setMobileOpen(false);};media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
 const setOpen=(value:boolean)=>{if(mobile)setMobileOpen(value);else {setDesktopOpen(value);try{localStorage.setItem('intel:research-sidebar',value?'open':'closed');}catch{/* Layout still works without browser storage. */}}};
 const close=()=>{setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());};
 return {open:mobile?mobileOpen:desktopOpen,mobile,trigger,toggle:()=>setOpen(!(mobile?mobileOpen:desktopOpen)),close,afterSelection:()=>{if(mobile)close();}};
}
export function ResearchSidebar({ask,context,catalog,error,refreshing,onRefresh,onTool,layout}: {
 ask:AskApi;context:AgentContext;catalog:Registry|null;error:string;refreshing:boolean;onRefresh:()=>void;onTool:(tool:ResearchTool)=>void;layout:ReturnType<typeof useResearchSidebar>;
}) {
 const {res}=useTasks(true),closeRef=useRef<HTMLButtonElement>(null);
 const last=ask.turns.at(-1),steps=last?.steps||[],running=steps.slice().reverse().find(s=>s.state==='running'),failed=steps.filter(s=>s.state==='error'),sources=steps.filter(s=>s.source);
 const lastSource=sources.at(-1),mode=last?.done?.memory?.mode||last?.memory?.mode;
 useEffect(()=>{if(layout.mobile&&layout.open)closeRef.current?.focus();},[layout.mobile,layout.open]);
 const badge=(id:ResearchTool)=>catalog?({experiments:catalog.experiments.length,data:catalog.datasets.length,notebooks:catalog.notebooks.length,convergence:catalog.plans.length} as Partial<Record<ResearchTool,number>>)[id]:undefined;
 return <aside id="research-workspace-sidebar" className="research-sidebar" hidden={!layout.open} aria-label="Research workspace" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();layout.close();}}}>
   <div className="research-sidebar-title"><Icon name="research" size={20}/><strong>Research workspace</strong><button ref={closeRef} className="research-library-toggle" onClick={layout.close} aria-label="Collapse research sidebar" title="Collapse sidebar"><Icon name="collapse" size={16}/></button></div>
   <button className="research-new" onClick={()=>{ask.newChat();layout.afterSelection();}} disabled={ask.busy}><Icon name="draw" size={15}/>New conversation</button>
   <section className="research-awareness" aria-label="Current research context">
     <div className="research-awareness-heading"><h2>Current investigation</h2><span className="research-state" data-state={ask.busy?'active':last?.error?'error':'idle'}>{ask.busy?'Running':last?.error?'Interrupted':last?'Recorded':'Ready'}</span></div>
     <p className="research-current-question">{last?.question||'No investigation started'}</p>
     <dl><div><dt>Model</dt><dd>{ask.status ? ask.status.configured ? 'Configured' : 'Not configured' : 'Checking…'}</dd></div><div><dt>Next sources</dt><dd>{({'platform':'Platform feeds','both':'Platform + web','web':'Web only'} as Record<string,string>)[ask.session.sourcing||'platform']||'Platform feeds'}</dd></div><div><dt>Memory</dt><dd>{mode==='isolated'?'Isolated':mode==='context-aware'?'Approved snapshot':'Standard context'}</dd></div></dl>
     <p className="research-context-note">{hasContext(context)&&!ask.detached?`Attached: ${contextLine(context)}`:'No screen selection attached'}{ask.attachId?' · Saved chat attached':''}</p>
     {last&&<div className="research-step-status"><span>{steps.filter(s=>s.state==='ok').length} completed tools</span><span>{failed.length} failed</span></div>}
     {running&&<p role="status" className="research-active-step">{running.label}</p>}
     {lastSource&&<details className="research-last-source"><summary>Latest tool source</summary><p>{lastSource.source}</p><p>As of {lastSource.asOf||'not supplied'} · {lastSource.latency||'latency not supplied'}</p><p>{lastSource.state==='error'?'This retrieval failed.':'Reported by the tool; completeness is not certified.'}</p></details>}
   </section>
   <nav aria-label="Research tools">{groups.map(group=><section className="research-nav-group" key={group.title}><h2>{group.title}</h2>{group.items.map(tool=><button key={tool.id} onClick={()=>{onTool(tool.id);layout.afterSelection();}}><Icon name={tool.icon} size={15}/><span>{tool.title}</span>{badge(tool.id)!==undefined&&<small aria-label={`${badge(tool.id)} recent records`}>{badge(tool.id)}</small>}</button>)}</section>)}</nav>
   <div className="research-registry-status"><span>{error?'Registry unavailable':catalog?`Registry read ${new Date(catalog.asOf).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`:'Reading registry…'}</span><button onClick={onRefresh} disabled={refreshing} aria-label="Refresh research registry"><Icon name="reset" size={13}/></button><small>Counts show the latest 20 per category.</small>{error&&<p role="alert">Could not refresh. {catalog?'Showing the previous snapshot.':'Retry to load saved records.'}</p>}</div>
   <details className="research-scheduled"><summary><span>Scheduled research</span><span className="research-schedule-state">{!res?'Checking…':!res.ok?'Unavailable':res.control?.paused?'Paused':res.items.some(t=>t.running)?'Running':res.scheduler==='off'?'Automatic off':'Enabled'}</span></summary><ScheduledTaskList openTurns={turns=>{ask.openTurns(turns);layout.afterSelection();}} res={res}/></details>
   <div className="research-saved"><SavedChats ask={{...ask,openSaved:id=>{ask.openSaved(id);layout.afterSelection();}}}/></div>
   <p className="research-local-note"><Icon name="dossier" size={12}/>Conversations stay in this browser. Research records are stored on this server.</p>
 </aside>;
}
