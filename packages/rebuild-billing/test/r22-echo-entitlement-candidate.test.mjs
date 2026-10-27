import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {BILLING_R16_INBOX_MEMORY_DDL,BILLING_R16_INBOX_INSERT_SQL,
 BILLING_R16_PUBLISHER_ID} from '../src/deletion-single-publisher-inbox.ts';
import {BILLING_R18_MEMORY_DDL,BILLING_R18_REFUND_INSERT_SQL}
 from '../src/r18-refund-inbox.ts';
import {BILLING_R17_READBACK_SQL} from '../src/deletion-readback-review.ts';
import {R19_BILLING_REFUND_SELECT,createOfflineBillingR19ReceiptReview}
 from '../src/r19-saga-receipt.ts';
import {createOfflineBillingR20NamespaceGate} from '../src/r20-namespace-mapping-gate.ts';
import {R21_BILLING_UI_READ_SQL,createOfflineR21BillingUiProjection}
 from '../src/r21-candidate-ui-billing-state.ts';
import {R22_ECHO_BILLING_SELECT,createOfflineEchoEntitlementCandidate,
 R22_ECHO_LIVE,R22_ECHO_PURCHASE_ALLOWED,R22_ECHO_STORE_ENABLED}
 from '../src/r22-echo-entitlement-candidate.ts';

const ref=c=>'r_'+c.repeat(64),mem=c=>'m_'+c.repeat(64);
const event='AuthDeleteEvent-20261028-0000000123';
const source='BillingDeleteEvent-20261028-00000001';
const time=1793100000;
const auth4={event_id:event,event_type:'account_deleted',member_ref:mem('a'),occurred_at_sec:time};
const b={brand_id:'starry',environment:'staging',app_ref:ref('b'),store_app_ref:ref('c'),
 member_ref:mem('d'),source_event_id:source,source_commit_ref:ref('e'),
 event_ref:ref('f'),event_digest:'1'.repeat(64),auth_version:8,
 occurred_at_sec:time,store:'google',transaction_ref:ref('2'),
 refund_event_ref:ref('3'),refund_source_version:11,refund_kind:'CHARGEBACK'};
