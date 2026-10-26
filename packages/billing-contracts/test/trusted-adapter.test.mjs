import test from 'node:test';
import assert from 'node:assert/strict';
import {createSandboxBillingAdapter,toCanonicalBillingEnvelope} from '../src/trusted-adapter.ts';
const now='2026-10-26T08:00:00Z';
const registry={brand_id:'starry',app_id:'starry.demo',environment:'staging',
  store_environment:'sandbox',store:'apple',store_app_id:'phd.starry.demo',catalog:[{
    appId:'starry.demo',store:'apple',storeAppId:'phd.starry.demo',productId:'test.monthly',
    kind:'subscription',entitlementKey:'demo.premium'}]};
const user={brand_id:'starry',app_id:'starry.demo',environment:'staging',s_user_id:'u1',
  session_id:'s1',auth_version:2,expires_at:1800000000};
const event={verifiedBy:'apple-app-store-server-api',store:'apple',storeEnvironment:'sandbox',
  appId:'starry.demo',storeAppId:'phd.starry.demo',productId:'test.monthly',
  transactionId:'txn-1',originalTransactionId:'orig-1',eventId:'evt-1',
  occurredAt:'2026-10-26T07:00:00+00:00',expiresAt:'2026-11-26T07:00:00Z',
  lifecycle:'PURCHASED',accountBinding:'binding-u1'};
