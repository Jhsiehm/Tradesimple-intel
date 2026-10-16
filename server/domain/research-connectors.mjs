/** Fixed, server-configured read-only connectors; secrets never enter browser requests or saved datasets. */
import dns from 'node:dns/promises';
import { privateAddress } from '../feeds/web.mjs';
import { fetchPinnedResponse } from '../lib/pinnedHttp.mjs';
import { IMPORT_LIMIT } from './research-events.mjs';
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const addresses = await Promise.race([lookup(url.hostname, { all: true }), new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Connector timed out.')), { once: true }))]);
    if (!addresses.length || addresses.some(a => privateAddress(a.address))) throw new Error('Connector must resolve exclusively to public internet addresses.');
    const token = c.tokenEnv ? env[c.tokenEnv] : '';
    if (c.tokenEnv && !token) throw new Error('Connector credential is not configured on the server.');
    const res = await request(url, { addresses, headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: controller.signal });
    if (!res.ok || res.status >= 300) { await res.body?.cancel(); throw new Error(`Connector returned HTTP ${res.status}; redirects are not followed.`); }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('Connector returned an empty response.');
    const chunks = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > IMPORT_LIMIT) throw new Error('Connector response exceeds 2 MiB.'); chunks.push(value); } }
    finally { await reader.cancel().catch(() => {}); }
    const content = Buffer.concat(chunks).toString('utf8');
    if (token && content.includes(token)) throw new Error('Connector response contains its credential; import refused.');
    return { content, format: 'json', source: `API connector: ${id}` };
  } catch (error) {
    // Network errors may contain configured URLs. Only return our controlled messages.
    if (/^(Connector|Choose)/.test(error.message)) throw error;
    throw new Error('Connector request failed. Check server configuration and upstream availability.');
  } finally { clearTimeout(timer); controller.abort(); }
}
