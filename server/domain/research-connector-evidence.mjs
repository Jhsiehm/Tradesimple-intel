/** Internal consistency only: importer-supplied evidence is not authenticated provider testimony. */
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
export const validConnectorTimestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export function validConnectorEndpoint(value){
 if(typeof value!=='string')return false;
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&!url.hash&&!url.search&&url.href===value;}catch{return false;}
}
export const validConnectorPagination=p=>Boolean(p&&['itemsField','nextCursorField','cursorParam'].every(k=>typeof p[k]==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(p[k]))&&p.itemsField!==p.nextCursorField&&Number.isInteger(p.maxPages)&&p.maxPages>=1&&p.maxPages<=20);
export function verifyConnectorEvidence(json){
 const database=json?.databaseEvidence;
 if(database!==undefined){
  if(!database||database.schemaVersion!==1||database.kind!=='sqlite'||typeof database.connector!=='string'||!database.connector||!/^([a-f0-9]{64})$/.test(database.queryHash)||!Array.isArray(json.items)||database.rows!==json.items.length||database.rows>5000||database.rowsHash!==hash(JSON.stringify(json.items))||database.consistency!=='single-read-transaction'||!validConnectorTimestamp(database.retrievedAt)||!validConnectorTimestamp(database.completedAt)||Date.parse(database.completedAt)<Date.parse(database.retrievedAt))throw Error('Database evidence is inconsistent with its imported records. Fetch a new complete preview.');
 }
 const e=json?.connectorEvidence;if(e===undefined)return;
 const fail=()=>{throw Error('Connector evidence is inconsistent with its pages or imported records. Fetch a new complete preview.');};
 if(!e||typeof e.connector!=='string'||!e.connector||!validConnectorEndpoint(e.endpoint)||e.schemaVersion!==1||e.complete!==true||!Array.isArray(e.pages)||!e.pages.length||e.pages.length>20||!Array.isArray(json.items))fail();
 const p=e.pagination;
 if(!validConnectorPagination(p)||p.maxPages<e.pages.length)fail();
 const items=[],seen=new Set();let cursor=null;
 for(let i=0;i<e.pages.length;i++){
  const page=e.pages[i];if(!page||!validConnectorTimestamp(page.retrievedAt)||page.page!==i+1||typeof page.rawContent!=='string'||hash(page.rawContent)!==page.responseHash||page.requestCursorHash!==(cursor===null?null:hash(cursor)))fail();
  let raw;try{raw=JSON.parse(page.rawContent);}catch{fail();}
  if(!raw||typeof raw!=='object'||!Object.hasOwn(raw,p.itemsField)||!Array.isArray(raw[p.itemsField])||raw[p.itemsField].some(row=>!row||typeof row!=='object'||Array.isArray(row))||!Object.hasOwn(raw,p.nextCursorField)||page.rows!==raw[p.itemsField].length)fail();
  if(items.length+raw[p.itemsField].length>5000)fail();
  items.push(...raw[p.itemsField]);
  const next=raw[p.nextCursorField],last=i===e.pages.length-1;
  if(last){if(next!==null&&next!=='')fail();}
  else{if(typeof next!=='string'||!next||next.length>2048||seen.has(next))fail();seen.add(next);cursor=next;}
 }
 if(JSON.stringify(items)!==JSON.stringify(json.items))fail();
}
