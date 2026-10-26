import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createServerIdentityResolver} from '../../../modules/starry-id-v1/src/index.ts';
import {isServerBillingPlan,planSandboxPurchase} from '../src/index.ts';
import {ATOMIC_SQL,createSandboxBillingD1Writer} from '../src/billing-d1.ts';

const now='2026-10-26T09:00:00.000Z',t=Math.floor(Date.parse(now)/1000);
const registry={brandId:'starry',appId:'starry.test',environment:'staging',
 storeEnvironment:'sandbox',store:'apple',storeAppId:'phd.starry.test',
 catalog:{'test.monthly':'subscription'}};
const event={brandId:'starry',appId:'starry.test',store:'apple',
 storeEnvironment:'sandbox',storeAppId:'phd.starry.test',sku:'test.monthly',
 kind:'subscription',originalTransactionId:'original-secret-001',
 transactionId:'transaction-secret-001',providerEventId:'event-secret-001',
 accountBinding:'binding_secret_001',periodStartedAt:'2026-10-26T08:00:00Z',
 effectiveAt:'2026-10-26T08:00:00Z',expiresAt:'2026-11-26T08:00:00Z',state:'PAID'};
async function plan(extra={}){
 const principal=await createServerIdentityResolver({
  trusted_scope:{brand_id:'starry',app_id:'starry.test',environment:'staging'},
  verify_oidc_or_session:async()=>({brand_id:'starry',app_id:'starry.test',environment:'staging',
   provider:'apple',provider_subject:'stable-sub',s_user_id:'s_001',session_id:'sess_1',
   auth_version:1,expires_at:t+120}),
  read_member:async()=>({s_user_id:'s_001',status:'active',auth_version:1,
   profile_revision:0,display_name:null,directory_opt_in:false,display_name_public:false}),
  read_session:async()=>({session_id:'sess_1',s_user_id:'s_001',auth_version:1,
   app_id:'starry.test',environment:'staging',expires_at:t+120,revoked_at:null,
   step_up_method:null,step_up_verified_at:null,step_up_expires_at:null}),
  identity_matches:async()=>true,
 })({},t);
 return planSandboxPurchase({store:'apple',evidence:'opaque:sandbox-mock'},{
  registry,auth:{resolveTrustedPrincipal:async()=>principal,
   accountBindingFor:async()=> 'binding_secret_001',
   opaqueActorRefFor:async()=> 'actor_anonymous_001'},
  store:{verifySandboxEvidence:async()=>({...event,...extra})},
  ledger:{ownerForOriginalTransaction:()=>null,latestEntitlement:()=>null,existingEvent:()=>null}
 },now);
}
async function fixture(options={}){
 const key=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign']);
 const queries=[],batches=[];
 const state={rows:{entitlement:null,event:null,after:null},...options};
 const db={
  prepare(sql){return {bind(...args){return {
   first:async()=>{queries.push({sql,args});
    if(sql.includes('FROM billing_entitlement WHERE'))return state.rows.entitlement;
    if(sql.includes('FROM billing_event e JOIN'))return state.rows.event;
    if(sql.includes('FROM billing_atomic_receipt r'))return state.rows.after;
    return null;
   },sql,args};
  }}},
  async batch(stmts){
   batches.push(stmts);if(options.reject)throw new Error('sqlite-constraint');
   if(options.badReceipt!==true)state.rows.after={
    verified_provider:1,guard_applied:1,payload_digest:options.digest??state.expectedDigest,
    brand_id:'starry',app_id:'starry.test',environment:'staging',
    safe_payload_json:state.lastP05};
   return Array(5).fill({success:true});
  }
 };
 const writer=createSandboxBillingD1Writer({db,scope:registry,hmacKey:key});
 return {writer,state,batches,queries,key};
}
test('trusted planner seals identity; JSON and structured clones cannot be committed',async()=>{
 const p=await plan();assert.equal(isServerBillingPlan(p),true);
 assert.equal(isServerBillingPlan({...p}),false);
 const f=await fixture();
 await assert.rejects(f.writer.commit({...p},now),/BILLING_UNISSUED_PLAN/);
 await assert.rejects(f.writer.commit(JSON.parse(JSON.stringify(p)),now),/BILLING_UNISSUED_PLAN/);
 assert.equal(f.batches.length,0);
});
test('billing batch contains five prepared writes incl guard, opaque payload, no external Store API',async()=>{
 const p=await plan(),f=await fixture();
 f.state.expectedDigest=p.payloadDigest;f.state.lastP05=JSON.stringify(p.p05);
 const out=await f.writer.commit(p,now);
 assert.equal(out.disposition,'committed');assert.equal(out.right,'active');
 assert.equal(f.batches.length,1);
 const stmts=f.batches[0];assert.equal(stmts.length,5);
 for(let i=0;i<stmts.length;i++)assert.equal(stmts[i].sql,Object.values(ATOMIC_SQL)[i]);
 const raw=JSON.stringify(stmts.map(x=>x.args));
 for(const secret of [event.accountBinding,event.originalTransactionId,event.transactionId,
    event.providerEventId,'RAW_PURCHASE_TOKEN'])
   assert.equal(raw.includes(secret),false,'sensitive data in SQL bind: '+secret);
 assert.match(stmts[4].sql,/billing_atomic_receipt/);
 assert.match(stmts[4].sql,/CASE WHEN EXISTS/);
});
test('database after-commit reader only accepts persisted receipt, never request flags',async()=>{
 const f=await fixture();assert.equal(await f.writer.readAfterCommit('b_'+'a'.repeat(64)),null);
 await assert.rejects(f.writer.readAfterCommit({committed:true,provider_verified:true}),/BILLING_COMMITTED_REF_DENIED/);
});
test('readAfterCommit validates DB proof and rejects wrong brand, scope, schema and digest',async()=>{
 const p=await plan(),f=await fixture();
 f.state.expectedDigest=p.payloadDigest;f.state.lastP05=JSON.stringify(p.p05);
 await f.writer.commit(p,now);
 const record=await f.writer.readAfterCommit(p.idempotencyKey);
 assert.equal(record.committed,true);assert.equal(record.provider_verified,true);
 assert.equal(record.p05.event_id,p.idempotencyKey);
 f.state.rows.after={...f.state.rows.after,verified_provider:0};
 await assert.rejects(f.writer.readAfterCommit(p.idempotencyKey),/BILLING_COMMITTED_PROOF_DENIED/);
 f.state.rows.after={...f.state.rows.after,verified_provider:1,
    safe_payload_json:JSON.stringify({...p.p05,brand_id:'hglobal'})};
 await assert.rejects(f.writer.readAfterCommit(p.idempotencyKey),/BILLING_COMMITTED_EVENT_DENIED/);
});
test('failed batch never returns a committed right',async()=>{
 const p=await plan(),f=await fixture({reject:true});
 f.state.lastP05=JSON.stringify(p.p05);f.state.expectedDigest=p.payloadDigest;
 await assert.rejects(f.writer.commit(p,now),/BILLING_ATOMIC_BATCH_FAILED/);
});
test('same-event payload+owner can be a duplicate, modified digest rejects',async()=>{
 const p=await plan(),f=await fixture();
 // compare owner hash from a successful writer invocation; avoids knowing HMAC key.
 f.state.expectedDigest=p.payloadDigest;f.state.lastP05=JSON.stringify(p.p05);
 await f.writer.commit(p,now);
 const bindingDigest=f.batches[0][0].args[9];
 f.state.rows.event={payload_digest:p.payloadDigest,s_user_id:'s_001',binding_digest:bindingDigest};
 assert.equal((await f.writer.commit(p,now)).disposition,'duplicate');
 f.state.rows.event={...f.state.rows.event,payload_digest:'0'.repeat(64)};
 await assert.rejects(f.writer.commit(p,now),/BILLING_IDEMPOTENCY_CONFLICT/);
});
test('new product event cannot overwrite unknown/stale persisted entitlement',async()=>{
 const p=await plan(),f=await fixture();
 f.state.rows.entitlement={version:3,s_user_id:'s_002',app_id:'starry.test',status:'active'};
 await assert.rejects(f.writer.commit(p,now),/BILLING_CAS_STALE_PLAN/);
 assert.equal(f.batches.length,0);
});
test('Production runtime or Store cannot construct a Billing writer',async()=>{
 const key=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign']);
 for(const change of [{environment:'production'},{storeEnvironment:'production'},{brandId:'hglobal'}]){
  assert.throws(()=>createSandboxBillingD1Writer({db:{},scope:{...registry,...change},hmacKey:key}),/BILLING_D1_SCOPE_DENIED/);
 }
});
test('historical or non-changing plan cannot issue fresh paid right from D1',async()=>{
 const p=await plan();
 const f=await fixture();
 const altered={...p,entitlementChanged:false};
 await assert.rejects(f.writer.commit(altered,now),/BILLING_UNISSUED_PLAN/);
});
