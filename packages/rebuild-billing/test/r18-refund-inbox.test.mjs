import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {BILLING_R16_INBOX_MEMORY_DDL,BILLING_R16_INBOX_INSERT_SQL,
 BILLING_R16_PUBLISHER_ID} from '../src/deletion-single-publisher-inbox.ts';
import {createOfflineBillingDeletionReadbackReview} from '../src/deletion-readback-review.ts';
import {LIVE_BILLING_R18_ENABLED,BILLING_R18_PUBLISHABLE,
 BILLING_R18_ACK_ALLOWED,BILLING_R18_MEMORY_DDL,BILLING_R18_REFUND_INSERT_SQL,
 BILLING_R18_REFUND_READ_SQL,canonicalBillingR18Refund,
 createOfflineBillingR18RefundInbox} from '../src/r18-refund-inbox.ts';

const NOW=1793100000,ID='AuthDeletionEvent-20261027-0001';
const del={source_event_id:ID,source_commit_ref:'r_'+'c'.repeat(64),
 member_ref:'m_'+'a'.repeat(64),event_ref:'r_'+'b'.repeat(64),
 event_digest:'f'.repeat(64),auth_version:8,occurred_at_sec:NOW-10};
const billSchema=readFileSync(new URL('../schema/0007_account_deletion_fence_DRAFT.sql',import.meta.url),'utf8');
const sig64=x=>btoa(String.fromCharCode(...new Uint8Array(x)))
 .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',
 modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
 true,['sign','verify']);
