import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Buffer} from 'node:buffer';
import {sign,verify,generateKeyPairSync} from 'node:crypto';
import {createR19OfflineFourDomainWire,LIVE_R19_FOUR_DOMAIN_TRANSPORT,
 R19_CONTRACT} from '../src/round19-offline-four-domain-wiring.ts';
import {createR18OfflineSagaTransport,R18_DISPOSABLE_TRANSPORT_SQL}
 from '../src/round18-offline-outbox-saga-transport.ts';
import {BILLING_R18_REFUND_READ_SQL,BILLING_R18_ACK_ALLOWED}
 from '../../../packages/rebuild-billing/src/r18-refund-inbox.ts';
import {LIVE_AUTH_R18_SAGA_PREFLIGHT_ENABLED}
 from '../../../modules/starry-id-v1/src/round18-auth-committed-saga-preflight.ts';
import {LIVE_R18_BATTERY_RECOVERY_ENABLED}
 from '../../../packages/rebuild-ai3/src/r18-cross-d1-recovery-review.ts';

const scope={brand_id:'starry',environment:'staging'};
const event='starry-delete-'+'d'.repeat(64), member='member_01',now=1793000001;
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const canonical=w=>[w.brand_id,w.environment,w.event_id,w.member_ref,
 w.auth_version,w.policy_revision].join('|');
const signWitness=()=>{const w={brand_id:'starry',environment:'staging',
 event_id:event,member_ref:member,auth_version:4,policy_revision:'law-v1'};
 return {...w,signature:sign('sha256',Buffer.from(canonical(w)),privateKey).toString('base64url')};
};
const schema="CREATE TABLE owner_receipt (event_id TEXT,member_ref TEXT,environment TEXT,auth_version INTEGER,policy_revision TEXT,committed INTEGER,inbox_applied INTEGER,pending_holds INTEGER,active_entitlements INTEGER,task_released INTEGER)";
const authReview=()=>({disposition:'offline_auth_source_review_only',event_id:event,
 attempt_no:1,auth_version:4,may_ack_queue:false,may_mark_delivered:false,
 may_regrant:false,may_restore:false,may_publish:false,live:false});
const batteryReview=()=>({status:'review_only',
 reason:'OFFLINE_CONSISTENT_NOT_AUTHORIZED_FOR_RECOVERY',may_ack_queue:false,
 may_restore:false,may_regrant:false,may_settle_task:false,
 may_release_task:false,live:false});
const sagaReview=()=>({status:'candidate_consistent',reason:'ONLY_LOCAL_CANDIDATE_NOT_AN_ACK',
 may_ack_queue:false,may_dlq:false,may_regrant:false,may_release_task:false,
 publishable:false,live:false});
