import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemberReadContract} from '../src/member-contract.ts';
import {handleRequest} from '../src/index.ts';
import {createEphemeralTestKey,signTestSession,createTestHmacVerifier} from '../test-support/session-hmac.ts';
import {createMemberPreviewSdk} from '../../../packages/sdk/src/member-preview.ts';
import {createServerIdentityResolver} from '../../../modules/starry-id-v1/src/index.ts';
import {createStarryBillingAuthPortForRequest} from '../../../modules/starry-id-v1/src/billing-bridge.ts';

const now=Math.floor(Date.parse('2026-10-26T09:00:00Z')/1000);
const scope=Object.freeze({brand_id:'starry',app_id:'starry-id',environment:'staging'});
const evidence=Object.freeze({...scope,provider:'apple',provider_subject:'stable-apple-sub',
 s_user_id:'s_member1',session_id:'session1',auth_version:2,expires_at:now+600});
const member=Object.freeze({s_user_id:'s_member1',status:'active',auth_version:2,
 profile_revision:5,display_name:'Own Private Name',directory_opt_in:false,display_name_public:false});
const session=Object.freeze({session_id:'session1',s_user_id:'s_member1',auth_version:2,
 app_id:'starry-id',environment:'staging',expires_at:now+600,revoked_at:null,
 step_up_method:null,step_up_verified_at:null,step_up_expires_at:null});