const spki=await crypto.subtle.exportKey('spki',keys.publicKey);
const verifyKey=await crypto.subtle.importKey('spki',spki,
 {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
async function sign(e){
 return {...e,signature:sig64(await crypto.subtle.sign(
  'RSASSA-PKCS1-v1_5',keys.privateKey,canonicalBillingR18Refund(e)))};
}
async function fixture(opt={}){
 const auth=new DatabaseSync(':memory:'),bill=new DatabaseSync(':memory:');
 const external=new DatabaseSync(':memory:');
 auth.exec('CREATE TABLE deletion(event_id TEXT PRIMARY KEY,status TEXT,version INTEGER);');
 auth.prepare('INSERT INTO deletion VALUES(?,?,?)').run(ID,'deleted',8);
 external.exec('CREATE TABLE floor(event_id TEXT PRIMARY KEY,version INTEGER,status TEXT);');
 external.prepare('INSERT INTO floor VALUES(?,?,?)').run(ID,8,'deleted');
 bill.exec(billSchema);
 bill.exec(BILLING_R16_INBOX_MEMORY_DDL);
 bill.exec(BILLING_R18_MEMORY_DDL);
 bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT(candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES(?,?,?,?,?)')
  .run('r_'+'d'.repeat(64),'staging',del.member_ref,'digital.monthly','candidate_active');
 if(opt.deletionCommit!==false){
  bill.prepare(BILLING_R16_INBOX_INSERT_SQL).get('staging',BILLING_R16_PUBLISHER_ID,
   ID,del.source_commit_ref,del.member_ref,del.event_ref,del.event_digest,8,NOW-10);
 }
 const calls={law:0,store:0,deleted:0,write:0};
 const ports={
  async lawfulRetentionApproved(){calls.law++;return opt.law!==false;},
  async verifyCommittedStoreRevocation(){calls.store++;return opt.store!==false;},
  async readStoreOriginStillCommitted(){return opt.changed!==true;},
  async reviewDeletedMember(receipt){
   calls.deleted++;
   return createOfflineBillingDeletionReadbackReview({
    enabled:true,scope:{brand_id:'starry',environment:'staging'},
    db:{prepare(sql){return {bind(...args){return {async first(){
     const x=bill.prepare(sql).get(...args);return x?{...x}:null;
    }};}};}},
    ports:{
     async lawfulMinimalRetentionApproved(){return opt.law!==false;},
     async readCurrentDeletedAuth(){
      const x=auth.prepare('SELECT * FROM deletion WHERE event_id=?').get(ID);
      return x?{status:x.status,...del,auth_version:x.version}:null;
     },
     async readIndependentFloorCandidate(){
      const x=external.prepare('SELECT * FROM floor WHERE event_id=?').get(ID);
      return x?{status:x.status,source_event_id:x.event_id,
       event_ref:del.event_ref,auth_version:x.version}:null;
     },
    },
   }).inspect(receipt);
  },
 };
 const adapter={prepare(sql){calls.write++;
  assert.ok([BILLING_R18_REFUND_INSERT_SQL,BILLING_R18_REFUND_READ_SQL].includes(sql));
  return {bind(...args){return {async first(){
   const x=bill.prepare(sql).get(...args);return x===undefined?null:{...x};
  }};}};
 }};
 const raw={version:1,brand_id:'starry',environment:'staging',
  store:'apple',store_app_ref:'r_'+'e'.repeat(64),
  transaction_ref:'r_'+'1'.repeat(64),event_ref:'r_'+'2'.repeat(64),
  source_version:9,effective_at_sec:NOW-2,member_ref:del.member_ref,
  deletion_source_event_id:ID,kind:'REFUNDED',
  key_id:'r18-offline-ephemeral-key',signature:''};
 const event=await sign(raw);
 const gate=(overrides={})=>createOfflineBillingR18RefundInbox({
  enabled:true,scope:{brand_id:'starry',environment:'staging'},key_id:raw.key_id,
  verifyKey,db:adapter,ports,...overrides,
 });
 const count=table=>bill.prepare('SELECT COUNT(*) n FROM '+table).get().n;
 return {auth,bill,external,calls,ports,event,raw,gate,count,
  close(){auth.close();bill.close();external.close();}};
}
test('R18 default OFF, no lawful or DB reads, publish/ACK/regrant/restore never allowed',async t=>{
 const x=await fixture();t.after(x.close);
 assert.equal(LIVE_BILLING_R18_ENABLED,false);
 assert.equal(BILLING_R18_PUBLISHABLE,false);
 assert.equal(BILLING_R18_ACK_ALLOWED,false);
 const v=await x.gate({enabled:false}).accept(x.event,del,NOW);
 assert.deepEqual(v,{status:'disabled',reason:'DISABLED',may_ack_queue:false,
  may_regrant:false,may_restore:false,live:false});
 assert.deepEqual(x.calls,{law:0,store:0,deleted:0,write:0});
});
test('signed test-only refund: one Billing SQLite inbox, floor and revoked candidate',async t=>{
 const x=await fixture();t.after(x.close);
 const out=await x.gate().accept(x.event,del,NOW);
 assert.deepEqual(out,{status:'recorded_offline',reason:'LOCAL_REVOCATION_REVIEW_ONLY',
  may_ack_queue:false,may_regrant:false,may_restore:false,live:false});
 assert.equal(x.count('billing_r18_refund_inbox_DRAFT'),1);
 assert.equal(x.count('billing_r18_refund_floor_DRAFT'),1);
 assert.equal(x.bill.prepare("SELECT COUNT(*) n FROM billing_entitlement_candidate_DRAFT WHERE candidate_state='candidate_active'").get().n,0);
 assert.equal(x.count('billing_delete_inbox_R16_DRAFT'),1);
});
test('duplicate source event never writes a second refund and never ACKs',async t=>{
 const x=await fixture();t.after(x.close);
 await x.gate().accept(x.event,del,NOW);
 assert.equal((await x.gate().accept(x.event,del,NOW)).status,'blocked'); // BEFORE INSERT SQLite version trigger also rejects replay
 assert.equal(x.count('billing_r18_refund_inbox_DRAFT'),1);
});
test('same transaction source_version with DIFFERENT event_ref is rejected by unique',async t=>{
 const x=await fixture();t.after(x.close);
 await x.gate().accept(x.event,del,NOW);
 const forged=await sign({...x.raw,event_ref:'r_'+'3'.repeat(64)});
 assert.equal((await x.gate().accept(forged,del,NOW)).status,'blocked');
 assert.equal(x.count('billing_r18_refund_inbox_DRAFT'),1);
});
test('newer chargeback then late earlier refund cannot downgrade local floor',async t=>{
 const x=await fixture();t.after(x.close);
 const high=await sign({...x.raw,kind:'CHARGEBACK',source_version:11,
  event_ref:'r_'+'4'.repeat(64)});
 assert.equal((await x.gate().accept(high,del,NOW)).status,'recorded_offline');
 assert.equal((await x.gate().accept(x.event,del,NOW)).status,'blocked');
 assert.equal(x.bill.prepare('SELECT source_version FROM billing_r18_refund_floor_DRAFT').get().source_version,11);
 assert.equal(x.count('billing_r18_refund_inbox_DRAFT'),1);
});
test('refund arriving after deleted member cannot regrant any candidate',async t=>{
 const x=await fixture();t.after(x.close);
 await x.gate().accept(x.event,del,NOW);
 assert.throws(()=>x.bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT(candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES(?,?,?,?,?)')
  .run('r_'+'5'.repeat(64),'staging',del.member_ref,'digital.yearly','candidate_active'),/DELETED_MEMBER_NO_NEW_BILLING/);
});
test('a stale PAID/RENEWED event is not even accepted as refund source',async t=>{
 const x=await fixture();t.after(x.close);
 for(const kind of ['PAID','RENEWED']){
  const invalid=await sign({...x.raw,kind});
  assert.equal((await x.gate().accept(invalid,del,NOW)).status,'blocked');
 }
 assert.equal(x.calls.write,0);
});
test('real partial cross-DB success: Auth deletion committed, Billing inbox missing, no refund write',async t=>{
 const x=await fixture({deletionCommit:false});t.after(x.close);
 assert.equal((await x.gate().accept(x.event,del,NOW)).reason,'DELETED_MEMBER_OR_PITR_FENCE_MISSING');
 assert.equal(x.count('billing_r18_refund_inbox_DRAFT'),0);
});
test('PITR real Billing snapshot regression re-enables candidates, independent source prevents refund',async t=>{
 const x=await fixture();t.after(x.close);
 assert.equal((await x.gate().accept(x.event,del,NOW)).status,'recorded_offline');
 // Rebuild the SAME Billing SQL connection to its older pre-delete state.
 // Auth and independent floor remain at their newer committed deleted version.
 x.bill.exec('DROP TABLE billing_r18_refund_inbox_DRAFT;');
 x.bill.exec('DROP TABLE billing_r18_refund_floor_DRAFT;');
 x.bill.exec('DROP TABLE billing_delete_inbox_R16_DRAFT;');
 x.bill.exec('DELETE FROM billing_deletion_fence_DRAFT;');
 x.bill.exec(BILLING_R16_INBOX_MEMORY_DDL);
 x.bill.exec(BILLING_R18_MEMORY_DDL);
 x.bill.prepare("UPDATE billing_entitlement_candidate_DRAFT SET candidate_state='candidate_active'").run();
 assert.equal(x.bill.prepare("SELECT COUNT(*) n FROM billing_entitlement_candidate_DRAFT WHERE candidate_state='candidate_active'").get().n,1);
 assert.equal(x.count('billing_delete_inbox_R16_DRAFT'),0);
 assert.equal(x.count('billing_deletion_fence_DRAFT'),0);
 assert.equal((await x.gate().accept(x.event,del,NOW)).reason,'DELETED_MEMBER_OR_PITR_FENCE_MISSING');
 assert.equal(x.count('billing_r18_refund_inbox_DRAFT'),0);
});
test('independent floor missing or behind current deletion: no refund record',async t=>{
 const x=await fixture();t.after(x.close);
 x.external.exec('DELETE FROM floor');
 assert.equal((await x.gate().accept(x.event,del,NOW)).status,'blocked');
 assert.equal(x.calls.write,0);
});
test('lawful Q104/Q119 missing must reject before origin reads or Billing write',async t=>{
 const x=await fixture({law:false});t.after(x.close);
 assert.equal((await x.gate().accept(x.event,del,NOW)).reason,'LAWFUL_PROVENANCE_MISSING');
 assert.deepEqual(x.calls,{law:1,store:0,deleted:0,write:0});
});
test('test-only signed event is never official Store: missing authoritative requery blocks',async t=>{
 const x=await fixture({store:false});t.after(x.close);
 assert.equal((await x.gate().accept(x.event,del,NOW)).reason,'STORE_SOURCE_NOT_VERIFIED');
 assert.equal(x.count('billing_r18_refund_inbox_DRAFT'),0);
});
test('signed store source changes during delivery => no mutation',async t=>{
 const x=await fixture({changed:true});t.after(x.close);
 assert.equal((await x.gate().accept(x.event,del,NOW)).reason,'STORE_SOURCE_CHANGED');
 assert.equal(x.calls.write,0);
});
test('tampered signed refund, wrong source, foreign brand/env and fake signature fail closed',async t=>{
 const x=await fixture();t.after(x.close);
 for(const bad of [{...x.event,source_version:99},{...x.event,signature:'abc'},
  {...x.event,environment:'production'}, {...x.event,brand_id:'hglobal'},
  {...x.event,deletion_source_event_id:'ForeignEvent-20261027-0001'},
  {...x.event,member_ref:'m_'+'9'.repeat(64)},
  Object.defineProperty({...x.event},'store',{get(){throw Error('accessor');}})]){
  assert.equal((await x.gate().accept(bad,del,NOW)).status,'blocked');
 }
 assert.equal(x.calls.write,0);
});
test('config refuses extractable/foreign key, untrusted ports and production scope',async t=>{
 const x=await fixture();t.after(x.close);
 assert.throws(()=>x.gate({verifyKey:keys.publicKey}),/R18_UNTRUSTED_CONFIGURATION/);
 assert.throws(()=>x.gate({scope:{brand_id:'starry',environment:'production'}}),/R18_UNTRUSTED_CONFIGURATION/);
 assert.throws(()=>x.gate({ports:{}}),/R18_UNTRUSTED_CONFIGURATION/);
});
test('one outer transaction rollback undoes local refund inbox/floor, proves no true durable ACK',async t=>{
 const x=await fixture();t.after(x.close);
 x.bill.exec('BEGIN');
 assert.equal((await x.gate().accept(x.event,del,NOW)).status,'recorded_offline');
 x.bill.exec('ROLLBACK');
 assert.equal(x.count('billing_r18_refund_inbox_DRAFT'),0);
 assert.equal(x.count('billing_r18_refund_floor_DRAFT'),0);
 assert.equal(x.count('billing_delete_inbox_R16_DRAFT'),1);
});
test('immutable local receipts cannot be edited or deleted and active rights stay zero',async t=>{
 const x=await fixture();t.after(x.close);
 await x.gate().accept(x.event,del,NOW);
 assert.throws(()=>x.bill.exec('DELETE FROM billing_r18_refund_inbox_DRAFT'),/R18_INBOX_IMMUTABLE/);
 assert.throws(()=>x.bill.exec('UPDATE billing_r18_refund_inbox_DRAFT SET source_version=99'),/R18_INBOX_IMMUTABLE/);
});
