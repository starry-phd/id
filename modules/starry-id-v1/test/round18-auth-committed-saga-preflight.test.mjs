import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createOfflineCanonicalAuthDeletionPublisher} from '../src/round16-canonical-deletion-publisher.ts';
import {createOfflineAuthCommittedSagaPreflight,
 AUTH_R18_COMMITTED_TIMELINE_SQL,LIVE_AUTH_R18_SAGA_PREFLIGHT_ENABLED,
 AUTH_R18_EXTERNAL_PROVENANCE_APPROVED,AUTH_R18_QUEUE_ACK_APPROVED}
 from '../src/round18-auth-committed-saga-preflight.ts';

const n=1793000000,event='starry-delete-'+'a'.repeat(64);
const files=['001_starry_identity.DRAFT.sql',
 '007_starry_age_deletion_admin.UP.DRAFT.sql',
 '011_starry_one_use_deletion.UP.DRAFT.sql',
 '012_starry_stepup_challenge_scope.UP.DRAFT.sql',
 '013_starry_deletion_source_immutability.UP.DRAFT.sql'];
function make(config={}){
 const auth=new DatabaseSync(':memory:');
 const separateSink=new DatabaseSync(':memory:');
 auth.exec('PRAGMA foreign_keys=ON');
 for(const name of files)
  auth.exec(readFileSync(new URL('../schema/'+name,import.meta.url),'utf8'));
 auth.exec(readFileSync(new URL('./fixtures/round16_auth_dispatch_lease.DRAFT.sql',import.meta.url),'utf8'));
 auth.prepare("INSERT INTO starry_members VALUES('u1','active',3,1,'member',1,1,?,?)").run(n,n);
 const ins=auth.prepare("INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
 ins.run('s1','u1','app-a','staging',3,'a'.repeat(64),n+120,'passkey',n-5,n+90);
 ins.run('s2','u1','app-b','staging',3,'b'.repeat(64),n+120,null,null,null);
 separateSink.exec('CREATE TABLE inbox(event_id TEXT PRIMARY KEY)');
 const state={now:n,legal:true,retention:true,dbReads:0,timelineReads:0};
 const scope={brand_id:'starry',environment:'staging'};
 const db={prepare(sql){state.dbReads++;return {bind(...args){return {first:async()=>{
  if(sql===AUTH_R18_COMMITTED_TIMELINE_SQL){
   state.timelineReads++;
   if(config.onTimeline)config.onTimeline(state.timelineReads,auth,state);
  }
  if(config.outage&&sql===AUTH_R18_COMMITTED_TIMELINE_SQL)throw Error('D1 outage');
  return auth.prepare(sql).get(...args)??null;
 }};}};}};
 const legal=async()=>state.legal,retain=async()=>state.retention;
 const clock=()=>state.now;
 const issuer=createOfflineCanonicalAuthDeletionPublisher({enabled:true,scope,db,
  lawfulDeletionProcessingApprovedNow:legal,readServerNow:clock});
 const guard=createOfflineAuthCommittedSagaPreflight({enabled:true,scope,db,
  lawfulDeletionProcessingApprovedNow:legal,
  lawfulMinimalRetentionApprovedNow:retain,readServerNow:clock});
 function deleteCommitted(){
  auth.prepare('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?,?,?,NULL)')
   .run('a'.repeat(64),'u1','s1',3,event,n,n+60);
  assert.equal(auth.prepare('UPDATE starry_deletion_challenges SET consumed_at=? WHERE challenge_ref=? AND consumed_at IS NULL').run(n,'a'.repeat(64)).changes,1);
 }
 return {auth,separateSink,state,scope,db,legal,retain,clock,issuer,guard,deleteCommitted,
  close(){auth.close();separateSink.close();}};
}
test('OFF by default, forged claim and unapproved scope never authorize DB',async()=>{
 assert.equal(LIVE_AUTH_R18_SAGA_PREFLIGHT_ENABLED,false);
 assert.equal(AUTH_R18_EXTERNAL_PROVENANCE_APPROVED,false);
 assert.equal(AUTH_R18_QUEUE_ACK_APPROVED,false);
 const x=make();try{
  x.deleteCommitted();
  const claim=await x.issuer.claim(event);assert.ok(claim);
  const off=createOfflineAuthCommittedSagaPreflight({scope:x.scope,db:x.db,
   lawfulDeletionProcessingApprovedNow:x.legal,
   lawfulMinimalRetentionApprovedNow:x.retain,readServerNow:x.clock});
  const before=x.state.dbReads;
  assert.equal(await off.inspect(claim),null);
  assert.equal(await x.guard.inspect({...claim}),null);
  assert.equal(await x.guard.inspect({event_id:event,verified:true}),null);
  assert.equal(x.state.dbReads,before);
  for(const s of [{brand_id:'hglobal',environment:'staging'},
   {brand_id:'starry',environment:'production'}]){
   assert.throws(()=>createOfflineAuthCommittedSagaPreflight({scope:s,db:x.db,
    lawfulDeletionProcessingApprovedNow:x.legal,
    lawfulMinimalRetentionApprovedNow:x.retain,readServerNow:x.clock}));
  }
 }finally{x.close();}
});
test('real 001/007/011/012/013 committed source, lease and two timeline reads: review ONLY',async()=>{
 const x=make();try{
  assert.equal(await x.issuer.claim(event),null);
  x.deleteCommitted();
  const c=await x.issuer.claim(event);assert.ok(c);
  const v=await x.guard.inspect(c);
  assert.equal(v?.disposition,'offline_auth_source_review_only');
  assert.equal(v?.event_id,event);
  assert.equal(v?.auth_version,4);
  assert.equal(x.state.timelineReads,2);
  for(const key of ['may_ack_queue','may_mark_delivered','may_regrant',
   'may_restore','may_publish','live'])assert.equal(v[key],false);
  assert.equal(typeof x.guard.publish,'undefined');
  assert.equal(typeof x.guard.ack,'undefined');
  assert.equal(x.separateSink.prepare('SELECT COUNT(*) AS n FROM inbox').get().n,0);
  assert.match(AUTH_R18_COMMITTED_TIMELINE_SQL,/^SELECT /);
  assert.doesNotMatch(AUTH_R18_COMMITTED_TIMELINE_SQL,/\b(INSERT|UPDATE|DELETE)\b/i);
 }finally{x.close();}
});
test('retention/purpose denial (including missing policy and DB outage) fails closed',async()=>{
 const x=make();try{
  x.deleteCommitted();const c=await x.issuer.claim(event);assert.ok(c);
  for(const [key,value] of [['retention',false],['retention',null],
   ['retention',undefined],['legal',false]]){
   x.state[key]=value;
   const before=x.state.dbReads;
   assert.equal(await x.guard.inspect(c),null);
   assert.equal(x.state.dbReads,before);
   x.state.legal=true;x.state.retention=true;
  }
  assert.throws(()=>createOfflineAuthCommittedSagaPreflight({
   scope:x.scope,db:x.db,readServerNow:x.clock,
   lawfulDeletionProcessingApprovedNow:x.legal}),/AUTH_R18_RETENTION_POLICY_REQUIRED/);
 }finally{x.close();}
 const y=make({outage:true});try{
  y.deleteCommitted();const c=await y.issuer.claim(event);assert.ok(c);
  assert.equal(await y.guard.inspect(c),null);
 }finally{y.close();}
});
test('late revocation of a session is NOT a valid deletion-time proof',async()=>{
 const x=make();try{
  x.deleteCommitted();const c=await x.issuer.claim(event);assert.ok(c);
  x.auth.prepare("UPDATE starry_sessions SET revoked_at=? WHERE session_id='s2'").run(n+1);
  // R15 present-day check sees 0 unrevoked sessions; R18 catches late revoke.
  assert.equal(await x.guard.inspect(c),null);
  assert.equal(x.state.timelineReads,1);
 }finally{x.close();}
});
test('session restored, Member reinstated, challenge scope spoof and deleted outbox all refuse',async()=>{
 const updates=[
  "UPDATE starry_sessions SET revoked_at=NULL WHERE session_id='s1'",
  "UPDATE starry_members SET status='active' WHERE s_user_id='u1'",
  "UPDATE starry_deletion_challenge_scope SET environment='development'",
  "UPDATE starry_members SET auth_version=5",
  "UPDATE starry_members SET display_name='resurrected'",
  "UPDATE starry_deletion_challenges SET consumed_at=NULL"
 ];
 for(const change of updates){
  const x=make();try{
   x.deleteCommitted();const c=await x.issuer.claim(event);assert.ok(c);
   let blockedBySql=false;
   try{x.auth.exec(change);}catch{blockedBySql=true;}
   if(blockedBySql){
    // The original DRAFT trigger already rejected the manipulation.
    assert.ok(await x.guard.inspect(c),change);
   }else{
    // If the database permits the invalid state, R18 must reject it.
    assert.equal(await x.guard.inspect(c),null,change);
   }
  }finally{x.close();}
 }
});
test('missing source commit after rolled-back deletion never produces a lease',async()=>{
 const x=make();try{
  x.auth.exec('BEGIN IMMEDIATE');
  x.deleteCommitted();
  x.auth.exec('ROLLBACK');
  assert.equal(await x.issuer.claim(event),null);
  assert.equal(x.auth.prepare('SELECT COUNT(*) AS n FROM starry_deletion_outbox').get().n,0);
 }finally{x.close();}
});
test('expired/replaced lease denied; retry still uses immutable original event id',async()=>{
 const x=make();try{
  x.deleteCommitted();
  const old=await x.issuer.claim(event);assert.ok(old);
  x.state.now=n+31;
  assert.equal(await x.guard.inspect(old),null);
  const newer=await x.issuer.claim(event);assert.ok(newer);
  assert.equal(newer.event.event_id,old.event.event_id);
  assert.notEqual(newer.lease_token,old.lease_token);
  assert.equal(await x.guard.inspect(old),null);
  assert.ok(await x.guard.inspect(newer));
 }finally{x.close();}
});
test('between two readbacks: source/session/policy/retention drift denies',async()=>{
 for(const mutate of [
  (_count,auth)=>auth.exec("UPDATE starry_sessions SET revoked_at=NULL WHERE session_id='s1'"),
  (_count,auth)=>auth.exec("UPDATE starry_members SET status='active' WHERE s_user_id='u1'"),
  (_count,auth)=>auth.exec('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,revoked_at) VALUES('+
   "'s3','u1','app-z','staging',4,'"+'c'.repeat(64)+"',"+(n+200)+','+(n+1)+')'),
  (_count,_auth,state)=>{state.retention=false;},
  (_count,_auth,state)=>{state.legal=false;}
 ]){
  const x=make({onTimeline:(count,auth,state)=>{if(count===2)mutate(count,auth,state);}});
  try{
   x.deleteCommitted();const c=await x.issuer.claim(event);assert.ok(c);
   assert.equal(await x.guard.inspect(c),null);
  }finally{x.close();}
 }
});
