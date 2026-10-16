/** Manual paper simulation only. No broker, quote fetch or live execution capability. */
import {researchStore,getExperiment,hashOf,newId} from './research-store.mjs';
import {requireAuditedSource} from './research-integrity.mjs';
const ready=new WeakSet();
const integer=(n,min,max,label)=>{if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(`${label} must be an integer from ${min} to ${max}.`);return n;};
const text=(s,max,label)=>{if(typeof s!=='string'||!s.trim()||s.length>max)throw Error(`Provide ${label} up to ${max} characters.`);return s.trim();};
function ensure(db){researchStore(db);if(ready.has(db))return;db.exec(`CREATE TABLE IF NOT EXISTS research.paper_accounts(id TEXT PRIMARY KEY,body_hash TEXT NOT NULL,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research.paper_events(account_id TEXT NOT NULL,sequence INTEGER NOT NULL,request_id TEXT NOT NULL,body_hash TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(account_id,sequence),UNIQUE(account_id,request_id));`);
for(const t of ['paper_accounts','paper_events'])for(const op of ['UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS research.${t}_${op.toLowerCase()} BEFORE ${op} ON ${t} BEGIN SELECT RAISE(ABORT,'Paper records are immutable'); END;`);ready.add(db);}
function decode(row){if(!row||hashOf(row.body)!==row.body_hash)throw Error('Paper record missing or checksum mismatch.');return JSON.parse(row.body);}
function accountRules(a){if(a.version!==1||!/^paper_[a-f0-9]+$/.test(a.id)||!Number.isFinite(Date.parse(a.createdAt)))throw Error('Invalid paper account metadata.');text(a.title,200,'account title');integer(a.initialCashCents,1,100000000000,'Initial cash cents');integer(a.maxOrderCents,1,a.initialCashCents,'Maximum order cents');integer(a.maxPositionShares,1,1000000,'Maximum shares per symbol');}
function cleanAction(raw){
 if(raw.kind==='halt'||raw.kind==='resume')return {kind:raw.kind,reason:text(raw.reason,1000,'control reason')};
 if(raw.kind!=='fill')throw Error('Choose fill, halt or resume.');
 const symbol=text(raw.symbol,15,'ticker').toUpperCase();if(!/^[A-Z][A-Z0-9.-]*$/.test(symbol))throw Error('Use a ticker symbol.');
 if(!['buy','sell'].includes(raw.side))throw Error('Choose buy or sell.');
 return {kind:'fill',symbol,side:raw.side,quantity:integer(raw.quantity,1,1000000,'Shares'),priceCents:integer(raw.priceCents,1,1000000000,'Assumed price cents'),feeCents:integer(raw.feeCents,0,100000000,'Fee cents'),approvalReason:text(raw.approvalReason,1000,'approval reason'),priceBasis:text(raw.priceBasis,1000,'price assumption or source')};
}
function apply(state,account,action){
 if(action.kind==='halt'||action.kind==='resume'){const halted=action.kind==='halt';if(state.halted===halted)throw Error(halted?'Account is already halted.':'Account is already active.');return {...state,halted};}
 if(state.halted)throw Error('Paper account is halted. Resume explicitly before recording any fill.');
 const notional=action.quantity*action.priceCents,held=state.positions[action.symbol]||0;
 if(notional+action.feeCents>account.maxOrderCents)throw Error('Paper order exceeds the account order limit, including fees.');
 const shares=held+(action.side==='buy'?action.quantity:-action.quantity);
 if(shares<0)throw Error('Paper sells cannot exceed held shares; shorting is unavailable.');
 if(shares>account.maxPositionShares)throw Error('Paper position exceeds the per-symbol share limit.');
 const cashCents=state.cashCents+(action.side==='buy'?-notional:notional)-action.feeCents;
 if(!Number.isSafeInteger(cashCents)||cashCents<0)throw Error('Insufficient paper cash or cash arithmetic limit exceeded.');
 const positions={...state.positions};if(shares)positions[action.symbol]=shares;else delete positions[action.symbol];
 return {...state,cashCents,positions,feesCents:state.feesCents+action.feeCents,fills:state.fills+1};
}
export function verifyPaperLedger(account,events){
 accountRules(account);let state={cashCents:account.initialCashCents,positions:{},feesCents:0,fills:0,halted:false,sequence:0,head:hashOf(account)};const requests=new Set();
 for(const event of events){
  if(event.accountId!==account.id||event.sequence!==state.sequence+1||event.previousHash!==state.head||requests.has(event.requestId)||typeof event.requestId!=='string'||!event.requestId||!Number.isFinite(Date.parse(event.recordedAt))||hashOf(cleanAction(event.action))!==hashOf(event.action))throw Error('Paper ledger sequence, action or chain mismatch.');
  requests.add(event.requestId);state={...apply(state,account,event.action),sequence:event.sequence,head:hashOf(event)};
 }
 return state;
}
export function createPaperAccount(db,raw){
 ensure(db);const experiment=getExperiment(db,raw.experimentId);if(!experiment?.run?.result.ok||experiment.run.result.building||experiment.run.inputs?.kind)throw Error('Choose a completed single-source experiment.');requireAuditedSource(experiment.run);
 const account={version:1,id:newId('paper'),createdAt:new Date().toISOString(),title:text(raw.title,200,'account title'),experimentId:experiment.id,sourceRunId:experiment.runId,sourceInputHash:experiment.run.inputHash,initialCashCents:raw.initialCashCents,maxOrderCents:raw.maxOrderCents,maxPositionShares:raw.maxPositionShares};accountRules(account);
 const body=JSON.stringify(account);db.prepare('INSERT INTO research.paper_accounts VALUES (?,?,?)').run(account.id,hashOf(body),body);return getPaperAccount(db,account.id);
}
export function getPaperAccount(db,id){ensure(db);const account=decode(db.prepare('SELECT * FROM research.paper_accounts WHERE id=?').get(id));if(account.id!==id)throw Error('Paper account identity mismatch.');
 const rows=db.prepare('SELECT * FROM research.paper_events WHERE account_id=? ORDER BY sequence').all(id),events=rows.map(row=>{const event=decode(row);if(event.sequence!==row.sequence||event.requestId!==row.request_id)throw Error('Paper event index mismatch.');return event;});
 return {account,state:verifyPaperLedger(account,events),events};}
export function listPaperAccounts(db){ensure(db);return db.prepare('SELECT * FROM research.paper_accounts ORDER BY rowid DESC LIMIT 100').all().map(decode);}
export function recordPaperAction(db,id,raw){
 ensure(db);const requestId=text(raw.requestId,100,'unique request ID'),expectedSequence=integer(raw.expectedSequence,0,10000,'Expected sequence'),action=cleanAction(raw);
 db.exec('SAVEPOINT paper_action');
 try{
  const prior=db.prepare('SELECT * FROM research.paper_events WHERE account_id=? AND request_id=?').get(id,requestId);
  if(prior){const event=decode(prior);if(hashOf(event.action)!==hashOf(action))throw Error('Paper request ID was already used with different instructions.');const out=getPaperAccount(db,id);db.exec('RELEASE paper_action');return out;}
  const {account,state}=getPaperAccount(db,id);if(state.sequence!==expectedSequence)throw Error('Paper account changed. Refresh and review the current balances.');if(state.sequence>=10000)throw Error('Paper account reached its 10,000-event limit.');
  apply(state,account,action);
  const event={accountId:id,sequence:state.sequence+1,requestId,previousHash:state.head,recordedAt:new Date().toISOString(),action},body=JSON.stringify(event);
  db.prepare('INSERT INTO research.paper_events VALUES (?,?,?,?,?)').run(id,event.sequence,requestId,hashOf(body),body);
  const out=getPaperAccount(db,id);db.exec('RELEASE paper_action');return out;
 }catch(error){db.exec('ROLLBACK TO paper_action; RELEASE paper_action');throw error;}
}
