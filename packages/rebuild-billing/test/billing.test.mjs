import test from 'node:test';
import assert from 'node:assert/strict';
import {planSandboxPurchase} from '../src/index.ts';
import {createServerIdentityResolver} from '../../../modules/starry-id-v1/src/index.ts';
import {isAuditMetadata} from '../../../packages/rebuild-ai3/src/index.ts';
const now='2026-10-26T09:00:00Z';
const registry={brandId:'starry',appId:'starry.test',environment:'staging',storeEnvironment:'sandbox',store:'apple',storeAppId:'phd.starry.test',catalog:{'test.monthly':'subscription'}};
const principal={brandId:'starry',appId:registry.appId,environment:registry.environment,userId:'s_001',accountBinding:'trusted_binding_1'};
const event={brandId:'starry',appId:registry.appId,store:'apple',storeEnvironment:'sandbox',storeAppId:registry.storeAppId,sku:'test.monthly',kind:'subscription',originalTransactionId:'original-1',transactionId:'transaction-1',providerEventId:'evt-1',accountBinding:principal.accountBinding,periodStartedAt:'2026-10-26T08:00:00Z',effectiveAt:'2026-10-26T08:00:00Z',expiresAt:'2026-11-26T08:00:00Z',state:'PAID'};
const request={store:'apple',evidence:'opaque:sandbox-mock'};
function fixture(changes={}) {
  const state={identity:principal,verified:event,owner:null,previous:null,seen:null,
    authCalls:0,verifyCalls:0,status:'active',revoked:false,linked:true,
    binding:principal.accountBinding,actorRef:'opaque_billing_actor_01',
    forgedPrincipal:undefined,now,...changes};
  const resolve=createServerIdentityResolver({
    trusted_scope:{brand_id:'starry',app_id:registry.appId,environment:'staging'},
    verify_oidc_or_session:async()=>{
      if(!state.identity)return null;
      const id=state.identity,sec=Math.floor(Date.parse(state.now)/1000);
      return {brand_id:id.brandId,app_id:id.appId,environment:id.environment,
        provider:'apple',provider_subject:'stable-provider-subject',
        s_user_id:id.userId,session_id:'session-1',auth_version:1,expires_at:sec+3600};
    },
    read_member:async id=>({s_user_id:id,status:state.status,auth_version:1,
      profile_revision:1,display_name:null,directory_opt_in:false,display_name_public:false}),
    read_session:async()=>({session_id:'session-1',s_user_id:state.identity.userId,auth_version:1,
      app_id:'starry.test',environment:'staging',expires_at:Math.floor(Date.parse(state.now)/1000)+3600,
      revoked_at:state.revoked?1:null,step_up_method:null,step_up_verified_at:null,step_up_expires_at:null}),
    identity_matches:async()=>state.linked,
  });
  const ports={registry:{...registry},auth:{
    async resolveTrustedPrincipal(){
      state.authCalls++;
      if(state.forgedPrincipal!==undefined)return state.forgedPrincipal;
      return resolve({opaque:'test-only'},Math.floor(Date.parse(state.now)/1000));
    },
    accountBindingFor:async()=>state.binding,
    opaqueActorRefFor:async()=>state.actorRef,
  },store:{verifySandboxEvidence(){state.verifyCalls++;return state.verified}},
  ledger:{ownerForOriginalTransaction:()=>state.owner,latestEntitlement:()=>state.previous,existingEvent:()=>state.seen}};
  return {state,ports};
}
const run=(f,r=request,t=now)=>{f.state.now=t;return planSandboxPurchase(r,f.ports,t)};
async function denied(p,match){await assert.rejects(p,match)}
test('happy path: ONLY server verified sandbox event produces a PLAN, not an actual entitlement grant',async()=>{
  const f=fixture();const out=await run(f);
  assert.equal(out.disposition,'new');assert.equal(out.entitlement.right,'active');
  assert.equal(out.entitlement.userId,principal.userId);assert.equal(out.owner.accountBinding,principal.accountBinding);
  assert.equal(out.outbox.eventType,'billing.store_state_observed');
  assert.match(out.outbox.idempotencyKey,/^b_[a-f0-9]{64}$/);
  assert.equal(f.state.verifyCalls,1);
});
test('client may supply only store and opaque evidence, not verified markers / identity / idempotency',async()=>{
  for(const extra of [{verified:true},{verifiedBy:'apple'},{adminVerified:true},{s_user_id:'s_002'},{accountBinding:principal.accountBinding},{appId:'wrong'},{environment:'production'},{storeEnvironment:'production'},{idempotencyKey:'fake'},{alreadyProcessed:false},{sku:'test.monthly'}]){
    const f=fixture();await denied(run(f,{...request,...extra}),/CLIENT_CLAIMS_DENIED/);assert.equal(f.state.verifyCalls,0);
  }
});
test('server principal missing, wrong Starry brand/app/runtime or suspended mocked as null fail closed',async()=>{
  for(const identity of [null,{...principal,brandId:'hglobal'},{...principal,appId:'other'},{...principal,environment:'production'}])
    await denied(run(fixture({identity})),/AUTH_DENIED/);
  await denied(run(fixture({binding:'bad binding with spaces'})),/SERVER_BINDING_DENIED/);
});
test('separate server-only Worker runtime and Store sandbox axes enforced',async()=>{
  for(const changed of [{environment:'production'},{environment:'sandbox'},{storeEnvironment:'production'},{brandId:'hglobal'}]){
    const f=fixture();f.ports.registry={...f.ports.registry,...changed};
    await denied(run(f),/(SANDBOX_ONLY|REGISTRY_DENIED)/);
  }
});
test('provider scope mismatch: wrong brand, app, store, package, store environment',async()=>{
  for(const changed of [{brandId:'hglobal'},{appId:'other'},{store:'google'},{storeAppId:'fake.package'},{storeEnvironment:'production'}])
    await denied(run(fixture({verified:{...event,...changed}})),/PROVIDER_SCOPE_DENIED/);
});
test('unapproved SKU, fake Battery SKU, wrong product kind rejected',async()=>{
  for(const changed of [{sku:'unlisted'},{sku:'starry.Battery.paid'},{kind:'non_consumable'}])
    await denied(run(fixture({verified:{...event,...changed}})),/SKU_DENIED/);
});
test('first claim requires matching backend account binding',async()=>{
  await denied(run(fixture({verified:{...event,accountBinding:'alien'}})),/ACCOUNT_BINDING_DENIED/);
});
test('foreign-owner restore/purchase transfer is denied even when event is otherwise valid',async()=>{
  for(const owner of [{userId:'s_002',accountBinding:principal.accountBinding},{userId:'s_001',accountBinding:'other'}])
    await denied(run(fixture({owner})),/PURCHASE_ALREADY_BOUND/);
});
test('stable backend key and payload hash identical across redelivery, and no receipt leaks',async()=>{
  const a=await run(fixture());const b=await run(fixture(),{...request,evidence:'another-opaque-representation'});
  assert.equal(a.idempotencyKey,b.idempotencyKey);assert.equal(a.payloadDigest,b.payloadDigest);
  assert.equal(JSON.stringify(a.outbox).includes('opaque'),false);
});
test('same event key and payload hash in ledger gives duplicate (no outbox)',async()=>{
  const a=await run(fixture());const b=await run(fixture({seen:{payloadDigest:a.payloadDigest}}));
  assert.deepEqual(b,{disposition:'duplicate',idempotencyKey:a.idempotencyKey});
});
test('same event id but altered provider content causes idempotency conflict',async()=>{
  const a=await run(fixture());
  await denied(run(fixture({verified:{...event,expiresAt:'2026-12-01T08:00:00Z'},seen:{payloadDigest:a.payloadDigest}})),/IDEMPOTENCY_CONFLICT/);
});
test('different store and transaction ids yield distinct keys',async()=>{
  const apple=await run(fixture());
  const google=fixture({verified:{...event,store:'google',storeAppId:'phd.starry.google'}});
  google.ports.registry={...registry,store:'google',storeAppId:'phd.starry.google'};
  const g=await run(google,{store:'google',evidence:'sandbox'});
  const next=await run(fixture({verified:{...event,transactionId:'transaction-2'}}));
  assert.notEqual(apple.idempotencyKey,g.idempotencyKey);assert.notEqual(apple.idempotencyKey,next.idempotencyKey);
});
test('renewal over later period stays active; delayed old refund is historical only',async()=>{
  const current=(await run(fixture())).entitlement;
  const renewal={...event,state:'RENEWED',transactionId:'transaction-2',providerEventId:'evt-2',periodStartedAt:'2026-11-26T08:00:00Z',effectiveAt:'2026-11-26T08:00:00Z',expiresAt:'2026-12-26T08:00:00Z'};
  const next=await run(fixture({verified:renewal,previous:current}),request,'2026-11-26T09:00:00Z');
  assert.equal(next.entitlement.right,'active');
  const historical=await run(fixture({verified:{...event,state:'REFUNDED',providerEventId:'old-refund',effectiveAt:'2026-11-27T09:00:00Z'},previous:next.entitlement}),request,'2026-11-27T09:30:00Z');
  assert.equal(historical.entitlement.right,'active');assert.equal(historical.entitlementChanged,false);
  assert.equal(historical.outbox.result,'historical');
});
test('same-period refund, chargeback and revoked disable rights',async()=>{
  const current=(await run(fixture())).entitlement;
  for(const state of ['REFUNDED','CHARGEBACK','REVOKED']){
    const next=await run(fixture({verified:{...event,state,providerEventId:'evt-'+state,effectiveAt:'2026-10-26T09:00:00Z'},previous:current}));
    assert.equal(next.entitlement.right,'inactive');
    const again=await run(fixture({verified:{...event,providerEventId:'paid-after-'+state,effectiveAt:'2026-10-26T10:00:00Z'},previous:next.entitlement}));
    assert.equal(again.entitlement.right,'inactive');
  }
});
test('grace period, hold, expired all fail closed pending product policy',async()=>{
  for(const state of ['GRACE_PERIOD','ON_HOLD','EXPIRED'])assert.equal((await run(fixture({verified:{...event,state}}))).entitlement.right,'inactive');
});
test('paid subscription past expiry does not activate',async()=>{
  assert.equal((await run(fixture({verified:{...event,expiresAt:'2026-10-26T08:30:00Z'}}))).entitlement.right,'inactive');
});
test('missing subscription expiration, bad timestamp, invalid state fail closed',async()=>{
  await denied(run(fixture({verified:{...event,expiresAt:null}})),/EXPIRY_REQUIRED/);
  for(const date of ['2026-02-30T00:00:00Z','2026-10-26','2026-10-26T25:00:00Z','2026-10-26T08:00:00+99:00'])
    await denied(run(fixture({verified:{...event,effectiveAt:date}})),/INVALID_TIME/);
  await denied(run(fixture({verified:{...event,state:'GIFTED'}})),/STATE_DENIED/);
});
test('cross-user existing entitlement cannot be overwritten',async()=>{
  const previous=(await run(fixture())).entitlement;
  await denied(run(fixture({previous:{...previous,userId:'s_other'}})),/ENTITLEMENT_OWNER_DENIED/);
});
test('single non-consumable SKU works only when server allowlisted; cannot renew',async()=>{
  const s={...event,sku:'test.forever',kind:'non_consumable',expiresAt:null};
  const f=fixture({verified:s});f.ports.registry={...registry,catalog:{'test.forever':'non_consumable'}};
  assert.equal((await run(f)).entitlement.right,'active');
  await denied(run(fixture({verified:{...s,state:'RENEWED'}})),/SKU_DENIED/);
});

