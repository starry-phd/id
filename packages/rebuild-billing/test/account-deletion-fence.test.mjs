import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createOfflineBillingAccountDeletionFence,BILLING_DELETION_FENCE_SQL,
 LIVE_BILLING_DELETION_CONSUMER_ENABLED,BILLING_DELETION_ENTITLEMENT_PUBLISHABLE}
 from '../src/account-deletion-fence.ts';
const NOW=1793100000,scope={brand_id:'starry',environment:'staging'};
const member='m_'+'a'.repeat(64),other='m_'+'b'.repeat(64);
const event={brand_id:'starry',environment:'staging',event_type:'account_deleted',
 member_ref:member,event_ref:'r_'+'c'.repeat(64),
 event_digest:'d'.repeat(64),auth_version:8,occurred_at_sec:NOW-10};
const path=new URL('../schema/0007_account_deletion_fence_DRAFT.sql',import.meta.url);
function add(db,m=member,c='a',offer='starry.monthly'){
 return db.prepare('INSERT INTO billing_entitlement_candidate_DRAFT (candidate_ref,environment,member_ref,offer_id,candidate_state) VALUES (?,?,?,?,?)')
  .run('r_'+c.repeat(64),'staging',m,offer,'candidate_active');
}
function setup(opts={}){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(path,'utf8'));
 if(!opts.empty){add(db,member,'e');add(db,member,'f');add(db,other,'1');}
 const count={lawful:0,verify:0,current:0,write:0};
 const current={brand_id:'starry',environment:'staging',status:'deleted',member_ref:member,
  auth_version:8,event_ref:event.event_ref,event_digest:event.event_digest,
  deleted_at_sec:event.occurred_at_sec};
 const ports={
  async lawfulMinimalRetentionApproved(){count.lawful++;return opts.lawful!==false;},
  async verifyCommittedAuthOutbox(){count.verify++;return opts.verified!==false;},
  async readCurrentAuthDeletion(){count.current++;return opts.current??current;},
 };
 const adapter={prepare(sql){
  count.write++;assert.equal(sql,BILLING_DELETION_FENCE_SQL);
  return {bind(...args){return {async first(){
   const value=db.prepare(sql).get(...args);return value===undefined?null:{...value};
  }};}};
 }};
 const make=(over={})=>createOfflineBillingAccountDeletionFence({
  enabled:true,scope,db:adapter,ports,...over});
 const rows=()=>db.prepare('SELECT member_ref,candidate_state FROM billing_entitlement_candidate_DRAFT').all();
 return {db,count,current,ports,make,rows,close:()=>db.close()};
}
test('R14 default disabled: no privacy, Auth or Billing DB reads',async t=>{
 const s=setup();t.after(s.close);
 assert.equal((await s.make({enabled:false}).consume(event,NOW)).status,'disabled');
 assert.deepEqual(s.count,{lawful:0,verify:0,current:0,write:0});
 assert.equal(LIVE_BILLING_DELETION_CONSUMER_ENABLED,false);
 assert.equal(BILLING_DELETION_ENTITLEMENT_PUBLISHABLE,false);
});
test('REAL SQLite: trusted deletion CAS tombstones + revokes ONLY matching member',async t=>{
 const s=setup();t.after(s.close);
 assert.deepEqual(await s.make().consume(event,NOW),{
  status:'revoked_candidate',reason:'BILLING_TOMBSTONE_COMMITTED',may_grant:false,may_ack:false});
 assert.equal(s.rows().filter(x=>x.member_ref===member&&x.candidate_state==='revoked').length,2);
 assert.equal(s.rows().find(x=>x.member_ref===other).candidate_state,'candidate_active');
 assert.equal(s.db.prepare('SELECT deleted_version FROM billing_deletion_fence_DRAFT').get().deleted_version,8);
});
test('REAL SQLite: delayed Store observation cannot insert new candidate or restore old one',async t=>{
 const s=setup();t.after(s.close);
 await s.make().consume(event,NOW);
 assert.throws(()=>add(s.db,member,'4'),/DELETED_MEMBER_NO_NEW_BILLING/);
 assert.throws(()=>s.db.prepare("UPDATE billing_entitlement_candidate_DRAFT SET candidate_state='candidate_active' WHERE member_ref=?").run(member),/DELETED_MEMBER_NO_REGRANT/);
 assert.equal(s.rows().filter(x=>x.member_ref===member&&x.candidate_state==='candidate_active').length,0);
});
test('REAL SQLite: old or replayed deletion event cannot overwrite tombstone',async t=>{
 const s=setup();t.after(s.close);
 assert.equal((await s.make().consume(event,NOW)).status,'revoked_candidate');
 assert.equal((await s.make().consume(event,NOW)).reason,'REPLAY_OR_STALE_AUTH_VERSION');
 const old={...event,auth_version:7};
 const x=s.make({ports:{...s.ports,readCurrentAuthDeletion:async()=>({
  ...s.current,auth_version:7})}});
 assert.equal((await x.consume(old,NOW)).reason,'REPLAY_OR_STALE_AUTH_VERSION');
});
test('REAL SQLite: newer Auth deletion version advances monotonically',async t=>{
 const s=setup();t.after(s.close);
 await s.make().consume(event,NOW);
 const newer={...event,auth_version:9,event_ref:'r_'+'4'.repeat(64),
  event_digest:'5'.repeat(64),occurred_at_sec:NOW-1};
 const alt={...s.ports,readCurrentAuthDeletion:async()=>({
  ...s.current,auth_version:9,event_ref:newer.event_ref,
  event_digest:newer.event_digest,deleted_at_sec:newer.occurred_at_sec})};
 assert.equal((await s.make({ports:alt}).consume(newer,NOW)).status,'revoked_candidate');
 assert.equal(s.db.prepare('SELECT deleted_version FROM billing_deletion_fence_DRAFT').get().deleted_version,9);
 assert.equal(s.rows().filter(x=>x.member_ref===member&&x.candidate_state==='candidate_active').length,0);
});
test('lawful retention denial prevents Auth or Billing contact',async t=>{
 const s=setup({lawful:false});t.after(s.close);
 assert.equal((await s.make().consume(event,NOW)).reason,'LAWFUL_RETENTION_REQUIRED');
 assert.deepEqual(s.count,{lawful:1,verify:0,current:0,write:0});
});
test('unsigned committed Auth outbox fails closed without touching Billing',async t=>{
 const s=setup({verified:false});t.after(s.close);
 assert.equal((await s.make().consume(event,NOW)).reason,'AUTH_OUTBOX_UNVERIFIED');
 assert.equal(s.count.current,0);assert.equal(s.count.write,0);
});
test('current Member not deleted, wrong version or wrong digest denied',async t=>{
 for(const altered of [{status:'active'},{auth_version:9},{event_digest:'a'.repeat(64)}]){
  const s=setup({current:{brand_id:'starry',environment:'staging',
   status:'deleted',member_ref:member,auth_version:8,event_ref:event.event_ref,
   event_digest:event.event_digest,deleted_at_sec:event.occurred_at_sec,...altered}});
  t.after(s.close);
  assert.equal((await s.make().consume(event,NOW)).reason,'CURRENT_AUTH_NOT_DELETED_OR_DIVERGED');
  assert.equal(s.count.write,0);
 }
});
test('wrong brand, env, malformed HMAC/ref, expired/future event denied before Auth',async t=>{
 const s=setup();t.after(s.close);
 for(const alt of [{brand_id:'hglobal'},{environment:'production'},
  {event_type:'entitlement_granted'},{member_ref:'member@email'},
  {event_ref:'bad'},{event_digest:'INVALID'},{occurred_at_sec:NOW+1},
  {occurred_at_sec:NOW-604801}]){
  assert.equal((await s.make().consume({...event,...alt},NOW)).status,'blocked');
 }
 assert.equal(s.count.lawful,0);assert.equal(s.count.write,0);
});
test('getter/Proxy/extra properties rejected before lawful or DB reads',async t=>{
 const s=setup();t.after(s.close);
 for(const invalid of [{...event,extra:true},
  Object.defineProperty({...event},'member_ref',{get(){throw Error('injected');}}),
  new Proxy({}, {getPrototypeOf(){throw Error('revoked');}})]){
  assert.equal((await s.make().consume(invalid,NOW)).status,'blocked');
 }
 assert.equal(s.count.lawful,0);
});
test('REAL SQLite: UNIQUE event collision rolls back new tombstone and BOTH candidates',async t=>{
 const s=setup();t.after(s.close);
 s.db.prepare("INSERT INTO billing_deletion_fence_DRAFT (environment,member_ref,deleted_version,deleted_at_sec,event_ref,event_digest) VALUES (?,?,?,?,?,?)")
  .run('staging',other,2,NOW-50,event.event_ref,'e'.repeat(64));
 assert.equal((await s.make().consume(event,NOW)).status,'blocked');
 assert.equal(s.db.prepare('SELECT count(*) AS n FROM billing_deletion_fence_DRAFT WHERE member_ref=?').get(member).n,0);
 assert.equal(s.rows().filter(x=>x.member_ref===member&&x.candidate_state==='candidate_active').length,2);
});
test('REAL SQLite: outer transaction ROLLBACK restores tombstone and candidates',async t=>{
 const s=setup();t.after(s.close);
 s.db.exec('BEGIN');
 assert.equal((await s.make().consume(event,NOW)).status,'revoked_candidate');
 s.db.exec('ROLLBACK');
 assert.equal(s.db.prepare('SELECT count(*) AS n FROM billing_deletion_fence_DRAFT').get().n,0);
 assert.equal(s.rows().filter(x=>x.member_ref===member&&x.candidate_state==='candidate_active').length,2);
});
test('schema excludes H-Global, production, paid Battery candidates',async t=>{
 const s=setup();t.after(s.close);
 assert.throws(()=>add(s.db,member,'7','premium.battery'));
 assert.throws(()=>s.db.prepare("UPDATE billing_entitlement_candidate_DRAFT SET brand_id='hglobal'").run());
 assert.throws(()=>s.db.prepare("UPDATE billing_entitlement_candidate_DRAFT SET environment='production'").run());
});
