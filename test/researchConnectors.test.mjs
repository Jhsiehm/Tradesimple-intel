import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readConnector} from '../server/domain/research-connectors.mjs';
import {prepareObservations} from '../server/domain/research-observations.mjs';
import {verifyConnectorEvidence} from '../server/domain/research-connector-evidence.mjs';
import {hashOf} from '../server/domain/research-store.mjs';
const pagination={cursorParam:'cursor',nextCursorField:'next',itemsField:'records',maxPages:3};
const config=(overrides={})=>({RESEARCH_API_CONNECTORS:JSON.stringify({weather:{url:'https://example.org/history',tokenEnv:'FIXTURE_KEY',pagination,...overrides}}),FIXTURE_KEY:'private-fixture-key'});
const lookup=async()=>[{address:'93.184.216.34',family:4}];
const row=(id,value)=>({id,entityId:'facility:test',metric:'temperature',unit:'C',value,eventAt:'2025-01-01',availableAt:'2025-01-03',sourceUrl:'https://example.org/evidence'});
test('cursor connector pins one vetted origin and preserves every exact page in validated observation content',async()=>{
 let calls=0,dns=0;const raw=[JSON.stringify({records:[row('a',-4)],next:'https://127.0.0.1/private?key=x'}),JSON.stringify({records:[row('b',0)],next:null})];
 const result=await readConnector('weather',{env:config({pagination:{...pagination,ignoredSecret:'never-copy-this'}}),lookup:async()=>{dns++;return lookup();},request:async(url,options)=>{
  assert.equal(url.origin,'https://example.org');assert.equal(url.pathname,'/history');assert.equal(options.headers.authorization,'Bearer private-fixture-key');assert.equal(options.addresses[0].address,'93.184.216.34');
  assert.equal(url.searchParams.get('cursor'),calls?'https://127.0.0.1/private?key=x':null);
  return new Response(raw[calls++]);
 }});
 assert.equal(calls,2);assert.equal(dns,1);assert.deepEqual(result.retrieval,{pages:2,rows:2,complete:true});
 const payload=JSON.parse(result.content);assert.equal(payload.items.length,2);
 assert.deepEqual(payload.connectorEvidence.pages.map(p=>p.rawContent),raw);assert.equal(payload.connectorEvidence.pages[1].requestCursorHash,hashOf('https://127.0.0.1/private?key=x'));
 assert.deepEqual(payload.connectorEvidence.pages.map(p=>p.responseHash),raw.map(hashOf));
 assert.ok(!JSON.stringify(result).includes('private-fixture-key'));assert.ok(!JSON.stringify(result).includes('never-copy-this'));
 const prepared=prepareObservations({name:'Connector temperatures',ownership:'Local owner',license:'Fixture only',...result});assert.equal(prepared.ok,true);assert.equal(prepared.payload.events[1].value,0);assert.equal(prepared.payload.rawContent,result.content);
 assert.doesNotThrow(()=>verifyConnectorEvidence(payload));
 for(const alter of [p=>{p.items[0].value=100;},p=>{p.connectorEvidence.pages[0].rawContent='changed';},p=>{p.connectorEvidence.pages[1].requestCursorHash='wrong';},p=>{p.connectorEvidence.complete=false;}]){const changed=structuredClone(payload);alter(changed);assert.throws(()=>prepareObservations({name:'Changed',ownership:'Local owner',license:'Fixture only',...result,content:JSON.stringify(changed)}),/evidence is inconsistent/);}
});
test('pagination requires explicit completion and refuses cycles, bounds and malformed pages',async()=>{
 for(const [pages,pattern,overrides] of [
  [[{records:[]}],/completion cursor/],
  [[{records:[],next:'again'},{records:[],next:'again'}],/repeated/],
  [[{records:[],next:'unfinished'}],/page limit/,{pagination:{...pagination,maxPages:1}}],
  [[{records:[],next:42}],/cursor must/],
  [[{records:[null],next:null}],/row objects/],
  [['not json'],/not valid JSON/],
  [[{records:Array.from({length:5001},()=>({id:'x'})),next:null}],/5,000 rows/]
 ]){
  let i=0;await assert.rejects(readConnector('weather',{env:config(overrides),lookup,request:async()=>new Response(typeof pages[i]==='string'?pages[i++]:JSON.stringify(pages[i++]))}),pattern);
 }
});
test('later connector pages cannot bypass redirect or credential protections',async()=>{
 for(const [response,pattern] of [[new Response('',{status:302,headers:{location:'http://127.0.0.1'}}),/redirects/],[new Response(JSON.stringify({records:[],next:'private-fixture-key'})),/credential/]]){
  let count=0;await assert.rejects(readConnector('weather',{env:config(),lookup,request:async()=>count++?response:new Response(JSON.stringify({records:[],next:'page-two'}))}),pattern);assert.equal(count,2);
 }
 await assert.rejects(readConnector('weather',{env:config({pagination:{...pagination,maxPages:100}}),lookup,request:async()=>assert.fail('invalid configuration must not connect')}),/maxPages/);
});
