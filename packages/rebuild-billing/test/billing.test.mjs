import test from 'node:test';
import assert from 'node:assert/strict';
import {planSandboxPurchase} from '../src/index.ts';
const now='2026-10-26T09:00:00Z';
const registry={brandId:'starry',appId:'starry.test',environment:'staging',storeEnvironment:'sandbox',store:'apple',storeAppId:'phd.starry.test',catalog:{'test.monthly':'subscription'}};
const principal={brandId:'starry',appId:registry.appId,environment:registry.environment,userId:'s_001',accountBinding:'trusted_binding_1'};
const event={brandId:'starry',appId:registry.appId,store:'apple',storeEnvironment:'sandbox',storeAppId:registry.storeAppId,sku:'test.monthly',kind:'subscription',originalTransactionId:'original-1',transactionId:'transaction-1',providerEventId:'evt-1',accountBinding:principal.accountBinding,periodStartedAt:'2026-10-26T08:00:00Z',effectiveAt:'2026-10-26T08:00:00Z',expiresAt:'2026-11-26T08:00:00Z',state:'PAID'};
const request={store:'apple',evidence:'opaque:sandbox-mock'};
function fixture(changes={}) {
  const state={identity:principal,verified:event,owner:null,previous:null,seen:null,authCalls:0,verifyCalls:0,...changes};
  const ports={registry:{...registry},auth:{verifyCurrentIdentity(){state.authCalls++;return state.identity}},store:{verifySandboxEvidence(){state.verifyCalls++;return state.verified}},ledger:{ownerForOriginalTransaction:()=>state.owner,latestEntitlement:()=>state.previous,existingEvent:()=>state.seen}};
  return {state,ports};
}
const run=(f,r=request,t=now)=>planSandboxPurchase(r,f.ports,t);
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
  for(const identity of [null,{...principal,brandId:'hglobal'},{...principal,appId:'other'},{...principal,environment:'production'},{...principal,accountBinding:'bad binding with spaces'}])
    await denied(run(fixture({identity})),/AUTH_DENIED/);
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
