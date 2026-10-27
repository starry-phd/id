import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {BILLING_R16_PUBLISHER_ID,BILLING_R16_INBOX_INSERT_SQL,
 BILLING_R16_INBOX_MEMORY_DDL} from '../src/deletion-single-publisher-inbox.ts';
import {LIVE_BILLING_R17_REVIEW_ENABLED,BILLING_R17_REVIEW_PUBLISHABLE,
 BILLING_R17_ACK_ALLOWED,BILLING_R17_READBACK_SQL,
 createOfflineBillingDeletionReadbackReview} from '../src/deletion-readback-review.ts';
const ID='AuthDeletionEvent-20261027-0001';
const v={source_event_id:ID,source_commit_ref:'r_'+'c'.repeat(64),
 member_ref:'m_'+'a'.repeat(64),event_ref:'r_'+'b'.repeat(64),
 event_digest:'f'.repeat(64),auth_version:8,occurred_at_sec:1793100000};
const schema=readFileSync(new URL('../schema/0007_account_deletion_fence_DRAFT.sql',import.meta.url),'utf8');
function fixture(opt={}){
 const auth=new DatabaseSync(':memory:'),bill=new DatabaseSync(':memory:');
 const floorDB=new DatabaseSync(':memory:');
 auth.exec('CREATE TABLE source(event_id TEXT PRIMARY KEY,status TEXT,version INTEGER)');
 auth.prepare('INSERT INTO source VALUES(?,?,?)').run(ID,'deleted',8);
 floorDB.exec('CREATE TABLE floor(event_id TEXT PRIMARY KEY,event_ref TEXT,version INTEGER,status TEXT)');
 floorDB.prepare('INSERT INTO floor VALUES(?,?,?,?)').run(ID,v.event_ref,8,'deleted');
 bill.exec(schema);bill.exec(BILLING_R16_INBOX_MEMORY_DDL);
 bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT(candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES(?,?,?,?,?)')
  .run('r_'+'d'.repeat(64),'staging',v.member_ref,'digital.monthly','candidate_active');
 if(opt.insert!==false){
  const x=bill.prepare(BILLING_R16_INBOX_INSERT_SQL).get('staging',
   BILLING_R16_PUBLISHER_ID,ID,v.source_commit_ref,v.member_ref,
   v.event_ref,v.event_digest,v.auth_version,v.occurred_at_sec);
  assert.equal(x.source_event_id,ID);
 }
 const calls={law:0,auth:0,floor:0,sql:0};
 const ports={
  async lawfulMinimalRetentionApproved(){calls.law++;return opt.law!==false;},
  async readCurrentDeletedAuth(id){
   calls.auth++;
   if(opt.changeAuthAt===calls.auth)auth.prepare("UPDATE source SET status='active'").run();
   const a=auth.prepare('SELECT * FROM source WHERE event_id=?').get(id);
   return a?{status:a.status,...v,auth_version:a.version}:null;
  },
  async readIndependentFloorCandidate(){
   calls.floor++;
   if(opt.changeFloorAt===calls.floor)floorDB.prepare('UPDATE floor SET version=version+1').run();
   const a=floorDB.prepare('SELECT * FROM floor WHERE event_id=?').get(ID);
   return a?{status:a.status,source_event_id:a.event_id,event_ref:a.event_ref,
    auth_version:a.version}:null;
  },
 };
 const db={prepare(sql){
  calls.sql++;assert.equal(sql,BILLING_R17_READBACK_SQL);
  return {bind(...args){return {async first(){
   const row=bill.prepare(sql).get(...args);return row===undefined?null:{...row};
  }};}};
 }};
 const review=(override={})=>createOfflineBillingDeletionReadbackReview({
  enabled:true,scope:{brand_id:'starry',environment:'staging'},db,ports,...override,
 });
 return {auth,bill,floorDB,calls,review,close:()=>{auth.close();bill.close();floorDB.close();}};
}
test('default disabled and immutable no-ACK/no-grant/no-restore safety',async t=>{
 const f=fixture();t.after(f.close);
 assert.equal(LIVE_BILLING_R17_REVIEW_ENABLED,false);
 assert.equal(BILLING_R17_REVIEW_PUBLISHABLE,false);
 assert.equal(BILLING_R17_ACK_ALLOWED,false);
 assert.deepEqual(await f.review({enabled:false}).inspect(v),
  {status:'disabled',reason:'DISABLED',may_ack_queue:false,may_grant:false,
   may_restore:false,live:false});
 assert.deepEqual(f.calls,{law:0,auth:0,floor:0,sql:0});
});
test('three independent SQLite memory DBs: local readback is only a review candidate',async t=>{
 const f=fixture();t.after(f.close);
 assert.deepEqual(await f.review().inspect(v),
  {status:'review_only',reason:'LOCAL_CANDIDATE_RECEIPTS_MATCH',
   may_ack_queue:false,may_grant:false,may_restore:false,live:false});
 assert.equal(f.calls.auth,2);assert.equal(f.calls.floor,2);
 assert.equal(f.bill.prepare("SELECT COUNT(*) AS n FROM billing_entitlement_candidate_DRAFT WHERE candidate_state='candidate_active'").get().n,0);
});
test('PITR removed Billing inbox, independent floor still exists: BLOCKED',async t=>{
 const f=fixture({insert:false});t.after(f.close);
 assert.equal((await f.review().inspect(v)).reason,'BILLING_OR_ENTITLEMENT_DIVERGED');
});
test('different or absent external floor cannot use local rows as authority',async t=>{
 const f=fixture();t.after(f.close);
 f.floorDB.prepare('UPDATE floor SET version=9').run();
 assert.equal((await f.review().inspect(v)).reason,'INDEPENDENT_FLOOR_MISSING');
 assert.equal(f.calls.sql,0);
 f.floorDB.prepare('DELETE FROM floor').run();
 assert.equal((await f.review().inspect(v)).status,'blocked');
});
test('legal purpose gate runs before reading Auth/floor/Billing',async t=>{
 const f=fixture({law:false});t.after(f.close);
 assert.equal((await f.review().inspect(v)).reason,'LEGAL_RETENTION_REQUIRED');
 assert.deepEqual(f.calls,{law:1,auth:0,floor:0,sql:0});
});
test('current deleted Member mismatch and post-read Auth race both rejected',async t=>{
 const f=fixture({changeAuthAt:2});t.after(f.close);
 assert.equal((await f.review().inspect(v)).reason,'AUTH_CHANGED_AFTER_READ');
});
test('separate floor changes after local read are denied',async t=>{
 const f=fixture({changeFloorAt:2});t.after(f.close);
 assert.equal((await f.review().inspect(v)).reason,'FLOOR_CHANGED_AFTER_READ');
});
test('mismatched local tombstone digest denied with actual SQL readback',async t=>{
 const f=fixture();t.after(f.close);
 f.bill.prepare('UPDATE billing_deletion_fence_DRAFT SET event_digest=?').run('0'.repeat(64));
 assert.equal((await f.review().inspect(v)).reason,'BILLING_OR_ENTITLEMENT_DIVERGED');
});
test('late paid candidate restore is forbidden by inherited R14 SQLite trigger',async t=>{
 const f=fixture();t.after(f.close);
 assert.throws(()=>f.bill.prepare("UPDATE billing_entitlement_candidate_DRAFT SET candidate_state='candidate_active'").run(),/DELETED_MEMBER_NO_REGRANT/);
 assert.equal((await f.review().inspect(v)).status,'review_only');
});
test('invalid shape, brand, environment and Proxy are blocked before accessing ports',async t=>{
 const f=fixture();t.after(f.close);
 assert.throws(()=>f.review({scope:{brand_id:'hglobal',environment:'staging'}}),/BILLING_R17_CONFIG_DENIED/);
 assert.throws(()=>f.review({scope:{brand_id:'starry',environment:'production'}}),/BILLING_R17_CONFIG_DENIED/);
 for(const bad of [{...v,member_ref:'raw'}, {...v,extra:1},
  Object.defineProperty({...v},'member_ref',{get(){throw Error('accessor');}}),
  new Proxy({}, {getPrototypeOf(){throw Error('trap');}})]){
  assert.equal((await f.review().inspect(bad)).reason,'INVALID_RECEIPT');
 }
 assert.deepEqual(f.calls,{law:0,auth:0,floor:0,sql:0});
});
test('Billing read failure is blocked with no queue ACK or regrant',async t=>{
 const f=fixture();t.after(f.close);
 const x=await f.review({db:{prepare(){throw Error('offline DB down');}}}).inspect(v);
 assert.equal(x.reason,'AUTHORITY_OR_DB_UNAVAILABLE');
 assert.equal(x.may_ack_queue,false);assert.equal(x.may_grant,false);
});
test('retry review is read-only, one same-DB R16 inbox remains',async t=>{
 const f=fixture();t.after(f.close);
 for(let i=0;i<3;i++)assert.equal((await f.review().inspect(v)).status,'review_only');
 assert.equal(f.bill.prepare('SELECT COUNT(*) AS n FROM billing_delete_inbox_R16_DRAFT').get().n,1);
});
