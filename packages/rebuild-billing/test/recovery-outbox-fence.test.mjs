import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {
 BILLING_OUTBOX_RESTORE_ALLOWED,LIVE_BILLING_RECOVERY_ENABLED,
 BILLING_RECOVERY_SQL,createOfflineBillingOutboxRecoveryFence,
 calculateOfflineBillingChain,
} from '../src/recovery-outbox-fence.ts';

const NOW=1793100000;
const S={brand_id:'starry',environment:'staging'};
const ref=c=>'r_'+c.repeat(64);
const event=(seq=1,state='PAID')=>({
 seq,event_ref:ref(seq===1?'a':'b'),
 app_id:'starry.alpha',store:'apple',store_app_id:'phd.starry.alpha',
 offer_id:'alpha.monthly',kind:'monthly',event_state:state,
 source_version:seq,store_effective_sec:NOW-(seq===1?25:100),
 committed_sec:NOW-(seq===1?15:10),source_digest:(seq===1?'c':'d').repeat(64),
});
const schema=readFileSync(new URL('../schema/0006_recovery_outbox_DRAFT.sql',import.meta.url),'utf8');
const INSERT='INSERT INTO billing_recovery_outbox_DRAFT (brand_id,environment,seq,event_ref,app_id,store,store_app_id,offer_id,kind,event_state,source_version,store_effective_sec,committed_sec,source_digest) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
function add(db,e,scope=S){
 db.prepare(INSERT).run(scope.brand_id,scope.environment,
  e.seq,e.event_ref,e.app_id,e.store,e.store_app_id,e.offer_id,
  e.kind,e.event_state,e.source_version,e.store_effective_sec,
  e.committed_sec,e.source_digest);
}
async function setup(options={}){
 const db=new DatabaseSync(':memory:');db.exec(schema);
 const rows=options.rows??[event(1),event(2,'REFUNDED')];
 for(const row of rows)add(db,row);
 const chain=await calculateOfflineBillingChain(S,rows,NOW);
 const witness=options.witness??{
  brand_id:'starry',environment:'staging',source:'independent_append_only',
  witness_ref:ref('e'),observed_at_sec:NOW,sequence:chain.count,head_digest:chain.headDigest,
 };
 const called={privacy:0,hold:0,witness:0,attest:0,read:0,audit:0};
 const adapter={prepare(sql){
  assert.ok(Object.values(BILLING_RECOVERY_SQL).includes(sql));
  return {args:[],bind(...args){this.args=args;return this;},
   async first(){
    called.read++;
    const result=db.prepare(sql).get(...this.args);
    return result===undefined?null:{...result};
   },
   async all(){
    called.read++;
    const result=db.prepare(sql).all(...this.args).map(x=>({...x}));
    if(options.onAll)options.onAll(db);
    return {results:options.overrideRows??result};
   },
  };
 }};
 const ports={
  async privacyAndRecoveryApprovedNow(){called.privacy++;return options.privacy!==false;},
  async readLegalHold(){called.hold++;return options.hold??'clear';},
  async readIndependentWitness(){called.witness++;return options.returnWitness??witness;},
  async verifyIndependentAttestation(){called.attest++;return options.attest!==false;},
  async recordDurableReview(){called.audit++;return options.audit!==false;},
 };
 const make=(override={})=>createOfflineBillingOutboxRecoveryFence({
  enabled:true,scope:S,db:adapter,ports,maxEvents:128,...override,
 });
 return {db,rows,witness,called,make,close:()=>db.close()};
}
test('R11 opt-in default OFF blocks before privacy, witness or D1',async t=>{
 const f=await setup();t.after(f.close);
 const p=f.make({enabled:false});
 assert.equal((await p.review(NOW)).reason,'DISABLED');
 assert.deepEqual(f.called,{privacy:0,hold:0,witness:0,attest:0,read:0,audit:0});
 assert.equal(LIVE_BILLING_RECOVERY_ENABLED,false);
 assert.equal(BILLING_OUTBOX_RESTORE_ALLOWED,false);
});
test('Q104/Q119 lawful gate denied: zero D1 or witness reads',async t=>{
 const f=await setup({privacy:false});t.after(f.close);
 assert.equal((await f.make().review(NOW)).reason,'PRIVACY_GATE');
 assert.equal(f.called.witness,0);assert.equal(f.called.read,0);
});
test('legal hold blocks before opening Billing D1',async t=>{
 const f=await setup({hold:'held'});t.after(f.close);
 assert.equal((await f.make().review(NOW)).reason,'LEGAL_HOLD');
 assert.equal(f.called.witness,0);assert.equal(f.called.read,0);
});
test('authenticated external two-event witness: only review_only, refund retained',async t=>{
 const f=await setup();t.after(f.close);
 const result=await f.make().review(NOW);
 assert.deepEqual(result,{disposition:'review_only',reason:'BILLING_OUTBOX_REVIEW_ONLY',
  billing_outbox:2,head_digest:f.witness.head_digest,may_restore:false});
 assert.equal(f.called.read,3);assert.equal(f.called.audit,1);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM billing_recovery_outbox_DRAFT').get().n,2);
});
test('external attestation failure blocks before D1 read',async t=>{
 const f=await setup({attest:false});t.after(f.close);
 assert.equal((await f.make().review(NOW)).reason,'WITNESS_NOT_AUTHENTICATED');
 assert.equal(f.called.read,0);assert.equal(f.called.audit,0);
});
test('stale independent witness and foreign/HGlobal witness denied',async t=>{
 for(const bad of [
  {observed_at_sec:NOW-31},
  {brand_id:'hglobal'},
  {environment:'development'},
  {head_digest:'short'},
  {source:'snapshot_same_d1'},
 ]){
  const f=await setup();t.after(f.close);
  const w={...f.witness,...bad};
  const g=await setup({returnWitness:w});t.after(g.close);
  assert.equal((await g.make().review(NOW)).reason,'WITNESS_MISSING_OR_STALE');
  assert.equal(g.called.read,0);
 }
});
test('PITR rollback with missing refund cannot pass independent latest witness',async t=>{
 const current=await setup();t.after(current.close);
 const pit=await setup({rows:[event(1)],returnWitness:current.witness});t.after(pit.close);
 assert.equal((await pit.make().review(NOW)).reason,'WITNESS_OR_COUNT_DIVERGED');
 assert.equal(pit.called.audit,0);
});
test('same event count but paid-looking modified refund rejected by hash anchor',async t=>{
 const trusted=await setup();t.after(trusted.close);
 const fake=await setup({rows:[event(1),event(2,'RENEWED')],
  returnWitness:trusted.witness});t.after(fake.close);
 assert.equal((await fake.make().review(NOW)).reason,'INDEPENDENT_DIGEST_DIVERGED');
 assert.equal(fake.called.audit,0);
});
test('outbox gap in seq is rejected despite independently provided count',async t=>{
 const f=await setup({rows:[event(1)]});t.after(f.close);
 add(f.db,{...event(2,'REFUNDED'),seq:3});
 const w={...f.witness,sequence:2,head_digest:'1'.repeat(64)};
 const next=await setup({rows:[event(1)],returnWitness:w});t.after(next.close);
 add(next.db,{...event(2,'REFUNDED'),seq:3});
 assert.equal((await next.make().review(NOW)).reason,'INVALID_OR_GAPPED_EVENT');
});
test('snapshot changed during read cannot pass double count',async t=>{
 const f=await setup({rows:[event(1)],onAll:db=>add(db,event(2,'REFUNDED'))});
 t.after(f.close);
 assert.equal((await f.make().review(NOW)).reason,'CONCURRENT_OUTBOX_CHANGE');
});
test('malicious event Proxy/accessor is rejected and never persisted',async t=>{
 const a=await setup({overrideRows:[new Proxy({},{
  getPrototypeOf(){throw Error('trap');}
 })]});t.after(a.close);
 assert.equal((await a.make().review(NOW)).reason,'INVALID_OR_GAPPED_EVENT');
 assert.equal(a.called.audit,0);
});
test('append-only DRAFT SQLite forbids UPDATE, DELETE and paid Battery',async t=>{
 const f=await setup();t.after(f.close);
 assert.throws(()=>f.db.exec("UPDATE billing_recovery_outbox_DRAFT SET event_state='PAID' WHERE seq=2"));
 assert.throws(()=>f.db.exec('DELETE FROM billing_recovery_outbox_DRAFT WHERE seq=2'));
 assert.throws(()=>add(f.db,{...event(3),offer_id:'battery.paid',event_ref:ref('3')}));
 assert.throws(()=>add(f.db,{...event(3),event_ref:ref('3')},{brand_id:'hglobal',environment:'staging'}));
});
test('maxEvents bounded: cannot use truncated history as proof',async t=>{
 const f=await setup();t.after(f.close);
 assert.equal((await f.make({maxEvents:1}).review(NOW)).reason,'PAGINATION_REQUIRED');
 assert.equal(f.called.read,0);
});
test('audit write failure forbids apparent success',async t=>{
 const f=await setup({audit:false});t.after(f.close);
 assert.equal((await f.make().review(NOW)).reason,'REVIEW_AUDIT_NOT_DURABLE');
});
test('default source rejects malformed timestamps and reordered commits',async()=>{
 await assert.rejects(calculateOfflineBillingChain(S,[
  event(1),{...event(2,'REFUNDED'),committed_sec:NOW-30}
 ],NOW),/BILLING_CHAIN_DENIED/);
});
