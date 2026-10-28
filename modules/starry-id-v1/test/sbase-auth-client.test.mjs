import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createOfflineCandidateAuthUI} from '../src/round21-candidate-ui-auth-state.ts';
import {createOfflineCanonicalAuthDeletionPublisher}
 from '../src/round16-canonical-deletion-publisher.ts';
import {createOfflineStarryAuthClient,STARRY_AUTH_CLIENT_VERSION,
 STARRY_AUTH_CLIENT_SCHEMA,STARRY_AUTH_CLIENT_LIVE_ENABLED,
 STARRY_AUTH_CLIENT_SERVER_AUTHORIZED} from '../src/sbase-auth-client.ts';

const now=1793000000,ev='starry-delete-'+'a'.repeat(64);
function setup(custom={}){
 const auth=new DatabaseSync(':memory:'),uiDb=new DatabaseSync(':memory:');
 auth.exec('PRAGMA foreign_keys=ON');
 for(const filename of ['001_starry_identity.DRAFT.sql',
  '007_starry_age_deletion_admin.UP.DRAFT.sql',
  '011_starry_one_use_deletion.UP.DRAFT.sql',
  '012_starry_stepup_challenge_scope.UP.DRAFT.sql',
  '013_starry_deletion_source_immutability.UP.DRAFT.sql'])
  auth.exec(readFileSync(new URL('../schema/'+filename,import.meta.url),'utf8'));
 auth.exec(readFileSync(new URL('./fixtures/round16_auth_dispatch_lease.DRAFT.sql',import.meta.url),'utf8'));
 auth.prepare("INSERT INTO starry_members VALUES('u1','active',3,1,'fake private',0,0,?,?)").run(now,now);
 const ins=auth.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
 ins.run('s1','u1','app-a','staging',3,'a'.repeat(64),now+120,'passkey',now-5,now+60);
 ins.run('s2','u1','app-b','staging',3,'b'.repeat(64),now+120,null,null,null);
 uiDb.exec("CREATE TABLE preview_ui (name TEXT, state TEXT)");
 uiDb.exec("INSERT INTO preview_ui VALUES('screen','guest')");
 const state={reads:0,sessionCalls:0,deletionCalls:0,now,legal:true,retention:true,
  sessionLegal:true,policy:'policy-sbase',down:false,claim:null};
 const scope={brand_id:'starry',app_id:'app-a',environment:'staging',platform:'ios'};
 const authScope={brand_id:'starry',environment:'staging'};
 const db={prepare(sql){state.reads++;return {bind(...args){return {first:async()=>{
  if(state.down)throw Error('DB unavailable');
  return auth.prepare(sql).get(...args)??null;
 }};}};}};
 const legal=async()=>state.legal,retention=async()=>state.retention,
  sessionLegal=async()=>state.sessionLegal,policy=async()=>state.policy,
  clock=()=>state.now;
 const candidate=createOfflineCandidateAuthUI({enabled:true,scope:authScope,
  authDb:db,lawfulSessionReadApprovedNow:sessionLegal,
  lawfulDeletionProcessingApprovedNow:legal,
  lawfulMinimalRetentionApprovedNow:retention,
  readApprovedPolicyRevisionNow:policy,readServerNow:clock});
 const issuer=createOfflineCanonicalAuthDeletionPublisher({enabled:true,
  scope:authScope,db,lawfulDeletionProcessingApprovedNow:legal,
  readServerNow:clock});
 const observed=(candidate_ui,ctx)=>({
  scope:custom.foreignScope??scope,
  observed_scopes:custom.seenScopes??['profile:read'],
  candidate_ui
 });
 const ports={
  async readSessionCandidate(ctx){
   state.sessionCalls++;
   if(custom.offline)throw Error('no network');
   if(custom.forged)return custom.forged;
   return observed(await candidate.project({screen:'HOME',mode:'session',
    scope:authScope,app_id:'app-a',session_ref:'s1'}),ctx);
  },
  async readDeletionCandidate(ctx){
   state.deletionCalls++;
   if(custom.offline)throw Error('no network');
   if(custom.forged)return custom.forged;
   return observed(await candidate.project({screen:'DELETE_ACCOUNT',mode:'deletion',
    scope:authScope},state.claim),ctx);
  }
 };
 const cfg={serverOwnedScope:scope,candidateAllowedScopes:['profile:read'],
  ports,enabled:true};
 const client=createOfflineStarryAuthClient(cfg);
 const request=()=>({scope,requested_scopes:['profile:read']});
 function commit(){
  auth.prepare('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?,?,?,NULL)')
   .run('a'.repeat(64),'u1','s1',3,ev,now,now+60);
  assert.equal(auth.prepare('UPDATE starry_deletion_challenges SET consumed_at=? WHERE challenge_ref=? AND consumed_at IS NULL')
   .run(now,'a'.repeat(64)).changes,1);
 }
 return {client,cfg,state,request,ports,auth,uiDb,issuer,commit,
  close(){auth.close();uiDb.close();}};
}
function noPrivilege(r,expected){
 assert.equal(r.schema_version,STARRY_AUTH_CLIENT_SCHEMA);
 assert.equal(r.client_version,STARRY_AUTH_CLIENT_VERSION);
 assert.equal(r.status,expected);
 for(const k of ['authenticated','private_access_authorized','may_grant',
  'may_write','may_ack_queue','may_restore','global_deletion_confirmed','live'])
  assert.equal(r[k],false,k);
 const json=JSON.stringify(r);
 for(const secret of ['u1','s1','fake private','refresh_hash','_authToken',
  'member_ref','starry-delete-','OAuth subject','Bearer'])
  assert.equal(json.includes(secret),false,secret);
}
test('client disabled by default and no official backend entitlement',async()=>{
 assert.equal(STARRY_AUTH_CLIENT_LIVE_ENABLED,false);
 assert.equal(STARRY_AUTH_CLIENT_SERVER_AUTHORIZED,false);
 const x=setup();try{
  const off=createOfflineStarryAuthClient({...x.cfg,enabled:undefined});
  noPrivilege(off.guest(x.request()),'blocked');
  noPrivilege(await off.getSession(x.request()),'blocked');
  assert.equal(x.state.sessionCalls,0);
  assert.equal(x.state.reads,0);
 }finally{x.close();}
});
test('public Guest has zero server DB/port reads; sign-in and logout are not credential operations',async()=>{
 const x=setup();try{
  const n=x.state.reads;
  noPrivilege(x.client.guest(x.request()),'guest');
  noPrivilege(x.client.beginSignIn(x.request()),'blocked');
  noPrivilege(x.client.signOut(x.request()),'reauth_required');
  assert.equal(x.state.reads,n);
  assert.equal(x.state.sessionCalls,0);
  assert.equal(x.uiDb.prepare('SELECT state FROM preview_ui').get().state,'guest');
  assert.equal(x.auth.prepare("SELECT revoked_at FROM starry_sessions WHERE session_id='s1'").get().revoked_at,null);
 }finally{x.close();}
});
test('real Starry Auth Session current still returns UNVERIFIED with NO access',async()=>{
 const x=setup();try{
  const got=await x.client.getSession(x.request());
  noPrivilege(got,'session_unverified');
  assert.equal(got.reason,'NO_OFFICIAL_AUTH_PROOF');
  assert.equal(x.state.sessionCalls,1);
  assert.ok(x.state.reads>0);
 }finally{x.close();}
});
test('revoked, expired and stale-version sessions cannot be promoted',async()=>{
 for(const sql of [
  "UPDATE starry_sessions SET revoked_at="+now+" WHERE session_id='s1'",
  "UPDATE starry_sessions SET expires_at="+(now-1)+" WHERE session_id='s1'",
  "UPDATE starry_sessions SET auth_version=2 WHERE session_id='s1'"
 ]){
  const x=setup();try{x.auth.exec(sql);
   noPrivilege(await x.client.getSession(x.request()),'reauth_required');
  }finally{x.close();}
 }
});
test('cross brand/app/environment/platform, unknown scopes and old Web token denied before port',async()=>{
 const x=setup();try{
  const bad=[
   {...x.request(),scope:{...x.request().scope,brand_id:'hglobal'}},
   {...x.request(),scope:{...x.request().scope,app_id:'app-b'}},
   {...x.request(),scope:{...x.request().scope,environment:'production'}},
   {...x.request(),scope:{...x.request().scope,platform:'android'}},
   {...x.request(),requested_scopes:['billing:write']},
   {...x.request(),requested_scopes:['profile:read','profile:read']},
   {...x.request(),token:'legacy-web-bearer'},
   {...x.request(),member_ref:'u1'},
   {...x.request(),cookie:'legacy-auth'}
  ];
  for(const q of bad)noPrivilege(await x.client.getSession(q),'blocked');
  assert.equal(x.state.reads,0);assert.equal(x.state.sessionCalls,0);
 }finally{x.close();}
});
test('untrusted response cannot elevate identity, spoof scopes or foreign platform',async()=>{
 for(const custom of [
  {forged:{authenticated:true,scope:{brand_id:'starry',app_id:'app-a',
   environment:'staging',platform:'ios'}}},
  {seenScopes:['other:read']},
  {foreignScope:{brand_id:'starry',app_id:'app-b',environment:'staging',platform:'ios'}},
  {foreignScope:{brand_id:'starry',app_id:'app-a',environment:'staging',platform:'android'}}
 ]){
  const x=setup(custom);try{
   noPrivilege(await x.client.getSession(x.request()),'blocked');
  }finally{x.close();}
 }
});
test('offline service errors safely isolate non-private guest and refuse private screen',async()=>{
 const x=setup({offline:true});try{
  noPrivilege(x.client.guest(x.request()),'guest');
  const got=await x.client.getSession(x.request());
  noPrivilege(got,'unavailable');
  assert.equal(got.reason,'AUTH_SERVICE_UNAVAILABLE');
  noPrivilege(await x.client.getDeletionStatus(x.request()),'unavailable');
 }finally{x.close();}
});
test('original committed Auth deletion + R16 sealed lease yields pending not global completion',async()=>{
 const x=setup();try{
  x.commit();x.state.claim=await x.issuer.claim(ev);assert.ok(x.state.claim);
  const view=await x.client.getDeletionStatus(x.request());
  noPrivilege(view,'deletion_pending');
  assert.equal(view.reason,'DELETION_NOT_GLOBAL');
  assert.equal(x.uiDb.prepare('SELECT COUNT(*) AS n FROM preview_ui').get().n,1);
  x.state.now=now+31;
  noPrivilege(await x.client.getDeletionStatus(x.request()),'blocked');
 }finally{x.close();}
});
test('legal deletion retention revoked blocks global claim without sensitive write',async()=>{
 const x=setup();try{
  x.commit();x.state.claim=await x.issuer.claim(ev);assert.ok(x.state.claim);
  x.state.retention=false;
  noPrivilege(await x.client.getDeletionStatus(x.request()),'blocked');
  assert.equal(x.auth.prepare('SELECT COUNT(*) AS n FROM starry_deletion_outbox').get().n,1);
 }finally{x.close();}
});
