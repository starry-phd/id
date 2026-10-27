import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {BILLING_R16_INBOX_MEMORY_DDL,BILLING_R16_INBOX_INSERT_SQL,
 BILLING_R16_PUBLISHER_ID} from '../src/deletion-single-publisher-inbox.ts';
import {BILLING_R18_MEMORY_DDL,BILLING_R18_REFUND_INSERT_SQL}
 from '../src/r18-refund-inbox.ts';
import {R19_BILLING_REFUND_SELECT,createOfflineBillingR19ReceiptReview}
 from '../src/r19-saga-receipt.ts';
import {BILLING_R17_READBACK_SQL} from '../src/deletion-readback-review.ts';
import {createOfflineBillingR20NamespaceGate} from '../src/r20-namespace-mapping-gate.ts';
import {createOfflineR21BillingUiProjection,R21_BILLING_UI_READ_SQL,
 R21_BILLING_LIVE,R21_BILLING_IAP_ENABLED,R21_BILLING_PURCHASE_ALLOWED}
 from '../src/r21-candidate-ui-billing-state.ts';

const ref=c=>'r_'+c.repeat(64),mem=c=>'m_'+c.repeat(64);
const authId='AuthDeletionEvent-20261028-0000001';
const billingId='BillingDeletionEvent-20261028-0000001';
const t=1793100000;
const auth4={event_id:authId,event_type:'account_deleted',member_ref:mem('a'),
 occurred_at_sec:t};
const b={brand_id:'starry',environment:'staging',app_ref:ref('b'),
 store_app_ref:ref('c'),member_ref:mem('d'),source_event_id:billingId,
 source_commit_ref:ref('e'),event_ref:ref('f'),event_digest:'1'.repeat(64),
 auth_version:8,occurred_at_sec:t,store:'google',transaction_ref:ref('2'),
 refund_event_ref:ref('3'),refund_source_version:11,refund_kind:'CHARGEBACK'};
