import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath,URL} from 'node:url';
import {createOfflineDeletionEventRelay,LIVE_AUTH_DELETION_RELAY,
 DELETION_RELAY_VERSION} from '../src/round15-deletion-event-relay.ts';
import {createOfflineAuthDeletionBatteryConsumer} from '../../../packages/rebuild-ai3/src/auth-deletion-battery-consumer.ts';
const root=(relative)=>readFileSync(fileURLToPath(new URL(relative,import.meta.url)),'utf8');
const ref='deletion_'+ 'd'.repeat(32),uid='m01',time=1700000040;
function fixture(){
 const auth=new DatabaseSync(':memory:'),battery=new DatabaseSync(':memory:');
 auth.exec('PRAGMA foreign_keys=ON');
 for(const f of ['../../../modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql',
  '../../../modules/starry-id-v1/schema/007_starry_age_deletion_admin.UP.DRAFT.sql',
  '../../../modules/starry-id-v1/schema/011_starry_one_use_deletion.UP.DRAFT.sql'])
  auth.exec(root(f));
 auth.prepare('INSERT INTO starry_members (s_user_id,status,auth_version,profile_revision,created_at,updated_at) VALUES (?,?,?,?,?,?)')
  .run(uid,'active',1,1,1700000000,1700000000);
 auth.prepare('INSERT INTO starry_sessions (session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES (?,?,?,?,?,?,?)')
  .run('sess01',uid,'starry-id','staging',1,'hash01',1700002000);
 auth.prepare('INSERT INTO starry_deletion_challenges (challenge_ref,s_user_id,session_id,auth_version,event_id,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
  .run('a'.repeat(64),uid,'sess01',1,ref,1700000000,1700000120);
 battery.exec(root('../../../packages/rebuild-ai3/schema/0005_free_battery_DRAFT.sql'));
 battery.exec(root('../../../packages/rebuild-ai3/schema/0010_auth_delete_battery_inbox_DRAFT.sql'));
 battery.prepare('INSERT INTO ai3_battery_wallet (brand_id,member_ref,balance,version) VALUES (?,?,?,?)')
  .run('starry',uid,0,0);
 battery.prepare('INSERT INTO ai3_battery_hold VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run('starry',uid,'task_01','app01','generate',1,1,1,1700000000000,1700000180000,'held');
 const deleteAccount=()=>{
  auth.prepare('UPDATE starry_deletion_challenges SET consumed_at=? WHERE challenge_ref=?')
   .run(time,'a'.repeat(64));
 };
 const log=[];
 const port={
  lawfulRelayApproved:async()=>{log.push('legal');return true;},
  readCommittedOutbox:async(eventId)=>{
   log.push('outbox');return auth.prepare('SELECT event_id,s_user_id,occurred_at,event_type FROM starry_deletion_outbox WHERE event_id=?').get(eventId)??null;
  },
  readDeletionContext:async(eventId)=>{
   log.push('context');return auth.prepare(
    'SELECT c.event_id,c.s_user_id,s.environment,c.consumed_at FROM starry_deletion_challenges c JOIN starry_sessions s ON s.session_id=c.session_id AND s.s_user_id=c.s_user_id WHERE c.event_id=?'
   ).get(eventId)??null;
  },
  readCurrentDeletedMember:async(memberId)=>{
   log.push('member');return auth.prepare('SELECT s_user_id,status,auth_version,updated_at FROM starry_members WHERE s_user_id=?').get(memberId)??null;
  },
  readUnrevokedSessions:async(memberId)=>{
   log.push('sessions');return auth.prepare(
    'SELECT count(*) as total FROM starry_sessions WHERE s_user_id=? AND revoked_at IS NULL'
   ).get(memberId)?.total;
  }
 };
 const bridge=createOfflineDeletionEventRelay({brand_id:'starry',environment:'staging'},port);
 const ai3db={
  prepare(sql){return {bind(...args){return {
   async run(){try{
    const row=battery.prepare(sql).run(...args);
    return {success:true,meta:{changes:Number(row.changes)}};
   }catch{return {success:false,meta:{changes:0}}}},
   async first(){return battery.prepare(sql).get(...args)??null}
  }}}}
 };
 const consumer=createOfflineAuthDeletionBatteryConsumer({
  enabled:true,scope:{brand_id:'starry',environment:'staging'},db:ai3db,
  authority:{
   verifyCommittedDeletion:async(_scope,event)=>{
    const p=await bridge.inspect(event.event_id,time+10);
    return p.status==='verified_offline_candidate'&&
      JSON.stringify(p.battery_event)===JSON.stringify(event);
   },
   readApprovedBatteryPolicyVersion:async()=>2
  }
 });
 return {auth,battery,port,bridge,consumer,deleteAccount,log,
  close:()=>{auth.close();battery.close()}};
}
test('R15 real AI-1 R13 SQLite one-use deletion maps EXACT raw outbox to Battery format',async()=>{
 const f=fixture();try{
  assert.equal(LIVE_AUTH_DELETION_RELAY,false);
  assert.equal(DELETION_RELAY_VERSION,'starry.account-deleted-relay.v0-draft');
  f.deleteAccount();
  const o=await f.bridge.inspect(ref,time+10);
  assert.equal(o.status,'verified_offline_candidate');
  assert.deepEqual(o.battery_event,{
   event_id:ref,member_ref:uid,occurred_at_sec:time,event_type:'account_deleted'
  });
  assert.equal(o.billing_status,'blocked_missing_authoritative_hmac_digest_version');
  assert.equal(o.may_ack_queue,false);
  assert.equal(f.auth.prepare('SELECT status FROM starry_members').get().status,'deleted');
  assert.equal(f.auth.prepare('SELECT count(*) as n FROM starry_sessions WHERE revoked_at IS NULL').get().n,0);
 }finally{f.close()}
});
test('R15 two real independent SQLite DBs: Auth deletion then AI-3 Battery local revoke',async()=>{
 const f=fixture();try{
  f.deleteAccount();
  const event=(await f.bridge.inspect(ref,time+10)).battery_event;
  const delivered=await f.consumer.consume(event,(time+10)*1000);
  assert.equal(delivered.disposition,'receipt_only');
  assert.equal(delivered.may_ack_queue,false);
  assert.equal(f.battery.prepare('SELECT revoked FROM ai3_battery_wallet').get().revoked,1);
  assert.equal(f.battery.prepare('SELECT status FROM ai3_battery_hold').get().status,'revoked');
  assert.equal(f.battery.prepare('SELECT count(*) as n FROM ai3_r14_deletion_inbox').get().n,1);
  assert.equal(f.battery.prepare("SELECT kind FROM ai3_battery_journal").get().kind,'revoke');
 }finally{f.close()}
});
test('R15 before actual Auth commit, client event id cannot cause Battery revocation',async()=>{
 const f=fixture();try{
  const o=await f.bridge.inspect(ref,time+10);
  assert.equal(o.status,'blocked');
  assert.equal(f.log.includes('outbox'),true);
  assert.equal(f.battery.prepare('SELECT revoked FROM ai3_battery_wallet').get().revoked,0);
 }finally{f.close()}
});
test('R15 lawful purpose is checked BEFORE touching any Auth PII/committed source',async()=>{
 const f=fixture();try{
  f.deleteAccount();
  f.port.lawfulRelayApproved=async()=>false;
  assert.equal((await f.bridge.inspect(ref,time+10)).status,'blocked');
  assert.deepEqual(f.log,[]);
 }finally{f.close()}
});
test('R15 strict Auth context blocks environment/s_user_id spoof and missing challenge',async()=>{
 for(const change of [
  {environment:'development'},
  {s_user_id:'wrong'},
  {consumed_at:time+1}
 ]){
  const f=fixture();try{
   f.deleteAccount();const original=f.port.readDeletionContext;
   f.port.readDeletionContext=async e=>({...await original(e),...change});
   assert.equal((await f.bridge.inspect(ref,time+10)).status,'blocked');
  }finally{f.close()}
 }
});
test('R15 deleted Member current AuthVersion, sessions, time all must match',async()=>{
 for(const change of [
  {status:'active'},{auth_version:1},{updated_at:time+10}
 ]){
  const f=fixture();try{
   f.deleteAccount();const original=f.port.readCurrentDeletedMember;
   f.port.readCurrentDeletedMember=async e=>({...await original(e),...change});
   assert.equal((await f.bridge.inspect(ref,time+10)).status,'blocked');
  }finally{f.close()}
 }
 const f=fixture();try{
  f.deleteAccount();f.port.readUnrevokedSessions=async()=>1;
  assert.equal((await f.bridge.inspect(ref,time+10)).status,'blocked');
 }finally{f.close()}
});
test('R15 server event seconds cannot be silently converted from milliseconds',async()=>{
 const f=fixture();try{
  f.deleteAccount();const original=f.port.readCommittedOutbox;
  f.port.readCommittedOutbox=async e=>({...await original(e),occurred_at:time*1000});
  assert.equal((await f.bridge.inspect(ref,time+10)).status,'blocked');
 }finally{f.close()}
});
test('R15 outbox differs between two trusted reads -> source race blocked',async()=>{
 const f=fixture();try{
  f.deleteAccount();const original=f.port.readCommittedOutbox;let n=0;
  f.port.readCommittedOutbox=async e=>{
   const row=await original(e);n++;return n===1?row:{...row,event_type:'other'};
  };
  assert.equal((await f.bridge.inspect(ref,time+10)).status,'blocked');
 }finally{f.close()}
});
test('R15 extra hidden properties/accessor/revoked Proxy are not an Auth event authority',async()=>{
 for(const kind of ['extra','accessor','proxy']){
  const f=fixture();try{
   f.deleteAccount();const original=f.port.readCommittedOutbox;
   f.port.readCommittedOutbox=async e=>{
    const row=await original(e);
    if(kind==='extra')return {...row,verified:true};
    if(kind==='accessor'){
     const v={...row};
     Object.defineProperty(v,'event_id',{enumerable:true,get(){throw Error('untrusted')}});
     return v;
    }
    const p=Proxy.revocable(row,{});p.revoke();return p.proxy;
   };
   assert.equal((await f.bridge.inspect(ref,time+10)).status,'blocked');
  }finally{f.close()}
 }
});
test('R15 invalid brand, environment, event ref and unavailable Auth ports fail closed',async()=>{
 const f=fixture();try{
  assert.throws(()=>createOfflineDeletionEventRelay({
   brand_id:'hglobal',environment:'staging'},f.port),/SCOPE_DENIED/);
  assert.throws(()=>createOfflineDeletionEventRelay({
   brand_id:'starry',environment:'production'},f.port),/SCOPE_DENIED/);
  for(const v of [null,{},'abc',{event_id:ref},'a'.repeat(181)]){
   assert.equal((await f.bridge.inspect(v,time+10)).status,'blocked');
  }
  f.deleteAccount();f.port.readCommittedOutbox=async()=>{throw Error('outage')};
  assert.equal((await f.bridge.inspect(ref,time+10)).status,'blocked');
 }finally{f.close()}
});
test('R15 separate DB crash gap is visible and needs retry, never claims atomicity/ACK',async()=>{
 const f=fixture();try{
  f.deleteAccount();
  const evt=(await f.bridge.inspect(ref,time+10)).battery_event;
  assert.equal(f.battery.prepare('SELECT revoked FROM ai3_battery_wallet').get().revoked,0);
  const done=await f.consumer.consume(evt,(time+10)*1000);
  assert.equal(done.disposition,'receipt_only');
  const replay=await f.consumer.consume(evt,(time+10)*1000);
  assert.equal(replay.disposition,'retry');
  assert.equal(replay.may_ack_queue,false);
  assert.equal(f.battery.prepare('SELECT revoked FROM ai3_battery_wallet').get().revoked,1);
 }finally{f.close()}
});