const okRequest={store:'apple',evidence:'opaque-test-only'};
const refundRequest={transaction_ref:'txn-1',reason:'manual verification',approval_id:'approval-1'};
function fixture(overrides={}) {
  const state={principal:user,active:true,refundAuthorized:true,steps:true,
    grant:true,seen:false,owner:'u1',providerEvent:event};
  Object.assign(state,overrides);
  const ports={registry:{...registry},
    auth:{
      resolveVerifiedPrincipal:()=>state.principal,
      assertActiveSession:()=>{if(!state.active)throw Error('SESSION_REVOKED')},
      accountBindingFor:()=> 'binding-u1',
      resolveRefundPermission:()=>state.refundAuthorized?{
        appIds:['starry.demo'], scopes:state.grant?['billing:refund:review']:[],
        stepUpAt:state.steps?'2026-10-26T07:59:00Z':null}:null,
    },
    verifier:{verifySandboxEvidence:()=>state.providerEvent},
    read:{previouslyProcessedEvent:()=>state.seen,resolveTransactionOwner:()=>state.owner},
    correlationId:()=> 'correlation-1',
  };
  return {state,ports,adapter:createSandboxBillingAdapter(ports)};
}
const reject=(fn,rx)=>assert.throws(fn,rx);
test('server-internal adapter maps AI-1 principal to app scoped active sandbox rights',()=>{
  const {adapter}=fixture();const value=adapter.evaluatePurchase(okRequest,null,now);
  assert.equal(value.application.projection.userId,'u1');
  assert.equal(value.application.projection.environment,'staging');
  assert.equal(value.application.projection.storeEnvironment,'sandbox');
  assert.equal(value.application.projection.entitlement,'active');
});
test('forged paid/adminVerified/verifiedBy and client identity or dedupe flags are denied',()=>{
  const {adapter}=fixture();
  for(const extra of [{verifiedBy:'apple-app-store-server-api'},{adminVerified:true},
    {previouslyProcessedEventId:false},{s_user_id:'u2'},{app_id:'foreign'},
    {environment:'production'},{store_environment:'production'},{isPaid:true}])
    reject(()=>adapter.evaluatePurchase({...okRequest,...extra},null,now),/CLIENT_CLAIMS_DENIED/);
  reject(()=>adapter.checkRefundReview({...refundRequest,adminVerified:true},now),/CLIENT_CLAIMS_DENIED/);
});
test('invalid or missing current principal and revoked session deny',()=>{
  for(const changed of [{principal:null},{principal:{...user,s_user_id:'other',brand_id:'hglobal'}},
    {principal:{...user,app_id:'foreign'}},{principal:{...user,environment:'production'}},
    {principal:{...user,expires_at:1}},{active:false}]){
    const {adapter}=fixture(changed);
    reject(()=>adapter.evaluatePurchase(okRequest,null,now),/(AUTH_REQUIRED|SCOPE_DENIED|SESSION_REVOKED)/);
  }
});
test('runtime environment and store environment cannot be conflated or used in production',()=>{
  for(const changed of [{environment:'production'},{environment:'sandbox'},
    {store_environment:'production'},{brand_id:'hglobal'}]){
    const {ports}=fixture();const adapter=createSandboxBillingAdapter({...ports,registry:{...ports.registry,...changed}});
    reject(()=>adapter.evaluatePurchase(okRequest,null,now),/(environment mismatch|trusted registry invalid)/);
  }
});
test('provider does not self-attest through client and wrong store/provider evidence is rejected',()=>{
  const {adapter}=fixture({providerEvent:{...event,verifiedBy:'from-client'}});
  reject(()=>adapter.evaluatePurchase(okRequest,null,now),/not provider verified/);
  const f=fixture({providerEvent:{...event,storeEnvironment:'production'}});
  reject(()=>f.adapter.evaluatePurchase(okRequest,null,now),/environment mismatch/);
  const g=fixture({providerEvent:{...event,appId:'foreign'}});
  reject(()=>g.adapter.evaluatePurchase(okRequest,null,now),/app mismatch/);
  const h=fixture({providerEvent:{...event,storeAppId:'foreign.bundle'}});
  reject(()=>h.adapter.evaluatePurchase(okRequest,null,now),/app mismatch/);
});
test('replay decision comes from server ledger only; cannot override from request',()=>{
  const f=fixture({seen:true}); const current=fixture().adapter.evaluatePurchase(okRequest,null,now).application.projection;
  const replay=f.adapter.evaluatePurchase(okRequest,current,now);
  assert.equal(replay.application.reason,'duplicate');assert.strictEqual(replay.application.projection,current);
  reject(()=>f.adapter.evaluatePurchase({...okRequest,previouslyProcessedEventId:false},current,now),/CLIENT_CLAIMS_DENIED/);
});
test('refund event cannot change another account entitlement',()=>{
  const f=fixture();const current=f.adapter.evaluatePurchase(okRequest,null,now).application.projection;
  const refund={...event,eventId:'refund-1',lifecycle:'REFUNDED',occurredAt:'2026-10-26T07:50:00Z'};
  const other=fixture({principal:{...user,s_user_id:'u2'},providerEvent:refund});
  reject(()=>other.adapter.evaluatePurchase(okRequest,current,now),/ownership or transaction mismatch/);
});
test('refund review from scoped admin requires persisted scope and fresh step-up',()=>{
  const {adapter}=fixture();
  assert.deepEqual(adapter.checkRefundReview(refundRequest,now),{transactionRef:'txn-1',ownerUserId:'u1'});
  for(const args of [{steps:false},{grant:false},{refundAuthorized:false},{active:false}]){
    reject(()=>fixture(args).adapter.checkRefundReview(refundRequest,now),/(step-up|scope denied|ADMIN_DENIED|SESSION_REVOKED)/);
  }
});
test('refund review owner is sourced from trusted transaction ledger, never client identity',()=>{
  const {adapter}=fixture({owner:null});
  reject(()=>adapter.checkRefundReview(refundRequest,now),/TRANSACTION_OWNER_UNRESOLVED/);
  reject(()=>fixture().adapter.checkRefundReview({...refundRequest,s_user_id:'u2'},now),/CLIENT_CLAIMS_DENIED/);
  reject(()=>fixture().adapter.checkRefundReview({...refundRequest,ownerUserId:'u2'},now),/CLIENT_CLAIMS_DENIED/);
});
test('P05 parity candidate uses exactly canonical AI-0 envelope keys and accepts RFC3339 with offset',()=>{
  const mapped=toCanonicalBillingEnvelope(event,registry,'corr-1');
  assert.deepEqual(Object.keys(mapped).sort(),[
    'app_id','brand_id','correlation_id','environment','event_id','event_type',
    'occurred_at','resource_id','resource_type','result','schema_version',
  ].sort());
  assert.deepEqual([mapped.brand_id,mapped.app_id,mapped.environment,mapped.event_type],
    ['starry','starry.demo','staging','billing.purchase_verified']);
  assert.equal(mapped.occurred_at,'2026-10-26T07:00:00+00:00');
  for(const bad of ['2026-10-26T07:00:00','2026-10-26','nonsense','2026-10-26T25:00:00Z'])
    reject(()=>toCanonicalBillingEnvelope({...event,occurredAt:bad},registry,'corr-1'),/invalid timestamp/);
  assert.equal(Object.hasOwn(toCanonicalBillingEnvelope({...event,access_token:'do-not-leak'},registry,'corr-1'),'access_token'),false);
});
