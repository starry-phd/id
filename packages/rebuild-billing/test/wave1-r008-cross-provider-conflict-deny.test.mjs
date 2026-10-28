import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineR007OfficialProviderAdapterGate,
 R007_ADAPTER_CONTRACT,R007_OFFICIAL_ADAPTER_LIVE}
 from '../src/wave1-r007-official-provider-adapter-deny.ts';
import {createOfflineR008CrossProviderConflictGate,
 R008_RECONCILIATION_CONTRACT,R008_RECONCILIATION_LIVE,
 R008_REQUIRED_ADAPTER}
 from '../src/wave1-r008-cross-provider-conflict-deny.ts';
const NOW=1793000000;
const scope={brand_id:'starry',app_id:'starry.one',environment:'staging'};
const catalog=[{product_key:'vip.month',kind:'AUTO_RENEWABLE_SUBSCRIPTION',
 period:'MONTH',ios_sku:'vip.ios.month',android_sku:'vip.android.month'},
 {product_key:'vip.buyout',kind:'NON_CONSUMABLE',period:null,
 ios_sku:'vip.ios.buyout',android_sku:'vip.android.buyout'}];
const M='m_'+'a'.repeat(64),ORDER='o_'+'f'.repeat(64);
let count=0;
function observation(provider='apple',change={}){
 const platform=provider==='google'?'android':'ios';
 return {provider,evidence_kind:provider==='apple'?'apple_jws_claim':
  provider==='google'?'google_developer_api_claim':'revenuecat_webhook_claim',
  brand_id:'starry',app_id:scope.app_id,environment:'staging',platform,
  event_id:'event.'+(++count),transaction_id:'txn.member.'+count,
  original_transaction_id:'txn.original.one',member_digest:M,
  product_key:'vip.month',store_sku:platform==='ios'?'vip.ios.month':'vip.android.month',
  kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'MONTH',event_type:'purchase',
  source_version:1,occurred_at:NOW-2,...change};
}
const r007=()=>createOfflineR007OfficialProviderAdapterGate({
 enabled:true,scope,skuCatalog:catalog,nowSeconds:()=>NOW});
const gate=(enabled=true)=>createOfflineR008CrossProviderConflictGate({
 enabled,scope,nowSeconds:()=>NOW});
