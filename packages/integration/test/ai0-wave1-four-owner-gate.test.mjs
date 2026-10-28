import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {WAVE1_PURCHASE_AUTH_LIVE_ENABLED} from '../../../modules/starry-id-v1/src/wave1-purchase-entry-auth-gate.ts';
import {WAVE1_BILLING_LIVE,createOfflineWave1BillingPolicy} from '../../rebuild-billing/src/wave1-billing-revenuecat-review.ts';
import {WAVE1_SECURITY_FENCE_LIVE,createWave1SecurityNotificationFence} from '../../rebuild-ai3/src/wave1-security-notification-fence.ts';
import {WAVE1_API_LIVE_APPROVED,auditWave1WorkerOpenApiContract} from '../../../apps/api/src/wave1-worker-openapi-parity.ts';

const get = path=>readFileSync(new URL('../../../'+path,import.meta.url));
const manifest=JSON.parse(get('docs/operations/ai0-wave1-four-owner-original-blob-integration.v1.json').toString());

test('AI-0 source-preserving integration imports exact 12 original owner Git blobs',()=>{
 assert.equal(manifest.owners.length,4);
 const seen=new Set();
 for(const owner of manifest.owners){
  assert.equal(owner.files.length,3);
  for(const f of owner.files){
   assert.ok(!seen.has(f.path),f.path);
   seen.add(f.path);
   const contents=get(f.path);
   const actual=createHash('sha1').update(Buffer.from('blob '+contents.length+'\0')).update(contents).digest('hex');
   assert.equal(actual,f.blob_sha,f.path);
  }
 }
 assert.equal(seen.size,12);
});

test('four owner review modules never authorize Store, Battery, notification, API or Production',async()=>{
 assert.equal(WAVE1_PURCHASE_AUTH_LIVE_ENABLED,false);
 assert.equal(WAVE1_BILLING_LIVE,false);
 assert.equal(WAVE1_SECURITY_FENCE_LIVE,false);
 assert.equal(WAVE1_API_LIVE_APPROVED,false);
 const bill=createOfflineWave1BillingPolicy({
  scope:{brand_id:'starry',app_id:'demo.starry',environment:'staging'},
  products:[{product_key:'premium.buyout',kind:'NON_CONSUMABLE',period:null,
   sku_ios:'demo.starry.ios.buyout',sku_android:'demo.starry.android.buyout',features:['vip_access']}],
  ports:{readIdentity:async()=>({kind:'offline_auth_fixture_only',brand_id:'starry',app_id:'demo.starry',
   member_digest:'m_'+'a'.repeat(64),auth_version:1,session_state:'active'}),
   readCandidateEvents:async()=>[]},enabled:true,nowSeconds:1793000000
 });
 const buy=await bill.purchasePreflight('premium.buyout');
 const view=await bill.inspect('premium.buyout');
 for(const x of [buy,view]){
  assert.equal(x.may_start_purchase,false);
  assert.equal(x.may_grant,false);
  assert.equal(x.official_store_verified,false);
  assert.equal(x.live,false);
 }
 const fence=createWave1SecurityNotificationFence({
  enabled:false,scope:{brand_id:'starry',app_id:'starry-demo',environment:'staging'},
  ports:{readSessionFence:async()=>null,verifyCanonicalSource:async()=> 'unknown',
   readDedupe:async()=> 'unknown',lawfulRetentionNow:async()=>false,
   notificationPreference:async()=> 'unknown'}
 });
 const message=await fence.review({event:null,channel:'inbox'});
 assert.equal(message.status,'blocked');
 assert.equal(message.may_send,false);
 assert.equal(message.may_ack_queue,false);
 assert.equal(message.may_purchase_battery,false);
 const api=await auditWave1WorkerOpenApiContract(null,{});
 assert.equal(api.status,'blocked');
 assert.equal(api.live_verified,false);
 assert.equal(api.may_deploy,false);
});

test('AI-0 Gate 1 remains blocked on trusted cross-owner connectors and Gate 3 on release',()=>{
 assert.equal(manifest.gate1.status,'PARTIAL_BLOCKED');
 assert.ok(manifest.gate1.blockers.includes('AI1_SIGNED_STAR_IDENTITY_TO_AI2_BILLING_TRUST_ADAPTER_NOT_APPROVED_OR_IMPLEMENTED'));
 assert.ok(manifest.gate1.blockers.includes('AI3_SIGNED_SOURCE_AND_AI1_SESSION_FENCE_AND_DURABLE_DEDUPE_NOT_BOUND'));
 assert.ok(manifest.gate1.blockers.includes('AI4_OPENAPI_ONLY_LIVENESS_NO_PROTECTED_BILLING_AUTH_BATTERY_ROUTES'));
 assert.equal(manifest.gate3.status,'BLOCKED');
 assert.equal(manifest.security.release_gates_blocked,11);
 assert.equal(manifest.security.ads_off,true);
 assert.equal(manifest.security.main_merge_authorized,false);
 assert.equal(manifest.security.production_authorized,false);
 assert.equal(manifest.security.new_consumer_monorepo_not_created,true);
});
