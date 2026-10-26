import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerIdentityResolver, isTrustedPrincipal } from '../src/index.ts';
import {
  STARRY_BILLING_BRIDGE_VERSION, createStarryBillingAuthPortForRequest,
  isServerIssuedStarryBillingPort,
} from '../src/billing-bridge.ts';

const now=1780000000;
const trustedScope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const storeScope={...trustedScope,store:'apple',
  store_app_id:'phd.starry.id',store_environment:'sandbox'};
const token='server-verified-session-fixture';
const e={...trustedScope,provider:'apple',provider_subject:'apple-stable-sub',
  s_user_id:'s1',session_id:'s1-session',auth_version:4,expires_at:now+600};
const member={s_user_id:'s1',status:'active',auth_version:4,
  profile_revision:1,display_name:'Sample',directory_opt_in:false,display_name_public:false};
const session={session_id:'s1-session',s_user_id:'s1',auth_version:4,
  app_id:'starry-id',environment:'staging',expires_at:now+600,revoked_at:null,
  step_up_method:null,step_up_verified_at:null,step_up_expires_at:null};
const accountBinding='123e4567-e89b-42d3-a456-426614174000';
const binding={brand_id:'starry',s_user_id:'s1',app_id:'starry-id',environment:'staging',
  store:'apple',store_app_id:'phd.starry.id',store_environment:'sandbox',
  account_binding:accountBinding,revoked_at:null,expires_at:null};
