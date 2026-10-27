import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createOfflineCanonicalAuthDeletionPublisher}
 from '../src/round16-canonical-deletion-publisher.ts';
import {createOfflineR20AuthIdentityBoundary,R20_SCHEMA_VERSION,
 R20_LIVE_CROSS_DOMAIN_MAPPING_ENABLED,R20_SIGNED_P05_SOURCE_APPROVED,
 R20_HMAC_MEMBER_MAPPING_APPROVED,R20_QUEUE_ACK_ALLOWED}
 from '../src/round20-auth-identity-boundary.ts';

const NOW=1793000000,EVENT='starry-delete-'+'a'.repeat(64);
const RF='refund-event-'+'b'.repeat(64),TASK='task-ref-'+'c'.repeat(64),
 DIGEST='digest-ref-'+'d'.repeat(64);
function setup(hooks={}){
 const auth=new DatabaseSync(':memory:'),billing=new DatabaseSync(':memory:'),
  task=new DatabaseSync(':memory:'),identity=new DatabaseSync(':memory:');
 auth.exec('PRAGMA foreign_keys=ON');
 for(const name of ['001_starry_identity.DRAFT.sql',
  '007_starry_age_deletion_admin.UP.DRAFT.sql',
  '011_starry_one_use_deletion.UP.DRAFT.sql',
  '012_starry_stepup_challenge_scope.UP.DRAFT.sql',
  '013_starry_deletion_source_immutability.UP.DRAFT.sql']){
  auth.exec(readFileSync(new URL('../schema/'+name,import.meta.url),'utf8'));
 }
 auth.exec(readFileSync(new URL('./fixtures/round16_auth_dispatch_lease.DRAFT.sql',import.meta.url),'utf8'));
 auth.prepare("INSERT INTO starry_members VALUES('u1','active',3,1,'member',1,1,?,?)").run(NOW,NOW);
 const session=auth.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
 session.run('s1','u1','app-a','staging',3,'a'.repeat(64),NOW+120,'passkey',NOW-5,NOW+60);
 session.run('s2','u1','app-b','staging',3,'b'.repeat(64),NOW+120,null,null,null);
 for(const db of [billing,task,identity])db.exec(
  "CREATE TABLE candidate(namespace TEXT NOT NULL,ref TEXT PRIMARY KEY,environment TEXT NOT NULL,provenance TEXT NOT NULL)");
 billing.prepare('INSERT INTO candidate VALUES(?,?,?,?)').run('billing.store_refund',RF,'staging','unapproved_mock');
 task.prepare('INSERT INTO candidate VALUES(?,?,?,?)').run('task.execution',TASK,'staging','unapproved_mock');
 identity.prepare('INSERT INTO candidate VALUES(?,?,?,?)').run('member.pseudonymous_digest',DIGEST,'staging','unapproved_mock');
 const state={legal:true,retention:true,policy:'policy-r20-1',now:NOW,authReads:0,candidateReads:0};
 const scope={brand_id:'starry',environment:'staging'};
 const db={prepare(sql){state.authReads++;return {bind(...args){return {first:async()=>{
  if(hooks.onAuthRead)hooks.onAuthRead(state,auth,sql);
  if(state.authOutage)throw Error('Auth unavailable');
  return auth.prepare(sql).get(...args)??null;
 }};}};}};
 const legal=async()=>state.legal,retain=async()=>state.retention,
  policy=async()=>state.policy,clock=()=>state.now;
 const load=(real,ref)=>async (value,sc)=>{
  assert.equal(sc.brand_id,'starry');
  assert.equal(typeof value,'string');
  assert.notEqual(value,'u1'); // NEVER give the Billing/Task port raw Auth ID.
  state.candidateReads++;
  if(hooks.onCandidate)hooks.onCandidate(state,real,ref);
  if(state.candidateOutage)throw Error('External DB unavailable');
  return real.prepare('SELECT namespace,ref,environment,provenance FROM candidate WHERE ref=?').get(value)??null;
 };
 const deps={scope,authDb:db,lawfulDeletionProcessingApprovedNow:legal,
  lawfulMinimalRetentionApprovedNow:retain,readApprovedPolicyRevisionNow:policy,
  readServerNow:clock,readRefundCandidate:load(billing,RF),
  readTaskCandidate:load(task,TASK),readDigestCandidate:load(identity,DIGEST)};
 const issuer=createOfflineCanonicalAuthDeletionPublisher({
  enabled:true,scope,db,lawfulDeletionProcessingApprovedNow:legal,readServerNow:clock});
 const guard=createOfflineR20AuthIdentityBoundary({enabled:true,...deps});
 const request={reader:'saga',scope,auth_event_ref:EVENT,store_refund_ref:RF,
  task_ref:TASK,digest_ref:DIGEST};
 function commit(){
  auth.prepare('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?,?,?,NULL)')
   .run('a'.repeat(64),'u1','s1',3,EVENT,NOW,NOW+60);
  assert.equal(auth.prepare('UPDATE starry_deletion_challenges SET consumed_at=? WHERE challenge_ref=? AND consumed_at IS NULL')
   .run(NOW,'a'.repeat(64)).changes,1);
 }
 return {auth,billing,task,identity,state,scope,db,issuer,guard,deps,request,commit,
  close(){auth.close();billing.close();task.close();identity.close();}};
}
async function issued(x){x.commit();const claim=await x.issuer.claim(EVENT);assert.ok(claim);return claim;}
test('R20 default OFF, fake claim and cross-brand/env/colliding namespace deny before any protected SQL',async()=>{
 assert.equal(R20_LIVE_CROSS_DOMAIN_MAPPING_ENABLED,false);
 assert.equal(R20_SIGNED_P05_SOURCE_APPROVED,false);
 assert.equal(R20_HMAC_MEMBER_MAPPING_APPROVED,false);
 assert.equal(R20_QUEUE_ACK_ALLOWED,false);
 const x=setup();try{
  const c=await issued(x),off=createOfflineR20AuthIdentityBoundary(x.deps);
  const n=x.state.authReads;
  assert.equal((await off.inspect(c,x.request)).status,'blocked');
  for(const claim of [{...c},{verified:true,event_id:EVENT}])
   assert.equal((await x.guard.inspect(claim,x.request)).status,'blocked');
  for(const request of [{...x.request,scope:{brand_id:'hglobal',environment:'staging'}},
   {...x.request,scope:{brand_id:'starry',environment:'development'}},
   {...x.request,store_refund_ref:EVENT},
   {...x.request,task_ref:RF},
   {...x.request,reader:'billing'},
   {...x.request,raw_member_ref:'u1'}])
   assert.equal((await x.guard.inspect(c,request)).status,'blocked');
  assert.equal(x.state.authReads,n);
  assert.throws(()=>createOfflineR20AuthIdentityBoundary({...x.deps,
   scope:{brand_id:'hglobal',environment:'staging'},enabled:true}));
 }finally{x.close();}
});
test('four separate SQLite DBs: distinct semantic namespaces REVIEW ONLY, no Auth member ID exposure',async()=>{
 const x=setup();try{
  const c=await issued(x);
  const result=await x.guard.inspect(c,x.request);
  assert.equal(result.status,'review_only');
  assert.equal(result.reason,'UNAPPROVED_IDENTITY_MAPPING_REVIEW_ONLY');
  assert.equal(result.schema_version,R20_SCHEMA_VERSION);
  assert.deepEqual(result.source,{namespace:'auth.account_deleted',event_id:EVENT,
   auth_version:4,policy_revision:'policy-r20-1'});
  assert.equal('member_ref' in result.source,false);
  assert.equal('digest_ref' in result,false);
  for(const k of ['may_publish','may_ack_queue','may_restore','may_regrant',
   'may_release_task','live','identity_mapping_approved'])assert.equal(result[k],false);
  for(const db of [x.billing,x.task,x.identity])
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM candidate').get().n,1);
  for(const method of ['publish','ack','send','regrant','write'])
   assert.equal(typeof x.guard[method],'undefined');
 }finally{x.close();}
});
test('wrong Store refund namespace, pseudonymous digest, task type, foreign environment all deny',async()=>{
 const changed=[
  [0,"UPDATE candidate SET namespace='auth.account_deleted'"],
  [1,"UPDATE candidate SET namespace='billing.store_refund'"],
  [2,"UPDATE candidate SET provenance='official_hmac'"],
  [0,"UPDATE candidate SET environment='production'"],
  [1,"DELETE FROM candidate"],
  [2,"UPDATE candidate SET ref='another-digest-'||substr(ref,15)"]
 ];
 for(const [index,sql] of changed){
  const x=setup();try{
   const c=await issued(x);[x.billing,x.task,x.identity][index].exec(sql);
   assert.equal((await x.guard.inspect(c,x.request)).status,'blocked',sql);
  }finally{x.close();}
 }
});
test('missing Auth commit and rolled-back one-use deletion refuse despite fake sink candidates',async()=>{
 const x=setup();try{
  assert.equal(await x.issuer.claim(EVENT),null);
  assert.equal((await x.guard.inspect({verified:true},x.request)).status,'blocked');
  x.auth.exec('BEGIN IMMEDIATE');x.commit();x.auth.exec('ROLLBACK');
  assert.equal(await x.issuer.claim(EVENT),null);
  assert.equal(x.auth.prepare('SELECT COUNT(*) AS n FROM starry_deletion_outbox').get().n,0);
 }finally{x.close();}
});
test('legal purpose, lawful retention and policy revocation reject before all protected reads',async()=>{
 const x=setup();try{
  const c=await issued(x);
  for(const [key,val] of [['legal',false],['retention',false],
   ['retention',undefined],['policy',null],['policy','bad policy']]){
   x.state[key]=val;
   const authReads=x.state.authReads,other=x.state.candidateReads;
   const v=await x.guard.inspect(c,x.request);
   assert.equal(v.status,'blocked');
   assert.equal(x.state.authReads,authReads);
   assert.equal(x.state.candidateReads,other);
   x.state.legal=true;x.state.retention=true;x.state.policy='policy-r20-1';
  }
 }finally{x.close();}
});
test('expired and superseded genuine Auth claim is rejected after original deletion commit',async()=>{
 const x=setup();try{
  const old=await issued(x);
  x.state.now=NOW+31;
  assert.equal((await x.guard.inspect(old,x.request)).status,'blocked');
  const newer=await x.issuer.claim(EVENT);assert.ok(newer);
  assert.equal(newer.attempt_no,2);
  assert.equal((await x.guard.inspect(old,x.request)).status,'blocked');
  assert.equal((await x.guard.inspect(newer,x.request)).status,'review_only');
 }finally{x.close();}
});
test('Session restoration/late revoke fail closed with genuine Auth outbox',async()=>{
 for(const sql of [
  "UPDATE starry_sessions SET revoked_at=NULL WHERE session_id='s1'",
  "UPDATE starry_sessions SET revoked_at="+(NOW+1)+" WHERE session_id='s2'",
  "UPDATE starry_deletion_challenge_scope SET environment='development'"
 ]){
  const x=setup();try{const c=await issued(x);x.auth.exec(sql);
   assert.equal((await x.guard.inspect(c,x.request)).status,'blocked',sql);
  }finally{x.close();}
 }
});
test('candidate DB changes between reads, Auth outage or policy drift refuse',async()=>{
 for(const kind of ['sink_changed','policy_changed','auth_outage']){
  const x=setup({onCandidate:(s,db)=>{
   if(s.candidateReads===4&&kind==='sink_changed')
    db.exec("UPDATE candidate SET environment='development'");
   if(s.candidateReads===4&&kind==='policy_changed')s.policy='policy-r20-2';
   if(s.candidateReads===3&&kind==='auth_outage')s.authOutage=true;
  }});
  try{const c=await issued(x);
   assert.equal((await x.guard.inspect(c,x.request)).status,'blocked',kind);
  }finally{x.close();}
 }
});
