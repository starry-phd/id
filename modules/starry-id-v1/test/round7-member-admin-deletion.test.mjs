import test from 'node:test';
import assert from 'node:assert/strict';
import {createServerIdentityResolver,createDeletionChallengeVerifier,isTrustedPrincipal} from '../src/index.ts';
import {createOfflineStarryAccountDeletion} from '../src/round7-deletion.ts';
import {createOfflineStarryAdminAuthority} from '../src/round7-admin.ts';
const now=1793000000,scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
function sample(){
 const member={s_user_id:'s1',status:'active',auth_version:3,profile_revision:1,display_name:'test',
  directory_opt_in:false,display_name_public:false};
 const session={session_id:'sess1',s_user_id:'s1',app_id:'starry-id',environment:'staging',
  auth_version:3,expires_at:now+300,revoked_at:null,
  step_up_method:'passkey',step_up_verified_at:now,step_up_expires_at:now+60};
 return {member,session};
}
async function mint(member,session){
 const resolve=createServerIdentityResolver({trusted_scope:scope,
  verify_oidc_or_session:async()=>({brand_id:'starry',app_id:'starry-id',environment:'staging',
    provider:'apple',provider_subject:'apple-sub',s_user_id:'s1',session_id:'sess1',auth_version:3,expires_at:now+100}),
  read_member:async()=>member,read_session:async()=>session,identity_matches:async()=>true});
 return resolve('opaque-verified-session',now);
}
function fakeDb(member,{role='supreme',status='active',batchResult=[1,2,1]}={}){
 const calls=[],pending=[];
 const db={prepare(sql){
  return {bind(...args){
   const entry={sql,args};calls.push(entry);
   const p={...entry,first:async()=>{
    if(sql.includes('FROM starry_members WHERE'))return {
     ...member,directory_opt_in:Number(member.directory_opt_in),display_name_public:Number(member.display_name_public)};
    if(sql.includes('FROM starry_admin_roles a'))return {role,revoked_at:null,version:3};
    return null;
   },run:async()=>({success:true,meta:{changes:1}})};
   pending.push(p);return p;
  }};
 },batch:async stmts=>{assert.equal(stmts.length,3);
    if(status==='throw')throw Error('transaction rollback');
    return batchResult.map(n=>({success:status==='failure'?false:true,meta:{changes:n}}));
  }};
 return {db,calls,pending};
}
test('single verified deletion challenge, CAS, Starry-wide revoke and append-only event',async()=>{
 const {member,session}=sample(),p=await mint(member,session);
 assert.equal(isTrustedPrincipal(p),true);
 const proof=await createDeletionChallengeVerifier(async()=>({s_user_id:'s1',session_id:'sess1',expires_at:now+100}))('server-step-up-proof');
 const f=fakeDb(member);
 const gate=createOfflineStarryAccountDeletion({scope,enabled:true,db:f.db});
 assert.equal(await gate.remove(p,proof,'deletion-event-unique-0001',now),true);
 assert.equal(f.calls.length,4);
 const writes=f.calls.slice(1);
 assert.match(writes[0].sql,/status='active' AND auth_version=\? AND profile_revision=\?/);
 assert.match(writes[1].sql,/WHERE s_user_id=\? AND revoked_at IS NULL/);
 assert.match(writes[2].sql,/NOT EXISTS/);
 assert.equal(writes[0].args[0],4);
 assert.equal(writes[2].args[2],'s1');
 assert.equal(writes[0].args.includes('apple-sub'),false);
});
test('cannot delete from unsigned JSON, wrong challenge, off state or arbitrary app',async()=>{
 const {member,session}=sample(),p=await mint(member,session),f=fakeDb(member);
 const valid=await createDeletionChallengeVerifier(async()=>({s_user_id:'s1',session_id:'sess1',expires_at:now+100}))('proof');
 const disabled=createOfflineStarryAccountDeletion({scope,db:f.db});
 assert.equal(await disabled.remove(p,valid,'deletion-event-unique-0002',now),false);
 const g=createOfflineStarryAccountDeletion({scope,enabled:true,db:f.db});
 assert.equal(await g.remove({...p},valid,'deletion-event-unique-0002',now),false);
 assert.equal(await g.remove(p,{...valid},'deletion-event-unique-0002',now),false);
 assert.equal(await g.remove(p,valid,'short',now),false);
 assert.equal(await g.remove(p,valid,'deletion-event-unique-0002',now+500),false);
 assert.equal(f.calls.length,0);
});
test('denied on suspended, auth-version mismatch, already deleted, or failing batch',async()=>{
 const {member,session}=sample(),p=await mint(member,session);
 const proof=await createDeletionChallengeVerifier(async()=>({s_user_id:'s1',session_id:'sess1',expires_at:now+100}))('proof');
 for(const mutated of [{...member,status:'suspended'},{...member,status:'deleted'},{...member,auth_version:4},
  {...member,profile_revision:Number.MAX_SAFE_INTEGER}]){
  const f=fakeDb(mutated);
  assert.equal(await createOfflineStarryAccountDeletion({scope,enabled:true,db:f.db}).remove(p,proof,'deletion-event-unique-0004',now),false);
 }
 for(const cfg of [{batchResult:[0,2,0]},{batchResult:[1,2,0]},{status:'throw'},{status:'failure'}]){
  const f=fakeDb(member,cfg);
  assert.equal(await createOfflineStarryAccountDeletion({scope,enabled:true,db:f.db}).remove(p,proof,'deletion-event-unique-0005',now),false);
 }
});
test('protected sole supreme admin requires fresh backend current Session and step-up',async()=>{
 const {member,session}=sample(),p=await mint(member,session);
 const f=fakeDb(member);
 const g=createOfflineStarryAdminAuthority({scope,db:f.db,enabled:true,readCurrentSession:async()=>session});
 assert.equal(await g.permit(p,'member:delete',now),true);
 assert.equal(await g.permit(p,'battery:adjust',now),true);
 assert.equal(await g.permit({...p},'member:delete',now),false);
 assert.equal(await g.permit(p,'member:delete',now+301),false);
 assert.equal(await createOfflineStarryAdminAuthority({scope,enabled:false,db:f.db,readCurrentSession:async()=>session}).permit(p,'member:delete',now),false);
 for(const sess of [{...session,revoked_at:now},{...session,auth_version:4},{...session,environment:'production'},
  {...session,step_up_method:null},{...session,step_up_expires_at:now},{...session,step_up_verified_at:now-301}]){
  const u=createOfflineStarryAdminAuthority({scope,db:f.db,enabled:true,readCurrentSession:async()=>sess});
  assert.equal(await u.permit(p,'member:delete',now),false);
 }
});
test('delegated role grants NO implicit privilege until fine-grained policy gate',async()=>{
 const {member,session}=sample(),p=await mint(member,session);
 const f=fakeDb(member,{role:'delegated'});
 const g=createOfflineStarryAdminAuthority({scope,enabled:true,db:f.db,readCurrentSession:async()=>session});
 assert.equal(await g.permit(p,'member:suspend',now),false);
 assert.equal(await g.permit(p,'member:delete',now),false);
 for(const s of [{...scope,brand_id:'hglobal'},{...scope,environment:'production'}]){
  assert.throws(()=>createOfflineStarryAdminAuthority({scope:s,db:f.db,readCurrentSession:async()=>session}),/ADMIN_AUTH_SCOPE_DENIED/);
  assert.throws(()=>createOfflineStarryAccountDeletion({scope:s,db:f.db}),/DELETE_SCOPE_DENIED/);
 }
});
