import test from 'node:test';
import assert from 'node:assert/strict';
import {createServerIdentityResolver,isTrustedPrincipal} from '../src/index.ts';
import {createOfflineFirstGiftPreflight,isInitialGiftEvidence} from '../src/round8-first-gift-guard.ts';
const now=1793000000;
const base={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const member={s_user_id:'s1',status:'active',auth_version:3,profile_revision:1,
  display_name:null,directory_opt_in:false,display_name_public:false};
async function mint(app_id='starry-id',m=member){
 const scope={...base,app_id},session={session_id:'sesh-1',s_user_id:'s1',app_id,
   environment:'staging',auth_version:3,expires_at:now+200,revoked_at:null,
   step_up_method:null,step_up_verified_at:null,step_up_expires_at:null};
 const auth=createServerIdentityResolver({trusted_scope:scope,
  verify_oidc_or_session:async()=>({brand_id:'starry',app_id,environment:'staging',
   provider:'apple',provider_subject:'canonical-sub',s_user_id:'s1',
   session_id:'sesh-1',auth_version:3,expires_at:now+100}),
  read_member:async()=>m,read_session:async()=>session,
  identity_matches:async()=>true});
 return auth('server-trusted-opaque',now);
}
async function setup(options={}){
 const key=options.hmacKey??await crypto.subtle.generateKey({
  name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const calls={privacy:0,identity:0,member:0,db:0,rawSubjects:[]};
 const db={prepare(sql){
  assert.match(sql,/FROM starry_first_gift_claims WHERE fingerprint=\?/);
  return {bind(fingerprint){
   calls.db++;
   assert.match(fingerprint,/^[a-f0-9]{64}$/);
   calls.rawSubjects.push(fingerprint);
   return {first:async()=>options.claimed===true?{claimed:1}:options.invalidRow?{claimed:0}:null};
  }};
 }};
 const deps={enabled:options.enabled??true,scope:options.scope??base,db,hmacKey:key,
  privacyApprovedNow:async()=>{calls.privacy++;return options.privacy??true;},
  readCanonicalSubject:async p=>{calls.identity++;return options.identity??{
   provider:'apple',subject:'opaque-real-provider-sub-01',s_user_id:p.s_user_id};
  },
  readCurrentMember:async()=>{calls.member++;return options.member??member;},
 };
 return {deps,key,calls,guard:createOfflineFirstGiftPreflight(deps)};
}
test('default-off or privacy denied MUST NOT query subject, create fingerprint or touch D1',async()=>{
 const p=await mint();
 for(const options of [{enabled:false},{privacy:false}]){
  const {guard,calls}=await setup(options);
  assert.deepEqual(await guard.check(p,now),{status:'BLOCKED'});
  assert.equal(calls.identity,0);assert.equal(calls.member,0);assert.equal(calls.db,0);
 }
});
test('legitimate verified Principal + current Member -> HMAC-only read-only preflight, NOT grant',async()=>{
 const p=await mint();
 assert.equal(isTrustedPrincipal(p),true);
 const {guard,calls}=await setup();
 const x=await guard.check(p,now);
 assert.equal(x.status,'UNCLAIMED_NOT_AUTHORIZED_TO_GRANT');
 assert.ok(isInitialGiftEvidence(x.evidence));
 assert.equal(isInitialGiftEvidence({...x.evidence}),false);
 assert.equal(x.evidence.brand_id,'starry');
 assert.equal('provider_subject' in x.evidence,false);
 assert.equal('grantApproved' in x.evidence,false);
 assert.equal(calls.db,1);
 assert.ok(!calls.rawSubjects[0].includes('provider'));
 assert.ok(!calls.rawSubjects[0].includes('opaque'));
});
test('already claimed is denied; malformed backend row and unavailable DB fail closed',async()=>{
 const p=await mint();
 assert.deepEqual(await (await setup({claimed:true})).guard.check(p,now),{status:'ALREADY_CLAIMED'});
 assert.deepEqual(await (await setup({invalidRow:true})).guard.check(p,now),{status:'BLOCKED'});
 const z=await setup();z.deps.db.prepare=()=>{throw Error('D1 unavailable')};
 // Frozen/injected db objects may fail modification in production; instead provide unavailable port.
 const bad=createOfflineFirstGiftPreflight({...z.deps,db:{prepare(){throw Error('unavailable')}}});
 assert.deepEqual(await bad.check(p,now),{status:'BLOCKED'});
});
test('same canonical login across two Starry apps yields SAME digest; different provider must differ',async()=>{
 const p=await mint(),app='starry-ai-bot';
 const p2=await mint(app);
 const shared=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const a=await setup({hmacKey:shared});
 const b=await setup({hmacKey:shared,scope:{...base,app_id:app}});
 const c=await setup({hmacKey:shared,identity:{provider:'google',subject:'opaque-real-provider-sub-01',s_user_id:'s1'}});
 assert.ok(isInitialGiftEvidence((await a.guard.check(p,now)).evidence));
 assert.ok(isInitialGiftEvidence((await b.guard.check(p2,now)).evidence));
 assert.notEqual((await c.guard.check(p,now)).status,'BLOCKED');
 assert.equal(a.calls.rawSubjects[0],b.calls.rawSubjects[0]);
 assert.notEqual(a.calls.rawSubjects[0],c.calls.rawSubjects[0]);
});
test('forged principal, stale session, altered version, revoked/deleted member or wrong identity denied',async()=>{
 const p=await mint();
 for(const options of [
  {member:{...member,status:'suspended'}},
  {member:{...member,status:'deleted'}},
  {member:{...member,auth_version:4}},
  {identity:{provider:'apple',subject:'s',s_user_id:'somebody-else'}},
  {identity:{provider:'apple',subject:'not/acceptable',s_user_id:'s1'}},
 ]){
  const x=await setup(options);
  assert.deepEqual(await x.guard.check(p,now),{status:'BLOCKED'});
  assert.equal(x.calls.db,0);
 }
 const x=await setup();
 assert.deepEqual(await x.guard.check({...p},now),{status:'BLOCKED'});
 assert.deepEqual(await x.guard.check({verified:true,s_user_id:'s1'},now),{status:'BLOCKED'});
 assert.deepEqual(await x.guard.check(p,now+101),{status:'BLOCKED'});
 assert.deepEqual(await x.guard.check(p,now-1),{status:'BLOCKED'});
});
test('foreign brand, production, insecure or extractable HMAC secret rejected',async()=>{
 const key=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const dep=(await setup({hmacKey:key})).deps;
 for(const scope of [{...base,brand_id:'hglobal'},{...base,environment:'production'},
    {...base,app_id:'invalid/app'}]){
  assert.throws(()=>createOfflineFirstGiftPreflight({...dep,scope}),/INITIAL_GIFT_SCOPE_DENIED/);
 }
 const extractable=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},true,['sign','verify']);
 assert.throws(()=>createOfflineFirstGiftPreflight({...dep,hmacKey:extractable}),/INITIAL_GIFT_SECRET_DENIED/);
 const weak=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:128},false,['sign','verify']);
 assert.throws(()=>createOfflineFirstGiftPreflight({...dep,hmacKey:weak}),/INITIAL_GIFT_SECRET_DENIED/);
});
