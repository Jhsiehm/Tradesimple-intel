import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { expandUniverse, mapContractorRecipients, defaultWarmTickers } from '../shared/universe.mjs';
const sec = { fields: ['cik', 'name', 'ticker', 'exchange'], data: [[2, 'New issuer', 'NEW', 'NYSE'], [3, 'Fund', 'FUND', 'NYSE'], [4, 'OTC', 'OTC', 'OTC']] };
const current = [{ symbol: 'OLD', core: true, contractParents: [{ uei: 'ONE' }] }];
test('expansion preserves curated joins and adds exact SEC matches without expanding automatic coverage', () => {
 const rows = expandUniverse(current, sec, [{ symbol: 'NEW', name: 'New Common Stock', marketCap: 100 }, { symbol: 'FUND', name: 'Fund ETF', marketCap: 200 }, { symbol: 'OTC', name: 'OTC', marketCap: 300 }], 2, '2026-10-16');
 assert.deepEqual(rows.find(r => r.symbol === 'OLD'), current[0]);
 const n = rows.find(r => r.symbol === 'NEW');
 assert.equal(n.cik, '0000000002'); assert.equal(n.insiderHistory, false); assert.equal(n.core, false); assert.deepEqual(n.contractParents, []); assert.deepEqual(n.index, []);
 assert.deepEqual(defaultWarmTickers(rows), current);
 assert.throws(() => expandUniverse(current, sec, [], 2), /incomplete/);
});
test('contractor linking requires an existing UEI, never just a similar company name', () => {
 const out = mapContractorRecipients([{ name: 'OLD', uei: 'OTHER', amount: 10 }, { name: 'Subsidiary', uei: 'ONE', amount: 5 }], current);
 assert.deepEqual(out[0].symbols, []); assert.equal(out[0].mapping, 'unresolved'); assert.deepEqual(out[1].symbols, ['OLD']);
});
test('live registry is unique, over 1000 tickers, and bounded to its original automatic/history scope', () => {
 const rows = JSON.parse(fs.readFileSync(new URL('../data/tickers.json', import.meta.url)));
 const meta = JSON.parse(fs.readFileSync(new URL('../data/universe.json', import.meta.url)));
 assert.ok(rows.length > 1000); assert.equal(rows.length, meta.total); assert.equal(new Set(rows.map(r => r.symbol)).size, rows.length);
 assert.equal(defaultWarmTickers(rows).length, 101); assert.equal(rows.filter(r => r.insiderHistory !== false).length, 504);
 assert.equal(meta.contractors.items.length, 500);
 assert.ok(meta.contractors.items.every((r, i, all) => r.rank === i + 1 && (!i || r.obligations <= all[i - 1].obligations)));
});

test('listed debt cannot displace an equity in the broad universe', () => {
 const source = { fields: sec.fields, data: [...sec.data, [8, 'Debt issuer', 'NOTE', 'NYSE']] };
 const out = expandUniverse(current, source, [{ symbol: 'NOTE', name: 'Issuer 5.0% Subordinated Notes due 2060', marketCap: 999 }, { symbol: 'NEW', name: 'New Common Stock', marketCap: 100 }], 2);
 assert.equal(out.some(r => r.symbol === 'NOTE'), false);
});

test('explicit non-core insider research reaches the requested issuer without enlarging bulk history', async () => {
 const { openDb } = await import('../server/lib/db.mjs');
 const { joinsByCik } = await import('../server/domain/positions/insiderStore.mjs');
 const os = await import('node:os');
 const path = await import('node:path');
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'universe-research-'));
 fs.mkdirSync(path.join(root, 'data'));
 fs.writeFileSync(path.join(root, 'data/tickers.json'), JSON.stringify([{ symbol: 'NEW', name: 'New issuer', cik: '0000000002', core: false, insiderHistory: false, ldaClients: [], recipients: [], districts: [], state: null, lat: null, lon: null }]));
 const { insiderHistory } = await import('../server/domain/positions/insiders.mjs');
 const db = openDb(root);
 assert.equal(joinsByCik(db).byCik.size, 0);
 const requested = [];
 try {
   const result = await insiderHistory(db, { symbols: ['NEW'], store: false, subsOf: async (_db, cik) => { requested.push(cik); return { filings: { recent: {} } }; } });
   assert.deepEqual(requested, ['0000000002']); assert.equal(result.issuers, 1);
 } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
