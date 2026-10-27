import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {
 BILLING_R16_PUBLISHER_ID,BILLING_R16_INBOX_MEMORY_DDL,BILLING_R16_INBOX_INSERT_SQL,
 LIVE_BILLING_DELETE_INBOX_ENABLED,BILLING_DELETE_INBOX_PUBLISHABLE,
 BILLING_DELETE_INBOX_ACK_ALLOWED,canonicalBillingDeletePublisherV1,
 createOfflineSinglePublisherBillingInbox,
} from '../src/deletion-single-publisher-inbox.ts';

const NOW=1793100000,scope={brand_id:'starry',environment:'staging'};
const id='AuthDeletionEvent-20261027-0001',member='m_'+'a'.repeat(64);
const eref='r_'+'b'.repeat(64),commit='r_'+'c'.repeat(64);
const b64=x=>btoa(String.fromCharCode(...new Uint8Array(x)))
 .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const billSchema=readFileSync(new URL('../schema/0007_account_deletion_fence_DRAFT.sql',import.meta.url),'utf8');
async function fixture(opt={}){
 const auth=new DatabaseSync(':memory:'),bill=new DatabaseSync(':memory:');
 auth.exec('CREATE TABLE starry_deletion_outbox(event_id TEXT PRIMARY KEY,s_user_id TEXT,occurred_at INTEGER,event_type TEXT);'+
  'CREATE TABLE starry_members(s_user_id TEXT PRIMARY KEY,status TEXT,auth_version INTEGER,updated_at INTEGER)');
 auth.prepare('INSERT INTO starry_deletion_outbox VALUES (?,?,?,?)').run(id,'opaque_auth_member',NOW-10,'account_deleted');
 auth.prepare('INSERT INTO starry_members VALUES (?,?,?,?)').run('opaque_auth_member','deleted',8,NOW-10);
 bill.exec(billSchema);
 bill.exec(BILLING_R16_INBOX_MEMORY_DDL);
 for(const c of ['d','e']){
  bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT(candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES (?,?,?,?,?)')
   .run('r_'+c.repeat(64),'staging',member,'digital.monthly','candidate_active');
 }
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
  true,['sign','verify']);
 const spki=await crypto.subtle.exportKey('spki',keys.publicKey);
 const verify=await crypto.subtle.importKey('spki',spki,
  {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 const payload={version:1,brand_id:'starry',environment:'staging',
  publisher_id:BILLING_R16_PUBLISHER_ID,source_event_id:id,source_commit_ref:commit,
  member_ref:member,event_ref:eref,event_digest:'f'.repeat(64),auth_version:8,
  occurred_at_sec:NOW-10,issued_at_sec:NOW-5,expires_at_sec:NOW+15,
  key_id:'single-auth-publisher-key-v1',signature:''};
 const sign=async content=>({...content,signature:b64(await crypto.subtle.sign(
  'RSASSA-PKCS1-v1_5',keys.privateKey,canonicalBillingDeletePublisherV1(content)))});
 const envelope=await sign(payload);
 const calls={law:0,verify:0,read:0,write:0};
 const adapter={prepare(sql){
  calls.write++;assert.equal(sql,BILLING_R16_INBOX_INSERT_SQL);
  return {bind(...args){return {async first(){
   const row=bill.prepare(sql).get(...args);return row===undefined?null:{...row};
  }};}};
 }};
 const ports={
  async lawfulMinimalRetentionApproved(){calls.law++;return opt.law!==false;},
  async verifyCommittedOrigin(x){
   calls.verify++;
   if(opt.provenance===false)return false;
   const raw=auth.prepare('SELECT * FROM starry_deletion_outbox WHERE event_id=?').get(x.source_event_id);
   const m=auth.prepare('SELECT * FROM starry_members WHERE s_user_id=?').get(raw?.s_user_id);
   return !!raw&&!!m&&raw.event_type==='account_deleted'&&
    raw.occurred_at===x.occurred_at_sec&&m.status==='deleted'&&m.auth_version===x.auth_version;
  },
  async readCurrentDeletedAuth(x){
   calls.read++;
   if(opt.changeOnRead===calls.read)
    auth.prepare("UPDATE starry_members SET auth_version=auth_version+1").run();
   const raw=auth.prepare('SELECT * FROM starry_deletion_outbox WHERE event_id=?').get(x);
   const m=auth.prepare('SELECT * FROM starry_members WHERE s_user_id=?').get(raw?.s_user_id);
   if(!raw||!m)return null;
   return {status:m.status,source_event_id:raw.event_id,
    source_commit_ref:commit,member_ref:member,event_ref:eref,
    event_digest:'f'.repeat(64),auth_version:m.auth_version,
    occurred_at_sec:raw.occurred_at};
  },
 };
 const inbox=(override={})=>createOfflineSinglePublisherBillingInbox({
  enabled:true,scope,verifyKey:verify,key_id:payload.key_id,db:adapter,ports,...override
 });
 const count=table=>bill.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
 const active=()=>bill.prepare("SELECT COUNT(*) AS n FROM billing_entitlement_candidate_DRAFT WHERE candidate_state='candidate_active'").get().n;
 return {auth,bill,keys,verify,sign,envelope,payload,ports,calls,inbox,count,active,
  close:()=>{auth.close();bill.close();}};
}
test('R16 OFF by default and no accesses, no Queue ACK or payment',async t=>{
 const s=await fixture();t.after(s.close);
 assert.equal((await s.inbox({enabled:false}).accept(s.envelope,NOW)).status,'disabled');
 assert.deepEqual(s.calls,{law:0,verify:0,read:0,write:0});
 assert.equal(LIVE_BILLING_DELETE_INBOX_ENABLED,false);
 assert.equal(BILLING_DELETE_INBOX_PUBLISHABLE,false);
 assert.equal(BILLING_DELETE_INBOX_ACK_ALLOWED,false);
});
test('real two independent SQLite DB: signed sole-candidate publisher, inbox+tombstone+revoke commit',async t=>{
 const s=await fixture();t.after(s.close);
 const out=await s.inbox().accept(s.envelope,NOW);
 assert.deepEqual(out,{status:'recorded_offline',reason:'SAME_BILLING_DB_INBOX_TOMBSTONE_ATOMIC',
  may_ack_queue:false,may_grant:false,live:false});
 assert.equal(s.active(),0);
 assert.equal(s.count('billing_delete_inbox_R16_DRAFT'),1);
 assert.equal(s.count('billing_deletion_fence_DRAFT'),1);
 assert.equal(s.calls.verify,2);assert.equal(s.calls.read,2);
 assert.throws(()=>s.bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT(candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES (?,?,?,?,?)')
  .run('r_'+'5'.repeat(64),'staging',member,'digital.monthly','candidate_active'),/DELETED_MEMBER_NO_NEW_BILLING/);
});
test('duplicate retry cannot cause double Billing receipt, tombstone or regrant',async t=>{
 const s=await fixture();t.after(s.close);
 await s.inbox().accept(s.envelope,NOW);
 const replay=await s.inbox().accept(s.envelope,NOW);
 assert.equal(replay.reason,'DUPLICATE_COMMITTED_DELIVERY');
 assert.equal(replay.may_ack_queue,false);
 assert.equal(s.count('billing_delete_inbox_R16_DRAFT'),1);
 assert.equal(s.count('billing_deletion_fence_DRAFT'),1);
});
test('unauthorized AI-3 or AI-4 second publisher rejected even if signed by same key',async t=>{
 const s=await fixture();t.after(s.close);
 for(const publisher of ['starry.battery.publisher','starry.api.relay.v1']){
  const forged=await s.sign({...s.payload,publisher_id:publisher});
  assert.equal((await s.inbox().accept(forged,NOW)).reason,'UNTRUSTED_PUBLISHER_ENVELOPE');
 }
 assert.equal(s.calls.law,0);assert.equal(s.calls.write,0);
});
test('tampered authenticated fields, signature or alternate RSA signer rejected',async t=>{
 const s=await fixture(),another=await fixture();t.after(s.close);t.after(another.close);
 for(const bad of [{...s.envelope,auth_version:999},
  {...s.envelope,event_digest:'0'.repeat(64)},
  {...s.envelope,signature:'bad'}]){
  assert.equal((await s.inbox().accept(bad,NOW)).status,'blocked');
 }
 const foreignSig=await another.sign(s.payload);
 assert.equal((await s.inbox().accept(foreignSig,NOW)).reason,'PUBLISHER_SIGNATURE_DENIED');
 assert.equal(s.calls.write,0);
});
test('Q104/Q119 lawful purpose fails before ever reading Auth or Billing',async t=>{
 const s=await fixture({law:false});t.after(s.close);
 assert.equal((await s.inbox().accept(s.envelope,NOW)).reason,'LAWFUL_PURPOSE_NOT_APPROVED');
 assert.equal(s.calls.verify,0);assert.equal(s.calls.read,0);assert.equal(s.calls.write,0);
});
test('uncommitted Auth proof fails before Billing inbox mutation',async t=>{
 const s=await fixture({provenance:false});t.after(s.close);
 assert.equal((await s.inbox().accept(s.envelope,NOW)).reason,'AUTH_COMMIT_PROOF_MISSING');
 assert.equal(s.calls.read,0);assert.equal(s.calls.write,0);
});
test('Auth changed during delivery refuses receipt before Billing write',async t=>{
 const s=await fixture({changeOnRead:2});t.after(s.close);
 assert.equal((await s.inbox().accept(s.envelope,NOW)).status,'blocked');
 assert.equal(s.calls.write,0);assert.equal(s.count('billing_delete_inbox_R16_DRAFT'),0);
});
test('committed deleted Member changes status before proof: no Billing mutation',async t=>{
 const s=await fixture();t.after(s.close);
 s.auth.prepare("UPDATE starry_members SET status='active'").run();
 assert.equal((await s.inbox().accept(s.envelope,NOW)).status,'blocked');
 assert.equal(s.calls.write,0);
});
test('failed stale tombstone trigger rolls back inbox insert and leaves existing protection',async t=>{
 const s=await fixture();t.after(s.close);
 s.bill.prepare("INSERT INTO billing_deletion_fence_DRAFT(brand_id,environment,member_ref,deleted_version,deleted_at_sec,event_ref,event_digest) VALUES (?,?,?,?,?,?,?)")
  .run('starry','staging',member,9,NOW-1,'r_'+'6'.repeat(64),'1'.repeat(64));
 const res=await s.inbox().accept(s.envelope,NOW);
 assert.equal(res.status,'blocked');
 assert.equal(s.count('billing_delete_inbox_R16_DRAFT'),0);
 assert.equal(s.bill.prepare('SELECT deleted_version FROM billing_deletion_fence_DRAFT').get().deleted_version,9);
 assert.equal(s.active(),0);
});
test('SQLite DB failure on duplicate event_ref for distinct source rolls back new inbox',async t=>{
 const s=await fixture();t.after(s.close);
 await s.inbox().accept(s.envelope,NOW);
 const next=await s.sign({...s.payload,source_event_id:'AuthDeletionEvent-20261027-0002'});
 const res=await s.inbox().accept(next,NOW);
 assert.equal(res.status,'blocked');
 assert.equal(s.count('billing_delete_inbox_R16_DRAFT'),1);
});
test('SQLite outer transaction rollback reverts inbox, tombstone and candidate revocations',async t=>{
 const s=await fixture();t.after(s.close);
 s.bill.exec('BEGIN');
 assert.equal((await s.inbox().accept(s.envelope,NOW)).status,'recorded_offline');
 s.bill.exec('ROLLBACK');
 assert.equal(s.count('billing_delete_inbox_R16_DRAFT'),0);
 assert.equal(s.count('billing_deletion_fence_DRAFT'),0);
 assert.equal(s.active(),2);
});
test('immutable Billing inbox cannot update or delete committed source',async t=>{
 const s=await fixture();t.after(s.close);
 await s.inbox().accept(s.envelope,NOW);
 assert.throws(()=>s.bill.exec("DELETE FROM billing_delete_inbox_R16_DRAFT"),/BILLING_INBOX_IMMUTABLE/);
 assert.throws(()=>s.bill.exec("UPDATE billing_delete_inbox_R16_DRAFT SET auth_version=9"),/BILLING_INBOX_IMMUTABLE/);
});
test('expired, future, wrong brand/env, malformed/accessor Proxy and extra keys fail closed',async t=>{
 const s=await fixture();t.after(s.close);
 for(const bad of [
  {...s.envelope,brand_id:'hglobal'}, {...s.envelope,environment:'production'},
  {...s.envelope,expires_at_sec:NOW-1},
  {...s.envelope,issued_at_sec:NOW+1},
  {...s.envelope,source_commit_ref:'unproven'},
  {...s.envelope,extra:true},
  Object.defineProperty({...s.envelope},'member_ref',{get(){throw Error('trap');}}),
  new Proxy({}, {getPrototypeOf(){throw Error('trap');}}),
 ]){
  assert.equal((await s.inbox().accept(bad,NOW)).status,'blocked');
 }
 assert.equal(s.calls.write,0);
});
test('extractable public keys and foreign brand config are denied, no trust downgrade',async t=>{
 const s=await fixture();t.after(s.close);
 assert.throws(()=>s.inbox({verifyKey:s.keys.publicKey}),/BILLING_R16_CONFIG_DENIED/);
 assert.throws(()=>s.inbox({scope:{brand_id:'hglobal',environment:'staging'}}),/BILLING_R16_CONFIG_DENIED/);
 assert.throws(()=>s.inbox({scope:{brand_id:'starry',environment:'production'}}),/BILLING_R16_CONFIG_DENIED/);
});
test('Auth and Billing SQLite are separate; successful local receipt is not cross-DB atomic ACK',async t=>{
 const s=await fixture();t.after(s.close);
 assert.equal((await s.inbox().accept(s.envelope,NOW)).status,'recorded_offline');
 s.auth.prepare("DELETE FROM starry_deletion_outbox").run();
 assert.equal(s.count('billing_delete_inbox_R16_DRAFT'),1);
 assert.equal((await s.inbox().accept(s.envelope,NOW)).status,'blocked');
 assert.equal(s.count('billing_delete_inbox_R16_DRAFT'),1);
});
