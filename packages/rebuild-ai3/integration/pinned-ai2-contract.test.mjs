import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {bindBillingAuditBridge,isAuditMetadata,BATTERY} from '../src/index.ts';
/**
 * Runs in AI-3 CI ONLY against SHA-pinned REAL AI-2 #29 draft source.
 * Fails rather than skipping if the pinned module is unavailable.
 */
if(!process.env.AI2_REBUILD_MODULE)
 throw new Error('AI2_REBUILD_MODULE pinned candidate is REQUIRED');
const {planSandboxPurchase}=await import(pathToFileURL(process.env.AI2_REBUILD_MODULE).href);
const now='2026-10-26T09:00:00Z';
const reg={brandId:'starry',appId:'starry-id',environment:'staging',
 storeEnvironment:'sandbox',store:'apple',storeAppId:'phd.starry.test',
 catalog:{'test.monthly':'subscription'}};
const p={brandId:'starry',appId:'starry-id',environment:'staging',userId:'s_001',accountBinding:'trusted_binding_1'};
const verified={brandId:'starry',appId:'starry-id',store:'apple',
 storeEnvironment:'sandbox',storeAppId:'phd.starry.test',
 sku:'test.monthly',kind:'subscription',originalTransactionId:'original-1',
 transactionId:'transaction-1',providerEventId:'evt-1',
 accountBinding:'trusted_binding_1',periodStartedAt:'2026-10-26T08:00:00Z',
 effectiveAt:'2026-10-26T08:00:00Z',expiresAt:'2026-11-26T08:00:00Z',state:'PAID'};
const ports=(s=verified)=>({
 registry:reg,
 auth:{verifyCurrentIdentity:()=>p},
 store:{verifySandboxEvidence:()=>s},
 ledger:{ownerForOriginalTransaction:()=>null,latestEntitlement:()=>null,existingEvent:()=>null},
});
const request={store:'apple',evidence:'opaque:mock'};
const hash=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,'0')).join('');
async function wire(s=verified){
 const result=await planSandboxPurchase(request,ports(s),now);
 assert.equal(result.disposition,'new');
 const candidate=result.outbox;
 const payload={
  outbox:candidate,occurred_at:s.effectiveAt,
  source_event_ref:'a_'+await hash(result.idempotencyKey),
  resource_ref:'r_'+await hash(s.transactionId),
  payload_digest:result.payloadDigest,
  committed:true,verified_provider:true,
 };
 let claim=null,latest=null,canonicalApproved=true;
 const binder=bindBillingAuditBridge({brand_id:'starry',app_id:reg.appId,environment:reg.environment},
  {readCommitted:async()=>payload},
  {lookupByKey:async()=>claim,latestSourceTime:async()=>latest},
  {schemaVersion:'rebuild-p05.0.1-candidate',validateForScope:async(scope,envelope)=>{
   return canonicalApproved&&envelope.brand_id==='starry'
    &&envelope.app_id===scope.app_id&&envelope.environment===scope.environment
    &&Object.keys(envelope).length===12
    &&envelope.event_type==='billing.store_state_observed'
    &&envelope.schema_version==='rebuild-p05.0.1-candidate';
  }});
 return {binder,result,payload,setClaim:x=>{claim=x},setLatest:x=>{latest=x},denyCanonical:()=>{canonicalApproved=false}};
}
test('exact AI-2 #29 plan generates a compliant AI-3 redacted audit with P05 boundary',async()=>{
 const {binder,result}=await wire();
 const o=await binder.plan('billing_event_1');
 assert.equal(o.disposition,'ready');
 assert.equal(o.canonical.idempotency_key,result.idempotencyKey);
 assert.equal(o.canonical.event_type,result.outbox.eventType);
 assert.equal(o.canonical.environment,'staging');
 assert.equal(o.audit.event_type,'billing.store_state_observed');
 assert.equal(isAuditMetadata(o.audit),true);
 assert.equal(JSON.stringify(o).includes('trusted_binding_1'),false);
 assert.equal(JSON.stringify(o).includes('transaction-1'),false);
 assert.equal(BATTERY.purchasable,false);
});
test('AI-2 planner rejects client forged verified flags and paid Battery',async()=>{
 await assert.rejects(planSandboxPurchase({...request,verifiedBy:'apple'},ports(),now),/CLIENT_CLAIMS_DENIED/);
 const bad={...verified,sku:'starry.battery',state:'PAID'};
 await assert.rejects(planSandboxPurchase(request,ports(bad),now),/SKU_DENIED/);
});
test('real AI-2 outbox repeated exactly dedupes; digest conflict fails closed',async()=>{
 const w=await wire();const a=await w.binder.plan('billing_event_1');
 w.setClaim({event_id:a.canonical.event_id,payload_digest:a.payload_digest});
 assert.equal((await w.binder.plan('billing_event_1')).disposition,'duplicate');
 w.setClaim({event_id:a.canonical.event_id,payload_digest:'e'.repeat(64)});
 assert.equal((await w.binder.plan('billing_event_1')).reason,'IDEMPOTENCY_CONFLICT');
});
test('AI-2 historical outbox cannot replay entitlement; strict scope and AI-0 port deny',async()=>{
 const refund={...verified,state:'REFUNDED',providerEventId:'old-refund',
   effectiveAt:'2026-10-26T08:05:00Z'};
 const w=await wire(refund);
 w.setLatest('2026-10-26T08:10:00Z');
 const old=await w.binder.plan('billing_event_1');
 assert.equal(old.disposition,'stale_audit_only');
 assert.equal('entitlement' in old,false);
 w.denyCanonical();
 assert.equal((await w.binder.plan('billing_event_1')).reason,'CANONICAL_P05_DENIED');
});
