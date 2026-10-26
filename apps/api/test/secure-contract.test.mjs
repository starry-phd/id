import test from 'node:test';
import assert from 'node:assert/strict';
import {createServerIdentityResolver,isTrustedPrincipal} from '../../../modules/starry-id-v1/src/index.ts';
import {planSandboxPurchase} from '../../../packages/rebuild-billing/src/index.ts';
import {auditIngress} from '../../../packages/rebuild-ai3/src/index.ts';
import {verifiedBillingIdentity,proposeBillingAuditEnvelope,P05_REBUILD_GATE_STATUS} from '../../../packages/integration/src/rebuild-bridge.ts';
import {createSecureContractWorker} from '../test-support/secure-contract-worker.ts';
import {createEphemeralTestKey,signTestSession,createTestHmacVerifier} from '../test-support/session-hmac.ts';
import {createTestMemberContractClient} from '../../../packages/sdk/test-support/member-contract-client.ts';
import {handleRequest} from '../src/index.ts';

const now=Math.floor(Date.parse('2026-10-26T09:00:00Z')/1000);
const scope=Object.freeze({brand_id:'starry',app_id:'starry-id',environment:'staging'});
const identity={...scope,provider:'google',provider_subject:'g-stable-1',
  s_user_id:'s_001',session_id:'s1',auth_version:3,expires_at:now+500};
const member={s_user_id:'s_001',status:'active',auth_version:3,profile_revision:1,
  display_name:'Example',directory_opt_in:false,display_name_public:false};
const session={session_id:'s1',s_user_id:'s_001',auth_version:3,app_id:'starry-id',environment:'staging',
  expires_at:now+500,revoked_at:null,step_up_method:null,step_up_verified_at:null,step_up_expires_at:null};
const adminGrant={s_user_id:'s_001',brand_id:'starry',app_id:'starry-id',environment:'staging',
  permission:'member:suspend',revoked_at:null,expires_at:now+500};