const mapping={mapping_version:1,auth:auth4,auth_version:8,billing:b};
const schema=readFileSync(new URL('../schema/0007_account_deletion_fence_DRAFT.sql',import.meta.url),'utf8');
const origin='yukidu/Echo-Starry@82cbf4f112af57fcfed12ff2f6cf86010c03560e';
const kinds={
 vip_private_audio:'legacy_private_vip_share',
 rank_gated_playback:'legacy_rank_permission',
 legacy_sticker_unlock:'legacy_sticker_unlock',
 ai_speaker_qa:'legacy_qa_quota',
 free_battery:'free_battery',
 potential_subscription:'none'
};
function fixture(opt={}){
 const auth=new DatabaseSync(':memory:'),bill=new DatabaseSync(':memory:'),
  floor=new DatabaseSync(':memory:');
 auth.exec('CREATE TABLE original(event_id TEXT PRIMARY KEY,event_type TEXT,member_ref TEXT,occurred_at_sec INTEGER)');
 auth.prepare('INSERT INTO original VALUES(?,?,?,?)')
  .run(event,'account_deleted',auth4.member_ref,time);
 auth.exec('CREATE TABLE deleted(status TEXT,brand_id TEXT,environment TEXT,app_ref TEXT,member_ref TEXT,source_event_id TEXT PRIMARY KEY,source_commit_ref TEXT,event_ref TEXT,event_digest TEXT,auth_version INTEGER,occurred_at_sec INTEGER,active_sessions INTEGER,revoked_before_or_at_deletion INTEGER)');
 auth.prepare('INSERT INTO deleted VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('deleted','starry','staging',b.app_ref,b.member_ref,source,b.source_commit_ref,b.event_ref,b.event_digest,8,time,0,1);
 floor.exec('CREATE TABLE binding(status TEXT,mapping_version INTEGER,brand_id TEXT,environment TEXT,auth_event_id TEXT,auth_member_ref TEXT,billing_member_digest TEXT,billing_source_event_id TEXT,auth_version INTEGER,store_app_ref TEXT,store_transaction_ref TEXT,store_refund_event_ref TEXT,store_source_version INTEGER)');
 floor.prepare('INSERT INTO binding VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
 'unapproved_local_mapping_candidate',1,'starry','staging',event,auth4.member_ref,
 b.member_ref,source,8,b.store_app_ref,b.transaction_ref,b.refund_event_ref,11);
 floor.exec('CREATE TABLE witness(status TEXT,mapping_version INTEGER,brand_id TEXT,environment TEXT,auth_event_id TEXT,billing_member_digest TEXT,billing_source_event_id TEXT,store_refund_event_ref TEXT,store_source_version INTEGER)');
 floor.prepare('INSERT INTO witness VALUES(?,?,?,?,?,?,?,?,?)').run(
  'unapproved_local_test_floor',1,'starry','staging',event,b.member_ref,source,
  b.refund_event_ref,11);
 bill.exec(schema);bill.exec(BILLING_R16_INBOX_MEMORY_DDL);
 bill.exec(BILLING_R18_MEMORY_DDL);
 if(opt.paidBeforeDeletion)bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT(candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES(?,?,?,?,?)')
  .run(ref('9'),'staging',b.member_ref,'echo.vip.candidate','candidate_active');
 if(opt.deleteInbox!==false)bill.prepare(BILLING_R16_INBOX_INSERT_SQL).get(
  'staging',BILLING_R16_PUBLISHER_ID,source,b.source_commit_ref,b.member_ref,
  b.event_ref,b.event_digest,8,time);
 if(opt.refundInbox!==false)bill.prepare(BILLING_R18_REFUND_INSERT_SQL).get(
  'staging','google',b.store_app_ref,b.transaction_ref,b.refund_event_ref,11,
  b.member_ref,'CHARGEBACK');
 const scope={brand_id:'starry',environment:'staging',app_ref:b.app_ref,
  store_app_ref:b.store_app_ref};
 const counts={law:0,legacy:0,r21:0,sql:0};
 const db={prepare(sql){
  assert.ok([BILLING_R17_READBACK_SQL,R19_BILLING_REFUND_SELECT,
   R21_BILLING_UI_READ_SQL,R22_ECHO_BILLING_SELECT].includes(sql),'read SQL allowlist');
  assert.ok(sql.startsWith('SELECT')||sql.startsWith('WITH'));
  counts.sql++;
  return {bind(...params){return {async first(){
   const row=bill.prepare(sql).get(...params);return row?{...row}:null;
  }};}};
 }};
 const store={status:'offline_store_candidate_only',brand_id:'starry',
  environment:'staging',app_ref:b.app_ref,store_app_ref:b.store_app_ref,
  store:'google',transaction_ref:b.transaction_ref,refund_event_ref:b.refund_event_ref,
  refund_source_version:11,refund_kind:'CHARGEBACK'};
 const r19=createOfflineBillingR19ReceiptReview({enabled:true,scope,billingDb:db,
  ports:{
   async lawfulProcessingAndRetention(){return opt.law!==false;},
   async readDeletedAuth(){
    const row=auth.prepare('SELECT * FROM deleted').get();return row?{...row}:null;
   },
   async readStoreCandidate(){return opt.storeUnavailable?null:{...store};},
   async readIndependentFloorCandidate(){return {
    status:'unapproved_test_floor',brand_id:'starry',
    environment:'staging',member_ref:b.member_ref,source_event_id:source,
    event_ref:b.event_ref,auth_version:8,
    refund_event_ref:b.refund_event_ref,refund_source_version:11};}
  }});
 const r20=createOfflineBillingR20NamespaceGate({enabled:true,scope,ports:{
  async lawfulProcessingAndRetention(){return opt.law!==false;},
  async readAuthOriginal(){
   const row=auth.prepare('SELECT * FROM original').get();return row?{...row}:null;
  },
  async readBindingCandidate(){
   const row=floor.prepare('SELECT * FROM binding').get();return row?{...row}:null;
  },
  async readFloorCandidate(){
   const row=floor.prepare('SELECT * FROM witness').get();return row?{...row}:null;
  },
  async inspectBillingR19(x){return r19.inspect(x);}
 }});
 const r21=createOfflineR21BillingUiProjection({enabled:true,scope,db,
  ports:{
   async lawfulProcessingAndRetention(){return opt.law!==false;},
   async readAuthCandidate(){return {
    status:'offline_deleted_candidate',brand_id:'starry',
    environment:'staging',app_ref:b.app_ref};},
   async readStoreCandidate(){return opt.storeUnavailable?null:{
    status:'offline_refund_candidate',brand_id:'starry',environment:'staging',
    app_ref:b.app_ref,store_app_ref:b.store_app_ref};},
   async inspectR20(x){return r20.inspect(x);}
 }});
 const ports={
  async lawfulProcessingAndRetention(){counts.law++;
   return opt.law!==false&&!(opt.lawDrift&&counts.law>=2);},
  async readLegacyFeatureCandidate(feature){counts.legacy++;
   if(opt.legacyMissing||opt.legacyDrift&&counts.legacy>=2)return null;
   return {origin,kind:'unapproved_legacy_semantic_observation',feature,
    brand_id:opt.legacyBrand||'starry',environment:'staging',
    access_type:kinds[feature],member_link_approved:false,
    official_store_sku:opt.legacySku===true,price_approved:false};},
  async projectR21(screen,x){counts.r21++;
   if(opt.r21Drift&&counts.r21>=2)return null;
   return r21.project({screen,mapping:x});}
 };
 const make=(x={})=>createOfflineEchoEntitlementCandidate({
  enabled:true,scope,billingDb:db,ports,...x});
 const inspect=(feature,overrides={},conf={})=>make(conf).inspect({
  version:1,feature,mapping,...overrides});
 return {auth,bill,floor,counts,db,scope,ports,r21,inspect,make,
  close(){auth.close();bill.close();floor.close();}};
}
function deny(o){
 assert.equal(o.schema_version,'starry.echo.entitlement-candidate.v1-offline');
 assert.equal(o.app,'echo_starry');assert.equal(o.battery_permanently_free,true);
 for(const k of ['legacy_right_confirmed','playback_authorized',
  'vip_unlocked','sticker_unlocked','qa_charge_allowed','official_store_verified',
  'subscription_active','can_buy_battery','can_sell_stickers','may_purchase',
  'may_grant','may_regrant','may_restore','may_ack_queue','may_publish','live'])
  assert.equal(o[k],false,k);
 const serialized=JSON.stringify(o);
 for(const secret of [b.member_ref,auth4.member_ref,b.transaction_ref,
  b.store_app_ref,b.refund_event_ref,source,event,'$', 'NT$'])
  assert.ok(!serialized.includes(secret));
 for(const k of ['sku','price','member_ref','transaction_ref',
  'auth_event_id','shareSlug','password'])assert.equal(Object.hasOwn(o,k),false);
}
test('R22 disabled defaults to no protected reads or Store',async t=>{
 const f=fixture();t.after(()=>f.close());
 assert.equal(R22_ECHO_LIVE,false);assert.equal(R22_ECHO_STORE_ENABLED,false);
 assert.equal(R22_ECHO_PURCHASE_ALLOWED,false);
 const o=await f.make({enabled:false}).inspect({version:1,feature:'vip_private_audio',mapping});
 deny(o);assert.equal(o.state,'unavailable');
 assert.deepEqual(f.counts,{law:0,legacy:0,r21:0,sql:0});
});
test('free Battery cannot be purchased or converted; zero protected reads',async t=>{
 const f=fixture();t.after(()=>f.close());
 const o=await f.inspect('free_battery');deny(o);
 assert.equal(o.domain,'free_battery');assert.equal(o.state,'free_not_purchasable');
 assert.deepEqual(f.counts,{law:0,legacy:0,r21:0,sql:0});
});
test('Legacy private VIP share remains unapproved playback; real R19/R20/R21 + SQL',async t=>{
 const f=fixture();t.after(()=>f.close());
 const o=await f.inspect('vip_private_audio');deny(o);
 assert.equal(o.domain,'content_playback');assert.equal(o.state,'review_only');
 assert.equal(o.source_authority,'unapproved_local');
 assert.equal(f.counts.legacy,2);assert.equal(f.counts.r21,2);
 assert.ok(f.counts.sql>=12);
});
test('legacy required member rank is NOT approved new billing tier',async t=>{
 const f=fixture();t.after(()=>f.close());
 const o=await f.inspect('rank_gated_playback');deny(o);
 assert.equal(o.domain,'content_playback');assert.equal(o.state,'review_only');
 assert.equal(o.playback_authorized,false);
});
test('old stickers are legacy consumption, not a Store SKU or grant',async t=>{
 const f=fixture();t.after(()=>f.close());
 const o=await f.inspect('legacy_sticker_unlock');deny(o);
 assert.equal(o.domain,'legacy_virtual_consumption');
 assert.equal(o.state,'review_only');assert.equal(o.sticker_unlocked,false);
});
test('AI QA legacy free Battery cost/quotas not a paid IAP',async t=>{
 const f=fixture();t.after(()=>f.close());
 const o=await f.inspect('ai_speaker_qa');deny(o);
 assert.equal(o.state,'unavailable');
 assert.equal(o.qa_charge_allowed,false);
});
test('potential Store subscription not yet an approved Echo SKU',async t=>{
 const f=fixture();t.after(()=>f.close());
 const o=await f.inspect('potential_subscription');deny(o);
 assert.equal(o.domain,'potential_store_subscription');
 assert.equal(o.state,'refund_review_only');
 assert.equal(o.subscription_active,false);
});
test('old legacy metadata cannot mint approved Store SKU',async t=>{
 const f=fixture({legacySku:true});t.after(()=>f.close());
 const o=await f.inspect('vip_private_audio');deny(o);
 assert.equal(o.state,'blocked');assert.equal(f.counts.r21,0);
});
test('missing or drifted original legacy evidence blocks rather than unlocks',async t=>{
 for(const opt of [{legacyMissing:true},{legacyDrift:true},{legacyBrand:'hglobal'}]){
  const f=fixture(opt);t.after(()=>f.close());
  const o=await f.inspect('vip_private_audio');deny(o);
  assert.equal(o.state,'blocked');
 }
});
test('no Q104/Q119 approval prevents accessing old or new member sources',async t=>{
 const f=fixture({law:false});t.after(()=>f.close());
 const o=await f.inspect('vip_private_audio');deny(o);
 assert.equal(o.state,'blocked');assert.equal(f.counts.legacy,0);
 assert.equal(f.counts.r21,0);assert.equal(f.counts.sql,0);
});
test('missing official Store candidate yields no Echo entitlement',async t=>{
 const f=fixture({storeUnavailable:true});t.after(()=>f.close());
 const o=await f.inspect('potential_subscription');deny(o);
 assert.equal(o.state,'unavailable');assert.equal(f.counts.sql,0);
});
test('wrong app, Store app, member ref, brand and environment denied before private reads',async t=>{
 const f=fixture();t.after(()=>f.close());
 const versions=[
  {...mapping,billing:{...b,app_ref:ref('8')}},
  {...mapping,billing:{...b,store_app_ref:ref('9')}},
  {...mapping,billing:{...b,member_ref:mem('2')}},
  {...mapping,billing:{...b,brand_id:'hglobal'}},
  {...mapping,billing:{...b,environment:'development'}},
  {...mapping,billing:{...b,auth_version:6}},
 ];
 for(const x of versions){
  const o=await f.inspect('vip_private_audio',{mapping:x});deny(o);
  assert.equal(o.state,'blocked');
 }
 assert.equal(f.counts.sql,0);
});
test('partial Billing delete receipt, stale PITR or old refund floor denied',async t=>{
 for(const opt of [{deleteInbox:false},{refundInbox:false}]){
  const f=fixture(opt);t.after(()=>f.close());
  const o=await f.inspect('vip_private_audio');deny(o);
  assert.equal(o.state,'unavailable');
 }
 const f=fixture();t.after(()=>f.close());
 f.floor.exec('UPDATE witness SET store_source_version=2');
 const o=await f.inspect('vip_private_audio');deny(o);
 assert.equal(o.state,'unavailable');
});
test('late refund REFUNDED cannot override newer CHARGEBACK version floor',async t=>{
 const f=fixture();t.after(()=>f.close());
 const bad={...mapping,billing:{...b,refund_event_ref:ref('4'),
  refund_source_version:4,refund_kind:'REFUNDED'}};
 const o=await f.inspect('potential_subscription',{mapping:bad});deny(o);
 assert.equal(o.state,'unavailable');
 assert.throws(()=>f.bill.prepare(BILLING_R18_REFUND_INSERT_SQL).get(
  'staging','google',b.store_app_ref,b.transaction_ref,ref('4'),4,
  b.member_ref,'REFUNDED'),/R18_STALE_OR_CONFLICTING_REFUND/);
});
test('paid candidate after deletion / revoked local cannot imply access',async t=>{
 const f=fixture({paidBeforeDeletion:true});t.after(()=>f.close());
 const o=await f.inspect('vip_private_audio');deny(o);
 assert.equal(o.state,'revoked_local_only');
 assert.equal(o.playback_authorized,false);
 const g=fixture();t.after(()=>g.close());
 g.bill.exec('DROP TRIGGER billing_delete_no_late_insert_DRAFT');
 g.bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT(candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES(?,?,?,?,?)')
  .run(ref('7'),'staging',b.member_ref,'echo.vip.candidate','candidate_active');
 deny(await g.inspect('vip_private_audio'));
 assert.equal((await g.inspect('potential_subscription')).state,'unavailable');
});
test('free Battery X/Y remains blocked as paid Billing SKU by original R14 SQL',async t=>{
 const f=fixture();t.after(()=>f.close());
 assert.throws(()=>f.bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT(candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES(?,?,?,?,?)')
  .run(ref('6'),'staging',b.member_ref,'starry.battery.X.topup','candidate_active'));
 deny(await f.inspect('free_battery'));
});
test('local refund duplicate never grants VIP or changes Billing',async t=>{
 const f=fixture();t.after(()=>f.close());
 deny(await f.inspect('vip_private_audio'));deny(await f.inspect('vip_private_audio'));
 assert.equal(f.bill.prepare('SELECT COUNT(*) n FROM billing_r18_refund_inbox_DRAFT').get().n,1);
});
test('law drift, source drift and fake R21 official proof all fail closed',async t=>{
 for(const opt of [{lawDrift:true},{r21Drift:true}]){
  const f=fixture(opt);t.after(()=>f.close());
  const o=await f.inspect('rank_gated_playback');deny(o);
  assert.equal(o.state,'blocked');
 }
 const f=fixture();t.after(()=>f.close());
 const ports={...f.ports,async projectR21(){return {
  version:1,kind:'starry_offline_candidate_billing_ui',screen:'HOME',
  state:'refund_review_only',reason:'fake',product_approved:false,
  evidence:'local_only',battery:{permanently_free:true,purchasable:false,
   redeemable_for_paid:false},
  store:{iap_available:true,purchase_enabled:true,subscription_active:true,
   verified_purchase:true,verified_refund:false,show_sku:true,show_price:true},
  may_ack_queue:true,may_grant:false,may_regrant:false,may_restore:false,
  may_publish:false,live:false
 };}};
 const o=await f.make({ports}).inspect({version:1,feature:'vip_private_audio',mapping});
 deny(o);assert.equal(o.state,'blocked');
});
test('Hostile getters, unknown features and SQL outage never authorize content',async t=>{
 const f=fixture();t.after(()=>f.close());
 const evil=new Proxy({version:1,feature:'vip_private_audio',mapping},
  {ownKeys(){throw Error('trap');}});
 deny(await f.make().inspect(evil));
 const no=await f.make().inspect({version:1,feature:'echo_real_paid',mapping});
 deny(no);assert.equal(no.state,'blocked');
 const db={prepare(){throw Error('db down')}};
 const o=await f.make({billingDb:db}).inspect({
  version:1,feature:'vip_private_audio',mapping});
 deny(o);assert.equal(o.state,'blocked');
});