function fixture(changes={}) {
  const cfg={e,member,session,scope:storeScope,binding,linked:true,
    clientToken:token,time:now,...changes};
  let t=cfg.time;
  let reads=0;
  const resolver=createServerIdentityResolver({
    trusted_scope:cfg.scope,
    verify_oidc_or_session:async req=>req===cfg.clientToken?cfg.e:null,
    read_member:async ()=>cfg.member,read_session:async ()=>cfg.session,
    identity_matches:async ()=>cfg.linked,
  });
  const deps={
    scope:cfg.scope,
    resolvePrincipal:resolver,
    readCurrentBinding:async key=>{reads++; return cfg.binding;},
    nowSeconds:()=>t,
  };
  return {deps, now:()=>t, setNow:n=>{t=n}, getReads:()=>reads};
}
const make=(cfg=fixture(),req=token)=>createStarryBillingAuthPortForRequest(cfg.deps,req);
test('version and WeakSet port prove backend-only mint, not client-side JSON',async()=>{
 assert.equal(STARRY_BILLING_BRIDGE_VERSION,'1.1.0-draft');
 const p=await make();
 assert.equal(isServerIssuedStarryBillingPort(p),true);
 assert.deepEqual(p.verifyCurrentIdentity(),{
   brandId:'starry',appId:'starry-id',environment:'staging',
   userId:'s1',accountBinding,
 });
 assert.equal(isServerIssuedStarryBillingPort({...p}),false);
 assert.equal(isServerIssuedStarryBillingPort(JSON.parse(JSON.stringify({role:'admin'}))),false);
 assert.equal(Object.isFrozen(p),true);
});
test('request flags, forged identity, client-supplied account binding cannot create port',async()=>{
 for(const request of [
   {s_user_id:'s1',verified:true,accountBinding,adminVerified:true},
   {userId:'s1',paid:true,app_id:'starry-id',environment:'staging'},
   {email:'x@demo.test',jwt:'unsigned',accountBinding}, null,
 ]) {
   const c=fixture();
   assert.equal(await make(c,request),null);
   assert.equal(c.getReads(),0);
 }
});
test('backend store key uses sealed member ID, app/runtime and store; no HTTP fields',async()=>{
 let captured=null;
 const c=fixture();
 c.deps.readCurrentBinding=async key=>{captured=key;return binding};
 const p=await make(c);
 assert.equal(p.verifyCurrentIdentity().userId,'s1');
 assert.deepEqual(captured,{s_user_id:'s1',app_id:'starry-id',environment:'staging',
   store:'apple',store_app_id:'phd.starry.id',store_environment:'sandbox'});
 assert.equal(Object.isFrozen(captured),true);
});
test('deny bad principal from custom callback (WeakSet, wrong user, app)',async()=>{
 const c=fixture();
 c.deps.resolvePrincipal=async ()=>({ ...e,member_status:'active',checked_at:now });
 assert.equal(await make(c),null);
 const foreign=await createServerIdentityResolver({
   trusted_scope:{brand_id:'starry',app_id:'other',environment:'staging'},
   verify_oidc_or_session:async()=>({...e,app_id:'other'}),
   read_member:async()=>member,
   read_session:async()=>({...session,app_id:'other'}),
   identity_matches:async()=>true,
 })(token,now);
 assert.equal(isTrustedPrincipal(foreign),true);
 c.deps.resolvePrincipal=async()=>foreign;
 assert.equal(await make(c),null);
});
test('suspended, deleted, revoked Session and stale auth_version fail closed',async()=>{
 for(const status of ['suspended','deleted'])
  assert.equal(await make(fixture({member:{...member,status}})),null);
 for(const mutation of [{revoked_at:now},{expires_at:now},{auth_version:5},
     {app_id:'another'},{environment:'production'}])
  assert.equal(await make(fixture({session:{...session,...mutation}})),null);
 assert.equal(await make(fixture({member:{...member,auth_version:5}})),null);
 assert.equal(await make(fixture({e:{...e,auth_version:5}})),null);
 assert.equal(await make(fixture({linked:false})),null);
});
test('cross brand/app/runtime and production Store/runtime denied',async()=>{
 for(const bad of [
  {store_environment:'production'},{environment:'production'},
  {store:'adversary'},{brand_id:'hglobal'},{app_id:'other'},
 ]) {
   await assert.rejects(async()=>make(fixture({scope:{...storeScope,...bad}})),
     /TRUSTED_STORE_REGISTRY_DENIED|INVALID_SERVER_SCOPE/);
 }
 for(const bad of [{brand_id:'hglobal'},{app_id:'other'},{environment:'production'}])
  assert.equal(await make(fixture({e:{...e,...bad}})),null);
});
test('deny foreign/revoked/expired binding or wrong Apple binding token',async()=>{
 for(const changed of [
   {s_user_id:'s2'}, {brand_id:'hglobal'},{app_id:'other'},
   {environment:'production'},{store:'google'},{store_environment:'production'},
   {store_app_id:'other-package'},{revoked_at:now},{expires_at:now},
   {account_binding:'client-from-http'}, {account_binding:'s1'},
 ]) {
   assert.equal(await make(fixture({binding:{...binding,...changed}})),null);
 }
});
test('Google scoped obfuscatedAccountId is opaque server record, not Apple UUID',async()=>{
 const c=fixture({scope:{...storeScope,store:'google',store_app_id:'phd.starry.android'},
   binding:{...binding,store:'google',store_app_id:'phd.starry.android',
     account_binding:'g_4d4f2b38b90fd51b'}});
 const p=await make(c);
 assert.equal(p.verifyCurrentIdentity().accountBinding,'g_4d4f2b38b90fd51b');
});
test('per-request auth port expires after 30s, not a reusable session token',async()=>{
 const c=fixture();
 const p=await make(c);
 assert.equal(p.verifyCurrentIdentity().userId,'s1');
 c.setNow(now+31);
 assert.equal(p.verifyCurrentIdentity(),null);
 c.setNow(now-1);
 assert.equal(p.verifyCurrentIdentity(),null);
});
test('reject expired verified session and slow binding backend / invalid clock',async()=>{
 assert.equal(await make(fixture({e:{...e,expires_at:now}})),null);
 const c=fixture();
 c.deps.readCurrentBinding=async()=>{c.setNow(now+31);return binding};
 assert.equal(await make(c),null);
 const bad=fixture();
 bad.deps.nowSeconds=()=>NaN;
 assert.equal(await make(bad),null);
});
test('cross-account binding replay never moves another user original transaction',async()=>{
 const c=fixture({binding:{...binding,account_binding:'123e4567-e89b-42d3-a456-426614174000',s_user_id:'other'}});
 assert.equal(await make(c),null);
 // AI-2 additionally checks originalTransactionId -> immutable owner on provider receipt.
});