test('AI-1 real WeakSet rejects structurally identical client JSON or forged paid principal',async()=>{
  const fake={brand_id:'starry',app_id:'starry.test',environment:'staging',
    s_user_id:'s_001',session_id:'session-1',auth_version:1,member_status:'active',
    checked_at:Math.floor(Date.parse(now)/1000),expires_at:Math.floor(Date.parse(now)/1000)+3600};
  for(const forgedPrincipal of [fake,JSON.parse(JSON.stringify(fake)),{...fake,adminVerified:true}]) {
    const f=fixture({forgedPrincipal});await denied(run(f),/AUTH_DENIED/);
    assert.equal(f.state.verifyCalls,0);
  }
});
test('AI-1 resolver denies suspended/deleted member, revoked Session and unlink',async()=>{
  for(const flags of [{status:'suspended'},{status:'deleted'},{revoked:true},{linked:false}]) {
    const f=fixture(flags);await denied(run(f),/AUTH_DENIED/);
    assert.equal(f.state.verifyCalls,0);
  }
});
test('authenticated principal is rejected if used across second request after expiry',async()=>{
  const f=fixture();
  const sealed=await f.ports.auth.resolveTrustedPrincipal();
  f.ports.auth.resolveTrustedPrincipal=async()=>sealed;
  await denied(run(f,request,'2026-10-27T09:00:00Z'),/AUTH_DENIED/);
});
test('actor reference and provider account binding must be server-owned opaque identifiers',async()=>{
  for(const changed of [{actorRef:'s_001'},{actorRef:principal.accountBinding},
    {actorRef:'unsafe actor ref'},{actorRef:null},{binding:null}]){
    await denied(run(fixture(changed)),/SERVER_BINDING_DENIED/);
  }
});
test('Billing P05 candidate is strictly minimal and omits raw user or receipt and store token',async()=>{
  const f=fixture();const r=await run(f);
  assert.equal(r.p05.schema_version,'billing.p05.v1-candidate');
  assert.equal(r.p05.event_type,'billing.store_state_observed');
  assert.equal(r.p05.app_id,'starry.test');assert.equal(r.p05.environment,'staging');
  assert.equal(r.p05.idempotency_key,r.outbox.idempotencyKey);
  assert.equal(r.p05.actor_ref,'opaque_billing_actor_01');
  assert.deepEqual(Object.keys(r.p05).sort(),[
    'brand_id','app_id','environment','schema_version','event_id','event_type','occurred_at',
    'correlation_id','idempotency_key','actor_ref','resource_ref','result','classification'].sort());
  const serialized=JSON.stringify(r.p05);
  for(const sensitive of [principal.userId,principal.accountBinding,request.evidence,'transaction-1','original-1'])
    assert.equal(serialized.includes(sensitive),false);
});
test('AI-3 real draft validator rejects Billing candidate until AI-0 reconciles canonical version/type',async()=>{
  const r=await run(fixture());
  assert.equal(isAuditMetadata(r.p05),false);
  assert.equal(isAuditMetadata({...r.p05,brand_id:'hglobal'}),false);
  assert.equal(isAuditMetadata({...r.p05,environment:'production'}),false);
  assert.equal(isAuditMetadata({...r.p05,access_token:'forbidden'}),false);
});
test('historical refund retains entitlement yet yields separate pseudonymous audit-only candidate',async()=>{
  const current=(await run(fixture())).entitlement;
  const newer={...event,state:'RENEWED',providerEventId:'new',transactionId:'new-txn',
    periodStartedAt:'2026-11-26T08:00:00Z',effectiveAt:'2026-11-26T08:00:00Z',
    expiresAt:'2026-12-26T08:00:00Z'};
  const renewed=await run(fixture({verified:newer,previous:current}),request,'2026-11-26T09:00:00Z');
  const oldRefund=await run(fixture({verified:{...event,state:'REFUNDED',providerEventId:'old-refund',
    effectiveAt:'2026-11-27T08:00:00Z'},previous:renewed.entitlement}),request,'2026-11-27T09:00:00Z');
  assert.equal(oldRefund.entitlementChanged,false);
  assert.equal(oldRefund.entitlement.right,'active');
  assert.equal(oldRefund.outbox.result,'historical');
  assert.equal(oldRefund.p05.classification,'metadata_only');
});

test('AI-1 principal from the previous request cannot be reused even one second later',async()=>{
  const f=fixture();
  const sealed=await f.ports.auth.resolveTrustedPrincipal();
  f.ports.auth.resolveTrustedPrincipal=async()=>sealed;
  await denied(run(f,request,'2026-10-26T09:00:01Z'),/AUTH_DENIED/);
});
