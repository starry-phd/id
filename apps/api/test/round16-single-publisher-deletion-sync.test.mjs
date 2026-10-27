import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {URL,fileURLToPath} from 'node:url';
import {setImmediate} from 'node:timers';
import {createOfflineAuthDeletionEventSource} from '../../../modules/starry-id-v1/src/round15-deletion-source-contract.ts';
import {createOfflineAuthDeletionBatteryConsumer} from '../../../packages/rebuild-ai3/src/auth-deletion-battery-consumer.ts';
import {createOfflineSinglePublisherDeletionSync,DELIVERY_JOURNAL_DRAFT_SQL,
 LIVE_DELETION_DELIVERY_COORDINATOR,EXCLUSIVE_DELETION_PUBLISHER}
 from '../src/round16-single-publisher-deletion-sync.ts';
const ref='delete_'+ 'd'.repeat(32),member='m01',deletedAt=1700000040;
const load=(p)=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),'utf8');
function fixture(){
 const auth=new DatabaseSync(':memory:'),wallet=new DatabaseSync(':memory:'),
  coordinator=new DatabaseSync(':memory:');
 auth.exec('PRAGMA foreign_keys=ON');
 for(const p of [
  '../../../modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql',
  '../../../modules/starry-id-v1/schema/007_starry_age_deletion_admin.UP.DRAFT.sql',
  '../../../modules/starry-id-v1/schema/011_starry_one_use_deletion.UP.DRAFT.sql',
  '../../../modules/starry-id-v1/schema/013_starry_deletion_source_immutability.UP.DRAFT.sql'
 ])auth.exec(load(p));
 auth.prepare('INSERT INTO starry_members (s_user_id,status,auth_version,profile_revision,created_at,updated_at) VALUES (?,?,?,?,?,?)')
 .run(member,'active',1,1,1700000000,1700000000);
 auth.prepare('INSERT INTO starry_sessions (session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES (?,?,?,?,?,?,?)')
 .run('sess01',member,'starry-id','staging',1,'hash01',1700000200);
 auth.prepare('INSERT INTO starry_deletion_challenges (challenge_ref,s_user_id,session_id,auth_version,event_id,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
 .run('a'.repeat(64),member,'sess01',1,ref,1700000000,1700000120);
 wallet.exec(load('../../../packages/rebuild-ai3/schema/0005_free_battery_DRAFT.sql'));
 wallet.exec(load('../../../packages/rebuild-ai3/schema/0010_auth_delete_battery_inbox_DRAFT.sql'));
 wallet.prepare('INSERT INTO ai3_battery_wallet (brand_id,member_ref,balance,version) VALUES (?,?,?,?)')
 .run('starry',member,0,0);
 wallet.prepare('INSERT INTO ai3_battery_hold VALUES (?,?,?,?,?,?,?,?,?,?,?)')
 .run('starry',member,'task_01','app01','generate',1,1,1,1700000000000,1700000180000,'held');
 coordinator.exec(DELIVERY_JOURNAL_DRAFT_SQL.create);
 let legal=true,consumerCalls=0,receiptReads=0;
 const authDb={prepare:sql=>({bind:(...args)=>({
  first:async()=>auth.prepare(sql).get(...args)??null
 })})};
 const source=createOfflineAuthDeletionEventSource({
  enabled:true,scope:{brand_id:'starry',environment:'staging'},db:authDb,
  legalDeletionProcessingApprovedNow:async()=>legal,readServerNow:()=>deletedAt+90
 });
 const batteryDb={prepare:sql=>({bind:(...args)=>({
  run:async()=>{try{const x=wallet.prepare(sql).run(...args);
   return {success:true,meta:{changes:Number(x.changes)}};}
   catch{return {success:false,meta:{changes:0}}}},
  first:async()=>wallet.prepare(sql).get(...args)??null
 })})};
 const consumer=createOfflineAuthDeletionBatteryConsumer({
  enabled:true,scope:{brand_id:'starry',environment:'staging'},db:batteryDb,
  authority:{
   verifyCommittedDeletion:source.verifyCommittedDeletion,
   readApprovedBatteryPolicyVersion:async()=>2
  }
 });
 const relayDb={prepare:sql=>({bind:(...args)=>({
  first:async()=>coordinator.prepare(sql).get(...args)??null
 })})};
 const ports={
  auth:source,db:relayDb,
  consumeBattery:async(e,now)=>{consumerCalls++;return consumer.consume(e,now);},
  readBatteryReceipt:async(eventId,memberId)=>{
   receiptReads++;
   const a=wallet.prepare(`SELECT i.applied AS inbox_applied,w.revoked AS wallet_revoked,
   (SELECT COUNT(*) FROM ai3_battery_hold h WHERE h.member_ref=i.member_ref AND h.status='held') AS pending_holds,
   j.kind AS journal_kind,j.event_ref AS journal_event_ref
   FROM ai3_r14_deletion_inbox i JOIN ai3_battery_wallet w
   ON w.member_ref=i.member_ref JOIN ai3_battery_journal j
   ON j.member_ref=i.member_ref AND j.event_ref=i.event_id
   WHERE i.event_id=? AND i.member_ref=?`).get(eventId,memberId);
   return a?{event_id:eventId,member_ref:memberId,...a}:null;
  }
 };
 const gate=()=>createOfflineSinglePublisherDeletionSync({
  brand_id:'starry',environment:'staging'},ports);
 const deleted=()=>auth.prepare('UPDATE starry_deletion_challenges SET consumed_at=? WHERE challenge_ref=?')
  .run(deletedAt,'a'.repeat(64));
 return {auth,wallet,coordinator,ports,gate,deleted,
  legal:x=>{legal=x},get consumerCalls(){return consumerCalls},
  get receiptReads(){return receiptReads},
  close:()=>{auth.close();wallet.close();coordinator.close()}};
}
test('R16 sole publisher is AI-1 Auth source; real three SQLite DBs only record local sink proof',async()=>{
 const f=fixture();try{
  f.deleted();
  const x=await f.gate().deliver(ref,deletedAt+1);
  assert.equal(EXCLUSIVE_DELETION_PUBLISHER,'AI-1_AUTH_COMMITTED_OUTBOX');
  assert.equal(LIVE_DELETION_DELIVERY_COORDINATOR,false);
  assert.equal(x.status,'local_recorded');
  assert.equal(x.sole_publisher,EXCLUSIVE_DELETION_PUBLISHER);
  assert.equal(x.may_ack_queue,false);
  assert.equal(x.may_regrant,false);
  assert.equal(f.coordinator.prepare('SELECT status FROM ai4_r16_delivery_journal').get().status,'applied');
  assert.equal(f.wallet.prepare('SELECT revoked FROM ai3_battery_wallet').get().revoked,1);
  assert.equal(f.wallet.prepare('SELECT status FROM ai3_battery_hold').get().status,'revoked');
  assert.equal(f.wallet.prepare("SELECT kind FROM ai3_battery_journal").get().kind,'revoke');
  assert.equal(f.consumerCalls,1);
 }finally{f.close()}
});
test('R16 identical delivery replay is verified duplicate without second Battery mutation or ACK',async()=>{
 const f=fixture();try{
  f.deleted();
  assert.equal((await f.gate().deliver(ref,deletedAt+1)).status,'local_recorded');
  assert.equal((await f.gate().deliver(ref,deletedAt+2)).status,'duplicate_local');
  assert.equal(f.consumerCalls,1);
  assert.equal(f.wallet.prepare('SELECT count(*) AS n FROM ai3_battery_journal').get().n,1);
 }finally{f.close()}
});
test('R16 no Auth commit means no fake publisher and no delivery lease',async()=>{
 const f=fixture();try{
  assert.equal((await f.gate().deliver(ref,deletedAt+1)).status,'blocked');
  assert.equal(f.coordinator.prepare('SELECT count(*) AS n FROM ai4_r16_delivery_journal').get().n,0);
  assert.equal(f.wallet.prepare('SELECT revoked FROM ai3_battery_wallet').get().revoked,0);
 }finally{f.close()}
});
test('R16 law denied by native AI-1 authority => no local DB or Battery writes',async()=>{
 const f=fixture();try{
  f.deleted();f.legal(false);
  assert.equal((await f.gate().deliver(ref,deletedAt+1)).status,'blocked');
  assert.equal(f.coordinator.prepare('SELECT count(*) AS n FROM ai4_r16_delivery_journal').get().n,0);
  assert.equal(f.consumerCalls,0);
 }finally{f.close()}
});
test('R16 forged client JSON cannot masquerade as sealed AI-1 source capability',async()=>{
 const f=fixture();try{
  f.deleted();
  f.ports.auth={...f.ports.auth,
   readCommitted:async()=>({event_id:ref,s_user_id:member,
    occurred_at:deletedAt,event_type:'account_deleted',auth_version:2})};
  assert.equal((await f.gate().deliver(ref,deletedAt+1)).status,'blocked');
  assert.equal(f.consumerCalls,0);
 }finally{f.close()}
});
test('R16 changed Battery DTO and cross-scope misuse are rejected before any lease',async()=>{
 const f=fixture();try{
  f.deleted();
  f.ports.auth={...f.ports.auth,
   readBatteryEvent:async()=>({event_id:ref,member_ref:'other',
    occurred_at_sec:deletedAt,event_type:'account_deleted'})};
  assert.equal((await f.gate().deliver(ref,deletedAt+1)).status,'blocked');
  assert.throws(()=>createOfflineSinglePublisherDeletionSync({
   brand_id:'hglobal',environment:'staging'},f.ports),/SCOPE_DENIED/);
  assert.throws(()=>createOfflineSinglePublisherDeletionSync({
   brand_id:'starry',environment:'production'},f.ports),/SCOPE_DENIED/);
 }finally{f.close()}
});
test('R16 competing deliveries for one event cannot each acquire an active lease',async()=>{
 const f=fixture();try{
  f.deleted();let resolve;
  const orig=f.ports.consumeBattery;
  f.ports.consumeBattery=async(e,now)=>{await new Promise(r=>{resolve=r;});return orig(e,now);};
  const first=f.gate().deliver(ref,deletedAt+1);
  for(let i=0;i<20&&!resolve;i++)await new Promise(r=>setImmediate(r));
  assert.equal(typeof resolve,'function');
  const second=await f.gate().deliver(ref,deletedAt+1);
  assert.equal(second.status,'retry');
  resolve();
  assert.equal((await first).status,'local_recorded');
  assert.equal(f.consumerCalls,1);
 }finally{f.close()}
});
test('R16 crash after Battery write but before local ledger completion repairs only local receipt',async()=>{
 const f=fixture();try{
  f.deleted();
  let crashed=false;
  const original=f.ports.readBatteryReceipt;
  f.ports.readBatteryReceipt=async(...args)=>{
   const out=await original(...args);
   if(out&&!crashed){crashed=true;throw Error('AFTER_BATTERY_COMMIT');}
   return out;
  };
  assert.equal((await f.gate().deliver(ref,deletedAt+1)).status,'retry');
  assert.equal(f.wallet.prepare('SELECT revoked FROM ai3_battery_wallet').get().revoked,1);
  assert.equal((await f.gate().deliver(ref,deletedAt+2)).status,'retry');
  assert.equal((await f.gate().deliver(ref,deletedAt+32)).status,'local_recorded');
  assert.equal(f.consumerCalls,1);
 }finally{f.close()}
});
test('R16 missing durable sink proof prevents journal completion even if consumer reports receipt',async()=>{
 const f=fixture();try{
  f.deleted();
  f.ports.readBatteryReceipt=async()=>null;
  assert.equal((await f.gate().deliver(ref,deletedAt+1)).status,'retry');
  assert.equal(f.coordinator.prepare('SELECT status FROM ai4_r16_delivery_journal').get().status,'leased');
 }finally{f.close()}
});
test('R16 event/member uniqueness forbids competing publisher for same deleted identity',async()=>{
 const f=fixture();try{
  f.deleted();
  assert.equal((await f.gate().deliver(ref,deletedAt+1)).status,'local_recorded');
  assert.throws(()=>f.coordinator.prepare(`INSERT INTO ai4_r16_delivery_journal
    VALUES ('staging','delete_other_00000000000000000','m01',1700000040,2,'leased','abcdef',1700000060)`).run(),/UNIQUE/);
  assert.throws(()=>f.coordinator.exec('DELETE FROM ai4_r16_delivery_journal'),/RETENTION_GATE/);
  assert.throws(()=>f.coordinator.exec("UPDATE ai4_r16_delivery_journal SET status='leased'"),/IMMUTABLE/);
 }finally{f.close()}
});
test('R16 Auth source changes between sink and post-commit check: no local completion or ACK',async()=>{
 const f=fixture();try{
  f.deleted();const original=f.ports.auth;let calls=0;
  f.ports.auth={...original,readCommitted:async id=>{
   calls++;return calls===1?original.readCommitted(id):null;
  }};
  assert.equal((await f.gate().deliver(ref,deletedAt+1)).status,'retry');
  assert.equal(f.coordinator.prepare('SELECT status FROM ai4_r16_delivery_journal').get().status,'leased');
 }finally{f.close()}
});
test('R16 invalid event/clock and unavailable source remain blocked/retry without remote ACK',async()=>{
 const f=fixture();try{
  f.deleted();
  for(const v of [null,{},'abc',{event_id:ref}])
   assert.equal((await f.gate().deliver(v,deletedAt+1)).status,'blocked');
  assert.equal((await f.gate().deliver(ref,Number.MAX_SAFE_INTEGER)).status,'blocked');
  f.ports.auth={...f.ports.auth,readCommitted:async()=>{throw Error('D1 outage')}};
  const x=await f.gate().deliver(ref,deletedAt+1);
  assert.equal(x.status,'retry');
  assert.equal(x.may_ack_queue,false);
 }finally{f.close()}
});
