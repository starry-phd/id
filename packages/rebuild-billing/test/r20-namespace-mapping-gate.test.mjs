import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {BILLING_R16_INBOX_MEMORY_DDL,BILLING_R16_INBOX_INSERT_SQL,
 BILLING_R16_PUBLISHER_ID} from '../src/deletion-single-publisher-inbox.ts';
import {BILLING_R18_MEMORY_DDL,BILLING_R18_REFUND_INSERT_SQL}
 from '../src/r18-refund-inbox.ts';
import {createOfflineBillingR19ReceiptReview,R19_BILLING_REFUND_SELECT}
 from '../src/r19-saga-receipt.ts';
import {BILLING_R17_READBACK_SQL} from '../src/deletion-readback-review.ts';
import {createOfflineBillingR20NamespaceGate,
 R20_BILLING_LIVE,R20_BILLING_ACK_ALLOWED,R20_BILLING_BINDING_APPROVED,
 R20_BILLING_STORE_SIGNER_APPROVED} from '../src/r20-namespace-mapping-gate.ts';

const ref=x=>'r_'+x.repeat(64),member=x=>'m_'+x.repeat(64);
const originalEvent='AuthCommittedDeletionEvent-20261027-00001';
const sourceEvent='BillingDeletionEvent-20261027-00001';
const time=1793100000;
const authEvent={event_id:originalEvent,event_type:'account_deleted',
 member_ref:member('a'),occurred_at_sec:time};
const billing={brand_id:'starry',environment:'staging',app_ref:ref('b'),
 store_app_ref:ref('c'),member_ref:member('d'),source_event_id:sourceEvent,
 source_commit_ref:ref('e'),event_ref:ref('f'),event_digest:'1'.repeat(64),
 auth_version:8,occurred_at_sec:time,store:'apple',transaction_ref:ref('2'),
 refund_event_ref:ref('3'),refund_source_version:11,refund_kind:'CHARGEBACK'};
