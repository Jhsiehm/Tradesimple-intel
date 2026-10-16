/** Internal consistency only: importer-supplied evidence is not authenticated provider testimony. */
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function verifyConnectorEvidence(json){
 const e=json?.connectorEvidence;if(e===undefined)return;
 const fail=()=>{throw Error('Connector evidence is inconsistent with its pages or imported records. Fetch a new complete preview.');};
 if(!e||e.schemaVersion!==1||e.complete!==true||!Array.isArray(e.pages)||!e.pages.length||e.pages.length>20||!Array.isArray(json.items))fail();
 const p=e.pagination;
 if(!p||!['itemsField','nextCursorField','cursorParam'].every(k=>typeof p[k]==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(p[k]))||p.itemsField===p.nextCursorField||!Number.isInteger(p.maxPages)||p.maxPages<e.pages.length||p.maxPages>20)fail();
 const items=[],seen=new Set();let cursor=null;
 for(let i=0;i<e.pages.length;i++){
  const page=e.pages[i];if(!page||page.page!==i+1||typeof page.rawContent!=='string'||hash(page.rawContent)!==page.responseHash||page.requestCursorHash!==(cursor===null?null:hash(cursor)))fail();
  let raw;try{raw=JSON.parse(page.rawContent);}catch{fail();}
  if(!raw||typeof raw!=='object'||!Object.hasOwn(raw,p.itemsField)||!Array.isArray(raw[p.itemsField])||!Object.hasOwn(raw,p.nextCursorField)||page.rows!==raw[p.itemsField].length)fail();
  if(items.length+raw[p.itemsField].length>5000)fail();
  items.push(...raw[p.itemsField]);
  const next=raw[p.nextCursorField],last=i===e.pages.length-1;
  if(last){if(next!==null&&next!=='')fail();}
  else{if(typeof next!=='string'||!next||next.length>2048||seen.has(next))fail();seen.add(next);cursor=next;}
 }
 if(JSON.stringify(items)!==JSON.stringify(json.items))fail();
}
