import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createOfflineR007OfficialProviderAdapterGate,R007_ADAPTER_CONTRACT,
 R007_OFFICIAL_ADAPTER_LIVE,R007_INHERITED_SYNTHETIC_BOUNDARY
} from '../src/wave1-r007-official-provider-adapter-deny.ts';
import {R006_STORE_BOUNDARY,R006_STORE_LIVE}
 from '../src/wave1-r006-synthetic-store-provenance.ts';

const NOW=1793000000;
const scope={brand_id:'starry',app_id:'starry.one',environment:'staging'};
const catalog=[
 {product_key:'vip.buyout',kind:'NON_CONSUMABLE',period:null,
  ios_sku:'vip.ios.buyout',android_sku:'vip.android.buyout'},
 {product_key:'vip.month',kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'MONTH',
  ios_sku:'vip.ios.month',android_sku:'vip.android.month'},
 {product_key:'vip.year',kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'YEAR',
  ios_sku:'vip.ios.year',android_sku:'vip.android.year'}
];
const digest='m_'+'a'.repeat(64);
let counter=0;
const make=(override={})=>({
 provider:'apple',evidence_kind:'apple_jws_claim',brand_id:'starry',
 app_id:'starry.one',environment:'staging',platform:'ios',
 event_id:'evt.'+(++counter),transaction_id:'txn.apple.one',
 original_transaction_id:'txn.apple.original',member_digest:digest,
 product_key:'vip.buyout',store_sku:'vip.ios.buyout',
 kind:'NON_CONSUMABLE',period:null,event_type:'purchase',
 source_version:1,occurred_at:NOW-1,...override
});
const gate=(enabled=true)=>createOfflineR007OfficialProviderAdapterGate({
 enabled,scope,skuCatalog:catalog,nowSeconds:()=>NOW
});
function neverLive(r){
 assert.equal(r.contract,R007_ADAPTER_CONTRACT);
 for(const k of [
  'source_is_officially_verified','apple_jws_verified','google_developer_api_verified',
  'google_rtdn_is_payment_proof','revenuecat_webhook_verified',
  'revenuecat_app_user_id_verified','signed_current_auth_verified','durable_cas_verified',
  'independent_anti_pitr_verified','can_purchase','can_restore','can_grant',
  'can_remove_ads','can_ack_webhook','can_send_p05','can_publish','ads_enabled','live'
 ])assert.equal(r[k],false,k);
 assert.ok(Object.isFrozen(r));
 assert.equal(JSON.stringify(r).includes(digest),false);
 assert.equal(JSON.stringify(r).includes('txn.apple.original'),false);
}
test('R007 adapter is deny-only and retains inherited R006 OFF',()=>{
 assert.equal(R007_OFFICIAL_ADAPTER_LIVE,false);
 assert.equal(R006_STORE_LIVE,false);
 assert.equal(R007_INHERITED_SYNTHETIC_BOUNDARY,R006_STORE_BOUNDARY);
 const r=gate(false).inspect(make());
 assert.equal(r.status,'blocked');
 assert.equal(r.reason,'DEFAULT_DISABLED');
 neverLive(r);
});
test('Apple JWS label is only an unverified candidate',()=>{
 const r=gate().inspect(make());
 assert.equal(r.status,'review_only');
 assert.equal(r.reason,'UNVERIFIED_APPLE_JWS_CLAIM');
 assert.equal(r.state_candidate,'unverified_active');
 neverLive(r);
});
test('Google Developer API label is not a verified purchase',()=>{
 const r=gate().inspect(make({provider:'google',platform:'android',
  evidence_kind:'google_developer_api_claim',store_sku:'vip.android.buyout'}));
 assert.equal(r.status,'review_only');
 assert.equal(r.reason,'UNVERIFIED_GOOGLE_DEVELOPER_API_CLAIM');
 neverLive(r);
});
test('RevenueCat webhook label cannot establish App User ID or Store authority',()=>{
 const r=gate().inspect(make({provider:'revenuecat',
  evidence_kind:'revenuecat_webhook_claim'}));
 assert.equal(r.status,'review_only');
 assert.equal(r.reason,'UNVERIFIED_REVENUECAT_WEBHOOK_CLAIM');
 neverLive(r);
});
test('Google RTDN alone is never payment validation',()=>{
 const r=gate().inspect(make({provider:'google',platform:'android',
  evidence_kind:'google_rtdn_claim',store_sku:'vip.android.buyout'}));
 assert.equal(r.reason,'NOTIFICATION_ALONE_NOT_PURCHASE_PROOF');neverLive(r);
});
test('Apple notification label alone is never payment validation',()=>{
 const r=gate().inspect(make({evidence_kind:'apple_notification_claim'}));
 assert.equal(r.reason,'NOTIFICATION_ALONE_NOT_PURCHASE_PROOF');neverLive(r);
});
test('source/platform mismatch fails closed',()=>{
 const r=gate().inspect(make({provider:'google',evidence_kind:'google_developer_api_claim'}));
 assert.equal(r.reason,'PROVIDER_PLATFORM_MISMATCH');neverLive(r);
});
test('source/evidence mismatch fails closed',()=>{
 const r=gate().inspect(make({evidence_kind:'revenuecat_webhook_claim'}));
 assert.equal(r.reason,'PROVIDER_EVIDENCE_MISMATCH');neverLive(r);
});
test('forged verified:true or client payment flags cannot create authority',()=>{
 const r=gate().inspect({...make(),verified:true,can_grant:true});
 assert.equal(r.reason,'INVALID_OR_CROSS_SCOPE_CLAIM');neverLive(r);
});
test('a hostile own-property getter is never evaluated',()=>{
 const o=make();
 Object.defineProperty(o,'store_sku',{get(){throw Error('unexpected getter');},enumerable:true});
 const r=gate().inspect(o);
 assert.equal(r.status,'blocked');neverLive(r);
});
test('wrong brand, app and environment fail closed',()=>{
 for(const change of [{brand_id:'hglobal'},{app_id:'starry.other'},
  {environment:'production'}]){
  const r=gate().inspect(make(change));
  assert.equal(r.reason,'INVALID_OR_CROSS_SCOPE_CLAIM');neverLive(r);
 }
});
test('cross-app and cross-platform SKU fail closed',()=>{
 for(const change of [{store_sku:'vip.ios.elsewhere'},
  {store_sku:'vip.android.buyout'},{product_key:'vip.missing'}]){
  const r=gate().inspect(make(change));
  assert.equal(r.reason,'UNLISTED_OR_CROSS_APP_SKU');neverLive(r);
 }
});
test('buyout/month/year categories remain distinct metadata only',()=>{
 for(const [key,sku,period] of [
  ['vip.month','vip.ios.month','MONTH'],['vip.year','vip.ios.year','YEAR']
 ]){
  const r=gate().inspect(make({product_key:key,store_sku:sku,
   kind:'AUTO_RENEWABLE_SUBSCRIPTION',period}));
  assert.equal(r.status,'review_only');neverLive(r);
 }
});
test('wrong subscription period is denied',()=>{
 const r=gate().inspect(make({product_key:'vip.month',store_sku:'vip.ios.month',
  kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'YEAR'}));
 assert.equal(r.reason,'UNLISTED_OR_CROSS_APP_SKU');neverLive(r);
});
test('same webhook/event replay is denied in disposable review memory',()=>{
 const g=gate(),a=make();
 assert.equal(g.inspect(a).status,'review_only');
 const r=g.inspect(a);
 assert.equal(r.reason,'EVENT_REPLAY');neverLive(r);
});
test('same Store transaction cannot be moved from iOS to Android',()=>{
 const g=gate(),a=make();
 assert.equal(g.inspect(a).status,'review_only');
 const r=g.inspect(make({provider:'google',platform:'android',
  evidence_kind:'google_developer_api_claim',store_sku:'vip.android.buyout',
  transaction_id:'txn.android.two',source_version:2}));
 assert.equal(r.reason,'CROSS_OS_OR_MEMBER_TRANSACTION_TRANSFER');neverLive(r);
});
test('same transaction cannot transfer between members',()=>{
 const g=gate(),a=make();
 g.inspect(a);
 const r=g.inspect(make({member_digest:'m_'+'b'.repeat(64),
  transaction_id:'txn.apple.second',source_version:2}));
 assert.equal(r.reason,'CROSS_OS_OR_MEMBER_TRANSACTION_TRANSFER');neverLive(r);
});
test('refund terminal event denies later restore and renewal',()=>{
 const g=gate();
 assert.equal(g.inspect(make({event_type:'purchase',source_version:1})).status,'review_only');
 const refund=g.inspect(make({event_type:'refund',source_version:2}));
 assert.equal(refund.state_candidate,'revoked');neverLive(refund);
 for(const event_type of ['restore','renewal','purchase']){
  const r=g.inspect(make({event_type,source_version:3}));
  assert.equal(r.reason,'REVOKED_ORDER_CANNOT_RESTORE_OR_RENEW');neverLive(r);
 }
});
test('revocation terminal event denies later restore',()=>{
 const g=gate();g.inspect(make());
 assert.equal(g.inspect(make({event_type:'revoke',source_version:2})).state_candidate,'revoked');
 const r=g.inspect(make({event_type:'restore',source_version:3}));
 assert.equal(r.reason,'REVOKED_ORDER_CANNOT_RESTORE_OR_RENEW');neverLive(r);
});
test('subscription expiry remains unverified and stale versions rejected',()=>{
 const g=gate();
 const month={product_key:'vip.month',store_sku:'vip.ios.month',
  kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'MONTH'};
 g.inspect(make({...month,source_version:1}));
 const expired=g.inspect(make({...month,event_type:'expire',source_version:2}));
 assert.equal(expired.state_candidate,'expired');neverLive(expired);
 const old=g.inspect(make({...month,event_type:'renewal',source_version:1}));
 assert.equal(old.reason,'DUPLICATE_OR_ROLLBACK_VERSION');neverLive(old);
});
test('future event time and unauthenticated member digest are denied',()=>{
 for(const update of [{occurred_at:NOW+60},{member_digest:'client-user@example.com'}]){
  const r=gate().inspect(make(update));
  assert.equal(r.reason,'INVALID_OR_CROSS_SCOPE_CLAIM');neverLive(r);
 }
});
test('malformed product registry fails before any review',()=>{
 assert.throws(()=>createOfflineR007OfficialProviderAdapterGate({
  enabled:true,scope,skuCatalog:[catalog[0],catalog[0]],nowSeconds:()=>NOW
 }),/R007_INVALID_OR_DUPLICATE_PRODUCT_CATALOG/);
});
test('candidate object insertion order never creates an extra source of authority',()=>{
 const o=make();
 const reordered=Object.fromEntries(Object.entries(o).reverse());
 const r=gate().inspect(reordered);
 assert.equal(r.status,'review_only');neverLive(r);
});
