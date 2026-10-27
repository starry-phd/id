import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeletionChallengeVerifier,createServerIdentityResolver,
 planSelfDeletion} from '../src/index.ts';
import {createOfflineDeletionChallengeIssuer,LIVE_STARRY_DELETION_CHALLENGE_ISSUANCE}
 from '../src/round14-stepup-issuance.ts';
import {createOfflineOneUseAccountDeletion} from '../src/round13-one-use-deletion.ts';

const now=1793000000,scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const member={s_user_id:'s1',status:'active',auth_version:3,profile_revision:1,
 display_name:null,directory_opt_in:false,display_name_public:false};
const sess={session_id:'sid1',s_user_id:'s1',auth_version:3,
 app_id:'starry-id',environment:'staging',revoked_at:null,expires_at:now+200,
 step_up_method:'passkey',step_up_verified_at:now-5,step_up_expires_at:now+90};
async function principal(){
 const fn=createServerIdentityResolver({trusted_scope:scope,
  verify_oidc_or_session:async()=>({
   brand_id:'starry',app_id:'starry-id',environment:'staging',provider:'google',
   provider_subject:'canonical-id',s_user_id:'s1',session_id:'sid1',
   auth_version:3,expires_at:now+200}),
  read_member:async()=>member,read_session:async()=>sess,identity_matches:async()=>true,
 });
 return fn('backend-verified',now);
}
function port(s=sess,m=member,changes=1){
 const calls=[];
 const db={prepare(sql){
  const item={sql,args:[]};calls.push(item);
  return {bind(...args){item.args=args;return {
   first:async()=>{
    if(sql.includes('FROM starry_members WHERE'))
     return {...m,directory_opt_in:0,display_name_public:0};
    if(sql.includes('FROM starry_sessions WHERE'))return s;
    return null;
   },
   run:async()=>({success:true,meta:{changes}}),
  };}};
 }};
 return {calls,db};
}
test('off-by-default, forged WeakSet principal and foreign scope never touch DB',async()=>{
 assert.equal(LIVE_STARRY_DELETION_CHALLENGE_ISSUANCE,false);
 const p=await principal(),a=port();
 const inactive=createOfflineDeletionChallengeIssuer({scope,db:a.db});
 assert.equal(await inactive.issue(p,now),null);
 assert.equal(a.calls.length,0);
 const enabled=createOfflineDeletionChallengeIssuer({scope,db:a.db,enabled:true});
 assert.equal(await enabled.issue({...p},now),null);
 assert.equal(a.calls.length,0);
 for(const foreign of [{...scope,brand_id:'hglobal'},{...scope,environment:'production'}])
 assert.throws(()=>createOfflineDeletionChallengeIssuer({scope:foreign,db:a.db}),
  /DELETE_ISSUER_SCOPE_DENIED/);
});
test('verified current Session persists 256-bit challenge then mints original sealed deletion proof',async()=>{
 const p=await principal(),a=port();
 const proof=await createOfflineDeletionChallengeIssuer({scope,db:a.db,enabled:true}).issue(p,now);
 assert.ok(proof);
 assert.match(proof.challenge_ref,/^[a-f0-9]{64}$/);
 assert.equal(proof.expires_at,now+90);
 assert.equal(a.calls.length,3);
 assert.match(a.calls[2].sql,/INSERT INTO starry_deletion_challenges/);
 assert.match(a.calls[2].sql,/s.step_up_verified_at BETWEEN/);
 assert.equal(a.calls[2].args[0],proof.challenge_ref);
 assert.match(a.calls[2].args[1],/^starry-delete-[a-f0-9]{64}$/);
 assert.equal(a.calls[2].args.includes('canonical-id'),false);
 assert.equal(a.calls[2].args.includes('passkey-raw-secret'),false);
 assert.equal(planSelfDeletion(p,scope,member,proof,now).status,'deleted');
 assert.throws(()=>planSelfDeletion(p,scope,member,{...proof},now),
  /DELETE_CONFIRMATION_REQUIRED/);
});
test('stale/future/missing Step-up, revoked Session, mismatched Session and Member reject before write',async()=>{
 const p=await principal();
 for(const s of [
  {...sess,step_up_method:null},{...sess,step_up_verified_at:now-301},
  {...sess,step_up_verified_at:now+1},{...sess,step_up_expires_at:now},
  {...sess,revoked_at:now},{...sess,auth_version:4},
  {...sess,app_id:'other-star-app'},{...sess,expires_at:now},
 ]){
  const a=port(s);
  assert.equal(await createOfflineDeletionChallengeIssuer({scope,db:a.db,enabled:true}).issue(p,now),null);
  assert.equal(a.calls.filter(x=>x.sql.startsWith('INSERT')).length,0);
 }
 for(const m of [{...member,status:'deleted'},{...member,auth_version:4}]){
  const a=port(sess,m);
  assert.equal(await createOfflineDeletionChallengeIssuer({scope,db:a.db,enabled:true}).issue(p,now),null);
 }
});
test('insert lost/failed/zero rows means NO sealed challenge issued',async()=>{
 const p=await principal();
 for(const n of [0,2]){
  const a=port(sess,member,n);
  assert.equal(await createOfflineDeletionChallengeIssuer({scope,db:a.db,enabled:true}).issue(p,now),null);
 }
});
test('sealed proof is consumable by existing R13 only via one-use prepared SQL',async()=>{
 const p=await principal(),a=port();
 const proof=await createOfflineDeletionChallengeIssuer({scope,db:a.db,enabled:true}).issue(p,now);
 const g=createOfflineOneUseAccountDeletion({scope,db:a.db,enabled:true});
 assert.equal(await g.remove(p,proof,now),true);
 assert.match(a.calls.at(-1).sql,/UPDATE starry_deletion_challenges SET consumed_at=/);
 const forged=await createDeletionChallengeVerifier(async()=>({
  s_user_id:'s1',session_id:'sid1',expires_at:now+100,challenge_ref:'nothex'
 }))('untrusted');
 assert.equal(forged,null);
});