async function fixture(){
 const key=await createEphemeralTestKey();
 const state={now,member:{...member},session:{...session},linked:true};
 const deps={trusted_scope:scope,verify_oidc_or_session:createTestHmacVerifier(key),
  read_member:async()=>state.member,read_session:async()=>state.session,
  identity_matches:async()=>state.linked,nowSeconds:()=>state.now};
 const handler=createMemberReadContract(deps);
 const token=await signTestSession(key,evidence);
 const request=(path='/v1/member/self',bearer=token,method='GET')=>
  new Request('https://api.example.invalid'+path,{
   method,headers:{authorization:'Bearer '+bearer}});
 return {key,token,state,deps,handler,request};
}
test('third-round real transport slice: signed request → AI-1 principal → Worker → typed SDK',async()=>{
 const f=await fixture();
 let calls=0;
 const sdk=createMemberPreviewSdk('https://api.example.invalid',async()=>f.token,
  async(url,init)=>{
   calls++;
   assert.equal(url,'https://api.example.invalid/v1/member/self');
   assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
   assert.equal(init.credentials,'omit');
   return f.handler(new Request(url,init));
  });
 const p=await sdk.readSelf();
 assert.deepEqual(p,{s_user_id:'s_member1',display_name:'Own Private Name',
  directory_opt_in:false,display_name_public:false,profile_revision:5});
 assert.equal(calls,1);
});
test('live Worker entrypoint has NO member route and only liveness',async()=>{
 const f=await fixture();
 assert.equal(handleRequest(f.request(),{STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'}).status,404);
 assert.equal(handleRequest(new Request('https://api.example.invalid/v1/health'),
  {STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'}).status,200);
});
test('invalid signature, modified token, missing bearer and client-faked membership rejected',async()=>{
 const f=await fixture();
 const otherKey=await createEphemeralTestKey();
 const foreign=await signTestSession(otherKey,evidence);
 const fake='v1.fake.unsafe';
 for(const token of [foreign,fake,'',f.token.slice(0,-8)+'forgery']){
  assert.equal((await f.handler(f.request('/v1/member/self',token))).status,401);
 }
 assert.equal((await f.handler(new Request('https://api.example.invalid/v1/member/self',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
   adminVerified:true,s_user_id:'s_member1',verified:true
  })}))).status,405);
 assert.equal((await f.handler(new Request('https://api.example.invalid/v1/member/self',{
  headers:{'x-admin-verified':'true',authorization:'Bearer '+f.token}
 }))).status,400);
 assert.equal((await f.handler(f.request('/v1/member/self?user_id=s_member1'))).status,400);
 assert.equal((await f.handler(new Request('https://api.example.invalid/v1/member/self',{
  headers:{authorization:'Bearer '+f.token,cookie:'session=forged'}
 }))).status,400);
});
test('revoke/expire session or suspend/delete user then current server lookup denies existing signed token',async()=>{
 for(const x of [{session:{...session,revoked_at:now}},
  {session:{...session,expires_at:now}},{session:{...session,auth_version:3}},
  {member:{...member,auth_version:3}},{member:{...member,status:'suspended'}},
  {member:{...member,status:'deleted'}}]){
  const f=await fixture();Object.assign(f.state,x);
  assert.equal((await f.handler(f.request())).status,401);
 }
 const f=await fixture();f.state.now=now+601;
 assert.equal((await f.handler(f.request())).status,401);
});
test('signed foreign brand, app, environment, unlinked subject and production scope fail closed',async()=>{
 for(const changed of [{brand_id:'hglobal'},{app_id:'hglobal-id'},{app_id:'starry-other'},
  {environment:'production'},{expires_at:now}]){
  const f=await fixture();const altered=await signTestSession(f.key,{...evidence,...changed});
  assert.equal((await f.handler(f.request('/v1/member/self',altered))).status,401);
 }
 const f=await fixture();f.state.linked=false;
 assert.equal((await f.handler(f.request())).status,401);
 for(const badScope of [{...scope,brand_id:'hglobal'},{...scope,app_id:'other'},
  {...scope,environment:'production'}]){
   assert.throws(()=>createMemberReadContract({...f.deps,trusted_scope:badScope}),/MEMBER_ROUTE_SCOPE_DENIED/);
 }
});
test('AI-1 official billing trust port accepts only sealed current principal and server binding',async()=>{
 const f=await fixture();
 const binding='123e4567-e89b-42d3-a456-426614174000';
 const storeScope={...scope,store:'apple',store_app_id:'phd.starry.id',store_environment:'sandbox'};
 const record={brand_id:'starry',s_user_id:'s_member1',app_id:'starry-id',
  environment:'staging',store:'apple',store_app_id:'phd.starry.id',
  store_environment:'sandbox',account_binding:binding,revoked_at:null,expires_at:null};
 const port=await createStarryBillingAuthPortForRequest({
  scope:storeScope,
  resolvePrincipal:createServerIdentityResolver(f.deps),
  readCurrentBinding:async key=>{
   assert.equal(key.s_user_id,'s_member1');return record;
  },
  nowSeconds:()=>f.state.now
 },f.request());
 assert.ok(port);
 assert.deepEqual(port.verifyCurrentIdentity(),{
  brandId:'starry',appId:'starry-id',environment:'staging',userId:'s_member1',accountBinding:binding});
 f.state.now+=31;assert.equal(port.verifyCurrentIdentity(),null);
 const fake=await createStarryBillingAuthPortForRequest({
  scope:storeScope,resolvePrincipal:async()=>({...evidence,member_status:'active',checked_at:now}),
  readCurrentBinding:async()=>record,nowSeconds:()=>now
 },f.request());
 assert.equal(fake,null);
});
test('SDK rejects insecure base URL, no validated Session, extra data and unreadable responses',async()=>{
 assert.throws(()=>createMemberPreviewSdk('http://remote.example.invalid',async()=>''),/INSECURE_API_ORIGIN/);
 assert.throws(()=>createMemberPreviewSdk('https://a:b@api.example.invalid',async()=>''),/INVALID_API_ORIGIN/);
 const f=await fixture();
 const noSession=createMemberPreviewSdk('https://api.example.invalid',async()=>null,async()=>{throw Error('NETWORK_UNEXPECTED')});
 await assert.rejects(noSession.readSelf(),/VERIFIED_SESSION_REQUIRED/);
 const bad=createMemberPreviewSdk('https://api.example.invalid',async()=>f.token,
  async()=>Response.json({...member,s_user_id:'s_member1',adminVerified:true}));
 await assert.rejects(bad.readSelf(),/INVALID_MEMBER_PROJECTION/);
 const denied=createMemberPreviewSdk('https://api.example.invalid',async()=>f.token,
  async()=>Response.json({error:{code:'DENIED'}},{status:403}));
 await assert.rejects(denied.readSelf(),/STARRY_MEMBER_NOT_AVAILABLE/);
});
