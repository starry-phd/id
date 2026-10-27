import test from 'node:test';
import assert from 'node:assert/strict';
import {createServerIdentityResolver,createDeletionChallengeVerifier}
 from '../src/index.ts';
import {createOfflineOneUseAccountDeletion,LIVE_ONE_USE_DELETION_ENABLED}
 from '../src/round13-one-use-deletion.ts';
const now=1793000000,scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const challengeRef='a'.repeat(64);
const member={s_user_id:'s1',status:'active',auth_version:3,profile_revision:1,
 display_name:null,directory_opt_in:false,display_name_public:false};
const session={session_id:'sess1',s_user_id:'s1',auth_version:3,app_id:'starry-id',
 environment:'staging',revoked_at:null,expires_at:now+100,
 step_up_method:'passkey',step_up_verified_at:now,step_up_expires_at:now+60};
async function setup(principalSession=session){
 const resolver=createServerIdentityResolver({trusted_scope:scope,
 verify_oidc_or_session:async()=>({brand_id:'starry',app_id:scope.app_id,
 environment:'staging',provider:'apple',provider_subject:'trusted-apple-sub',
 s_user_id:'s1',session_id:'sess1',auth_version:3,expires_at:now+100}),
 read_member:async()=>member,read_session:async()=>principalSession,identity_matches:async()=>true});
 const p=await resolver('opaque-server-verified',now);
 const mint=createDeletionChallengeVerifier(async()=>({
  s_user_id:'s1',session_id:'sess1',expires_at:now+60,challenge_ref:challengeRef,
 }));
 const proof=await mint('strong-two-factor-proof');
 return {p,proof};
}
function db(result={success:true,meta:{changes:1}},snapshot=member){
 const calls=[];
 return {calls,api:{prepare(sql){
  const e={sql,args:[]};calls.push(e);
  return {bind(...args){e.args=args;return {
   first:async()=>sql.includes('FROM starry_members WHERE')?{
    ...snapshot,directory_opt_in:0,display_name_public:0}:null,
   run:async()=>result,
  }};},
 };
 }}};
}
test('OFF by default, invalid brand/production or fabricated principal never write',async()=>{
 assert.equal(LIVE_ONE_USE_DELETION_ENABLED,false);
 const {p,proof}=await setup();const d=db();
 assert.equal(await createOfflineOneUseAccountDeletion({scope,db:d.api}).remove(p,proof,now),false);
 assert.equal(d.calls.length,0);
 const gate=createOfflineOneUseAccountDeletion({scope,db:d.api,enabled:true});
 assert.equal(await gate.remove({...p},proof,now),false);
 assert.equal(d.calls.length,0);
 for(const s of [{...scope,brand_id:'hglobal'},{...scope,environment:'production'}]){
  assert.throws(()=>createOfflineOneUseAccountDeletion({scope:s,db:d.api,enabled:true}),
   /ONE_USE_DELETE_SCOPE_DENIED/);
 }
});
test('single trusted challenge_ref triggers ONE prepared atomic statement, not 4 exposed writes',async()=>{
 const {p,proof}=await setup();const d=db();
 const gate=createOfflineOneUseAccountDeletion({scope,db:d.api,enabled:true});
 assert.equal(await gate.remove(p,proof,now),true);
 assert.equal(d.calls.length,2);
 assert.match(d.calls[0].sql,/FROM starry_members WHERE/);
 assert.match(d.calls[1].sql,/UPDATE starry_deletion_challenges SET consumed_at=\?/);
 assert.match(d.calls[1].sql,/consumed_at IS NULL/);
 assert.deepEqual(d.calls[1].args,[now,challengeRef,'s1','sess1',3,now,now]);
 assert.equal(d.calls.some(x=>x.args.includes('trusted-apple-sub')),false);
 assert.equal(d.calls.some(x=>x.sql.includes('UPDATE starry_sessions')),false);
});
test('replayed challenge, failed SQL, malformed change count and outages deny',async()=>{
 const {p,proof}=await setup();
 for(const result of [{success:true,meta:{changes:0}},
  {success:true,meta:{changes:2}},{success:false,meta:{changes:1}},
  {success:true,meta:{}},null]){
  const d=db(result);const g=createOfflineOneUseAccountDeletion({scope,db:d.api,enabled:true});
  assert.equal(await g.remove(p,proof,now),false);
 }
});
test('old challenge without server-verified random ref, forged object and bad ref deny',async()=>{
 const {p,proof}=await setup(),d=db();
 const g=createOfflineOneUseAccountDeletion({scope,db:d.api,enabled:true});
 assert.equal(await g.remove(p,{...proof},now),false);
 const old=await createDeletionChallengeVerifier(async()=>({
  s_user_id:'s1',session_id:'sess1',expires_at:now+60}))('trusted');
 assert.equal(await g.remove(p,old,now),false);
 const invalid=await createDeletionChallengeVerifier(async()=>({
  s_user_id:'s1',session_id:'sess1',expires_at:now+60,challenge_ref:'nothex'}))('trusted');
 assert.equal(invalid,null);
 assert.equal(d.calls.some(c=>c.sql.startsWith('UPDATE ')),false);
});
test('member already deleted, suspended, stale version and expired proof cannot consume',async()=>{
 const {p,proof}=await setup();
 for(const m of [{...member,status:'deleted'},{...member,status:'suspended'},
  {...member,auth_version:4}]){
  const d=db({success:true,meta:{changes:1}},m);
  assert.equal(await createOfflineOneUseAccountDeletion({scope,db:d.api,enabled:true})
   .remove(p,proof,now),false);
  assert.equal(d.calls.filter(x=>x.sql.startsWith('UPDATE ')).length,0);
 }
 const d=db();
 assert.equal(await createOfflineOneUseAccountDeletion({scope,db:d.api,enabled:true})
  .remove(p,proof,now+61),false);
 assert.equal(d.calls.length,0);
});
test('invalid principal and missing proof never writes; user/session scope binds in trigger',async()=>{
 const {p,proof}=await setup(),d=db();
 const gate=createOfflineOneUseAccountDeletion({scope,db:d.api,enabled:true});
 assert.equal(await gate.remove(p,null,now),false);
 assert.equal(await gate.remove(p,proof,-1),false);
 assert.equal(await gate.remove(p,proof,now+101),false);
 assert.equal(d.calls.filter(x=>x.sql.startsWith('UPDATE ')).length,0);
});
