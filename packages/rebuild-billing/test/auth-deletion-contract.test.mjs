import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {BILLING_DELETION_FENCE_SQL} from '../src/account-deletion-fence.ts';
import {BILLING_DELETE_CONTRACT_PUBLISHABLE,LIVE_AUTH_BILLING_DELETE_BRIDGE_ENABLED,
 BILLING_DELETE_CONTRACT_VERSION,createOfflineBillingDeletionContractBridge}
 from '../src/auth-deletion-contract.ts';

const NOW=1793100000,SCOPE={brand_id:'starry',environment:'staging'};
const id='AuthDeleteEvent-20261027-123456789',user='starry_member_opaque_A';
const authSchema=readFileSync(new URL('../../../modules/starry-id-v1/schema/011_starry_one_use_deletion.UP.DRAFT.sql',import.meta.url),'utf8');
const sqlSchema=readFileSync(new URL('../schema/0007_account_deletion_fence_DRAFT.sql',import.meta.url),'utf8');
async function fixture(opts={}){
 // Two independent connections: no fake cross-D1 transaction can be inferred.
 const auth=new DatabaseSync(':memory:'),bill=new DatabaseSync(':memory:');
 auth.exec("CREATE TABLE starry_deletion_outbox(event_id TEXT PRIMARY KEY,s_user_id TEXT,occurred_at INTEGER,event_type TEXT);CREATE TABLE starry_members(s_user_id TEXT PRIMARY KEY,status TEXT,auth_version INTEGER,updated_at INTEGER)");
 auth.prepare('INSERT INTO starry_deletion_outbox VALUES (?,?,?,?)')
  .run(id,user,NOW-10,'account_deleted');
 auth.prepare('INSERT INTO starry_members VALUES (?,?,?,?)')
  .run(user,'deleted',8,NOW-10);
 bill.exec(sqlSchema);
 bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT (candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES (?,?,?,?,?)');
 const key=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(11),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const calls={law:0,read:0,proof:0,write:0};
 const snapshot=()=>{
  const o=auth.prepare('SELECT event_id,s_user_id,occurred_at,event_type FROM starry_deletion_outbox WHERE event_id=?').get(id);
  const m=auth.prepare('SELECT s_user_id,status,auth_version,updated_at FROM starry_members WHERE s_user_id=?').get(user);
  if(!o||!m)return null;
  return {outbox:{...o},member:{...m}};
 };
 const deps={
  enabled:true,scope:SCOPE,key,db:{prepare(sql){
   calls.write++;assert.equal(sql,BILLING_DELETION_FENCE_SQL);
   return {bind(...args){return {async first(){
    const out=bill.prepare(sql).get(...args);return out===undefined?null:{...out};
   }};}};
  }},
  lawfulMinimalRetentionApproved:async()=>{calls.law++;return opts.law!==false;},
  auth:{
   readCommittedSnapshot:async()=>{
    calls.read++;
    if(opts.mutateAt===calls.read){
     auth.prepare('UPDATE starry_members SET auth_version=auth_version+1').run();
    }
    if(opts.deleted===false)return null;
    const s=snapshot();
    return opts.transform?opts.transform(s,calls.read):s;
   },
   verifyCommittedSnapshot:async()=>{
    calls.proof++;return opts.proof!==false;
   },
  },
 };
 const make=(over={})=>createOfflineBillingDeletionContractBridge({...deps,...over});
 return {make,bill,auth,calls,key,close:()=>{bill.close();auth.close();},
  active:()=>bill.prepare("SELECT COUNT(*) AS n FROM billing_entitlement_candidate_DRAFT WHERE candidate_state='candidate_active'").get().n,
  tombstones:()=>bill.prepare('SELECT COUNT(*) AS n FROM billing_deletion_fence_DRAFT').get().n,
 };
}
test('R15 real Auth schema source contract is exact four columns, not fake Billing fields',()=>{
 assert.match(authSchema,/INSERT INTO starry_deletion_outbox\(event_id,s_user_id,occurred_at,event_type\)/);
 assert.doesNotMatch(authSchema,/INSERT INTO starry_deletion_outbox\(.*auth_version/);
 assert.equal(LIVE_AUTH_BILLING_DELETE_BRIDGE_ENABLED,false);
 assert.equal(BILLING_DELETE_CONTRACT_PUBLISHABLE,false);
 assert.equal(BILLING_DELETE_CONTRACT_VERSION,'starry.billing.account_deleted.candidate.v1');
});
test('default OFF: no raw Auth read, cryptography or Billing write',async t=>{
 const a=await fixture();t.after(a.close);
 assert.equal((await a.make({enabled:false}).consumeCommittedAuthEvent(id,NOW)).status,'disabled');
 assert.deepEqual(a.calls,{law:0,read:0,proof:0,write:0});
});
test('legal purpose denial precedes every raw Auth identifier or Billing operation',async t=>{
 const a=await fixture({law:false});t.after(a.close);
 assert.equal((await a.make().consumeCommittedAuthEvent(id,NOW)).reason,'LAWFUL_RETENTION_REQUIRED');
 assert.equal(a.calls.read,0);assert.equal(a.calls.write,0);
});
test('full cross-DB candidate: HMAC derived Billing tombstone revokes after committed Auth proof',async t=>{
 const a=await fixture();t.after(a.close);
 // Materialize prior Store candidate under the same scoped keyed member pseudonym
 // from the same sealed key, independently of any user-supplied Queue JSON.
 const data=JSON.stringify([BILLING_DELETE_CONTRACT_VERSION,'member.v1','starry','staging',user]);
 const pseudonym='m_'+Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',a.key,
  new TextEncoder().encode(data))),x=>x.toString(16).padStart(2,'0')).join('');
 a.bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT (candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES (?,?,?,?,?)')
  .run('r_'+'b'.repeat(64),'staging',pseudonym,'starry.monthly','candidate_active');
 const outcome=await a.make().consumeCommittedAuthEvent(id,NOW);
 assert.equal(outcome.status,'revoked_candidate');
 assert.equal(outcome.may_ack,false);assert.equal(outcome.may_grant,false);
 assert.equal(a.active(),0);assert.equal(a.tombstones(),1);
 const row=a.bill.prepare('SELECT * FROM billing_deletion_fence_DRAFT').get();
 assert.equal(row.member_ref,pseudonym);
 assert.equal(row.deleted_version,8);
 assert.match(row.event_ref,/^r_[a-f0-9]{64}$/);
 assert.match(row.event_digest,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(row).includes(user),false);
 assert.ok(a.calls.read>=3);assert.ok(a.calls.proof>=3);
 assert.throws(()=>a.bill.prepare('INSERT INTO billing_entitlement_candidate_DRAFT (candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES (?,?,?,?,?)')
  .run('r_'+'c'.repeat(64),'staging',pseudonym,'starry.monthly','candidate_active'),/DELETED_MEMBER_NO_NEW_BILLING/);
});
test('repeated Auth event maps identical scoped HMAC but cannot overwrite one-use tombstone',async t=>{
 const a=await fixture();t.after(a.close);
 assert.equal((await a.make().consumeCommittedAuthEvent(id,NOW)).status,'revoked_candidate');
 assert.equal((await a.make().consumeCommittedAuthEvent(id,NOW)).reason,'REPLAY_OR_STALE_AUTH_VERSION');
 assert.equal(a.tombstones(),1);
});
test('current Auth member not deleted or absent fails before Billing writes',async t=>{
 for(const fn of [
  s=>({...s,member:{...s.member,status:'active'}}),
  s=>({...s,member:{...s.member,auth_version:0}}),
  s=>({...s,member:{...s.member,updated_at:NOW-11}}),
  ()=>null,
 ]){
  const a=await fixture({transform:fn});t.after(a.close);
  assert.equal((await a.make().consumeCommittedAuthEvent(id,NOW)).status,'blocked');
  assert.equal(a.calls.write,0);
 }
});
test('raw four-field outbox mismatch, getter or forged extra digest is fail closed',async t=>{
 for(const fn of [
  s=>({...s,outbox:{...s.outbox,event_type:'purchase'}}),
  s=>({...s,outbox:{...s.outbox,s_user_id:'other'}}),
  s=>({...s,outbox:{...s.outbox,event_digest:'invented'}}),
  s=>({...s,outbox:Object.defineProperty({...s.outbox},'event_id',{get(){throw Error('getter');}})}),
 ]){
  const a=await fixture({transform:fn});t.after(a.close);
  assert.equal((await a.make().consumeCommittedAuthEvent(id,NOW)).status,'blocked');
  assert.equal(a.calls.write,0);
 }
});
test('Auth signed/source committed verifier rejection prevents Billing mutation',async t=>{
 const a=await fixture({proof:false});t.after(a.close);
 assert.equal((await a.make().consumeCommittedAuthEvent(id,NOW)).reason,'AUTH_COMMIT_PROOF_DENIED');
 assert.equal(a.calls.write,0);
});
test('authVersion change between source reads blocks before Billing SQL',async t=>{
 const a=await fixture({mutateAt:2});t.after(a.close);
 assert.equal((await a.make().consumeCommittedAuthEvent(id,NOW)).status,'blocked');
 assert.equal(a.calls.write,0);
});
test('source lost before Billing read rejects, no ACK',async t=>{
 const a=await fixture({transform:(s,n)=>n>=2?null:s});t.after(a.close);
 const result=await a.make().consumeCommittedAuthEvent(id,NOW);
 assert.equal(result.status,'blocked');assert.equal(result.may_ack,false);
 assert.equal(a.calls.write,0);
});
test('bad event ID, production scope, extractable HMAC/invalid key rejected',async t=>{
 const a=await fixture();t.after(a.close);
 assert.equal((await a.make().consumeCommittedAuthEvent('bad',NOW)).status,'blocked');
 assert.equal(a.calls.read,0);
 assert.throws(()=>a.make({scope:{brand_id:'starry',environment:'production'}}),/BILLING_DELETION_BRIDGE_CONFIG_DENIED/);
 const key=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(1),
  {name:'HMAC',hash:'SHA-256'},true,['sign']);
 assert.throws(()=>a.make({key}),/BILLING_DELETION_BRIDGE_CONFIG_DENIED/);
});
test('independent Auth and Billing DBs do not share rollback/transaction',async t=>{
 const a=await fixture();t.after(a.close);
 a.auth.exec('BEGIN');
 a.auth.prepare('UPDATE starry_members SET auth_version=9').run();
 a.auth.exec('ROLLBACK');
 assert.equal(a.tombstones(),0);
 // Successfully reviewed Billing state is not a proof of cross-D1 atomicity.
 assert.equal((await a.make().consumeCommittedAuthEvent(id,NOW)).status,'revoked_candidate');
 assert.equal(a.tombstones(),1);
});
