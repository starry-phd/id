import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Buffer} from 'node:buffer';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {setImmediate} from 'node:timers';
import {createOfflineDeletionFanoutReview} from '../src/round17-offline-deletion-fanout-review.ts';
import {createR18OfflineSagaTransport,R18_DISPOSABLE_TRANSPORT_SQL,
 R18_LIVE_TRANSPORT_ENABLED,R18_ONLY_LOGICAL_SOURCE}
 from '../src/round18-offline-outbox-saga-transport.ts';

const scope={brand_id:'starry',environment:'staging'};
const event='delete_'+'e'.repeat(32),member='member_01';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const canonical=w=>[w.brand_id,w.environment,w.event_id,w.member_ref,
 w.auth_version,w.policy_revision].join('|');
const unsigned=()=>({brand_id:'starry',environment:'staging',event_id:event,
 member_ref:member,auth_version:3,policy_revision:'law-v1'});
const signed=w=>({...w,signature:sign('sha256',Buffer.from(canonical(w)),
 privateKey).toString('base64url')});
function fixture(){
 const coordinator=new DatabaseSync(':memory:');
 coordinator.exec(R18_DISPOSABLE_TRANSPORT_SQL.create);
 const domains=new Map();
 for(const domain of ['battery','billing','task']){
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE receipt (sink TEXT,brand_id TEXT,environment TEXT,event_id TEXT,member_ref TEXT,auth_version INTEGER,policy_revision TEXT,source_event_ref TEXT,committed INTEGER,inbox_applied INTEGER,pending_holds INTEGER,active_entitlements INTEGER,task_released INTEGER)");
  db.prepare('INSERT INTO receipt VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(domain,'starry','staging',event,member,3,'law-v1',event,1,1,0,0,0);
  domains.set(domain,db);
 }
 let policy='law-v1',approved=true,now=1700000060,deleted=true;
 let witness=signed(unsigned()),r17Calls=0,signatureChecks=0,reads=0;
 const readOwnerSink=async domain=>{
  reads++;
  const db=domains.get(domain);
  const row=db?.prepare('SELECT * FROM receipt WHERE event_id=?').get(event);
  return row?{...row,committed:row.committed===1,
   inbox_applied:row.inbox_applied===1,task_released:row.task_released===1}:null;
 };
 const r17=createOfflineDeletionFanoutReview(scope,'law-v1',{
  readPolicy:async()=>({revision:policy,processing_approved:approved}),
  readCurrentDeletion:async()=>({...scope,event_id:event,member_ref:witness.member_ref,
   auth_version:witness.auth_version,deleted}),
  deliverLocal:async()=>({status:'local_recorded',reason:'SINK_REVOCATION_LOCALLY_DURABLE_ONLY',
   may_ack_queue:false,may_regrant:false,live:false,
   sole_publisher:'AI-1_AUTH_COMMITTED_OUTBOX'}),
  readLocalSink:async domain=>{
   const r=await readOwnerSink(domain);
   return r?{sink:r.sink,brand_id:r.brand_id,environment:r.environment,
    event_id:r.event_id,member_ref:r.member_ref,auth_version:r.auth_version,
    policy_revision:r.policy_revision,local_inbox_applied:r.inbox_applied,
    blocked_from_regrant:true,pending_operations:r.pending_holds}:null;
  }
 });
 const dbPort={prepare:sql=>({bind:(...values)=>({
  first:async()=>coordinator.prepare(sql).get(...values)??null
 })})};
 const ports={
  db:dbPort,readWitness:async()=>witness,
  verifyOfflineSignature:async w=>{
   signatureChecks++;
   try{return verify('sha256',Buffer.from(canonical(w)),publicKey,
    Buffer.from(w.signature,'base64url'))}
   catch{return false;}
  },
  readPolicy:async()=>({revision:policy,processing_approved:approved}),
  reviewExistingR17:async(...args)=>{r17Calls++;return r17.review(...args)},
  readOwnerSink,nowSec:()=>now
 };
 const saga=()=>createR18OfflineSagaTransport(scope,'law-v1',ports);
 return {coordinator,domains,ports,saga,
  setPolicy:v=>{policy=v},setApproved:v=>{approved=v},setNow:v=>{now=v},
  setDeleted:v=>{deleted=v},
  changeWitness:patch=>{witness={...witness,...patch}},
  resign:()=>{witness=signed({...witness,signature:undefined})},
  mutate:(name,field,value)=>domains.get(name).prepare('UPDATE receipt SET '+field+'=?').run(value),
  remove:name=>domains.get(name).exec('DELETE FROM receipt'),
  row:()=>coordinator.prepare('SELECT * FROM ai4_r18_offline_saga').get(),
  get r17Calls(){return r17Calls},
  get signatureChecks(){return signatureChecks},
  get reads(){return reads},
  close:()=>{coordinator.close();for(const db of domains.values())db.close()}
 };
}
function forbidden(result){
 for(const key of ['may_ack_queue','may_dlq','may_release_task','may_regrant',
  'may_restore','publishable','live'])assert.equal(result[key],false,key);
 assert.equal(Object.isFrozen(result),true);
}
test('R18 signed test witness + three independent local DB readbacks are ONLY a non-ACK candidate',async()=>{
 const f=fixture();try{
  const out=await f.saga().inspect(event,1700000060);
  assert.equal(out.status,'observed_local');assert.equal(out.attempt_count,1);
  assert.equal(f.row().status,'observed_local');
  assert.equal(f.domains.size,3);
  assert.equal(R18_LIVE_TRANSPORT_ENABLED,false);
  assert.equal(R18_ONLY_LOGICAL_SOURCE,'AI-1_AUTH_COMMITTED_OUTBOX');
  assert.equal('publish' in f.saga(),false);assert.equal('ack' in f.saga(),false);
  forbidden(out);
 }finally{f.close();}
});
test('R18 lost Queue ACK replay is duplicate local only, cannot ACK/DLQ or rewrite owner receipts',async()=>{
 const f=fixture();try{
  assert.equal((await f.saga().inspect(event,1700000060)).status,'observed_local');
  f.setNow(1700000061);
  const out=await f.saga().inspect(event,1700000061);
  assert.equal(out.status,'duplicate_local');
  assert.equal(out.reason,'QUEUE_ACK_LOST_REDELIVERY_LOCAL_ONLY');
  assert.equal(f.row().attempt_count,1);forbidden(out);
  for(const db of f.domains.values())
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM receipt').get().n,1);
 }finally{f.close();}
});
test('R18 missing legal approval blocks before source lease or sink writes',async()=>{
 const f=fixture();try{
  f.setApproved(false);
  const out=await f.saga().inspect(event,1700000060);
  assert.equal(out.status,'blocked');assert.equal(f.row(),undefined);
  assert.equal(f.r17Calls,0);forbidden(out);
 }finally{f.close();}
});
test('R18 wrong signed issuer, tampered signature and fake Auth witness do not claim lease',async()=>{
 const f=fixture();try{
  f.changeWitness({member_ref:'someone_else'});
  let out=await f.saga().inspect(event,1700000060);
  assert.equal(out.status,'blocked');forbidden(out);
  f.changeWitness({signature:'z'.repeat(64)});
  out=await f.saga().inspect(event,1700000060);
  assert.equal(out.status,'blocked');forbidden(out);
  assert.equal(f.row(),undefined);assert.equal(f.r17Calls,0);
 }finally{f.close();}
});
test('R18 foreign brand/environment and malformed event never use publisher',async()=>{
 const f=fixture();try{
  assert.throws(()=>createR18OfflineSagaTransport({...scope,brand_id:'hglobal'},'law-v1',f.ports),/SCOPE_DENIED/);
  assert.throws(()=>createR18OfflineSagaTransport({...scope,environment:'production'},'law-v1',f.ports),/SCOPE_DENIED/);
  assert.throws(()=>createR18OfflineSagaTransport(scope,'?',f.ports),/POLICY_REQUIRED/);
  assert.throws(()=>createR18OfflineSagaTransport(scope,'law-v1',{}),/PORTS_REQUIRED/);
  for(const candidate of [null,{},'oops',{event_id:event}])
   assert.equal((await f.saga().inspect(candidate,1700000060)).status,'blocked');
  f.changeWitness({environment:'production'});
  assert.equal((await f.saga().inspect(event,1700000060)).status,'blocked');
  assert.equal(f.row(),undefined);
 }finally{f.close();}
});
test('R18 partial Billing sink commit enters durable local retry, recovery reuses same event',async()=>{
 const f=fixture();try{
  f.remove('billing');
  let out=await f.saga().inspect(event,1700000060);
  assert.equal(out.status,'retry');assert.equal(f.row().status,'retry');
  assert.equal(f.row().attempt_count,1);forbidden(out);
  f.setNow(1700000061);
  assert.equal((await f.saga().inspect(event,1700000061)).status,'retry');
  assert.equal(f.row().attempt_count,1);
  f.setNow(1700000062);
  f.domains.get('billing').prepare('INSERT INTO receipt SELECT * FROM main.receipt WHERE 0').run();
  f.domains.get('billing').prepare('INSERT INTO receipt VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .run('billing','starry','staging',event,member,3,'law-v1',event,1,1,0,0,0);
  out=await f.saga().inspect(event,1700000062);
  assert.equal(out.status,'observed_local');assert.equal(f.row().attempt_count,2);
  forbidden(out);
 }finally{f.close();}
});
test('R18 local DLQ candidate bounded retry becomes immutable human-review, never sends real DLQ',async()=>{
 const f=fixture();try{
  f.remove('task');
  assert.equal((await f.saga().inspect(event,1700000060)).status,'retry');
  f.setNow(1700000062);
  assert.equal((await f.saga().inspect(event,1700000062)).status,'retry');
  f.setNow(1700000066);
  const out=await f.saga().inspect(event,1700000066);
  assert.equal(out.status,'review_only');assert.equal(out.attempt_count,3);
  assert.equal(f.row().status,'review_only');forbidden(out);
  f.setNow(1700000120);
  const again=await f.saga().inspect(event,1700000120);
  assert.equal(again.status,'review_only');assert.equal(f.row().attempt_count,3);forbidden(again);
 }finally{f.close();}
});
test('R18 simultaneous event deliveries cannot both acquire active lease',async()=>{
 const f=fixture();try{
  let release;
  const original=f.ports.reviewExistingR17;
  f.ports.reviewExistingR17=async(...args)=>{
   await new Promise(r=>{release=r});
   return original(...args);
  };
  const first=f.saga().inspect(event,1700000060);
  for(let i=0;i<30&&!release;i++)await new Promise(r=>setImmediate(r));
  assert.equal(typeof release,'function');
  const competing=await f.saga().inspect(event,1700000060);
  assert.equal(competing.status,'retry');forbidden(competing);
  release();
  assert.equal((await first).status,'observed_local');
  assert.equal(f.row().attempt_count,1);
 }finally{f.close();}
});
test('R18 pending Task->Battery wallet holds cannot release Task or finalize Saga',async()=>{
 const f=fixture();try{
  f.mutate('battery','pending_holds',1);
  const out=await f.saga().inspect(event,1700000060);
  assert.equal(out.status,'retry');assert.equal(f.row().status,'retry');
  forbidden(out);
 }finally{f.close();}
});
test('R18 Billing active entitlement and Task unexpectedly released are both rejected',async()=>{
 for(const [domain,field,val] of [['billing','active_entitlements',1],['task','task_released',1]]){
  const f=fixture();try{
   f.mutate(domain,field,val);
   const out=await f.saga().inspect(event,1700000060);
   assert.equal(out.status,'retry',domain);forbidden(out);
  }finally{f.close();}
 }
});
test('R18 policy revoked during local source readback remains fail closed after a local attempt',async()=>{
 const f=fixture();try{
  const orig=f.ports.reviewExistingR17;
  f.ports.reviewExistingR17=async(...args)=>{
   const out=await orig(...args);f.setApproved(false);return out;
  };
  const out=await f.saga().inspect(event,1700000060);
  assert.notEqual(out.status,'observed_local');forbidden(out);
  assert.equal(f.row().status,'retry');
 }finally{f.close();}
});
test('R18 Auth version drift after R17 local candidate denies observed success',async()=>{
 const f=fixture();try{
  const orig=f.ports.reviewExistingR17;
  f.ports.reviewExistingR17=async(...args)=>{
   const out=await orig(...args);
   f.changeWitness({auth_version:7});f.resign();
   return out;
  };
  const out=await f.saga().inspect(event,1700000060);
  assert.equal(out.status,'retry');forbidden(out);
 }finally{f.close();}
});
test('R18 PITR-like loss of a sink after observed result never re-authorizes replay',async()=>{
 const f=fixture();try{
  assert.equal((await f.saga().inspect(event,1700000060)).status,'observed_local');
  f.remove('battery');f.setNow(1700000061);
  const out=await f.saga().inspect(event,1700000061);
  assert.equal(out.status,'review_only');forbidden(out);
  assert.equal(f.row().status,'observed_local');
 }finally{f.close();}
});
test('R18 lease expiry during sink readback cannot finalize local attempt or ACK',async()=>{
 const f=fixture();try{
  const orig=f.ports.reviewExistingR17;
  f.ports.reviewExistingR17=async(...args)=>{
   f.setNow(1700000091);
   return orig(...args);
  };
  const out=await f.saga().inspect(event,1700000060);
  assert.equal(out.status,'retry');assert.equal(out.reason,'LEASE_EXPIRED_OR_CLOCK_REGRESSED');
  assert.equal(f.row().status,'leased');forbidden(out);
 }finally{f.close();}
});
test('R18 owner sink outage or forged local receipt never allows ACK',async()=>{
 const f=fixture();try{
  f.ports.readOwnerSink=async()=>{throw Error('D1 unavailable')};
  const out=await f.saga().inspect(event,1700000060);
  assert.equal(out.status,'retry');forbidden(out);
 }finally{f.close();}
 const g=fixture();try{
  g.mutate('billing','source_event_ref','wrong_event');
  const out=await g.saga().inspect(event,1700000060);
  assert.equal(out.status,'retry');forbidden(out);
 }finally{g.close();}
});
test('R18 old local journal cannot delete, reset attempts or change final result',async()=>{
 const f=fixture();try{
  assert.equal((await f.saga().inspect(event,1700000060)).status,'observed_local');
  assert.throws(()=>f.coordinator.exec('DELETE FROM ai4_r18_offline_saga'),/RETENTION_UNAPPROVED/);
  assert.throws(()=>f.coordinator.exec("UPDATE ai4_r18_offline_saga SET attempt_count=1,member_ref='other'"),/IMMUTABLE/);
 }finally{f.close();}
});