const request={mapping_version:1,auth:authEvent,auth_version:8,billing};
const billSchema=readFileSync(new URL('../schema/0007_account_deletion_fence_DRAFT.sql',import.meta.url),'utf8');
function fixture(opt={}){
 const auth=new DatabaseSync(':memory:'),bill=new DatabaseSync(':memory:'),
  floor=new DatabaseSync(':memory:');
 auth.exec('CREATE TABLE original(event_id TEXT PRIMARY KEY,event_type TEXT,member_ref TEXT,occurred_at_sec INTEGER)');
 auth.prepare('INSERT INTO original VALUES(?,?,?,?)').run(
  originalEvent,'account_deleted',authEvent.member_ref,time);
 auth.exec('CREATE TABLE deleted(status TEXT,brand_id TEXT,environment TEXT,app_ref TEXT,member_ref TEXT,source_event_id TEXT PRIMARY KEY,source_commit_ref TEXT,event_ref TEXT,event_digest TEXT,auth_version INTEGER,occurred_at_sec INTEGER,active_sessions INTEGER,revoked_before_or_at_deletion INTEGER)');
 auth.prepare('INSERT INTO deleted VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
  'deleted','starry','staging',billing.app_ref,billing.member_ref,sourceEvent,
  billing.source_commit_ref,billing.event_ref,billing.event_digest,8,time,0,1);
 floor.exec('CREATE TABLE binding(status TEXT,mapping_version INTEGER,brand_id TEXT,environment TEXT,auth_event_id TEXT,auth_member_ref TEXT,billing_member_digest TEXT,billing_source_event_id TEXT,auth_version INTEGER,store_app_ref TEXT,store_transaction_ref TEXT,store_refund_event_ref TEXT,store_source_version INTEGER)');
 floor.prepare('INSERT INTO binding VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
  'unapproved_local_mapping_candidate',1,'starry','staging',originalEvent,
  authEvent.member_ref,billing.member_ref,sourceEvent,8,billing.store_app_ref,
  billing.transaction_ref,billing.refund_event_ref,11);
 floor.exec('CREATE TABLE witness(status TEXT,mapping_version INTEGER,brand_id TEXT,environment TEXT,auth_event_id TEXT,billing_member_digest TEXT,billing_source_event_id TEXT,store_refund_event_ref TEXT,store_source_version INTEGER)');
 floor.prepare('INSERT INTO witness VALUES(?,?,?,?,?,?,?,?,?)').run(
  'unapproved_local_test_floor',1,'starry','staging',originalEvent,
  billing.member_ref,sourceEvent,billing.refund_event_ref,11);
 bill.exec(billSchema);bill.exec(BILLING_R16_INBOX_MEMORY_DDL);
 bill.exec(BILLING_R18_MEMORY_DDL);
 if(opt.deleteInbox!==false){
  bill.prepare(BILLING_R16_INBOX_INSERT_SQL).get('staging',
   BILLING_R16_PUBLISHER_ID,sourceEvent,billing.source_commit_ref,
   billing.member_ref,billing.event_ref,billing.event_digest,8,time);
 }
 if(opt.refundInbox!==false){
  bill.prepare(BILLING_R18_REFUND_INSERT_SQL).get('staging','apple',
   billing.store_app_ref,billing.transaction_ref,billing.refund_event_ref,
   11,billing.member_ref,'CHARGEBACK');
 }
 const stats={legal:0,auth:0,binding:0,floor:0,billing:0};
 const scope={brand_id:'starry',environment:'staging',app_ref:billing.app_ref,
  store_app_ref:billing.store_app_ref};
 const origin={status:'offline_store_candidate_only',brand_id:'starry',
  environment:'staging',app_ref:billing.app_ref,store_app_ref:billing.store_app_ref,
  store:'apple',transaction_ref:billing.transaction_ref,
  refund_event_ref:billing.refund_event_ref,refund_source_version:11,
  refund_kind:'CHARGEBACK'};
 const r19=createOfflineBillingR19ReceiptReview({enabled:true,scope,
  billingDb:{prepare(sql){
   assert.ok([BILLING_R17_READBACK_SQL,R19_BILLING_REFUND_SELECT].includes(sql));
   assert.ok(sql.startsWith('SELECT'));
   return {bind(...params){return {async first(){
    const row=bill.prepare(sql).get(...params);return row?{...row}:null;
   }};}};
  }},
  ports:{
   async lawfulProcessingAndRetention(){return opt.law!==false;},
   async readDeletedAuth(){
    const row=auth.prepare('SELECT * FROM deleted').get();
    return row?{...row}:null;
   },
   async readStoreCandidate(){return opt.storeMissing?null:{...origin};},
   async readIndependentFloorCandidate(){
    if(opt.r19FloorMissing)return null;
    return {status:'unapproved_test_floor',brand_id:'starry',
     environment:'staging',member_ref:billing.member_ref,
     source_event_id:sourceEvent,event_ref:billing.event_ref,
     auth_version:8,refund_event_ref:billing.refund_event_ref,
     refund_source_version:11};
   }
  }
 });
 const ports={
  async lawfulProcessingAndRetention(){stats.legal++;
   return opt.law!==false&&!(opt.lawDrift&&stats.legal>=2);},
  async readAuthOriginal(){stats.auth++;
   if(opt.authDrift&&stats.auth>=2)return null;
   const row=auth.prepare('SELECT * FROM original').get();return row?{...row}:null;
  },
  async readBindingCandidate(){stats.binding++;
   if(opt.bindingDrift&&stats.binding>=2)return null;
   const row=floor.prepare('SELECT * FROM binding').get();return row?{...row}:null;
  },
  async readFloorCandidate(){stats.floor++;
   if(opt.floorDrift&&stats.floor>=2)return null;
   const row=floor.prepare('SELECT * FROM witness').get();return row?{...row}:null;
  },
  async inspectBillingR19(v){stats.billing++;return r19.inspect(v);}
 };
 const gate=(patch={})=>createOfflineBillingR20NamespaceGate({
  enabled:true,scope,ports,...patch});
 return {auth,bill,floor,gate,ports,stats,scope,origin,
  close(){auth.close();bill.close();floor.close();}};
}
const denied=o=>{
 assert.equal(o.may_ack_queue,false);assert.equal(o.may_regrant,false);
 assert.equal(o.may_restore,false);assert.equal(o.may_publish,false);
 assert.equal(o.may_grant,false);assert.equal(o.live,false);
};
test('R20 default OFF: no protected Auth, HMAC, Store or Billing read',async t=>{
 const f=fixture();t.after(()=>f.close());
 assert.equal(R20_BILLING_LIVE,false);assert.equal(R20_BILLING_ACK_ALLOWED,false);
 assert.equal(R20_BILLING_BINDING_APPROVED,false);
 assert.equal(R20_BILLING_STORE_SIGNER_APPROVED,false);
 const o=await f.gate({enabled:false}).inspect(request);denied(o);
 assert.equal(o.status,'disabled');assert.equal(o.candidate,null);
 assert.deepEqual(f.stats,{legal:0,auth:0,binding:0,floor:0,billing:0});
});
test('REAL separate Auth, Billing and floor SQLite: local observation ONLY',async t=>{
 const f=fixture();t.after(()=>f.close());
 const o=await f.gate().inspect(request);denied(o);
 assert.equal(o.status,'review_only');assert.equal(o.reason,'LOCAL_NAMESPACE_CANDIDATE_ONLY');
 assert.equal(o.candidate.auth_event_id,originalEvent);
 assert.equal(o.candidate.billing_source_event_id,sourceEvent);
 assert.notEqual(o.candidate.auth_member_ref,o.candidate.billing_member_digest);
 assert.equal(o.candidate.store_refund_event_ref,billing.refund_event_ref);
 assert.equal(o.candidate.hmac_binding_approved,false);
 assert.equal(o.candidate.store_signature_verified,false);
 assert.equal(o.candidate.external_pitr_witness_verified,false);
 assert.equal(f.stats.billing,2);
});
test('Q104/Q119 denied before even the original four Auth fields',async t=>{
 const f=fixture({law:false});t.after(()=>f.close());
 const o=await f.gate().inspect(request);denied(o);
 assert.equal(o.reason,'Q104_Q119_LEGAL_MISSING');
 assert.deepEqual(f.stats,{legal:1,auth:0,binding:0,floor:0,billing:0});
});
test('missing lawful HMAC candidate cannot link Auth member to Billing digest',async t=>{
 const f=fixture();t.after(()=>f.close());
 f.floor.exec('DELETE FROM binding');
 const o=await f.gate().inspect(request);denied(o);
 assert.equal(o.status,'blocked');
 assert.equal(o.reason,'UNAPPROVED_HMAC_MEMBER_MAPPING_MISSING');
 assert.equal(f.stats.billing,0);
});
test('HMAC candidate wrong member and mapping version must reject',async t=>{
 const f=fixture();t.after(()=>f.close());
 f.floor.exec("UPDATE binding SET auth_member_ref='m_"+'7'.repeat(64)+"'");
 assert.equal((await f.gate().inspect(request)).status,'blocked');
 f.floor.exec("UPDATE binding SET auth_member_ref='"+authEvent.member_ref+"', mapping_version=9");
 assert.equal((await f.gate().inspect(request)).status,'blocked');
});
test('Auth original account_deleted source missing or changed refuses mapping',async t=>{
 const f=fixture();t.after(()=>f.close());
 f.auth.exec("UPDATE original SET event_type='account_created'");
 assert.equal((await f.gate().inspect(request)).reason,'AUTH_ORIGINAL_FOUR_FIELDS_MISMATCH');
});
test('Auth event and Store refund event cannot alias or be joined by string',async t=>{
 const f=fixture();t.after(()=>f.close());
 for(const x of [
  {...request,billing:{...billing,source_event_id:originalEvent}},
  {...request,auth:{...authEvent,event_id:billing.refund_event_ref}},
  {...request,auth:{...authEvent,member_ref:billing.member_ref}},
  {...request,billing:{...billing,event_ref:billing.refund_event_ref}}
 ]){
  const o=await f.gate().inspect(x);denied(o);
  assert.equal(o.status,'blocked');
 }
 assert.equal(f.stats.billing,0);
});
test('late refunded source version cannot override newer chargeback floor',async t=>{
 const f=fixture();t.after(()=>f.close());
 const old={...billing,refund_event_ref:ref('4'),refund_source_version:4,
  refund_kind:'REFUNDED'};
 const o=await f.gate().inspect({...request,billing:old});denied(o);
 assert.equal(o.status,'blocked');
 assert.equal(f.stats.billing,0);
 assert.throws(()=>f.bill.prepare(BILLING_R18_REFUND_INSERT_SQL).get(
  'staging','apple',billing.store_app_ref,billing.transaction_ref,
  old.refund_event_ref,4,billing.member_ref,'REFUNDED'),
 /R18_STALE_OR_CONFLICTING_REFUND/);
});
test('changed Store app, member scope, foreign brand or environment blocked',async t=>{
 const f=fixture();t.after(()=>f.close());
 for(const bad of [
  {...request,billing:{...billing,store_app_ref:ref('8')}},
  {...request,billing:{...billing,environment:'development'}},
  {...request,billing:{...billing,brand_id:'hglobal'}},
  {...request,billing:{...billing,member_ref:member('9')}},
  {...request,mapping_version:2},
  {...request,auth_version:7}
 ]){
  const o=await f.gate().inspect(bad);denied(o);assert.equal(o.status,'blocked');
 }
 assert.equal(f.stats.billing,0);
});
test('PITR Billing deletion inbox disappears: no candidate, no restore',async t=>{
 const f=fixture({deleteInbox:false});t.after(()=>f.close());
 const o=await f.gate().inspect(request);denied(o);
 assert.equal(o.status,'blocked');assert.equal(o.candidate,null);
});
test('partial Billing refund receipt missing cannot fake one from Auth',async t=>{
 const f=fixture({refundInbox:false});t.after(()=>f.close());
 assert.equal((await f.gate().inspect(request)).status,'blocked');
});
test('deleted member with stale active paid entitlement blocks even with mapping mock',async t=>{
 const f=fixture();t.after(()=>f.close());
 f.bill.exec('DROP TRIGGER billing_delete_no_late_insert_DRAFT');
 f.bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT(candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES(?,?,?,?,?)')
  .run(ref('6'),'staging',billing.member_ref,'digital.monthly','candidate_active');
 const o=await f.gate().inspect(request);denied(o);assert.equal(o.status,'blocked');
});
test('floor missing, backdated source version and foreign event deny',async t=>{
 const f=fixture();t.after(()=>f.close());
 f.floor.exec("UPDATE witness SET store_source_version=2");
 assert.equal((await f.gate().inspect(request)).status,'retry');
 f.floor.exec('DELETE FROM witness');
 assert.equal((await f.gate().inspect(request)).status,'retry');
});
test('same local candidate replay cannot grant entitlement or ACK',async t=>{
 const f=fixture();t.after(()=>f.close());
 denied(await f.gate().inspect(request));denied(await f.gate().inspect(request));
 assert.equal(f.bill.prepare('SELECT COUNT(*) n FROM billing_r18_refund_inbox_DRAFT').get().n,1);
});
test('law / Auth / binding / floor race after Billing receipt all deny',async t=>{
 for(const key of ['lawDrift','authDrift','bindingDrift','floorDrift']){
  const f=fixture({[key]:true});t.after(()=>f.close());
  const o=await f.gate().inspect(request);denied(o);
  assert.notEqual(o.status,'review_only');
 }
});
test('fake R19 result cannot promote local review to an official Store authorization',async t=>{
 const f=fixture();t.after(()=>f.close());
 const o=await f.gate({ports:{...f.ports,
  async inspectBillingR19(){return {status:'review_only',reason:'fake',
   receipt:{kind:'offline_candidate_only',official_store_verified:true},
   may_ack_queue:true,may_regrant:false,may_restore:false,may_publish:false,live:false};}
 }}).inspect(request);
 denied(o);assert.equal(o.status,'blocked');
});
test('official Apple/Google payment and signed sources remain unapproved even locally matched',async t=>{
 const f=fixture();t.after(()=>f.close());
 const o=await f.gate().inspect(request);denied(o);
 assert.equal(o.status,'review_only');assert.equal(o.candidate.publishable,false);
 assert.equal(o.candidate.hmac_binding_approved,false);
});
test('Starry Battery is free: R14 refuses paid Battery SKU',async t=>{
 const f=fixture();t.after(()=>f.close());
 assert.throws(()=>f.bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT(candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES(?,?,?,?,?)')
  .run(ref('5'),'staging',billing.member_ref,'starry.battery.credit','candidate_active'));
});
test('Proxy/accessor hostile input blocked without reading protected DB',async t=>{
 const f=fixture();t.after(()=>f.close());
 const evil=new Proxy(request,{ownKeys(){throw Error('trap')}});
 assert.equal((await f.gate().inspect(evil)).status,'blocked');
 const getter=Object.defineProperty({...request},'auth',{enumerable:true,
  get(){throw Error('accessor')}});
 assert.equal((await f.gate().inspect(getter)).status,'blocked');
 assert.equal(f.stats.billing,0);
});
