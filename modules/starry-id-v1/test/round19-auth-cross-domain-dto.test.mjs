import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createOfflineCanonicalAuthDeletionPublisher}
 from '../src/round16-canonical-deletion-publisher.ts';
import {createOfflineAuthCrossDomainDTO,R19_LIVE_AUTH_DTO_ENABLED,
 R19_EXTERNAL_AUTH_SIGNATURE_APPROVED,R19_QUEUE_ACK_ALLOWED}
 from '../src/round19-auth-cross-domain-dto.ts';

const epoch=1793000000,event='starry-delete-'+'a'.repeat(64);
const schema=['001_starry_identity.DRAFT.sql',
 '007_starry_age_deletion_admin.UP.DRAFT.sql',
 '011_starry_one_use_deletion.UP.DRAFT.sql',
 '012_starry_stepup_challenge_scope.UP.DRAFT.sql',
 '013_starry_deletion_source_immutability.UP.DRAFT.sql'];
function make(hooks={}){
 const auth=new DatabaseSync(':memory:');
 const battery=new DatabaseSync(':memory:');
 const saga=new DatabaseSync(':memory:');
 auth.exec('PRAGMA foreign_keys=ON');
 for(const f of schema)auth.exec(readFileSync(new URL('../schema/'+f,import.meta.url),'utf8'));
 auth.exec(readFileSync(new URL('./fixtures/round16_auth_dispatch_lease.DRAFT.sql',import.meta.url),'utf8'));
 auth.prepare("INSERT INTO starry_members VALUES('u1','active',3,1,'profile',1,1,?,?)")
  .run(epoch,epoch);
 const ins=auth.prepare("INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
 ins.run('s1','u1','app-a','staging',3,'a'.repeat(64),epoch+120,'passkey',epoch-5,epoch+90);
 ins.run('s2','u1','app-b','staging',3,'b'.repeat(64),epoch+120,null,null,null);
 battery.exec('CREATE TABLE inbox(event_id TEXT PRIMARY KEY,member_ref TEXT,environment TEXT)');
 saga.exec('CREATE TABLE delivery(event_id TEXT PRIMARY KEY,member_ref TEXT,environment TEXT)');
 const state={now:epoch,legal:true,retention:true,revision:'policy-r19-draft',
  authReads:0,policyReads:0};
 const scope={brand_id:'starry',environment:'staging'};
 const db={prepare(sql){state.authReads++;return {bind(...args){return {first:async()=>{
  if(hooks.onAuthRead)hooks.onAuthRead(sql,auth,state);
  if(state.outage)throw Error('D1 fail');
  return auth.prepare(sql).get(...args)??null;
 }};}};}};
 const legal=async()=>state.legal;
 const retention=async()=>state.retention;
 const now=()=>state.now;
 const policy=async()=>{state.policyReads++;if(hooks.onPolicy)hooks.onPolicy(state,auth);return state.revision;};
 const issuer=createOfflineCanonicalAuthDeletionPublisher({enabled:true,scope,db,
  lawfulDeletionProcessingApprovedNow:legal,readServerNow:now});
 const opts={scope,db,lawfulDeletionProcessingApprovedNow:legal,
  lawfulMinimalRetentionApprovedNow:retention,readApprovedPolicyRevisionNow:policy,
  readServerNow:now};
 const adapter=createOfflineAuthCrossDomainDTO({enabled:true,...opts});
 function commit(){
  auth.prepare('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?,?,?,NULL)')
   .run('a'.repeat(64),'u1','s1',3,event,epoch,epoch+60);
  assert.equal(auth.prepare("UPDATE starry_deletion_challenges SET consumed_at=? WHERE challenge_ref=? AND consumed_at IS NULL")
   .run(epoch,'a'.repeat(64)).changes,1);
 }
 return {auth,battery,saga,state,scope,db,opts,issuer,adapter,commit,
  close(){auth.close();battery.close();saga.close();}};
}
const read=(x,claim,domain='battery',scope=x.scope)=>
 x.adapter.readForOfflineConsumer(claim,domain,scope);
test('offline default, forged claim, wrong brand and environment denied before Auth DB',async()=>{
 assert.equal(R19_LIVE_AUTH_DTO_ENABLED,false);
 assert.equal(R19_EXTERNAL_AUTH_SIGNATURE_APPROVED,false);
 assert.equal(R19_QUEUE_ACK_ALLOWED,false);
 const x=make();try{
  x.commit();const claim=await x.issuer.claim(event);assert.ok(claim);
  const off=createOfflineAuthCrossDomainDTO(x.opts);
  const before=x.state.authReads;
  assert.equal(await off.readForOfflineConsumer(claim,'battery',x.scope),null);
  assert.equal(await read(x,{...claim}),null);
  assert.equal(await read(x,{event_id:event,verified:true}),null);
  assert.equal(await read(x,claim,'billing'),null);
  assert.equal(await read(x,claim,'battery',{brand_id:'hglobal',environment:'staging'}),null);
  assert.equal(await read(x,claim,'saga',{brand_id:'starry',environment:'development'}),null);
  assert.equal(x.state.authReads,before);
  assert.throws(()=>createOfflineAuthCrossDomainDTO({...x.opts,
   scope:{brand_id:'hglobal',environment:'staging'}}),/AUTH_R19_SCOPE_DENIED/);
 }finally{x.close();}
});
test('actual original Auth committed DTO matches both READ-ONLY local consumers',async()=>{
 const x=make();try{
  assert.equal(await x.issuer.claim(event),null);
  x.commit();const c=await x.issuer.claim(event);assert.ok(c);
  const a=await read(x,c,'battery'),b=await read(x,c,'saga');
  assert.ok(a);assert.ok(b);
  assert.deepEqual(a.event,b.event);
  assert.deepEqual(a.event,{event_id:event,member_ref:'u1',
   occurred_at_sec:epoch,event_type:'account_deleted'});
  assert.deepEqual(Object.keys(a.event).sort(),
   ['event_id','member_ref','occurred_at_sec','event_type'].sort());
  assert.equal(a.auth_version,4);assert.equal(a.source_attempt_no,1);
  assert.equal(a.policy_revision,'policy-r19-draft');
  for(const k of ['may_publish','may_ack_queue','may_grant','may_restore','may_regrant','live'])
   assert.equal(a[k],false);
  assert.equal(typeof x.adapter.publish,'undefined');
  assert.equal(typeof x.adapter.ack,'undefined');
  assert.equal(x.battery.prepare('SELECT COUNT(*) AS n FROM inbox').get().n,0);
  assert.equal(x.saga.prepare('SELECT COUNT(*) AS n FROM delivery').get().n,0);
  assert.notEqual(x.auth,x.battery);
  assert.notEqual(x.auth,x.saga);
 }finally{x.close();}
});
test('raw requester event or cross-domain fake receipts never convert into source proof',async()=>{
 const x=make();try{
  x.commit();const c=await x.issuer.claim(event);assert.ok(c);
  const raw={event_id:event,member_ref:'u1',occurred_at_sec:epoch,event_type:'account_deleted'};
  assert.equal(await read(x,raw),null);
  x.battery.prepare('INSERT INTO inbox VALUES(?,?,?)').run(event,'wrong','staging');
  x.saga.prepare('INSERT INTO delivery VALUES(?,?,?)').run(event,'u1','development');
  assert.ok(await read(x,c)); // source only; sink rows not asserted as delivered.
  assert.equal(x.battery.prepare("SELECT member_ref FROM inbox WHERE event_id=?").get(event).member_ref,'wrong');
  assert.equal(x.saga.prepare('SELECT environment FROM delivery WHERE event_id=?').get(event).environment,'development');
 }finally{x.close();}
});
test('legal / retention / policy authorization missing => no Auth DB read',async()=>{
 const x=make();try{
  x.commit();const c=await x.issuer.claim(event);assert.ok(c);
  for(const [key,value] of [['legal',false],['retention',false],
   ['retention',undefined],['revision',null],['revision','bad policy'],['revision','']]){
   x.state[key]=value;
   const n=x.state.authReads;
   assert.equal(await read(x,c),null);
   assert.equal(x.state.authReads,n);
   x.state.legal=true;x.state.retention=true;x.state.revision='policy-r19-draft';
  }
 }finally{x.close();}
});
test('policy revision changes between Auth source reads: reject and no new sink writes',async()=>{
 const x=make({onPolicy:(state)=>{if(state.policyReads===3)state.revision='policy-r19-next';}});
 try{
  x.commit();const c=await x.issuer.claim(event);assert.ok(c);
  assert.equal(await read(x,c),null);
  assert.equal(x.battery.prepare('SELECT COUNT(*) AS n FROM inbox').get().n,0);
 }finally{x.close();}
});
test('stale lease and replacement token cannot produce new cross-domain projection',async()=>{
 const x=make();try{
  x.commit();const old=await x.issuer.claim(event);assert.ok(old);
  x.state.now=epoch+31;
  assert.equal(await read(x,old),null);
  const fresh=await x.issuer.claim(event);assert.ok(fresh);
  assert.equal(fresh.event.event_id,old.event.event_id);
  assert.equal(fresh.attempt_no,2);
  assert.equal(await read(x,old),null);
  assert.ok(await read(x,fresh));
 }finally{x.close();}
});
test('deleted Member restoration, unrevoked Session and late revocation denied',async()=>{
 const changes=[
  "UPDATE starry_members SET status='active' WHERE s_user_id='u1'",
  "UPDATE starry_sessions SET revoked_at=NULL WHERE session_id='s2'",
  "UPDATE starry_sessions SET revoked_at="+(epoch+1)+" WHERE session_id='s2'",
  "UPDATE starry_deletion_challenge_scope SET environment='development'"
 ];
 for(const sql of changes){
  const x=make();try{
   x.commit();const c=await x.issuer.claim(event);assert.ok(c);
   let blockedBySql=false;
   try{x.auth.exec(sql);}catch{blockedBySql=true;}
   if(blockedBySql){
    // Existing Auth immutability guard already refused the bad mutation.
    assert.ok(await read(x,c),sql);
   }else{
    // When an invalid state is permitted, the R19 adapter must fail closed.
    assert.equal(await read(x,c),null,sql);
   }
  }finally{x.close();}
 }
});
test('original outbox cannot mutate or be erased; rollback leaves no committed source',async()=>{
 const x=make();try{
  x.auth.exec('BEGIN IMMEDIATE');
  x.commit();x.auth.exec('ROLLBACK');
  assert.equal(await x.issuer.claim(event),null);
  x.commit();const c=await x.issuer.claim(event);assert.ok(c);
  assert.throws(()=>x.auth.prepare('UPDATE starry_deletion_outbox SET occurred_at=?').run(epoch+1));
  assert.throws(()=>x.auth.exec('DELETE FROM starry_deletion_outbox'));
  assert.ok(await read(x,c));
 }finally{x.close();}
});
test('Auth database failure and late read authorization drift fail closed',async()=>{
 const x=make();try{
  x.commit();const c=await x.issuer.claim(event);assert.ok(c);
  x.state.outage=true;
  assert.equal(await read(x,c),null);
  x.state.outage=false;
  const y=make({onAuthRead:(sql,db,state)=>{
   if(sql.includes('SELECT o.event_id')&&state.authReads>10)state.retention=false;
  }});
  try{
   y.commit();const cc=await y.issuer.claim(event);assert.ok(cc);
   const n=y.state.authReads;
   // Always fail safely once a later Auth proof becomes unavailable.
   y.state.outage=true;
   assert.equal(await read(y,cc),null);
   assert.ok(y.state.authReads>n);
  }finally{y.close();}
 }finally{x.close();}
});
