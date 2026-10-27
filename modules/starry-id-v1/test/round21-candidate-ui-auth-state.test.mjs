import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createOfflineCanonicalAuthDeletionPublisher}
 from '../src/round16-canonical-deletion-publisher.ts';
import {createOfflineCandidateAuthUI,R21_OFFLINE_SESSION_SELECT,
 R21_AUTH_UI_SCHEMA,R21_LIVE_AUTH_UI_ENABLED,R21_OFFICIAL_SIGNIN_APPROVED,
 R21_GLOBAL_DELETION_PROOF_APPROVED}
 from '../src/round21-candidate-ui-auth-state.ts';

const now=1793000000,event='starry-delete-'+'a'.repeat(64);
const schema=['001_starry_identity.DRAFT.sql',
 '007_starry_age_deletion_admin.UP.DRAFT.sql',
 '011_starry_one_use_deletion.UP.DRAFT.sql',
 '012_starry_stepup_challenge_scope.UP.DRAFT.sql',
 '013_starry_deletion_source_immutability.UP.DRAFT.sql'];
function make(hooks={}){
 const auth=new DatabaseSync(':memory:'),ui=new DatabaseSync(':memory:');
 auth.exec('PRAGMA foreign_keys=ON');
 for(const name of schema)auth.exec(readFileSync(new URL('../schema/'+name,import.meta.url),'utf8'));
 auth.exec(readFileSync(new URL('./fixtures/round16_auth_dispatch_lease.DRAFT.sql',import.meta.url),'utf8'));
 auth.prepare("INSERT INTO starry_members VALUES('u1','active',3,1,'hello',1,1,?,?)").run(now,now);
 const ins=auth.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
 ins.run('s1','u1','app-a','staging',3,'a'.repeat(64),now+120,'passkey',now-5,now+90);
 ins.run('s2','u1','app-b','staging',3,'b'.repeat(64),now+120,null,null,null);
 ui.exec("CREATE TABLE ui_candidate(screen TEXT PRIMARY KEY,state TEXT NOT NULL)");
 ui.prepare('INSERT INTO ui_candidate VALUES(?,?)').run('HOME','design_only');
 const state={clock:now,legal:true,retention:true,sessionPolicy:true,
  revision:'policy-r21-draft',dbReads:0,sessionReads:0,policyReads:0};
 const scope={brand_id:'starry',environment:'staging'};
 const db={prepare(sql){state.dbReads++;return {bind(...args){return {first:async()=>{
  if(sql===R21_OFFLINE_SESSION_SELECT){state.sessionReads++;
   if(hooks.onSessionRead)hooks.onSessionRead(state,auth);
  }
  if(state.outage)throw Error('sqlite unavailable');
  return auth.prepare(sql).get(...args)??null;
 }};}};}};
 const legal=async()=>state.legal,retention=async()=>state.retention,
  sessionPolicy=async()=>state.sessionPolicy,clock=()=>state.clock;
 const revision=async()=>{state.policyReads++;
  if(hooks.onPolicy)hooks.onPolicy(state,auth);
  return state.revision;
 };
 const deps={scope,authDb:db,lawfulSessionReadApprovedNow:sessionPolicy,
  lawfulDeletionProcessingApprovedNow:legal,
  lawfulMinimalRetentionApprovedNow:retention,
  readApprovedPolicyRevisionNow:revision,readServerNow:clock};
 const guard=createOfflineCandidateAuthUI({enabled:true,...deps});
 const issuer=createOfflineCanonicalAuthDeletionPublisher({enabled:true,scope,db,
  lawfulDeletionProcessingApprovedNow:legal,readServerNow:clock});
 function deleteCommitted(){
  auth.prepare('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?,?,?,NULL)')
   .run('a'.repeat(64),'u1','s1',3,event,now,now+60);
  assert.equal(auth.prepare('UPDATE starry_deletion_challenges SET consumed_at=? WHERE challenge_ref=? AND consumed_at IS NULL')
   .run(now,'a'.repeat(64)).changes,1);
 }
 const guest=(screen='SIGN_IN')=>({screen,mode:'guest',scope});
 const session=(screen='HOME')=>({screen,mode:'session',scope,
  app_id:'app-a',session_ref:'s1'});
 const deletion=()=>({screen:'DELETE_ACCOUNT',mode:'deletion',scope});
 return {auth,ui,state,scope,db,deps,guard,issuer,deleteCommitted,
  guest,session,deletion,close(){auth.close();ui.close();}};
}
function minimal(result,expected){
 assert.equal(result.state,expected);assert.equal(result.schema_version,R21_AUTH_UI_SCHEMA);
 assert.equal(result.authenticated,false);assert.equal(result.global_deletion_confirmed,false);
 assert.equal(result.ui_only,true);assert.equal(result.candidate_only,true);
 assert.equal(result.personal_data_included,false);
 for(const key of ['may_grant','may_ack_queue','may_publish','may_restore','live'])
  assert.equal(result[key],false,key);
 const json=JSON.stringify(result);
 for(const secret of ['u1','s1','app-a','starry-delete-','refresh_hash','OAuth','member_ref','event_id'])
  assert.equal(json.includes(secret),false,secret);
}
test('default OFF and unsafe scope/request blocked before DB reads',async()=>{
 assert.equal(R21_LIVE_AUTH_UI_ENABLED,false);
 assert.equal(R21_OFFICIAL_SIGNIN_APPROVED,false);
 assert.equal(R21_GLOBAL_DELETION_PROOF_APPROVED,false);
 const x=make();try{
  const before=x.state.dbReads,off=createOfflineCandidateAuthUI(x.deps);
  minimal(await off.project(x.guest()),'access_blocked');
  for(const q of [{...x.session(),scope:{brand_id:'hglobal',environment:'staging'}},
   {...x.session(),scope:{brand_id:'starry',environment:'production'}},
   {...x.session(),extra:'u1'}]){
   const r=await x.guard.project(q);
   assert.equal(r.state,'access_blocked');
  }
  assert.equal(x.state.dbReads,before);
  assert.throws(()=>createOfflineCandidateAuthUI({...x.deps,
   scope:{brand_id:'hglobal',environment:'staging'},enabled:true}));
 }finally{x.close();}
});
test('guest SIGN_IN is a fake nonpersonal placeholder, protected pages require reauth',async()=>{
 const x=make();try{
  const n=x.state.dbReads;
  minimal(await x.guard.project(x.guest('SIGN_IN')),'guest');
  for(const screen of ['HOME','ACCOUNT_SETTINGS','DELETE_ACCOUNT']){
   minimal(await x.guard.project(x.guest(screen)),'reauth_required');
  }
  assert.equal(x.state.dbReads,n);
  assert.equal(x.ui.prepare("SELECT state FROM ui_candidate WHERE screen='HOME'").get().state,'design_only');
 }finally{x.close();}
});
test('active Session from real Auth DB NEVER becomes officially signed in',async()=>{
 const x=make();try{
  for(const screen of ['SIGN_IN','HOME','ACCOUNT_SETTINGS','DELETE_ACCOUNT']){
   const y=await x.guard.project(x.session(screen));
   minimal(y,'auth_unverified');assert.equal(y.reason_code,'SESSION_NOT_OFFICIALLY_VERIFIED');
  }
  assert.equal(x.state.sessionReads,8);
  assert.match(R21_OFFLINE_SESSION_SELECT,/^SELECT /);
  assert.doesNotMatch(R21_OFFLINE_SESSION_SELECT,/\b(INSERT|UPDATE|DELETE)\s/i);
 }finally{x.close();}
});
test('revoked or expired Session yields reauth required without returning session id',async()=>{
 for(const change of [
  "UPDATE starry_sessions SET revoked_at="+now+" WHERE session_id='s1'",
  "UPDATE starry_sessions SET expires_at="+(now-1)+" WHERE session_id='s1'",
  "UPDATE starry_sessions SET auth_version=2 WHERE session_id='s1'"
 ]){
  const x=make();try{
   x.auth.exec(change);
   minimal(await x.guard.project(x.session()),'reauth_required');
  }finally{x.close();}
 }
});
test('second Session read revoke race and Member status change never authorizes access',async()=>{
 for(const change of [
  "UPDATE starry_sessions SET revoked_at="+now+" WHERE session_id='s1'",
  "UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'"
 ]){
  const x=make({onSessionRead:(s,db)=>{
   if(s.sessionReads===2)db.exec(change);
  }});
  try{
   const y=await x.guard.project(x.session());
   minimal(y,'access_blocked');
  }finally{x.close();}
 }
});
test('session policy unapproved or policy drift blocks protected DB before or after read',async()=>{
 const x=make();try{
  for(const [key,value] of [['sessionPolicy',false],['revision',null],
   ['revision','bad policy']]){
   x.state[key]=value;const n=x.state.dbReads;
   minimal(await x.guard.project(x.session()),'access_blocked');
   assert.equal(x.state.dbReads,n);
   x.state.sessionPolicy=true;x.state.revision='policy-r21-draft';
  }
 }finally{x.close();}
 const y=make({onPolicy:s=>{if(s.policyReads===2)s.revision='policy-r21-changed';}});
 try{minimal(await y.guard.project(y.session()),'access_blocked');}
 finally{y.close();}
});
test('real local Auth committed deletion still displays PENDING, never global confirmed',async()=>{
 const x=make();try{
  x.deleteCommitted();
  const claim=await x.issuer.claim(event);assert.ok(claim);
  const projected=await x.guard.project(x.deletion(),claim);
  minimal(projected,'deletion_pending');
  assert.equal(projected.reason_code,'LOCAL_DELETION_PENDING_GLOBAL_EVIDENCE');
  assert.equal(x.ui.prepare('SELECT COUNT(*) AS n FROM ui_candidate').get().n,1);
  minimal(await x.guard.project(x.deletion(),{...claim}),'access_blocked');
  const stale=x.state.clock=now+31;
  assert.equal(stale,now+31);
  minimal(await x.guard.project(x.deletion(),claim),'access_blocked');
 }finally{x.close();}
});
test('missing committed source/rollback, late session revoke and legal retention denial refuse false success',async()=>{
 const x=make();try{
  x.auth.exec('BEGIN IMMEDIATE');x.deleteCommitted();x.auth.exec('ROLLBACK');
  minimal(await x.guard.project(x.deletion(),{verified:true}),'access_blocked');
  x.deleteCommitted();const claim=await x.issuer.claim(event);assert.ok(claim);
  x.state.retention=false;const n=x.state.dbReads;
  minimal(await x.guard.project(x.deletion(),claim),'access_blocked');
  assert.equal(x.state.dbReads,n);
  x.state.retention=true;
  x.auth.prepare("UPDATE starry_sessions SET revoked_at=? WHERE session_id='s2'").run(now+1);
  minimal(await x.guard.project(x.deletion(),claim),'access_blocked');
 }finally{x.close();}
});
test('Auth outage, illegal permission and protected Session mismatch do not expose PII',async()=>{
 const x=make();try{
  x.state.outage=true;
  minimal(await x.guard.project(x.session()),'access_blocked');
  x.state.outage=false;
  x.state.sessionPolicy=false;
  const n=x.state.dbReads;
  minimal(await x.guard.project(x.deletion(),{}),'access_blocked');
  assert.equal(x.state.dbReads,n);
  x.state.sessionPolicy=true;
  minimal(await x.guard.project({...x.session(),session_ref:'unavailable'}),'access_blocked');
 }finally{x.close();}
});
