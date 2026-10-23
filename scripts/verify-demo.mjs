#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { snapshotSamples } from '../server/routes/manifest.mjs';
import { demoFile } from '../shared/demoPath.mjs';

const out = path.resolve(process.argv[2] || 'dist-demo');
const dir = path.join(out, 'snapshot');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
if (!manifest.takenAt || !manifest.members?.length || !manifest.symbols?.length) throw new Error('Incomplete snapshot manifest');
const secrets = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8').split('\n').map(line => line.match(/^\s*[A-Z0-9_]+\s*=\s*"?([^"\n]+)"?\s*$/)?.[1]?.trim()).filter(v => v && v.length >= 12) : [];
const unavailable = [], dates = [];
let routes = 0;
for (const file of fs.readdirSync(dir).filter(file => file.endsWith('.json'))) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  if (secrets.some(secret => text.includes(secret))) throw new Error(`Refusing to publish a local configuration value in ${file}`);
  const body = JSON.parse(text);
  if (file.startsWith('api_')) {
    routes++;
    if (body.ok === false) unavailable.push({ file, error: body.error || body.missing || 'Source unavailable' });
    if (body.asOf && Number.isFinite(Date.parse(body.asOf))) dates.push(body.asOf);
  }
}
const missing = snapshotSamples().filter(route => !fs.existsSync(path.join(dir, demoFile(route))));
if (missing.length) throw new Error(`Missing board snapshots: ${missing.join(', ')}`);
for (const file of ['index.html', '404.html', '.nojekyll']) if (!fs.existsSync(path.join(out, file))) throw new Error(`Missing ${file}`);
const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^" ]*\/assets\/[^" ]+)"/g)) {
  const relative = match[1].slice(match[1].indexOf('/assets/') + 1);
  if (!fs.existsSync(path.join(out, relative))) throw new Error(`Missing built asset: ${relative}`);
}
const report = { verifiedAt: new Date().toISOString(), snapshotTakenAt: manifest.takenAt, retainedSnapshotTakenAt: manifest.retainedSnapshotTakenAt || null, routes, members: manifest.members.length, symbols: manifest.symbols.length, available: routes - unavailable.length, unavailable, missing, sourceDateRange: dates.sort().length ? [dates[0], dates.at(-1)] : [], localServerRequired: ['AI answers', 'Research registry and saved records', 'Backtest execution', 'Scheduled tasks', 'Live feeds', 'Data outside this snapshot'] };
fs.writeFileSync(path.join(out, 'demo-coverage.json'), JSON.stringify(report, null, 2));
console.log(`Verified ${routes} snapshot routes: ${report.available} available, ${unavailable.length} source-unavailable; ${report.members} members, ${report.symbols} symbols.`);
