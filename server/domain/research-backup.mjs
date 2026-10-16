import {verifyAttemptRow,verifyCompletion} from './tasks/integrity.mjs';
import {verifyObservationDerivation,verifyObservationComposition} from './research-observations.mjs';
import {verifyAnalysisRows} from './research-analysis.mjs';
/** Portable research snapshots. Restores create a new database and never overwrite a live one. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashOf } from './research-store.mjs';
const tables = ['runs', 'engines', 'datasets', 'experiments', 'notebook_revisions', 'convergence_plans', 'convergence_evaluations'];
const fileHash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function inspect(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const checks = db.prepare('PRAGMA integrity_check').all();
    if (checks.length !== 1 || checks[0].integrity_check !== 'ok') throw new Error('SQLite integrity check failed.');
    const present = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
    if (tables.some(t => !present.includes(t))) throw new Error('Missing required research tables.');
    const counts = {};
    for (const table of present) counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM "${table.replaceAll('"', '""')}"`).get().n;
    for (const table of ['runs', 'datasets', 'notebook_revisions', 'convergence_plans', 'source_documents', 'relationship_snapshots', 'memory_approvals', 'memory_snapshots', 'pair_protocols', 'pair_executions', 'pair_results', 'pair_evaluations', 'observation_snapshots', 'stress_plans', 'event_study_plans', 'task_attempts', 'task_completions'].filter(t => present.includes(t))) {
      for (const row of db.prepare(`SELECT body, body_hash FROM ${table}`).iterate()) {
        if (hashOf(row.body) !== row.body_hash) throw new Error(`${table} checksum mismatch.`);
        const body = JSON.parse(row.body);
        if (table === 'runs' && hashOf(body.inputs) !== body.inputHash) throw new Error('Run input checksum mismatch.');
      }
    }
    if(present.includes('task_attempts'))for(const row of db.prepare('SELECT * FROM task_attempts').iterate())verifyAttemptRow(row);
    if(present.includes('task_completions'))for(const row of db.prepare('SELECT attempt_id,body FROM task_completions').iterate()){
      const completion=JSON.parse(row.body),saved=db.prepare('SELECT * FROM task_attempts WHERE id=?').get(row.attempt_id);
      if(completion.attemptId!==row.attempt_id)throw Error('Task completion attempt reference mismatch.');
      verifyCompletion(completion,verifyAttemptRow(saved));
    }
    for(const row of db.prepare('SELECT body FROM notebook_revisions').iterate()){
      const notebook=JSON.parse(row.body);
      for(const reference of notebook.evidence||[]){
        const stored=db.prepare('SELECT body FROM runs WHERE id=?').get(reference.runId),run=stored&&JSON.parse(stored.body);
        if(!run||run.inputHash!==reference.inputHash)throw Error('Notebook evidence run is missing or differs from its pinned checksum.');
      }
    }
    if(present.includes('event_study_plans'))for(const row of db.prepare('SELECT body FROM event_study_plans').iterate()){
      const plan=JSON.parse(row.body),sourceRow=db.prepare('SELECT body FROM runs WHERE id=?').get(plan.sourceRunId);
      const source=sourceRow&&JSON.parse(sourceRow.body);
      if(!source||source.inputHash!==plan.sourceInputHash||source.engineId!==plan.sourceEngineId)throw Error('Event study plan source mismatch.');
      const evaluation=db.prepare('SELECT run_id FROM event_study_evaluations WHERE plan_id=?').get(plan.id);
      if(evaluation){const saved=db.prepare('SELECT body FROM runs WHERE id=?').get(evaluation.run_id);const run=saved&&JSON.parse(saved.body);if(!run||run.inputs.kind!=='event-study'||run.engineId!==plan.engineId||hashOf(run.inputs.base)!==source.inputHash||hashOf(run.inputs.spec)!==hashOf(plan.spec)||hashOf(run.provenance.plan)!==hashOf(plan))throw Error('Event study evaluation reference mismatch.');}
    }
    if(present.includes('event_study_evaluations')&&db.prepare('SELECT 1 FROM event_study_evaluations e LEFT JOIN event_study_plans p ON p.id=e.plan_id LEFT JOIN runs r ON r.id=e.run_id WHERE p.id IS NULL OR r.id IS NULL LIMIT 1').get())throw Error('Missing event study evaluation reference.');
    if(present.includes('stress_plans'))for(const row of db.prepare('SELECT body FROM stress_plans').iterate()){
      const plan=JSON.parse(row.body),sourceRow=db.prepare('SELECT body FROM runs WHERE id=?').get(plan.sourceRunId);
      const source=sourceRow&&JSON.parse(sourceRow.body);
      if(!source||source.inputHash!==plan.sourceInputHash||source.engineId!==plan.sourceEngineId)throw Error('Stress plan source mismatch.');
      const evaluation=db.prepare('SELECT run_id FROM stress_evaluations WHERE plan_id=?').get(plan.id);
      if(evaluation){const saved=db.prepare('SELECT body FROM runs WHERE id=?').get(evaluation.run_id);const run=saved&&JSON.parse(saved.body);if(!run||run.inputs.kind!=='stress'||run.engineId!==plan.engineId||hashOf(run.inputs.base)!==source.inputHash||hashOf(run.inputs.scenarios)!==hashOf(plan.scenarios)||hashOf(run.provenance.plan)!==hashOf(plan))throw Error('Stress evaluation reference mismatch.');}
    }
    if(present.includes('stress_evaluations')&&db.prepare('SELECT 1 FROM stress_evaluations e LEFT JOIN stress_plans p ON p.id=e.plan_id LEFT JOIN runs r ON r.id=e.run_id WHERE p.id IS NULL OR r.id IS NULL LIMIT 1').get())throw Error('Missing stress evaluation reference.');
    if (present.includes('memory_approvals')) for (const row of db.prepare('SELECT body FROM memory_approvals').iterate()) {
      const approval=JSON.parse(row.body);
      const notebook=db.prepare('SELECT body FROM notebook_revisions WHERE notebook_id=? AND revision=?').get(approval.notebookId,approval.revision);
      if (!notebook || hashOf(JSON.parse(notebook.body))!==approval.notebookHash) throw new Error('Memory approval notebook reference mismatch.');
    }
    if (present.includes('memory_snapshots')) for (const row of db.prepare('SELECT body FROM memory_snapshots').iterate()) {
      const snapshot=JSON.parse(row.body);
      const {mode,scope,knownAt,records}=snapshot;
      if (hashOf({mode,scope,knownAt,records})!==snapshot.contentHash) throw new Error('Memory context checksum mismatch.');
      for (const record of records) {
        const approval=db.prepare('SELECT body FROM memory_approvals WHERE id=?').get(record.approval.id);
        if (!approval || hashOf(JSON.parse(approval.body))!==hashOf(record.approval) || hashOf(record.notebook)!==record.approval.notebookHash) throw new Error('Memory snapshot approval reference mismatch.');
      }
    }
    if(present.includes('observation_snapshots')) for(const row of db.prepare('SELECT body FROM observation_snapshots').iterate()) {
      const s=JSON.parse(row.body);
      verifyObservationComposition(s,id=>{const found=db.prepare('SELECT body FROM observation_snapshots WHERE id=?').get(id);if(!found)throw Error('Observation history source missing.');return JSON.parse(found.body);});
      if(hashOf(s.rawContent)!==s.rawHash||hashOf({raw:s.rawContent,mapping:s.mapping,source:s.source,ownership:s.ownership,license:s.license})!==s.contentHash) throw Error('Observation source checksum mismatch.');
    }
    for(const row of db.prepare('SELECT body FROM datasets').iterate()) {
      const dataset=JSON.parse(row.body),observation=dataset.manifest?.observation;
      if(observation){verifyObservationDerivation(dataset);const original=db.prepare('SELECT body FROM observation_snapshots WHERE id=?').get(observation.snapshot.id);if(!original||hashOf(JSON.parse(original.body))!==hashOf(observation.snapshot)) throw Error('Derived observation source mismatch.');}
    }
    if(present.includes('pair_evaluations')) for(const row of db.prepare('SELECT protocol_id,revision,body FROM pair_evaluations ORDER BY protocol_id,revision').iterate()) {
      const e=JSON.parse(row.body);
      const resultRow=db.prepare('SELECT body FROM pair_results WHERE protocol_id=?').get(row.protocol_id);
      const protocolRow=db.prepare('SELECT body FROM pair_protocols WHERE id=?').get(row.protocol_id);
      const result=resultRow&&JSON.parse(resultRow.body),p=protocolRow&&JSON.parse(protocolRow.body);
      if(!result||!p||result.status!=='completed'||e.protocolId!==row.protocol_id||e.revision!==row.revision||e.resultHash!==hashOf(result)||e.executionId!==result.executionId||e.conditionsHash!==p.conditionsHash||e.criteria!==p.evaluation||e.hypothesis!==p.hypothesis) throw Error('Pair evaluation result reference mismatch.');
      const prior=db.prepare('SELECT body FROM pair_evaluations WHERE protocol_id=? AND revision=?').get(row.protocol_id,row.revision-1);
      if((row.revision>1&&!prior)||e.previousId!==(prior?JSON.parse(prior.body).id:null)) throw Error('Pair evaluation revision history mismatch.');
      for(const excerpt of e.excerpts) if(!result.arms[excerpt.arm]?.answer.includes(excerpt.quote)||result.arms[excerpt.arm].analysisId!==excerpt.analysisId) throw Error('Pair evaluation excerpt mismatch.');
    }
    if(present.includes('pair_executions')) for(const row of db.prepare('SELECT protocol_id,body FROM pair_executions').iterate()) {
      const execution=JSON.parse(row.body);
      const protocolRow=db.prepare('SELECT body FROM pair_protocols WHERE id=?').get(row.protocol_id);
      const p=protocolRow&&JSON.parse(protocolRow.body);
      if(!p||execution.protocolId!==p.id||execution.conditionsHash!==p.conditionsHash) throw Error('Paired execution protocol mismatch.');
      for(const mode of ['isolated','context-aware']) {
        const {events}=verifyAnalysisRows(db.prepare('SELECT body,body_hash FROM analysis_events WHERE analysis_id=? ORDER BY sequence').all(execution.arms[mode]));
        const start=events[0].data;
        if(start.request.pairId!==p.id||start.request.conditionsHash!==p.conditionsHash||start.memory.mode!==mode||start.model!==p.conditions.model||start.provider!==p.conditions.provider) throw Error('Paired arm reference mismatch.');
      }
    }
    if(present.includes('pair_results')) for(const row of db.prepare('SELECT protocol_id,body FROM pair_results').iterate()) {
      const result=JSON.parse(row.body);
      const executionRow=db.prepare('SELECT body FROM pair_executions WHERE protocol_id=?').get(row.protocol_id);
      const execution=executionRow&&JSON.parse(executionRow.body);
      if(!execution||result.protocolId!==row.protocol_id||result.executionId!==execution.id) throw Error('Paired result execution mismatch.');
      for(const mode of ['isolated','context-aware']) {
        const arm=result.arms[mode];
        if(arm?.analysisId!==execution.arms[mode]) throw Error('Paired result arm mismatch.');
        const {events}=verifyAnalysisRows(db.prepare('SELECT body,body_hash FROM analysis_events WHERE analysis_id=? ORDER BY sequence').all(arm.analysisId));
        const terminal=events.at(-1),event=events.at(-2);
        const {type,...summary}=event?.data||{};
        if(terminal.kind!=='finished'||terminal.data.status!==arm.status||event.kind!=='event'||hashOf(summary)!==hashOf(arm)) throw Error('Paired result differs from recorded arm.');
      }
    }
    if(present.includes('pair_protocols')) for(const row of db.prepare('SELECT body FROM pair_protocols').iterate()) {
      const p=JSON.parse(row.body),c=p.conditions;
      if(hashOf(c)!==p.conditionsHash||hashOf(c.evidence)!==c.evidenceHash) throw Error('Paired conditions checksum mismatch.');
      const {events,headHash}=verifyAnalysisRows(db.prepare('SELECT body,body_hash FROM analysis_events WHERE analysis_id=? ORDER BY sequence').all(c.evidenceAnalysisId));
      if(headHash!==c.evidenceAnalysisHash) throw Error('Paired evidence source mismatch.');
      for(const item of c.evidence) {
        const e=events[item.sequence];
        if(e?.kind!=='tool_output'||hashOf({sequence:e.sequence,name:e.data.name,args:e.data.args,result:e.data.result,observedAt:e.at})!==hashOf(item)) throw Error('Paired evidence payload mismatch.');
      }
      for(const [id,mode] of [[c.contextSnapshotId,'context-aware'],[p.isolatedSnapshotId,'isolated']]) {
        const row=db.prepare('SELECT body FROM memory_snapshots WHERE id=?').get(id);
        const context=row&&JSON.parse(row.body);
        if(!context||context.mode!==mode||context.knownAt!==c.knownAt||(mode==='context-aware'&&context.contentHash!==c.contextHash)) throw Error('Paired context reference mismatch.');
      }
    }
    if(present.includes('analysis_events')) for(const row of db.prepare('SELECT DISTINCT analysis_id FROM analysis_events').all()) {
      const {events}=verifyAnalysisRows(db.prepare('SELECT body,body_hash FROM analysis_events WHERE analysis_id=? ORDER BY sequence').all(row.analysis_id));
      const start=events[0].data;
      const snapshot=db.prepare('SELECT body FROM memory_snapshots WHERE id=?').get(start.memory.snapshotId);
      if(events[0].analysisId!==row.analysis_id || !snapshot || hashOf(JSON.parse(snapshot.body))!==hashOf(start.snapshot) || start.snapshot.contentHash!==start.memory.contentHash) throw Error('Analysis memory reference mismatch.');
    }
    for (const table of ['evidence_blobs'].filter(t => present.includes(t))) {
      for (const row of db.prepare(`SELECT hash, body FROM ${table}`).iterate()) if (hashOf(row.body) !== row.hash) throw new Error('Evidence checksum mismatch.');
    }
    if (present.includes('evidence_mappings')) {
      for (const row of db.prepare('SELECT hash, body FROM evidence_mappings').iterate()) {
        const blob = db.prepare('SELECT body FROM evidence_blobs WHERE hash=?').get(row.hash);
        if (!blob) throw new Error('Evidence mapping blob is missing.');
        const original = JSON.parse(blob.body), mapping = JSON.parse(row.body);
        if (hashOf(mapping) !== hashOf({ mapping: original.mapping, proofs: original.proofs })) throw new Error('Evidence mapping does not match its source blob.');
      }
    }
    for (const row of db.prepare('SELECT id, body FROM engines').iterate()) if (hashOf(JSON.parse(row.body)) !== row.id) throw new Error('Engine checksum mismatch.');
    for (const query of [
      'SELECT 1 FROM runs r LEFT JOIN engines e ON e.id=r.engine WHERE e.id IS NULL LIMIT 1',
      'SELECT 1 FROM experiments e LEFT JOIN runs r ON r.id=e.run_id WHERE r.id IS NULL LIMIT 1',
      'SELECT 1 FROM convergence_evaluations e LEFT JOIN runs r ON r.id=e.run_id LEFT JOIN convergence_plans p ON p.id=e.plan_id WHERE r.id IS NULL OR p.id IS NULL LIMIT 1'
    ]) if (db.prepare(query).get()) throw new Error('Research snapshot contains missing references.');
    return counts;
  } finally { db.close(); }
}
export function createResearchBackup(source, directory) {
  source = path.resolve(source); directory = path.resolve(directory);
  if (!fs.statSync(source).isFile()) throw new Error('Research source must be an existing database file.');
  // Exclusive directory creation protects existing backups from accidental replacement.
  fs.mkdirSync(directory, { mode: 0o700 });
  const target = path.join(directory, 'research.sqlite');
  let db;
  try {
    db = new DatabaseSync(source, { readOnly: true });
    // SQLite creates a consistent snapshot including committed WAL contents.
    db.prepare('VACUUM INTO ?').run(target);
    db.close(); db = null;
    fs.chmodSync(target, 0o600);
    const counts = inspect(target);
    const manifest = { version: 1, createdAt: new Date().toISOString(), file: 'research.sqlite', sha256: fileHash(target), counts };
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return manifest;
  } catch (error) {
    db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
export function verifyResearchBackup(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || manifest.file !== 'research.sqlite') throw new Error('Unsupported backup manifest.');
  const file = path.join(directory, manifest.file);
  if (fileHash(file) !== manifest.sha256) throw new Error('Backup file checksum mismatch.');
  const counts = inspect(file);
  if (JSON.stringify(counts) !== JSON.stringify(manifest.counts)) throw new Error('Backup table counts mismatch.');
  return manifest;
}
export function restoreResearchBackup(directory, destination) {
  const manifest = verifyResearchBackup(directory);
  destination = path.resolve(destination);
  for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(destination + suffix)) throw new Error('Restore destination or SQLite sidecars already exist; choose a new database path.');
  fs.copyFileSync(path.join(directory, 'research.sqlite'), destination, fs.constants.COPYFILE_EXCL);
  try {
    fs.chmodSync(destination, 0o600);
    if (fileHash(destination) !== manifest.sha256) throw new Error('Restored database checksum mismatch.');
    inspect(destination);
    return { destination, counts: manifest.counts, verified: true };
  } catch (error) { fs.rmSync(destination, { force: true }); throw error; }
}
