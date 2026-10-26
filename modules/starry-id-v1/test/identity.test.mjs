import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_VERSION, CROSS_BRAND_SYNC_ENABLED, createServerIdentityResolver, isTrustedPrincipal,
  readSelf, planSelfUpdate, publicDirectoryProjection, requireMemberAdmin,
  createDeletionChallengeVerifier, planSelfDeletion,
} from '../src/index.ts';
const now=1780000000;
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const e={brand_id:'starry',app_id:'starry-id',environment:'staging',provider:'google',
  provider_subject:'google-sub-xyz',s_user_id:'s-001',session_id:'sid',auth_version:3,expires_at:now+600};
const m={s_user_id:'s-001',status:'active',auth_version:3,profile_revision:2,
  display_name:'Example',directory_opt_in:false,display_name_public:false};
const s={session_id:'sid',s_user_id:'s-001',auth_version:3,app_id:'starry-id',environment:'staging',
  expires_at:now+600,revoked_at:null,step_up_method:'passkey',step_up_verified_at:now-70,
  step_up_expires_at:now+100};
const g={s_user_id:'s-001',brand_id:'starry',app_id:'starry-id',environment:'staging',
  permission:'member:suspend',revoked_at:null,expires_at:now+600};
const authenticated='ONLY_BACKEND_VERIFIED_SESSION_TEST_FIXTURE';
function resolver(overrides={}) {
 const d={e,m,s,linked:true,scope,...overrides};
 return createServerIdentityResolver({
   trusted_scope:d.scope,
   verify_oidc_or_session:async req=>req===authenticated?d.e:null,
   read_member:async ()=>d.m,read_session:async ()=>d.s,
   identity_matches:async ()=>d.linked,
 });
}
const principal=async (o={}) => resolver(o)(authenticated,now);
test('Starry contract version and disabled cross-brand sync',()=>{
 assert.equal(CONTRACT_VERSION,'1.0.0-draft');assert.equal(CROSS_BRAND_SYNC_ENABLED,false);
});
test('valid trusted principal and self read, default directory private',async()=>{
 const p=await principal();assert.equal(isTrustedPrincipal(p),true);
 assert.deepEqual(readSelf(p,scope,m,now),{s_user_id:'s-001',display_name:'Example',
 directory_opt_in:false,display_name_public:false,profile_revision:2});
 assert.equal(publicDirectoryProjection(m),null);
});
test('HTTP JSON/adminVerified/email cannot forge principal',async()=>{
 const p=await principal();
 for(const fake of [{...p},{adminVerified:true,brand_id:'starry',s_user_id:'s-001'},
  JSON.parse(JSON.stringify(p))]){
   assert.equal(isTrustedPrincipal(fake),false);
   assert.throws(()=>readSelf(fake,scope,m,now),/IDENTITY_DENIED/);
 }
 assert.equal(await resolver()({adminVerified:true,email:'user@example.com'},now),null);
});
test('missing/foreign provider identity, suspended/deleted member denied',async()=>{
 assert.equal(await principal({linked:false}),null);
 for(const status of ['suspended','deleted']) assert.equal(await principal({m:{...m,status}}),null);
 for(const provider of ['evil','']) assert.equal(await principal({e:{...e,provider}}),null);
});
test('revoked/expired/foreign session, mismatched auth versions denied',async()=>{
 for(const x of [{revoked_at:now},{expires_at:now},{s_user_id:'other'},
  {auth_version:4},{app_id:'other'}, {environment:'production'}])
  assert.equal(await principal({s:{...s,...x}}),null);
 assert.equal(await principal({m:{...m,auth_version:4}}),null);
 assert.equal(await principal({e:{...e,auth_version:4}}),null);
});
test('cross brand, app, runtime env and expired trusted evidence denied',async()=>{
 for(const k of [{brand_id:'hglobal'},{app_id:'other'},{environment:'production'},
  {expires_at:now}])assert.equal(await principal({e:{...e,...k}}),null);
 const p=await principal();
 for(const change of [{app_id:'other'},{environment:'production'},{brand_id:'hglobal'}])
  assert.throws(()=>readSelf(p,{...scope,...change},m,now),/IDENTITY_DENIED/);
 assert.throws(()=>readSelf(p,scope,m,now+61),/IDENTITY_DENIED/);
});
test('cannot access another user profile or revoked profile version',async()=>{
 const p=await principal();
 assert.throws(()=>readSelf(p,scope,{...m,s_user_id:'other'},now),/MEMBER_DENIED/);
 assert.throws(()=>readSelf(p,scope,{...m,auth_version:4},now),/MEMBER_DENIED/);
});
test('self update rejects id/role/status injection and stale revision',async()=>{
 const p=await principal();
 for(const input of [{s_user_id:'other'},{status:'active'}, {adminVerified:true},
  {email:'private@example.com'}, {display_name:'Bad\nName'}, {directory_opt_in:'true'},{}]){
  assert.throws(()=>planSelfUpdate(p,scope,m,2,input,now),/PROFILE_FIELDS_DENIED/);
 }
 assert.throws(()=>planSelfUpdate(p,scope,m,3,{display_name:'New'},now),/PROFILE_VERSION_CONFLICT/);
});
test('explicit opt-in directory and compare-and-swap profile revision',async()=>{
 const p=await principal();
 const n=planSelfUpdate(p,scope,m,2,{display_name:'Alias',
  directory_opt_in:true,display_name_public:true},now);
 assert.equal(n.profile_revision,3);assert.equal(m.profile_revision,2);
 assert.deepEqual(publicDirectoryProjection(n),{s_user_id:'s-001',display_name:'Alias'});
 assert.equal(publicDirectoryProjection({...n,status:'suspended'}),null);
 assert.equal(publicDirectoryProjection({...n,directory_opt_in:false}),null);
 assert.equal(publicDirectoryProjection({...n,display_name_public:false}),null);
});
test('admin only exact scoped grant and verified backend persisted step-up',async()=>{
 const p=await principal();
 assert.doesNotThrow(()=>requireMemberAdmin(p,scope,s,g,'suspend',now));
 for(const changed of [{brand_id:'hglobal'},{app_id:'other'},{environment:'production'},
  {s_user_id:'other'},{permission:'member:restore'},{revoked_at:now},{expires_at:now}])
  assert.throws(()=>requireMemberAdmin(p,scope,s,{...g,...changed},'suspend',now),/ADMIN_SCOPE_DENIED/);
 assert.throws(()=>requireMemberAdmin(p,scope,s,null,'suspend',now),/ADMIN_SCOPE_DENIED/);
});
test('admin step-up Passkey/TOTP source persisted, stale/expired/missing denied',async()=>{
 const p=await principal();
 for(const changed of [{step_up_method:null},{step_up_method:'sms'},
  {step_up_verified_at:null},{step_up_verified_at:now-301},
  {step_up_verified_at:now+1},{step_up_expires_at:now},
  {revoked_at:now},{session_id:'other'}]){
  assert.throws(()=>requireMemberAdmin(p,scope,{...s,...changed},g,'suspend',now),
    /STEP_UP_REQUIRED|SESSION_DENIED/);
 }
 assert.doesNotThrow(()=>requireMemberAdmin(p,scope,{...s,step_up_method:'totp'},g,'suspend',now));
});
test('self deletion requires separately backend verified and scoped confirmation',async()=>{
 const p=await principal();
 const confirm=createDeletionChallengeVerifier(async token=>token==='verified-on-server'
  ? {s_user_id:'s-001',session_id:'sid',expires_at:now+60}:null);
 assert.equal(await confirm('fake'),null);
 assert.throws(()=>planSelfDeletion(p,scope,m,{s_user_id:'s-001',session_id:'sid',expires_at:now+60},now),
  /DELETE_CONFIRMATION_REQUIRED/);
 const ticket=await confirm('verified-on-server');
 const deleted=planSelfDeletion(p,scope,m,ticket,now);
 assert.equal(deleted.status,'deleted');assert.equal(deleted.auth_version,4);
 assert.equal(deleted.display_name,null);assert.equal(publicDirectoryProjection(deleted),null);
 assert.equal(await principal({m:deleted}),null);
});
test('cross-account confirmation and expired proof denied',async()=>{
 const p=await principal();
 const verifier=createDeletionChallengeVerifier(async ()=>({s_user_id:'other',session_id:'sid',expires_at:now+60}));
 const foreignProof=await verifier('x');
 assert.throws(()=>planSelfDeletion(p,scope,m,foreignProof,now),/DELETE_CONFIRMATION_REQUIRED/);
 const short=createDeletionChallengeVerifier(async ()=>({s_user_id:'s-001',session_id:'sid',expires_at:now}));
 const expiredProof=await short('x');
 assert.throws(()=>planSelfDeletion(p,scope,m,expiredProof,now),/DELETE_CONFIRMATION_REQUIRED/);
});
