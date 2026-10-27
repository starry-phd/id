import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createOfflineCanonicalAuthDeletionPublisher} from '../src/round16-canonical-deletion-publisher.ts';
import {createOfflineAuthLeaseFence,AUTH_LEASE_FENCE_SQL,
 LIVE_AUTH_LEASE_FENCE_ENABLED,AUTH_FENCE_TRANSPORT_ACK_ALLOWED}
 from '../src/round17-auth-lease-fence.ts';

const epoch=1793000000,id='starry-delete-'+'a'.repeat(64);
function make(){
 const auth=new DatabaseSync(':memory:');
 const other=new DatabaseSync(':memory:');
 auth.exec('PRAGMA foreign_keys=ON;'+
 'CREATE TABLE starry_members(s_user_id TEXT PRIMARY KEY,status TEXT,auth_version INTEGER,updated_at INTEGER,display_name TEXT,directory_opt_in INTEGER,display_name_public INTEGER);'+
 'CREATE TABLE starry_sessions(s_user_id TEXT,revoked_at INTEGER);'+
 'CREATE TABLE starry_deletion_outbox(event_id TEXT PRIMARY KEY,s_user_id TEXT,occurred_at INTEGER,event_type TEXT);'+
 'CREATE TABLE starry_deletion_challenges(event_id TEXT,s_user_id TEXT,consumed_at INTEGER,auth_version INTEGER,challenge_ref TEXT);'+
 'CREATE TABLE starry_deletion_challenge_scope(challenge_ref TEXT,environment TEXT);'+
 "CREATE TABLE starry_auth_deletion_dispatch_claims(event_id TEXT PRIMARY KEY,publisher_id TEXT CHECK(publisher_id='starry-auth-sole-v1'),lease_token TEXT UNIQUE,lease_expires_at INTEGER,attempt_no INTEGER);");
 auth.prepare("INSERT INTO starry_members VALUES('u1','deleted',?, ?, NULL,0,0)").run(4,epoch);
 auth.prepare("INSERT INTO starry_sessions VALUES('u1',?)").run(epoch);
 auth.prepare('INSERT INTO starry_deletion_outbox VALUES(?,?,?,?)').run(id,'u1',epoch,'account_deleted');
 auth.prepare('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?)').run(id,'u1',epoch,3,'challenge-1');
 auth.prepare("INSERT INTO starry_deletion_challenge_scope VALUES('challenge-1','staging')").run();
 other.exec('CREATE TABLE inbox(event_id TEXT PRIMARY KEY)');
 const state={clock:epoch,approved:true,dbReads:0};
 const db={prepare(sql){state.dbReads++;return {bind(...args){return {
  first:async()=>auth.prepare(sql).get(...args)??null
 };}};}};
 const legal=async()=>state.approved;
 const time=()=>state.clock,scope={brand_id:'starry',environment:'staging'};
 const issuer=createOfflineCanonicalAuthDeletionPublisher({enabled:true,scope,db,
  lawfulDeletionProcessingApprovedNow:legal,readServerNow:time});
 const fence=createOfflineAuthLeaseFence({enabled:true,scope,db,
  lawfulDeletionProcessingApprovedNow:legal,readServerNow:time});
 return {auth,other,state,db,legal,time,scope,issuer,fence,
  close(){auth.close();other.close();}};
}
test('default off, no DB without legal purpose, reject H-Global and production',async()=>{
 assert.equal(LIVE_AUTH_LEASE_FENCE_ENABLED,false);
 assert.equal(AUTH_FENCE_TRANSPORT_ACK_ALLOWED,false);
 const x=make();try{
  const c=await x.issuer.claim(id);assert.ok(c);
  const off=createOfflineAuthLeaseFence({scope:x.scope,db:x.db,
   lawfulDeletionProcessingApprovedNow:x.legal,readServerNow:x.time});
  const n=x.state.dbReads;
  assert.equal(await off.observeCurrentLease(c),null);
  assert.equal(x.state.dbReads,n);
  x.state.approved=false;
  assert.equal(await x.fence.observeCurrentLease(c),null);
  assert.equal(x.state.dbReads,n);
  for(const scope of [{brand_id:'hglobal',environment:'staging'},
   {brand_id:'starry',environment:'production'}])
   assert.throws(()=>createOfflineAuthLeaseFence({scope,db:x.db,
    lawfulDeletionProcessingApprovedNow:x.legal,readServerNow:x.time}),
    /AUTH_R17_FENCE_CONFIG_DENIED/);
 }finally{x.close();}
});
test('one actual SQLite Auth claim verifies by two lease reads, not an ACK',async()=>{
 const x=make();try{
  const c=await x.issuer.claim(id);assert.ok(c);
  const v=await x.fence.observeCurrentLease(c);
  assert.equal(v?.disposition,'offline_current_lease_observation_only');
  assert.equal(v?.event_id,id);
  for(const k of ['may_ack_queue','may_mark_delivered','may_regrant','live'])
   assert.equal(v[k],false);
  assert.equal(x.other.prepare('SELECT COUNT(*) AS n FROM inbox').get().n,0);
  assert.equal(typeof x.fence.send,'undefined');
  assert.equal(typeof x.fence.ack,'undefined');
  assert.match(AUTH_LEASE_FENCE_SQL,/^SELECT /);
  assert.doesNotMatch(AUTH_LEASE_FENCE_SQL,/\b(INSERT|UPDATE|DELETE)\b/i);
  assert.equal(await x.fence.observeCurrentLease({...c}),null);
 }finally{x.close();}
});
test('lease expiry and retry invalidate ORIGINAL sealed claim',async()=>{
 const x=make();try{
  const old=await x.issuer.claim(id);assert.ok(old);
  x.state.clock=epoch+31;
  assert.equal(await x.fence.observeCurrentLease(old),null);
  const newer=await x.issuer.claim(id);assert.ok(newer);
  assert.notEqual(newer.lease_token,old.lease_token);
  assert.equal(newer.attempt_no,old.attempt_no+1);
  assert.equal(await x.fence.observeCurrentLease(old),null);
  assert.ok(await x.fence.observeCurrentLease(newer));
 }finally{x.close();}
});
test('actual SQLite stale Member, session, challenge scope and outbox rejected',async()=>{
 const changes=[
  "UPDATE starry_members SET status='active'",
  "INSERT INTO starry_sessions VALUES('u1',NULL)",
  "UPDATE starry_deletion_challenge_scope SET environment='development'",
  "UPDATE starry_deletion_challenges SET consumed_at=0",
  "UPDATE starry_deletion_outbox SET event_type='other'",
  'UPDATE starry_members SET auth_version=5',
  "UPDATE starry_members SET display_name='back'"
 ];
 for(const change of changes){
  const x=make();try{
   const claim=await x.issuer.claim(id);assert.ok(claim);
   x.auth.exec(change);
   assert.equal(await x.fence.observeCurrentLease(claim),null,change);
  }finally{x.close();}
 }
});
test('lease replaced between observations gets refused despite originally valid proof',async()=>{
 const x=make();try{
  const claim=await x.issuer.claim(id);assert.ok(claim);
  let count=0;
  const racing={prepare(sql){return {bind(...args){return {first:async()=>{
   const result=x.auth.prepare(sql).get(...args)??null;
   if(sql===AUTH_LEASE_FENCE_SQL&&++count===1)
    x.auth.prepare('UPDATE starry_auth_deletion_dispatch_claims SET lease_token=?')
     .run('b'.repeat(64));
   return result;
  }};}};}};
  const f=createOfflineAuthLeaseFence({enabled:true,scope:x.scope,db:racing,
   lawfulDeletionProcessingApprovedNow:x.legal,readServerNow:x.time});
  assert.equal(await f.observeCurrentLease(claim),null);
  assert.equal(count,2);
 }finally{x.close();}
});