const mapping={mapping_version:1,auth:auth4,auth_version:8,billing:b};
const billSchema=readFileSync(new URL('../schema/0007_account_deletion_fence_DRAFT.sql',import.meta.url),'utf8');
function fixture(opt={}){
 const auth=new DatabaseSync(':memory:'),bill=new DatabaseSync(':memory:'),
  floor=new DatabaseSync(':memory:');
 auth.exec('CREATE TABLE original(event_id TEXT PRIMARY KEY,event_type TEXT,member_ref TEXT,occurred_at_sec INTEGER)');
 auth.prepare('INSERT INTO original VALUES(?,?,?,?)').run(authId,'account_deleted',auth4.member_ref,t);
 auth.exec('CREATE TABLE deleted(status TEXT,brand_id TEXT,environment TEXT,app_ref TEXT,member_ref TEXT,source_event_id TEXT PRIMARY KEY,source_commit_ref TEXT,event_ref TEXT,event_digest TEXT,auth_version INTEGER,occurred_at_sec INTEGER,active_sessions INTEGER,revoked_before_or_at_deletion INTEGER)');
 auth.prepare('INSERT INTO deleted VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
  'deleted','starry','staging',b.app_ref,b.member_ref,billingId,
  b.source_commit_ref,b.event_ref,b.event_digest,8,t,0,1);
 floor.exec('CREATE TABLE binding(status TEXT,mapping_version INTEGER,brand_id TEXT,environment TEXT,auth_event_id TEXT,auth_member_ref TEXT,billing_member_digest TEXT,billing_source_event_id TEXT,auth_version INTEGER,store_app_ref TEXT,store_transaction_ref TEXT,store_refund_event_ref TEXT,store_source_version INTEGER)');
 floor.prepare('INSERT INTO binding VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
  'unapproved_local_mapping_candidate',1,'starry','staging',authId,auth4.member_ref,
  b.member_ref,billingId,8,b.store_app_ref,b.transaction_ref,b.refund_event_ref,11);
 floor.exec('CREATE TABLE witness(status TEXT,mapping_version INTEGER,brand_id TEXT,environment TEXT,auth_event_id TEXT,billing_member_digest TEXT,billing_source_event_id TEXT,store_refund_event_ref TEXT,store_source_version INTEGER)');
 floor.prepare('INSERT INTO witness VALUES(?,?,?,?,?,?,?,?,?)').run(
  'unapproved_local_test_floor',1,'starry','staging',authId,b.member_ref,billingId,b.refund_event_ref,11);
 bill.exec(billSchema);bill.exec(BILLING_R16_INBOX_MEMORY_DDL);
 bill.exec(BILLING_R18_MEMORY_DDL);
 if(opt.initialPaid){
  bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT(candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES(?,?,?,?,?)').run(
   ref('9'),'staging',b.member_ref,'digital.monthly','candidate_active');
 }
 if(opt.deletion!==false){
  bill.prepare(BILLING_R16_INBOX_INSERT_SQL).get('staging',BILLING_R16_PUBLISHER_ID,
   billingId,b.source_commit_ref,b.member_ref,b.event_ref,b.event_digest,8,t);
 }
 if(opt.refund!==false){
  bill.prepare(BILLING_R18_REFUND_INSERT_SQL).get('staging','google',
   b.store_app_ref,b.transaction_ref,b.refund_event_ref,11,b.member_ref,'CHARGEBACK');
 }
 const c={legal:0,auth:0,store:0,binding:0,floor:0,r20:0,sql:0};
 const scope={brand_id:'starry',environment:'staging',app_ref:b.app_ref,
  store_app_ref:b.store_app_ref};
 const mockStore={status:'offline_store_candidate_only',brand_id:'starry',
  environment:'staging',app_ref:b.app_ref,store_app_ref:b.store_app_ref,
  store:'google',transaction_ref:b.transaction_ref,
  refund_event_ref:b.refund_event_ref,refund_source_version:11,
  refund_kind:'CHARGEBACK'};
 const rwDb={prepare(sql){
  assert.ok([BILLING_R17_READBACK_SQL,R19_BILLING_REFUND_SELECT,
   R21_BILLING_UI_READ_SQL].includes(sql),'R21 read-only SELECT allowlist');
  assert.ok(sql.startsWith('SELECT')||sql.startsWith('WITH'));
  c.sql++;return {bind(...params){return {async first(){
   const row=bill.prepare(sql).get(...params);return row?{...row}:null;
  }};}};
 }};
 const r19=createOfflineBillingR19ReceiptReview({enabled:true,scope,billingDb:rwDb,
  ports:{
   async lawfulProcessingAndRetention(){return opt.legal!==false;},
   async readDeletedAuth(){
    const row=auth.prepare('SELECT * FROM deleted').get();return row?{...row}:null;
   },
   async readStoreCandidate(){return opt.missingStore?null:{...mockStore};},
   async readIndependentFloorCandidate(){return {
    status:'unapproved_test_floor',brand_id:'starry',
    environment:'staging',member_ref:b.member_ref,source_event_id:billingId,
    event_ref:b.event_ref,auth_version:8,
    refund_event_ref:b.refund_event_ref,refund_source_version:11};
   }
  }});
 const r20=createOfflineBillingR20NamespaceGate({enabled:true,scope,ports:{
  async lawfulProcessingAndRetention(){return opt.legal!==false;},
  async readAuthOriginal(){c.auth++;return opt.authLost?null:
   {...auth.prepare('SELECT * FROM original').get()};},
  async readBindingCandidate(){c.binding++;const row=floor.prepare('SELECT * FROM binding').get();return row?{...row}:null;},
  async readFloorCandidate(){c.floor++;const row=floor.prepare('SELECT * FROM witness').get();return row?{...row}:null;},
  async inspectBillingR19(input){return r19.inspect(input);}
 }});
 const ports={
  async lawfulProcessingAndRetention(){c.legal++;
   return opt.legal!==false&&!(opt.policyDrift&&c.legal>=2);},
  async readAuthCandidate(){c.auth++;
   if(opt.authUnavailable)return null;
   return {status:'offline_deleted_candidate',brand_id:'starry',
    environment:'staging',app_ref:b.app_ref};},
  async readStoreCandidate(){c.store++;
   return opt.storeUnavailable?null:{
    status:opt.storeUnverified?'unverified':'offline_refund_candidate',
    brand_id:'starry',environment:'staging',app_ref:b.app_ref,
    store_app_ref:opt.foreignStore?ref('8'):b.store_app_ref
   };},
  async inspectR20(m){c.r20++;
   if(opt.r20Drift&&c.r20>=2)return null;
   return r20.inspect(m);}
 };
 const app=(patch={})=>createOfflineR21BillingUiProjection({enabled:true,
  scope,db:rwDb,ports,...patch});
 return {auth,bill,floor,c,scope,ports,r19,r20,app,
  close(){auth.close();bill.close();floor.close();}};
}
const UI=x=>({screen:x,mapping});
function safe(v){
 assert.equal(v.version,1);
 assert.equal(v.kind,'starry_offline_candidate_billing_ui');
 assert.equal(v.product_approved,false);
 assert.deepEqual(v.battery,{permanently_free:true,purchasable:false,
  redeemable_for_paid:false});
 assert.deepEqual(v.store,{iap_available:false,purchase_enabled:false,
  subscription_active:false,verified_purchase:false,verified_refund:false,
  show_sku:false,show_price:false});
 for(const key of ['may_ack_queue','may_grant','may_regrant','may_restore',
  'may_publish','live'])assert.equal(v[key],false);
 const text=JSON.stringify(v);
 for(const key of [b.member_ref,auth4.member_ref,b.transaction_ref,
  b.refund_event_ref,b.store_app_ref,'digital.monthly','NT$','$'])assert.equal(text.includes(key),false);
 assert.equal(Object.hasOwn(v,'sku'),false);
 assert.equal(Object.hasOwn(v,'price'),false);
}
test('R21 all payment/release flags hard false and default no source reads',async t=>{
 const f=fixture();t.after(()=>f.close());
 assert.equal(R21_BILLING_LIVE,false);assert.equal(R21_BILLING_IAP_ENABLED,false);
 assert.equal(R21_BILLING_PURCHASE_ALLOWED,false);
 const o=await f.app({enabled:false}).project(UI('HOME'));safe(o);
 assert.equal(o.state,'iap_not_offered');assert.equal(f.c.sql,0);
 assert.equal(f.c.legal,0);assert.equal(f.c.r20,0);
});
test('TASK_REVIEW always permanently free and iap_not_offered without personal reads',async t=>{
 const f=fixture();t.after(()=>f.close());
 const o=await f.app().project(UI('TASK_REVIEW'));safe(o);
 assert.equal(o.state,'iap_not_offered');assert.equal(f.c.r20,0);
 assert.equal(f.c.sql,0);assert.equal(f.c.legal,0);
});
test('HOME reads real R20+R19 and separate SQLite refund: only refund_review_only',async t=>{
 const f=fixture();t.after(()=>f.close());
 const o=await f.app().project(UI('HOME'));safe(o);
 assert.equal(o.state,'refund_review_only');assert.equal(o.evidence,'local_only');
 assert.equal(f.c.r20,2);assert.equal(f.c.legal,2);
 assert.ok(f.c.sql>=8);
});
test('ACCOUNT_SETTINGS local revoked candidate never appears active subscription',async t=>{
 const f=fixture({initialPaid:true});t.after(()=>f.close());
 const row=f.bill.prepare('SELECT candidate_state FROM billing_entitlement_candidate_DRAFT').get();
 assert.equal(row.candidate_state,'revoked');
 const o=await f.app().project(UI('ACCOUNT_SETTINGS'));safe(o);
 assert.equal(o.state,'revoked');assert.equal(o.evidence,'local_only');
});
test('no official Store / signature becomes explicit official_store_unverified',async t=>{
 const f=fixture({storeUnavailable:true});t.after(()=>f.close());
 const o=await f.app().project(UI('HOME'));safe(o);
 assert.equal(o.state,'official_store_unverified');assert.equal(f.c.r20,0);
});
test('unverified Store candidate never implies PURCHASED or ACTIVE',async t=>{
 const f=fixture({storeUnverified:true});t.after(()=>f.close());
 const o=await f.app().project(UI('ACCOUNT_SETTINGS'));safe(o);
 assert.equal(o.state,'official_store_unverified');assert.equal(f.c.r20,0);
});
test('Q104/Q119 denied before Auth, Billing or Store reads',async t=>{
 const f=fixture({legal:false});t.after(()=>f.close());
 const o=await f.app().project(UI('HOME'));safe(o);
 assert.equal(o.state,'entitlement_unknown');assert.equal(o.reason,'POLICY_OR_LAW_UNAPPROVED');
 assert.equal(f.c.sql,0);assert.equal(f.c.auth,0);assert.equal(f.c.store,0);
});
test('Auth unavailable or revoked Session cannot leak stale paid UI',async t=>{
 const f=fixture({authUnavailable:true});t.after(()=>f.close());
 assert.equal((await f.app().project(UI('HOME'))).state,'entitlement_unknown');
 const q=fixture();t.after(()=>q.close());
 q.auth.exec('UPDATE deleted SET active_sessions=1');
 const o=await q.app().project(UI('HOME'));safe(o);
 assert.equal(o.state,'entitlement_unknown');
});
test('cross-app/store-app/environment/brand cannot reveal private Billing data',async t=>{
 const f=fixture();t.after(()=>f.close());
 for(const bad of [
  {...mapping,billing:{...b,app_ref:ref('8')}},
  {...mapping,billing:{...b,store_app_ref:ref('9')}},
  {...mapping,billing:{...b,environment:'development'}},
  {...mapping,billing:{...b,brand_id:'hglobal'}}
 ]){
  const o=await f.app().project({screen:'ACCOUNT_SETTINGS',mapping:bad});
  safe(o);assert.equal(o.state,'entitlement_unknown');
 }
 assert.equal(f.c.sql,0);
});
test('Store app response changed denies paid UI without source readback',async t=>{
 const f=fixture({foreignStore:true});t.after(()=>f.close());
 const o=await f.app().project(UI('HOME'));safe(o);
 assert.equal(o.state,'official_store_unverified');assert.equal(f.c.r20,0);
});
test('Auth deletion committed but Billing local deletion inbox missing',async t=>{
 const f=fixture({deletion:false});t.after(()=>f.close());
 const o=await f.app().project(UI('HOME'));safe(o);
 assert.equal(o.state,'entitlement_unknown');
});
test('Billing missing local refund inbox or rolled back independent floor denies',async t=>{
 const f=fixture({refund:false});t.after(()=>f.close());
 assert.equal((await f.app().project(UI('HOME'))).state,'entitlement_unknown');
 const q=fixture();t.after(()=>q.close());
 q.floor.exec('UPDATE witness SET store_source_version=1');
 const o=await q.app().project(UI('HOME'));safe(o);
 assert.equal(o.state,'entitlement_unknown');
});
test('older REFUNDED after newer CHARGEBACK remains unknown not purchased',async t=>{
 const f=fixture();t.after(()=>f.close());
 const old={...mapping,billing:{...b,refund_event_ref:ref('5'),
  refund_source_version:3,refund_kind:'REFUNDED'}};
 const o=await f.app().project({screen:'HOME',mapping:old});safe(o);
 assert.equal(o.state,'entitlement_unknown');
 assert.throws(()=>f.bill.prepare(BILLING_R18_REFUND_INSERT_SQL).get(
  'staging','google',b.store_app_ref,b.transaction_ref,ref('5'),3,
  b.member_ref,'REFUNDED'),/R18_STALE_OR_CONFLICTING_REFUND/);
});
test('late regrant or PITR-resurrected active entitlement never says active',async t=>{
 const f=fixture();t.after(()=>f.close());
 f.bill.exec('DROP TRIGGER billing_delete_no_late_insert_DRAFT');
 f.bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT(candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES(?,?,?,?,?)').run(
  ref('7'),'staging',b.member_ref,'digital.monthly','candidate_active');
 const o=await f.app().project(UI('ACCOUNT_SETTINGS'));safe(o);
 assert.equal(o.state,'entitlement_unknown');
});
test('policy or owner proof drifts after local read => entitlement_unknown',async t=>{
 for(const option of [{policyDrift:true},{r20Drift:true}]){
  const f=fixture(option);t.after(()=>f.close());
  const o=await f.app().project(UI('HOME'));safe(o);
  assert.equal(o.state,'entitlement_unknown');
 }
});
test('duplicate local receipt does not create double purchase or Queue ACK',async t=>{
 const f=fixture();t.after(()=>f.close());
 const a=await f.app().project(UI('HOME')),v=await f.app().project(UI('HOME'));
 safe(a);safe(v);assert.equal(a.state,'refund_review_only');
 assert.equal(v.state,a.state);
 assert.equal(f.bill.prepare('SELECT COUNT(*) n FROM billing_r18_refund_inbox_DRAFT').get().n,1);
});
test('permanently free Battery cannot be paid, exchanged or priced',async t=>{
 const f=fixture();t.after(()=>f.close());
 assert.throws(()=>f.bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT(candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES(?,?,?,?,?)').run(
  ref('4'),'staging',b.member_ref,'battery.X_Y.topup','candidate_active'));
 const o=await f.app().project(UI('TASK_REVIEW'));safe(o);
 assert.equal(o.battery.redeemable_for_paid,false);
});
test('SQL down, hostile Proxy or foreign screen fails closed with no entitlement',async t=>{
 const f=fixture();t.after(()=>f.close());
 const o=await f.app({db:{prepare(){throw Error('offline');}}}).project(UI('HOME'));
 safe(o);assert.equal(o.state,'entitlement_unknown');
 const evil=new Proxy(UI('HOME'),{ownKeys(){throw Error('trap');}});
 safe(await f.app().project(evil));
 const getter=Object.defineProperty({screen:'HOME'},'mapping',{enumerable:true,
  get(){throw Error('accessor')}});
 safe(await f.app().project(getter));
 const foreign=await f.app().project({screen:'STORE_CHECKOUT',mapping});
 safe(foreign);assert.equal(foreign.state,'entitlement_unknown');
});
test('R20 fake successful authority must not be used to show paid success',async t=>{
 const f=fixture();t.after(()=>f.close());
 const result=await f.app({ports:{...f.ports,async inspectR20(){
  return {status:'review_only',reason:'FAKE',
   candidate:{hmac_binding_approved:true,store_signature_verified:true},
   may_ack_queue:true,may_regrant:false,may_restore:false,may_publish:false,
   may_grant:false,live:false};
 }}}).project(UI('HOME'));
 safe(result);assert.equal(result.state,'entitlement_unknown');
});