function pair({storeProvider='apple',storeEvent='purchase',rcEvent='purchase',
 storeChange={},rcChange={},correlation={}}={}){
 const store=r007().inspect(observation(storeProvider,{
  event_type:storeEvent,...storeChange}));
 const revenuecat=r007().inspect(observation('revenuecat',{
  platform:storeProvider==='google'?'android':'ios',
  store_sku:storeProvider==='google'?'vip.android.month':'vip.ios.month',
  event_type:rcEvent,...rcChange}));
 return {store,revenuecat,correlation:{
  brand_id:'starry',app_id:scope.app_id,environment:'staging',
  platform:storeProvider==='google'?'android':'ios',product_key:'vip.month',
  period:'MONTH',store_member_digest:M,rc_member_digest:M,
  store_original_order_digest:ORDER,rc_original_order_digest:ORDER,
  store_event_version:1,rc_event_version:1,
  store_event_at:NOW-2,rc_event_at:NOW-1,...correlation
 }};
}
function neverLive(r){
 assert.equal(r.contract,R008_RECONCILIATION_CONTRACT);
 for(const k of [
 'correlation_is_authoritative','official_apple_verified','official_google_verified',
 'official_revenuecat_verified','revenuecat_app_user_id_authorized',
 'current_signed_auth_verified','durable_order_cas_verified',
 'independent_anti_pitr_verified','can_purchase','can_restore','can_grant',
 'can_regrant','can_remove_ads','can_ack_webhook','can_send_p05','can_publish',
 'ads_enabled','live'])assert.equal(r[k],false,k);
 assert.equal(JSON.stringify(r).includes(M),false);
 assert.equal(JSON.stringify(r).includes(ORDER),false);
 assert.equal(JSON.stringify(r).includes('txn.original.one'),false);
 assert.ok(Object.isFrozen(r));
}
test('R008 contract pins R007 unverified adapter, stays OFF by default',()=>{
 assert.equal(R008_RECONCILIATION_LIVE,false);
 assert.equal(R007_OFFICIAL_ADAPTER_LIVE,false);
 assert.equal(R008_REQUIRED_ADAPTER,R007_ADAPTER_CONTRACT);
 const r=gate(false).reconcile(pair());
 assert.equal(r.status,'blocked');
 assert.equal(r.reason,'DEFAULT_DISABLED');neverLive(r);
});
test('matching Apple and RevenueCat unverified labels cannot grant',()=>{
 const r=gate().reconcile(pair());
 assert.equal(r.status,'review_only');
 assert.equal(r.reason,'MATCHING_UNVERIFIED_CLAIMS_NO_AUTHORITY');
 assert.equal(r.store_candidate,'apple');
 assert.equal(r.revenuecat_candidate,true);neverLive(r);
});
test('matching Google and RevenueCat unverified labels cannot grant',()=>{
 const r=gate().reconcile(pair({storeProvider:'google'}));
 assert.equal(r.status,'review_only');
 assert.equal(r.store_candidate,'google');neverLive(r);
});
test('Store purchase and RevenueCat refund contradiction fail closed',()=>{
 const r=gate().reconcile(pair({rcEvent:'refund'}));
 assert.equal(r.reason,'REFUND_OR_REVOCATION_DENIES_RESTORE');neverLive(r);
});
test('Store refund wins over stale RevenueCat purchase',()=>{
 const r=gate().reconcile(pair({storeEvent:'refund'}));
 assert.equal(r.reason,'REFUND_OR_REVOCATION_DENIES_RESTORE');neverLive(r);
});
test('either source revoke denies restore or regrant',()=>{
 for(const k of [{storeEvent:'revoke'},{rcEvent:'revoke'}]){
  const r=gate().reconcile(pair(k));
  assert.equal(r.reason,'REFUND_OR_REVOCATION_DENIES_RESTORE');neverLive(r);
 }
});
test('expired Store versus active RevenueCat is not active entitlement',()=>{
 const r=gate().reconcile(pair({storeEvent:'expire'}));
 assert.equal(r.reason,'EXPIRED_OR_GRACE_NO_VERIFIED_ENTITLEMENT');neverLive(r);
});
test('grace RevenueCat versus Store renewal does not open entitlement',()=>{
 const r=gate().reconcile(pair({storeEvent:'renewal',rcEvent:'grace'}));
 assert.equal(r.reason,'EXPIRED_OR_GRACE_NO_VERIFIED_ENTITLEMENT');neverLive(r);
});
test('renewal/purchase mismatch is blocked even with matching digest',()=>{
 const r=gate().reconcile(pair({storeEvent:'renewal'}));
 assert.equal(r.reason,'INCONSISTENT_VENDOR_EVENT_STATE');neverLive(r);
});
test('matching renewal still lacks official verification',()=>{
 const r=gate().reconcile(pair({storeEvent:'renewal',rcEvent:'renewal'}));
 assert.equal(r.status,'review_only');neverLive(r);
});
test('restore cannot be approved from two unsupported claims',()=>{
 const r=gate().reconcile(pair({storeEvent:'restore',rcEvent:'restore'}));
 assert.equal(r.reason,'RESTORE_NEEDS_AUTHORITY_AND_LEDGER');neverLive(r);
});
test('RevenueCat App User ID/member swap denied',()=>{
 const r=gate().reconcile(pair({correlation:{rc_member_digest:'m_'+'b'.repeat(64)}}));
 assert.equal(r.reason,'REVENUECAT_MEMBER_MAPPING_CONFLICT');neverLive(r);
});
test('RevenueCat order lineage swap denied',()=>{
 const r=gate().reconcile(pair({correlation:{rc_original_order_digest:'o_'+'b'.repeat(64)}}));
 assert.equal(r.reason,'REVENUECAT_ORDER_LINK_CONFLICT');neverLive(r);
});
test('Google Store cannot be injected into iOS correlation',()=>{
 const r=gate().reconcile(pair({storeProvider:'google',correlation:{platform:'ios'}}));
 assert.equal(r.reason,'STORE_PLATFORM_CONFLICT');neverLive(r);
});
test('cross app, H-Global, production and Battery rejected',()=>{
 for(const c of [{app_id:'starry.other'},{brand_id:'hglobal'},
  {environment:'production'},{product_key:'battery.paid'}]){
  const r=gate().reconcile(pair({correlation:c}));
  assert.equal(r.reason,'MALFORMED_CORRELATION');neverLive(r);
 }
});
test('additional entitlement or verified fields fail closed',()=>{
 const p=pair();
 const r=gate().reconcile({...p,verified:true,may_grant:true});
 assert.equal(r.reason,'MALFORMED_PAIR');neverLive(r);
});
test('forged R007 verified flag fails, not a claim of double authority',()=>{
 const p=pair();
 const r=gate().reconcile({...p,store:{...p.store,can_grant:true}});
 assert.equal(r.reason,'SOURCE_NOT_AUTHENTICATED');neverLive(r);
});
test('forged R007 status and provider fail closed',()=>{
 const p=pair();
 for(const candidate of [{...p.store,status:'verified'},{...p.store,provider_candidate:'revenuecat'},
  {...p.store,reason:'VERIFIED_OFFICIAL_JWS'}]){
  const r=gate().reconcile({...p,store:candidate});
  assert.equal(r.reason,'SOURCE_NOT_AUTHENTICATED');neverLive(r);
 }
});
test('R007 blocked provider cannot become a double-source entitlement',()=>{
 const p=pair();
 const blocked=r007().inspect(observation('google',{platform:'ios'}));
 assert.equal(blocked.status,'blocked');
 const r=gate().reconcile({...p,store:blocked});
 assert.equal(r.reason,'SOURCE_NOT_AUTHENTICATED');neverLive(r);
});
test('any source accessor cannot run and leaks no sensitive data',()=>{
 const p=pair();
 Object.defineProperty(p.correlation,'store_member_digest',{
  enumerable:true,get(){throw new Error('not evaluated');}});
 const r=gate().reconcile(p);
 assert.equal(r.status,'blocked');neverLive(r);
});
test('unexpected own keys on R007 review fail closed',()=>{
 const p=pair();
 const r=gate().reconcile({...p,revenuecat:{...p.revenuecat,app_user_id:'fake'}});
 assert.equal(r.reason,'SOURCE_NOT_AUTHENTICATED');neverLive(r);
});
test('clock, future event and bad cross-source version metadata block',()=>{
 const p=pair();
 for(const change of [{store_event_at:NOW+30},{rc_event_version:0},
  {store_event_version:NaN},{rc_event_at:0}]){
  const r=gate().reconcile({...p,correlation:{...p.correlation,...change}});
  assert.equal(r.reason,'MALFORMED_CORRELATION');neverLive(r);
 }
});
test('different source-local version counters MUST NOT be compared',()=>{
 const r=gate().reconcile(pair({correlation:{store_event_version:100,
  rc_event_version:1}}));
 assert.equal(r.status,'review_only');neverLive(r);
});
test('correlation key insertion order does not supply proof or break shape',()=>{
 const p=pair();
 const r=gate().reconcile({...p,correlation:Object.fromEntries(
  Object.entries(p.correlation).reverse())});
 assert.equal(r.status,'review_only');neverLive(r);
});
test('invalid scope is rejected at construction, never production',()=>{
 for(const x of [{...scope,environment:'production'},
  {...scope,app_id:'hglobal.member'},
  {...scope,app_id:'battery.store'}]){
  assert.throws(()=>createOfflineR008CrossProviderConflictGate({
   enabled:true,scope:x,nowSeconds:()=>NOW}),/R008_UNTRUSTED_SCOPE/);
 }
});
test('missing or malicious correlation is blocked, not exceptional',()=>{
 for(const x of [null,[],Object.create(null),new Proxy({}, {
  getPrototypeOf(){throw Error('not trusted');}})]){
  const r=gate().reconcile(x);
  assert.equal(r.status,'blocked');neverLive(r);
 }
});
