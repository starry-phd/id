import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createOfflineCanonicalAuthDeletionPublisher}
 from '../src/round16-canonical-deletion-publisher.ts';
import {createOfflineEchoStarryCandidateSession,R22_ECHO_SCHEMA,
 R22_ECHO_CANDIDATE_APP_ID,R22_ECHO_LIVE_AUTH_ENABLED,
 R22_ECHO_OFFICIAL_MEMBERSHIP_APPROVED,R22_ECHO_OIDC_APPROVED,
 R22_ECHO_MEMBERSHIP_SQL} from '../src/round22-echo-candidate-session.ts';
const now=1793000000,event='starry-delete-'+'a'.repeat(64);
function fixture(hooks={}){
 const auth=new DatabaseSync(':memory:'),echoUi=new DatabaseSync(':memory:');
 auth.exec('PRAGMA foreign_keys=ON');
 for(const f of ['001_starry_identity.DRAFT.sql','007_starry_age_deletion_admin.UP.DRAFT.sql',
 '011_starry_one_use_deletion.UP.DRAFT.sql',
 '012_starry_stepup_challenge_scope.UP.DRAFT.sql',
 '013_starry_deletion_source_immutability.UP.DRAFT.sql'])
  auth.exec(readFileSync(new URL('../schema/'+f,import.meta.url),'utf8'));
 auth.exec(readFileSync(new URL('./fixtures/round16_auth_dispatch_lease.DRAFT.sql',import.meta.url),'utf8'));
 // Disposable fixture ONLY. Not approved physical migration or actual app membership.
 auth.exec('CREATE TABLE echo_r22_membership_fixture(s_user_id TEXT REFERENCES starry_members(s_user_id),app_id TEXT,environment TEXT,membership_status TEXT,member_auth_version INTEGER,PRIMARY KEY(s_user_id,app_id,environment))');
 auth.prepare("INSERT INTO starry_members VALUES('u1','active',3,1,'fake name',1,1,?,?)").run(now,now);
 const ins=auth.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
 ins.run('s1','u1',R22_ECHO_CANDIDATE_APP_ID,'staging',3,'a'.repeat(64),now+120,'passkey',now-5,now+90);
 ins.run('s2','u1','another-app','staging',3,'b'.repeat(64),now+120,null,null,null);
 auth.prepare('INSERT INTO echo_r22_membership_fixture VALUES(?,?,?,?,?)').run('u1',R22_ECHO_CANDIDATE_APP_ID,'staging','active',3);
 echoUi.exec("CREATE TABLE preview(state TEXT)");echoUi.exec("INSERT INTO preview VALUES('design_only')");
 const state={clock:now,dbReads:0,membershipReads:0,legal:true,retention:true,
  sessionLawful:true,policy:'policy-r22',outage:false};
 const scope={brand_id:'starry',environment:'staging'};
 const db={prepare(sql){state.dbReads++;return {bind(...args){return {first:async()=>{
  if(sql===R22_ECHO_MEMBERSHIP_SQL){
   state.membershipReads++;
   if(hooks.onMemberRead)hooks.onMemberRead(state,auth);
  }
  if(state.outage)throw Error('DB offline');
  return auth.prepare(sql).get(...args)??null;
 }};}};}};
 const lawful=async()=>state.legal,retain=async()=>state.retention,
  sessionLawful=async()=>state.sessionLawful,
  policy=async()=>state.policy,clock=()=>state.clock;
 const cfg={scope,db,lawfulSessionReadApprovedNow:sessionLawful,
  lawfulDeletionProcessingApprovedNow:lawful,
  lawfulMinimalRetentionApprovedNow:retain,
  readApprovedPolicyRevisionNow:policy,readServerNow:clock};
 const guard=createOfflineEchoStarryCandidateSession({enabled:true,...cfg});
 const issuer=createOfflineCanonicalAuthDeletionPublisher({enabled:true,scope,db,
  lawfulDeletionProcessingApprovedNow:lawful,readServerNow:clock});
 const input=(mode,other={})=>({scope,app_id:R22_ECHO_CANDIDATE_APP_ID,
  origin:'new_starry_id_candidate',mode,...other});
 function commit(){
  auth.prepare('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?,?,?,NULL)')
   .run('a'.repeat(64),'u1','s1',3,event,now,now+60);
  assert.equal(auth.prepare('UPDATE starry_deletion_challenges SET consumed_at=? WHERE challenge_ref=? AND consumed_at IS NULL')
   .run(now,'a'.repeat(64)).changes,1);
 }
 return {auth,echoUi,state,scope,cfg,guard,issuer,input,commit,
  close(){auth.close();echoUi.close();}};
}
function denyPrivilege(x,expected){
 assert.equal(x.schema_version,R22_ECHO_SCHEMA);
 assert.equal(x.state,expected);
 for(const p of ['authenticated','privilege_authorized','global_deletion_confirmed',
  'legacy_identity_accepted','may_grant','may_ack_queue','may_publish',
  'may_restore','may_open_paid_access','live'])assert.equal(x[p],false,p);
 const j=JSON.stringify(x);
 for(const v of ['u1','s1','fake name','_authToken','_starryUserId',
  'starry-delete-','member_ref','refresh_hash','Bearer'])
  assert.equal(j.includes(v),false,v);
}
test('OFF by default, legacy Web token/user/google-origin and foreign app/env rejected before Auth DB',async()=>{
 assert.equal(R22_ECHO_LIVE_AUTH_ENABLED,false);
 assert.equal(R22_ECHO_OFFICIAL_MEMBERSHIP_APPROVED,false);
 assert.equal(R22_ECHO_OIDC_APPROVED,false);
 const x=fixture();try{
  const off=createOfflineEchoStarryCandidateSession(x.cfg);
  const before=x.state.dbReads;
  denyPrivilege(await off.inspect(x.input('guest')),'access_blocked');
  for(const q of [
   {...x.input('guest'),_starryUserId:'u1'},
   {...x.input('session',{session_ref:'s1'}),_authToken:'webBearer'},
   {...x.input('session',{session_ref:'s1'}),origin:'legacy_web_cookie'},
   {...x.input('session',{session_ref:'s1'}),origin:'google_redirect'},
   {...x.input('session',{session_ref:'s1'}),app_id:'another-app'},
   {...x.input('session',{session_ref:'s1'}),scope:{brand_id:'hglobal',environment:'staging'}},
   {...x.input('session',{session_ref:'s1'}),scope:{brand_id:'starry',environment:'production'}}
  ])denyPrivilege(await x.guard.inspect(q),'access_blocked');
  assert.equal(x.state.dbReads,before);
 }finally{x.close();}
});
test('new Echo guest and logout are UI-only with no DB reads and no actual revocation',async()=>{
 const x=fixture();try{
  const n=x.state.dbReads;
  denyPrivilege(await x.guard.inspect(x.input('guest')),'guest');
  denyPrivilege(await x.guard.inspect(x.input('logout')),'reauth_required');
  assert.equal(x.state.dbReads,n);
  assert.equal(x.auth.prepare("SELECT revoked_at FROM starry_sessions WHERE session_id='s1'").get().revoked_at,null);
  assert.equal(x.echoUi.prepare('SELECT state FROM preview').get().state,'design_only');
 }finally{x.close();}
});
test('actual Auth Session and Echo local fixture membership still never authorizes login',async()=>{
 const x=fixture();try{
  const v=await x.guard.inspect(x.input('session',{session_ref:'s1'}));
  denyPrivilege(v,'auth_unverified');
  assert.equal(v.membership,'unverified');
  assert.equal(x.state.membershipReads,2);
  assert.match(R22_ECHO_MEMBERSHIP_SQL,/^SELECT /);
 }finally{x.close();}
});
test('missing/suspended/untrusted version App membership refuses privileges',async()=>{
 for(const sql of [
  'DELETE FROM echo_r22_membership_fixture',
  "UPDATE echo_r22_membership_fixture SET membership_status='suspended'",
  "UPDATE echo_r22_membership_fixture SET app_id='other'",
  'UPDATE echo_r22_membership_fixture SET member_auth_version=2'
 ]){
  const x=fixture();try{x.auth.exec(sql);
   denyPrivilege(await x.guard.inspect(x.input('session',{session_ref:'s1'})),'access_blocked');
  }finally{x.close();}
 }
});
test('revoked, expired and stale Auth version reject Session; other-app session denied',async()=>{
 for(const sql of [
  "UPDATE starry_sessions SET revoked_at="+now+" WHERE session_id='s1'",
  "UPDATE starry_sessions SET expires_at="+(now-1)+" WHERE session_id='s1'",
  "UPDATE starry_sessions SET auth_version=2 WHERE session_id='s1'"
 ]){
  const x=fixture();try{x.auth.exec(sql);
   denyPrivilege(await x.guard.inspect(x.input('session',{session_ref:'s1'})),'reauth_required');
  }finally{x.close();}
 }
 const x=fixture();try{
  denyPrivilege(await x.guard.inspect(x.input('session',{session_ref:'s2'})),'access_blocked');
 }finally{x.close();}
});
test('member fixture changes during double read, never grants privilege',async()=>{
 const x=fixture({onMemberRead:(s,db)=>{
  if(s.membershipReads===2)db.exec("UPDATE echo_r22_membership_fixture SET membership_status='suspended'");
 }});
 try{denyPrivilege(await x.guard.inspect(x.input('session',{session_ref:'s1'})),'access_blocked');}
 finally{x.close();}
});
test('lawful Session policy absent BEFORE read and Auth DB outage fail closed',async()=>{
 const x=fixture();try{
  x.state.sessionLawful=false;const count=x.state.dbReads;
  denyPrivilege(await x.guard.inspect(x.input('session',{session_ref:'s1'})),'access_blocked');
  assert.equal(x.state.dbReads,count);
  x.state.sessionLawful=true;x.state.outage=true;
  denyPrivilege(await x.guard.inspect(x.input('session',{session_ref:'s1'})),'access_blocked');
 }finally{x.close();}
});
test('real Auth local committed deletion is pending only and forged/expired claim blocked',async()=>{
 const x=fixture();try{
  x.commit();const claim=await x.issuer.claim(event);assert.ok(claim);
  const r=await x.guard.inspect(x.input('deletion'),claim);
  denyPrivilege(r,'deletion_pending');
  denyPrivilege(await x.guard.inspect(x.input('deletion'),{...claim}),'access_blocked');
  x.state.clock=now+31;
  denyPrivilege(await x.guard.inspect(x.input('deletion'),claim),'access_blocked');
 }finally{x.close();}
});
test('rollback / revoked lawful retention / late Session revoke refuse deletion success',async()=>{
 const x=fixture();try{
  x.auth.exec('BEGIN IMMEDIATE');x.commit();x.auth.exec('ROLLBACK');
  assert.equal(await x.issuer.claim(event),null);
  denyPrivilege(await x.guard.inspect(x.input('deletion'),{verified:true}),'access_blocked');
  x.commit();const claim=await x.issuer.claim(event);assert.ok(claim);
  x.state.retention=false;const reads=x.state.dbReads;
  denyPrivilege(await x.guard.inspect(x.input('deletion'),claim),'access_blocked');
  assert.equal(x.state.dbReads,reads);
  x.state.retention=true;
  x.auth.prepare("UPDATE starry_sessions SET revoked_at=? WHERE session_id='s2'").run(now+1);
  denyPrivilege(await x.guard.inspect(x.input('deletion'),claim),'access_blocked');
 }finally{x.close();}
});