async function fixture(){
 const key=await createEphemeralTestKey();
 const state={now,evidence:{...identity},member:{...member},session:{...session},
   grant:null,linked:true,binding:'server_binding_1'};
 const ports={trusted_scope:scope,verify_oidc_or_session:createTestHmacVerifier(key),
  read_member:async()=>state.member,read_session:async()=>state.session,
  identity_matches:async()=>state.linked,read_admin_grant:async()=>state.grant,
  lookup_account_binding:()=>state.binding,now:()=>state.now};
 const worker=createSecureContractWorker(ports);
 const signed=await signTestSession(key,state.evidence);
 const request=(path='/__contract/member/self',token=signed,method='GET')=>
  new Request('https://api.example.invalid'+path,{method,headers:{authorization:'Bearer '+token}});
 return {key,state,ports,worker,signed,request};
}
test('full contract: signed-session -> AI-1 WeakSet principal -> protected Worker -> typed SDK',async()=>{
 const f=await fixture();
 const client=createTestMemberContractClient('https://api.example.invalid',async(url,init)=>
  f.worker(new Request(url,init)));
 const profile=await client.self(f.signed);
 assert.deepEqual(profile,{s_user_id:'s_001',display_name:'Example',directory_opt_in:false,
  display_name_public:false,profile_revision:1});
 assert.equal(profile.display_name_public,false);
});
test('invalid/unsigned/re-signed-by-foreign-key token, HTTP identity JSON and forged admin flag fail closed',async()=>{
 const f=await fixture();
 const badKey=await createEphemeralTestKey();
 const foreign=await signTestSession(badKey,identity);
 const tampered=f.signed.slice(0,-3)+'AAA';
 for(const token of [foreign,tampered,'adminVerified:true','',f.signed+'junk']){
  const r=await f.worker(f.request('/__contract/member/self',token));
  assert.equal(r.status,401,token.slice(0,14));
 }
 const invalid=await f.worker(new Request('https://api.example.invalid/__contract/member/self',
  {method:'POST',body:JSON.stringify({verified:true,adminVerified:true,s_user_id:'s_001'})}));
 assert.equal(invalid.status,405);
 assert.equal((await f.worker(f.request('/__contract/member/self?adminVerified=true'))).status,400);
});
test('revoked session, expired session, version rollback, suspended and deleted members denied by current backend',async()=>{
 for(const patch of [{session:{...session,revoked_at:now}},{session:{...session,expires_at:now}},
  {session:{...session,auth_version:4}},{member:{...member,auth_version:4}},
  {member:{...member,status:'suspended'}},{member:{...member,status:'deleted'}}]){
  const f=await fixture();Object.assign(f.state,patch);
  assert.equal((await f.worker(f.request())).status,401);
 }
 const f=await fixture();f.state.now=now+501;
 assert.equal((await f.worker(f.request())).status,401);
});
test('foreign brand, app, Worker environment and unlinked provider subject rejected AFTER HMAC verify',async()=>{
 for(const changed of [{brand_id:'hglobal'},{app_id:'foreign'},{environment:'production'},
  {provider_subject:'invalid'}]){
  const f=await fixture();
  const altered=await signTestSession(f.key,{...identity,...changed});
  if(changed.provider_subject) f.state.linked=false;
  assert.equal((await f.worker(f.request('/__contract/member/self',altered))).status,401);
 }
 const f=await fixture();f.state.linked=false;
 assert.equal((await f.worker(f.request())).status,401);
});
test('admin action requires persisted backend grant + recent Passkey/TOTP, not request flags',async()=>{
 const f=await fixture();
 assert.equal((await f.worker(f.request('/__contract/admin/check'))).status,403);
 f.state.grant={...adminGrant};
 assert.equal((await f.worker(f.request('/__contract/admin/check'))).status,403);
 f.state.session={...session,step_up_method:'passkey',step_up_verified_at:now-15,
   step_up_expires_at:now+90};
 const r=await f.worker(f.request('/__contract/admin/check'));
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{test_only:true,permission:'member:suspend',operation_performed:false});
 f.state.grant={...adminGrant,permission:'member:restore'};
 assert.equal((await f.worker(f.request('/__contract/admin/check'))).status,403);
 f.state.grant={...adminGrant};
 f.state.session={...f.state.session,step_up_verified_at:now-301};
 assert.equal((await f.worker(f.request('/__contract/admin/check'))).status,403);
});
test('billing bridge allows ONLY real AI-1 sealed principal and server-owned account binding',async()=>{
 const f=await fixture();
 const mint=createServerIdentityResolver(f.ports);
 const p=await mint(f.request(),now);
 assert.equal(isTrustedPrincipal(p),true);
 assert.deepEqual(verifiedBillingIdentity(p,scope,now,f.ports.lookup_account_binding),{
  brandId:'starry',appId:'starry-id',environment:'staging',
  userId:'s_001',accountBinding:'server_binding_1'});
 for(const fake of [{...p},p===null?{}:JSON.parse(JSON.stringify(p)),{adminVerified:true,s_user_id:'s_001'}]){
  assert.throws(()=>verifiedBillingIdentity(fake,scope,now,()=>f.state.binding),/AI4_BILLING_TRUST_DENIED/);
 }
 assert.throws(()=>verifiedBillingIdentity(p,{...scope,app_id:'other'},now,()=>f.state.binding),/AI4_BILLING_TRUST_DENIED/);
 assert.throws(()=>verifiedBillingIdentity(p,scope,now+61,()=>f.state.binding),/AI4_BILLING_TRUST_DENIED/);
 assert.throws(()=>verifiedBillingIdentity(p,scope,now,()=>null),/AI4_ACCOUNT_BINDING_DENIED/);
 const res=await f.worker(f.request('/__contract/billing/check'));
 assert.equal(res.status,200);
 const output=await res.json();
 assert.equal(output.purchase_performed,false);
 assert.equal(output.sandbox_planner,true);
 f.state.binding=null;
 assert.equal((await f.worker(f.request('/__contract/billing/check'))).status,403);
});
test('canonical AI-2 sandbox planner consumes bridge identity, produces typed outbox, not rights issuance',async()=>{
 const f=await fixture();
 const minted=await createServerIdentityResolver(f.ports)(f.request(),now);
 const registry={brandId:'starry',appId:'starry-id',environment:'staging',
  storeEnvironment:'sandbox',store:'apple',storeAppId:'phd.starry.id.dev',catalog:{'test.monthly':'subscription'}};
 const verifiedSnapshot={brandId:'starry',appId:'starry-id',store:'apple',storeEnvironment:'sandbox',
  storeAppId:'phd.starry.id.dev',sku:'test.monthly',kind:'subscription',
  originalTransactionId:'orig1',transactionId:'trx1',providerEventId:'evt1',
  accountBinding:'server_binding_1',periodStartedAt:'2026-10-26T08:00:00Z',
  effectiveAt:'2026-10-26T08:00:00Z',expiresAt:'2026-11-26T08:00:00Z',state:'PAID'};
 const ledger={ownerForOriginalTransaction:()=>null,latestEntitlement:()=>null,existingEvent:()=>null};
 const ports={registry,auth:{
  resolveTrustedPrincipal:async()=>minted,
  accountBindingFor:async(sUserId,fromRegistry)=>sUserId===minted.s_user_id && fromRegistry.appId===scope.app_id ? f.state.binding : null,
  opaqueActorRefFor:async(sUserId)=>sUserId===minted.s_user_id ? 'server_pseudonym_audit_1' : null,
 },
  store:{verifySandboxEvidence:()=>verifiedSnapshot},ledger};
 const plan=await planSandboxPurchase({store:'apple',evidence:'test-only'},ports,'2026-10-26T09:00:00Z');
 assert.equal(plan.disposition,'new');
 assert.equal(plan.outbox.eventType,'billing.store_state_observed');
 const proposal=proposeBillingAuditEnvelope(plan.outbox,scope);
 assert.equal(proposal.publishable,false);
 assert.equal(P05_REBUILD_GATE_STATUS,'CANDIDATE_NOT_APPROVED');
 assert.equal(proposal.idempotency_key,plan.idempotencyKey);
 assert.throws(()=>auditIngress(scope,proposal),/AI3_INVALID_METADATA/);
 assert.deepEqual(await planSandboxPurchase({store:'apple',evidence:'test-only'},
  {...ports,ledger:{...ledger,existingEvent:()=>({payloadDigest:plan.payloadDigest})}},
  '2026-10-26T09:00:00Z'),{disposition:'duplicate',idempotencyKey:plan.idempotencyKey});
 await assert.rejects(planSandboxPurchase({store:'apple',evidence:'test-only',
  adminVerified:true},ports,'2026-10-26T09:00:00Z'),/CLIENT_CLAIMS_DENIED/);
 for(const x of [{brandId:'hglobal'},{appId:'foreign'},{environment:'production'},
  {storeEnvironment:'production'},{idempotencyKey:'fake'}, {email:'secret@example.com'}])
  assert.throws(()=>proposeBillingAuditEnvelope({...plan.outbox,...x},scope),/AI4_P05_QUARANTINE/);
});
test('production entrypoint remains health-only; test-only protected contract routes are NOT deployed',async()=>{
 const f=await fixture();
 for(const path of ['/__contract/member/self','/__contract/admin/check','/__contract/billing/check']){
  assert.equal(handleRequest(f.request(path),{STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'}).status,404);
 }
 assert.equal((await f.worker(f.request('/__contract/not-registered'))).status,404);
});
test('typed SDK refuses corrupt profiles and credential-bearing insecure origins',async()=>{
 assert.throws(()=>createTestMemberContractClient('http://public.example.invalid'),/INSECURE_API_ORIGIN/);
 assert.throws(()=>createTestMemberContractClient('https://user:pass@api.example.invalid'),/INVALID_API_ORIGIN/);
 const f=await fixture();
 const client=createTestMemberContractClient('https://api.example.invalid',
  async()=>Response.json({adminVerified:true,s_user_id:'s_001'}));
 await assert.rejects(client.self(f.signed),/INVALID_PROFILE_RESPONSE/);
});
