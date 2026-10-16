/** Fixed, server-configured read-only connectors; secrets never enter browser requests or saved datasets. */
import dns from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { privateAddress } from '../feeds/web.mjs';
import { fetchPinnedResponse } from '../lib/pinnedHttp.mjs';
import { IMPORT_LIMIT, ROW_LIMIT } from './research-events.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
function configs(env) {
  let entries;
  try { entries = JSON.parse(env.RESEARCH_API_CONNECTORS || '{}'); } catch { throw new Error('Connector configuration is not valid JSON.'); }
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('RESEARCH_API_CONNECTORS must be a JSON object.');
  return entries;
}
export function listConnectors(env = process.env) {
  return Object.keys(configs(env)).map(id => ({ id, label: id }));
}
export async function readConnector(id, { env = process.env, lookup = dns.lookup, request = fetchPinnedResponse } = {}) {
  const entries = configs(env);
  const c = Object.hasOwn(entries, id) ? entries[id] : null;
  if (!c || typeof c.url !== 'string') throw new Error('Choose a configured API connector.');
  let url;
  try { url = new URL(c.url); } catch { throw new Error('Connector URL is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash || url.search) throw new Error('Connector URL must be HTTPS on port 443 without credentials, query parameters, or fragments.');
  const pagination=c.pagination;
  if(pagination!=null&&(!pagination||typeof pagination!=='object'||Array.isArray(pagination)))throw Error('Connector pagination must be an object.');
  if(pagination){
    for(const key of ['cursorParam','nextCursorField','itemsField'])if(typeof pagination[key]!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(pagination[key]))throw Error('Connector pagination requires simple top-level field names and a cursor parameter.');
    if(pagination.nextCursorField===pagination.itemsField)throw Error('Connector item and cursor fields must differ.');
    if(!Number.isInteger(pagination.maxPages)||pagination.maxPages<1||pagination.maxPages>20)throw Error('Connector maxPages must be between 1 and 20.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const addresses = await Promise.race([lookup(url.hostname, { all: true }), new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Connector timed out.')), { once: true }))]);
    if (!addresses.length || addresses.some(a => privateAddress(a.address))) throw new Error('Connector must resolve exclusively to public internet addresses.');
    const token = c.tokenEnv ? env[c.tokenEnv] : '';
    if (c.tokenEnv && !token) throw new Error('Connector credential is not configured on the server.');
    const pages=[],items=[],seen=new Set();let cursor=null,total=0;
    for(let page=0;page<(pagination?.maxPages||1);page++){
      const endpoint=new URL(url);
      if(cursor!==null)endpoint.searchParams.set(pagination.cursorParam,cursor);
      // The provider supplies only an opaque cursor. It cannot select a URL, host, path or credentials.
      const res = await request(endpoint, { addresses, headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: controller.signal });
      if (!res.ok || res.status >= 300) { await res.body?.cancel(); throw new Error(`Connector returned HTTP ${res.status}; redirects are not followed.`); }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Connector returned an empty response.');
      const chunks=[];
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > IMPORT_LIMIT) throw new Error('Connector responses exceed 2 MiB in total.'); chunks.push(value); } }
      finally { await reader.cancel().catch(() => {}); }
      const content=Buffer.concat(chunks).toString('utf8');
      if (token && content.includes(token)) throw new Error('Connector response contains its credential; import refused.');
      if(!pagination)return {content,format:'json',source:`API connector: ${id}`};
      let parsed;try{parsed=JSON.parse(content);}catch{throw Error('Connector page is not valid JSON.');}
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||!Object.hasOwn(parsed,pagination.itemsField)||!Array.isArray(parsed[pagination.itemsField])||parsed[pagination.itemsField].some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('Connector page requires the configured array of row objects.');
      if(!Object.hasOwn(parsed,pagination.nextCursorField))throw Error('Connector page is missing its completion cursor; partial imports are refused.');
      const next=parsed[pagination.nextCursorField];
      if(next!==null&&(typeof next!=='string'||next.length>2048))throw Error('Connector next cursor must be null or a string up to 2,048 characters.');
      if(items.length+parsed[pagination.itemsField].length>ROW_LIMIT)throw Error('Connector exceeds 5,000 rows; partial imports are refused.');
      items.push(...parsed[pagination.itemsField]);
      pages.push({page:page+1,retrievedAt:new Date().toISOString(),requestCursorHash:cursor===null?null:digest(cursor),responseHash:digest(content),rawContent:content,rows:parsed[pagination.itemsField].length});
      if(next===null||next===''){
        const evidence={schemaVersion:1,connector:id,endpoint:url.href,pagination:Object.fromEntries(['cursorParam','nextCursorField','itemsField','maxPages'].map(k=>[k,pagination[k]])),complete:true,coverage:'Pagination completed; historical completeness is not independently verified.',pages};
        const combined=JSON.stringify({items,connectorEvidence:evidence});
        if(token&&combined.includes(token))throw Error('Connector evidence contains its credential; import refused.');
        if(Buffer.byteLength(combined)>IMPORT_LIMIT)throw Error('Connector records and preserved page evidence exceed 2 MiB.');
        return {content:combined,format:'json',source:`API connector: ${id}`,retrieval:{pages:pages.length,rows:items.length,complete:true}};
      }
      if(seen.has(next))throw Error('Connector repeated a pagination cursor; partial imports are refused.');
      seen.add(next);cursor=next;
    }
    throw Error('Connector page limit reached before completion; partial imports are refused.');
  } catch (error) {
    // Network errors may contain configured URLs. Only return our controlled messages.
    if (/^(Connector|Choose)/.test(error.message)) throw error;
    throw new Error('Connector request failed. Check server configuration and upstream availability.');
  } finally { clearTimeout(timer); controller.abort(); }
}
