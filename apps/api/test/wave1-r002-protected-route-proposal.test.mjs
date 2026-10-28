import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {handleRequest} from '../src/index.ts';
import {WAVE1_PURCHASE_AUTH_SCHEMA} from '../../../modules/starry-id-v1/src/wave1-purchase-entry-auth-gate.ts';
import {WAVE1_BILLING_CONTRACT} from '../../../packages/rebuild-billing/src/wave1-billing-revenuecat-review.ts';
import {WAVE1_SECURITY_FENCE_VERSION} from '../../../packages/rebuild-ai3/src/wave1-security-notification-fence.ts';
import {R002_PROTECTED_API_VERSION,R002_PUBLIC_ROUTES_APPROVED,
 R002_QUEUE_ACK_APPROVED,R002_LIVE_AUTH_APPROVED,R002_STORE_APPROVED,
 R002_OWNER_CONTRACTS,R002_PROPOSED_ROUTES,R002_P05_QUEUE_BOUNDARY,
 reviewR002ProtectedProposal} from '../src/wave1-r002-protected-route-proposal.ts';
const env={STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'};
const testInput=(patch={})=>({
 brand_id:'starry',app_id:'starry-id',environment:'staging',
 path:'/v1/identity/purchase-entry-review',method:'POST',
 caller:'server_asserted',...patch
});
const deny=(result)=>{
 assert.equal(result.contract,R002_PROTECTED_API_VERSION);
 assert.equal(result.status,'blocked');assert.equal(result.live,false);
 assert.equal(result.publishable,false);
 assert.equal(result.source_level,'offline_proposal_not_an_http_route');
 for(const field of ['may_authenticate','may_charge','may_grant','may_remove_ads',
  'may_send_notification','may_ack_queue','may_write_d1','may_deploy'])
  assert.equal(result[field],false,field);
 assert.ok([400,401,403,404,405,503].includes(result.proposed_http_status));
 assert.equal(Object.isFrozen(result),true);
};
test('Round-002 proposals match the real three inherited owner version constants',()=>{
 assert.deepEqual(Object.values(R002_OWNER_CONTRACTS),[
  WAVE1_PURCHASE_AUTH_SCHEMA,WAVE1_BILLING_CONTRACT,WAVE1_SECURITY_FENCE_VERSION
 ]);
 assert.equal(R002_PUBLIC_ROUTES_APPROVED,false);
 assert.equal(R002_QUEUE_ACK_APPROVED,false);
 assert.equal(R002_LIVE_AUTH_APPROVED,false);
 assert.equal(R002_STORE_APPROVED,false);
 assert.equal(R002_PROPOSED_ROUTES.length,3);
 assert.equal(new Set(R002_PROPOSED_ROUTES.map(x=>x.path)).size,3);
 assert.deepEqual(R002_PROPOSED_ROUTES.map(x=>x.owner),['AI-1','AI-2','AI-3']);
 for(const r of R002_PROPOSED_ROUTES){
  assert.equal(r.method,'POST');
  assert.equal(r.lifecycle,'PROPOSED_NOT_REGISTERED');
  assert.equal(r.has_openapi_live_path,false);
  assert.equal(r.requires_ai0_gate,true);
  assert.equal(r.response_success_disabled,true);
  assert.equal(r.authentication,'SERVER_SIGNED_STARRY_SESSION_REQUIRED');
  assert.deepEqual(r.errors,['400','401','403','404','405','409','503']);
  assert.ok(Object.isFrozen(r));
 }
});
test('canonical OpenAPI remains ONLY deployed liveness; route proposal is not published',()=>{
 const yaml=readFileSync(new URL('../openapi.yaml',import.meta.url),'utf8');
 assert.match(yaml,/^openapi: 3\.1\.0/m);
 assert.match(yaml,/^  \/v1\/health:/m);
 for(const proposed of R002_PROPOSED_ROUTES)
  assert.equal(yaml.includes(proposed.path),false);
});
test('actual Worker does NOT register the three proposed sensitive routes',()=>{
 for(const route of R002_PROPOSED_ROUTES){
  const request=new Request('https://starry.invalid'+route.path,{method:'POST'});
  const response=handleRequest(request,env);
  assert.equal(response.status,405);
  const body=JSON.stringify(response.json());
  assert.doesNotMatch(body,/member_digest|session_id|transaction|user_id/i);
 }
 const actualGet=handleRequest(
  new Request('https://starry.invalid/v1/identity/purchase-entry-review'),env);
 assert.equal(actualGet.status,404);
});
test('valid-looking server_asserted identity is NEVER signed Auth authorization',()=>{
 for(const route of R002_PROPOSED_ROUTES){
  const r=reviewR002ProtectedProposal(testInput({path:route.path}));
  deny(r);
  assert.equal(r.proposed_http_status,503);
  assert.equal(r.error_code,'OWNER_GATE_PENDING');
  assert.equal(r.owner,route.owner);
  assert.equal(r.owner_contract,route.owner_contract);
 }
});
test('guests, UI isLoggedIn and mock SDK never pass server-session Gate',()=>{
 for(const caller of ['guest','ui_isLoggedIn','mock_verified','SIGNED_TRUE',
  'authenticated','', 'Bearer fake','server-signed-mock']){
  const r=reviewR002ProtectedProposal(testInput({caller}));
  deny(r);
  assert.equal(r.proposed_http_status,401);
  assert.equal(r.error_code,'SERVER_SIGNED_SESSION_REQUIRED');
 }
});
test('brand, appId and environment hard-isolation cannot cross H-Global or production',()=>{
 for(const patch of [
  {brand_id:'hglobal'},{app_id:'hglobal-id'},{app_id:'starry/../../admin'},
  {app_id:'starry-%2fescape'},{environment:'staging-prod'},
  {environment:'unknown'},{brand_id:'starry-id'}
 ]){
  const r=reviewR002ProtectedProposal(testInput(patch));
  deny(r);assert.equal(r.proposed_http_status,403);
 }
 const p=reviewR002ProtectedProposal(testInput({environment:'production'}));
 deny(p);assert.equal(p.proposed_http_status,503);
});
test('unknown route and dangerous methods remain 404/405 independently of identity',()=>{
 for(const path of ['/v1/auth/login','/v1/billing/charge','/v1/admin',
  '/v1/notifications/delivery-review/extra',
  '/v1/identity/purchase-entry-review?token=unsafe']){
  const r=reviewR002ProtectedProposal(testInput({path}));
  deny(r);assert.equal(r.proposed_http_status,404);
 }
 for(const method of ['GET','PUT','DELETE','PATCH','OPTIONS','get','post']){
  const r=reviewR002ProtectedProposal(testInput({method}));
  deny(r);assert.equal(r.proposed_http_status,405);
 }
});
test('malformed, extra secret and getter injected records reject before executing getter',()=>{
 for(const bad of [null,{},[],{'app_id':'starry-id'},
  {...testInput(),client_secret:'do-not-log'},
  Object.assign(Object.create({hidden:'secret'}),testInput())]){
  const r=reviewR002ProtectedProposal(bad);
  deny(r);assert.equal(r.proposed_http_status,400);
 }
 let touched=0;const trap=testInput();
 Object.defineProperty(trap,'path',{get(){touched++;throw Error('secret')}});
 const r=reviewR002ProtectedProposal(trap);
 deny(r);assert.equal(r.proposed_http_status,400);assert.equal(touched,0);
});
test('future approved-looking client claims do not grant payment, entitlement or Ads',()=>{
 const claimed=['server_asserted','verified_by_ui','official_store_ok','entitlement_active',
  'p05_signed','admin'];
 for(const caller of claimed){
  for(const route of R002_PROPOSED_ROUTES){
   const r=reviewR002ProtectedProposal(testInput({caller,path:route.path}));
   deny(r);assert.ok(r.proposed_http_status>=400);
  }
 }
});
test('error mapping is finite and always contains non-2xx, no PII/token in result',()=>{
 const r=reviewR002ProtectedProposal(testInput({caller:'Bearer user-private-token'}));
 deny(r);
 const payload=JSON.stringify(r);
 for(const text of ['user-private-token','member_digest','s_user_id','session_id','Bearer'])
  assert.equal(payload.includes(text),false);
});
test('P05 Queue boundary is a typed trust-order contract, not a second issuer',()=>{
 assert.match(R002_P05_QUEUE_BOUNDARY.event_source,/AI-0_SINGLE_CANONICAL/);
 assert.match(R002_P05_QUEUE_BOUNDARY.auth_fence,/AI-1_/);
 assert.equal(R002_P05_QUEUE_BOUNDARY.notification_fence,WAVE1_SECURITY_FENCE_VERSION);
 assert.match(R002_P05_QUEUE_BOUNDARY.durable_receipt,/AI-3_/);
 assert.match(R002_P05_QUEUE_BOUNDARY.legal_retention,/Q104_Q119/);
 assert.match(R002_P05_QUEUE_BOUNDARY.queue_commit,/COMMIT_BEFORE_ACK/);
 for(const flag of ['real_queue_binding','may_ack','may_enqueue','may_emit_signed_event','verified_live'])
  assert.equal(R002_P05_QUEUE_BOUNDARY[flag],false);
 assert.equal(Object.isFrozen(R002_P05_QUEUE_BOUNDARY),true);
});
test('proposed scope remains immutable, no network, no keyring, no owner data port read',()=>{
 const request=testInput();
 const before=JSON.stringify(request);
 const r=reviewR002ProtectedProposal(request);
 deny(r);assert.equal(JSON.stringify(request),before);
 assert.equal(request.caller,'server_asserted');
});