function fixture(){
 // Five INDEPENDENT physical SQLite memory connections (not an all-in-one).
 const auth=new DatabaseSync(':memory:'),billing=new DatabaseSync(':memory:'),
  battery=new DatabaseSync(':memory:'),task=new DatabaseSync(':memory:'),
  coordinator=new DatabaseSync(':memory:');
 for(const db of [auth,billing,battery,task])db.exec(schema);
 for(const [db,sink] of [[auth,'auth'],[billing,'billing'],[battery,'battery'],[task,'task']]){
  db.prepare('INSERT INTO owner_receipt VALUES (?,?,?,?,?,?,?,?,?,?)')
   .run(event,member,'staging',4,'law-v1',1,1,0,0,0);
 }
 task.exec("CREATE TABLE local_task(task_ref TEXT,member_ref TEXT,environment TEXT,status TEXT,wallet_hold_status TEXT)");
 task.prepare("INSERT INTO local_task VALUES(?,?,?,?,?)")
  .run('task_01',member,'staging','cancelled','revoked');
 billing.exec('CREATE TABLE billing_local_deletion(event_id TEXT PRIMARY KEY,member_ref TEXT,environment TEXT,auth_version INTEGER,deleted INTEGER,tombstone_revoked INTEGER,active_entitlements INTEGER,refund_floor_current INTEGER)');
 billing.prepare('INSERT INTO billing_local_deletion VALUES(?,?,?,?,?,?,?,?)')
  .run(event,member,'staging',4,1,1,0,1);
 coordinator.exec(R18_DISPOSABLE_TRANSPORT_SQL.create);
 let policy=true,retention=true,revision='law-v1',clock=now;
 let witness=signWitness(),authOverride=null,batteryOverride=null;
 let ownerReads=0,authReads=0,sagaCalls=0;
 const readOwnerSink=async domain=>{
  ownerReads++;
  const db={battery,billing,task}[domain];
  const row=db?.prepare('SELECT * FROM owner_receipt WHERE event_id=?').get(event);
  if(!row)return null;
  return {sink:domain,brand_id:'starry',environment:row.environment,
   event_id:row.event_id,member_ref:row.member_ref,
   auth_version:row.auth_version,policy_revision:row.policy_revision,
   source_event_ref:row.event_id,committed:row.committed===1,
   inbox_applied:row.inbox_applied===1,pending_holds:row.pending_holds,
   active_entitlements:row.active_entitlements,task_released:row.task_released===1};
 };
 const policyPort=async()=>({revision,processing_approved:policy,
  retention_approved:retention});
 const db={prepare:sql=>({bind:(...values)=>({first:async()=>
  coordinator.prepare(sql).get(...values)??null})})};
 const saga=createR18OfflineSagaTransport(scope,'law-v1',{
  db,readWitness:async()=>witness,readPolicy:async()=>({
   revision,processing_approved:policy&&retention
  }),verifyOfflineSignature:async w=>verify('sha256',Buffer.from(canonical(w)),
   publicKey,Buffer.from(w.signature,'base64url')),
  nowSec:()=>clock,reviewExistingR17:async()=>sagaReview(),readOwnerSink
 });
 const ports={
  readPolicy:policyPort,
  inspectAuth:async()=>{authReads++;const row=auth.prepare(
   'SELECT * FROM owner_receipt WHERE event_id=?').get(event);
   if(!row||row.committed!==1)return null;
   return typeof authOverride==='function'?authOverride():authOverride??authReview();
  },
  readBilling:async()=>{
   const r=billing.prepare('SELECT * FROM billing_local_deletion WHERE event_id=?').get(event);
   if(!r)return null;
   return {event_id:r.event_id,member_ref:r.member_ref,environment:r.environment,
    auth_version:r.auth_version,deletion_inbox_committed:r.deleted===1,
    tombstone_revoked:r.tombstone_revoked===1,
    active_entitlements:r.active_entitlements,refund_floor_current:r.refund_floor_current===1};
  },
  inspectBattery:async()=>{
   const r=battery.prepare('SELECT * FROM owner_receipt WHERE event_id=?').get(event);
   if(!r||r.inbox_applied!==1||r.pending_holds!==0)return {
    ...batteryReview(),status:'blocked',reason:'WALLET_HOLD_STILL_PENDING'
   };
   return typeof batteryOverride==='function'?batteryOverride():
    batteryOverride??batteryReview();
  },
  readTask:async()=>{
   const r=task.prepare('SELECT * FROM local_task').get();
   return r??null;
  },
  inspectExistingSaga:async(...args)=>{sagaCalls++;return saga.inspect(...args)}
 };
 const gate=()=>createR19OfflineFourDomainWire(scope,'law-v1',ports);
 return {auth,billing,battery,task,coordinator,ports,gate,
  setPolicy:x=>{policy=x},setRetention:x=>{retention=x},
  setRevision:x=>{revision=x},setClock:x=>{clock=x},
  setWitness:x=>{witness=x},setAuthOverride:x=>{authOverride=x},
  setBatteryOverride:x=>{batteryOverride=x},
  change:(domain,col,value)=>{
   const db={auth,billing,battery,task}[domain];
   db.prepare('UPDATE owner_receipt SET '+col+'=?').run(value);
  },
  taskChange:(col,value)=>task.prepare('UPDATE local_task SET '+col+'=?').run(value),
  billChange:(col,value)=>billing.prepare('UPDATE billing_local_deletion SET '+col+'=?').run(value),
  remove:domain=>({auth,billing,battery,task}[domain].exec('DELETE FROM owner_receipt'),
  sagaRow:()=>coordinator.prepare('SELECT * FROM ai4_r18_offline_saga').get(),
  get ownerReads(){return ownerReads},get authReads(){return authReads},
  get sagaCalls(){return sagaCalls},
  close:()=>{for(const db of [auth,billing,battery,task,coordinator])db.close()}
 };
}
const flags=r=>{
 for(const k of ['may_ack_queue','may_dlq','may_release_task','may_settle_task',
  'may_regrant','may_restore','may_publish','publishable','live'])
  assert.equal(r[k],false,k);
 assert.equal(Object.isFrozen(r),true);
};
test('R19 invokes actual AI-4 R18 Saga SQLite CAS and four DISTINCT disposable owner DBs',async()=>{
 const f=fixture();try{
  const r=await f.gate().inspect(event,now);
  assert.equal(r.status,'local_consistent_review_only');
  assert.equal(r.reason,'OFFLINE_FOUR_DOMAIN_CONSISTENCY_NOT_AUTHORITY');
  assert.equal(f.sagaRow().status,'observed_local');assert.equal(f.sagaCalls,1);
  assert.ok(f.ownerReads>=6);assert.ok(f.authReads>=2);
  assert.equal(LIVE_R19_FOUR_DOMAIN_TRANSPORT,false);
  assert.equal(R19_CONTRACT,'starry.private-four-domain-wire.v0-draft');
  assert.equal(LIVE_AUTH_R18_SAGA_PREFLIGHT_ENABLED,false);
  assert.equal(LIVE_R18_BATTERY_RECOVERY_ENABLED,false);
  assert.equal(BILLING_R18_ACK_ALLOWED,false);
  flags(r);
 }finally{f.close()}
});
test('R19 Queue ACK lost replay still uses existing Saga local duplicate, never ACK',async()=>{
 const f=fixture();try{
  assert.equal((await f.gate().inspect(event,now)).status,'local_consistent_review_only');
  f.setClock(now+1);
  const again=await f.gate().inspect(event,now+1);
  assert.equal(again.status,'local_consistent_review_only');
  assert.equal(f.sagaRow().attempt_count,1);flags(again);
 }finally{f.close()}
});
test('R19 rejects missing legal purpose/retention before ANY protected reads',async()=>{
 for(const kind of ['policy','retention']){
  const f=fixture();try{
   if(kind==='policy')f.setPolicy(false);else f.setRetention(false);
   const r=await f.gate().inspect(event,now);
   assert.equal(r.status,'blocked');assert.equal(f.authReads,0);
   assert.equal(f.sagaCalls,0);assert.equal(f.sagaRow(),undefined);flags(r);
  }finally{f.close()}
 }
});
test('R19 independently missing Auth, Billing, Battery or Task record never invokes Saga',async()=>{
 for(const domain of ['auth','billing','battery','task']){
  const f=fixture();try{
   if(domain==='billing')f.billing.exec('DELETE FROM billing_local_deletion');
   else if(domain==='task')f.task.exec('DELETE FROM local_task');
   else f.remove(domain);
   const r=await f.gate().inspect(event,now);
   assert.equal(r.status,'blocked',domain);assert.equal(f.sagaCalls,0);flags(r);
  }finally{f.close()}
 }
});
test('R19 refuses premature Task release, settlement mismatches and held Battery',async()=>{
 for(const [domain,column,value] of [
  ['task','status','committed'],['task','wallet_hold_status','held'],
  ['task','wallet_hold_status','committed']
 ]){
  const f=fixture();try{
   f.taskChange(column,value);
   const r=await f.gate().inspect(event,now);
   assert.equal(r.status,'blocked',JSON.stringify([domain,column,value]));flags(r);
  }finally{f.close()}
 }
 const f=fixture();try{
  f.change('battery','pending_holds',1);
  const r=await f.gate().inspect(event,now);assert.equal(r.status,'blocked');flags(r);
 }finally{f.close()}
});
test('R19 Billing rollback, resurrected paid entitlement, missing local floor deny before Saga',async()=>{
 for(const [col,val] of [['deleted',0],['tombstone_revoked',0],
  ['active_entitlements',1],['refund_floor_current',0]]){
  const f=fixture();try{
   f.billChange(col,val);
   const out=await f.gate().inspect(event,now);
   assert.equal(out.status,'blocked',col);assert.equal(f.sagaCalls,0);flags(out);
  }finally{f.close()}
 }
});
test('R19 forged owner result/ACK bits cannot cross real Saga authority boundary',async()=>{
 for(const corrupt of [{may_ack_queue:true},{may_publish:true},
  {disposition:'event_published'},{auth_version:5}]){
  const f=fixture();try{
   f.setAuthOverride(()=>({...authReview(),...corrupt}));
   const r=await f.gate().inspect(event,now);
   assert.equal(r.status,'blocked');assert.equal(f.sagaCalls,0);flags(r);
  }finally{f.close()}
 }
});
test('R19 rejects forged Battery authorized result instead of approving recovery',async()=>{
 const f=fixture();try{
  f.setBatteryOverride(()=>({...batteryReview(),may_restore:true}));
  const r=await f.gate().inspect(event,now);
  assert.equal(r.status,'blocked');assert.equal(f.sagaCalls,0);flags(r);
 }finally{f.close()}
});
test('R19 detected policy revision drift after owner observation denies before Saga',async()=>{
 const f=fixture();try{
  const original=f.ports.readBilling;
  f.ports.readBilling=async(...args)=>{
   const r=await original(...args);f.setRevision('law-v2');return r;
  };
  const r=await f.gate().inspect(event,now);
  assert.equal(r.status,'blocked');assert.equal(f.sagaCalls,0);flags(r);
 }finally{f.close()}
});
test('R19 PITR stale Billing after Saga local commit forces review/blocked, no ACK',async()=>{
 const f=fixture();try{
  const original=f.ports.inspectExistingSaga;
  f.ports.inspectExistingSaga=async(...args)=>{
   const r=await original(...args);
   f.billChange('active_entitlements',1);
   return r;
  };
  const r=await f.gate().inspect(event,now);
  assert.equal(r.status,'blocked');assert.equal(f.sagaRow().status,'observed_local');
  flags(r);
 }finally{f.close()}
});
test('R19 source and Task drift between before/after reads cannot pass',async()=>{
 for(const target of ['auth','task']){
  const f=fixture();try{
   const orig=f.ports.inspectExistingSaga;
   f.ports.inspectExistingSaga=async(...args)=>{
    const v=await orig(...args);
    if(target==='task')f.taskChange('status','pending');
    else f.setAuthOverride(()=>({...authReview(),attempt_no:2}));
    return v;
   };
   const r=await f.gate().inspect(event,now);
   assert.equal(r.status,'blocked');flags(r);
  }finally{f.close()}
 }
});
test('R19 local Saga partial commit/retry and DLQ remain review-only; no real transport',async()=>{
 const f=fixture();try{
  f.change('billing','committed',0);
  const r=await f.gate().inspect(event,now);
  assert.equal(r.status,'retry');flags(r);
  assert.equal(f.sagaRow().status,'retry');
  f.setClock(now+2);f.change('billing','committed',1);
  const recovered=await f.gate().inspect(event,now+2);
  assert.equal(recovered.status,'local_consistent_review_only');flags(recovered);
 }finally{f.close()}
});
test('R19 cross-brand, production and unapproved physical paths denied at construction',async()=>{
 const f=fixture();try{
  assert.throws(()=>createR19OfflineFourDomainWire({...scope,brand_id:'hglobal'},'law-v1',f.ports),/SCOPE_DENIED/);
  assert.throws(()=>createR19OfflineFourDomainWire({...scope,environment:'production'},'law-v1',f.ports),/SCOPE_DENIED/);
  assert.throws(()=>createR19OfflineFourDomainWire(scope,'?',f.ports),/POLICY_REQUIRED/);
  assert.throws(()=>createR19OfflineFourDomainWire(scope,'law-v1',{}),/PORTS_REQUIRED/);
  for(const bad of [null,{},'x',{event_id:event}]){
   const r=await f.gate().inspect(bad,now);
   assert.equal(r.status,'blocked');flags(r);
  }
  assert.equal(f.sagaCalls,0);
 }finally{f.close()}
});
test('R19 actual R18 Billing refund SQL is a different Store event and cannot be faked into deletion DTO',()=>{
 const f=fixture();try{
  // The R18 Billing source is a scoped Store refund, NOT an approved canonical
  // deletion receipt. Never turn a missing Store record into a true proof.
  assert.match(BILLING_R18_REFUND_READ_SQL,/billing_r18_refund_inbox_DRAFT/);
  assert.match(BILLING_R18_REFUND_READ_SQL,/floor_source_version/);
  assert.equal('billing_r18_refund_inbox_DRAFT' in f.billing,false);
  assert.equal(f.billing.prepare('SELECT COUNT(*) AS n FROM billing_local_deletion').get().n,1);
  assert.equal('publish' in f.gate(),false);
  assert.equal('ack' in f.gate(),false);
 }finally{f.close()}
});
