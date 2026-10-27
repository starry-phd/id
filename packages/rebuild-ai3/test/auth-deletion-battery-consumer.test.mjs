import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_BATTERY_DELETION_CONSUMER_ENABLED,BATTERY_DELETE_SQL,
 createOfflineAuthDeletionBatteryConsumer}
 from '../src/auth-deletion-battery-consumer.ts';
const scope={brand_id:'starry',environment:'staging'};
const event={event_id:'delete_event_12345678901234567890',
 member_ref:'member_1',occurred_at_sec:100,event_type:'account_deleted'};
const result={applied:1,revoked:1,balance:0,version:3,journal_revision:3,
 kind:'revoke',delta:-3,balance_after:0,reason_code:'ACCOUNT_DELETED',pending_holds:0};
function fixture(opts={}){
 let dbReads=0,approved=0,mutations=0;
 const db={prepare(sql){
  dbReads++;
  return {bind(...v){return {
   run:async()=>{
    mutations++;
    if(opts.failSql)throw Error('SQL CONSTRAINT');
    return opts.runResult??{success:true,meta:{changes:1}};
   },
   first:async()=>opts.readFailure?null:opts.row??result,
  };}};
 }};
 const authority={
  async verifyCommittedDeletion(s,e){approved++;return opts.auth!==false},
  async readApprovedBatteryPolicyVersion(){return Object.hasOwn(opts,'policy')?opts.policy:1}
 };
 const build=(overrides={})=>createOfflineAuthDeletionBatteryConsumer(
  {scope,db,authority,enabled:true,...overrides});
 return {build,db,authority,stats:()=>({dbReads,approved,mutations})};
}
test('R14 offline-only consumer, valid Auth committed receipt never ACKs Queue or regrants X/Y',async()=>{
 assert.equal(LIVE_BATTERY_DELETION_CONSUMER_ENABLED,false);
 const f=fixture(),r=await f.build().consume(event,100_500);
 assert.deepEqual(r,{disposition:'receipt_only',
  reason:'BATTERY_LOCAL_REVOCATION_RECORDED',may_regrant:false,
  may_ack_queue:false,live:false});
 assert.equal(f.stats().mutations,1);
});
test('R14 SQL is one INSERT, not unrelated multi-db writes; only local tombstone transaction',()=>{
 assert.match(BATTERY_DELETE_SQL.apply,/^INSERT INTO ai3_r14_deletion_inbox /);
 assert.match(BATTERY_DELETE_SQL.receipt,/pending_holds/);
 assert.match(BATTERY_DELETE_SQL.receipt,/journal_revision/);
});
test('R14 strict disable, scope and source ports checked before reading Auth',async()=>{
 const f=fixture();
 assert.equal((await f.build({enabled:false}).consume(event,100_500)).reason,'DISABLED');
 assert.equal(f.stats().approved,0);assert.equal(f.stats().dbReads,0);
 for(const bad of [{...scope,brand_id:'hglobal'},{...scope,environment:'production'}]){
  assert.throws(()=>f.build({scope:bad}),/SCOPE_DENIED/);
 }
 assert.throws(()=>f.build({authority:{}}),/SERVER_PORTS_REQUIRED/);
});
test('R14 reject forged event type, extra fields, hidden PII, getters and revoked Proxy',async()=>{
 const f=fixture();const hidden={...event};
 Object.defineProperty(hidden,'oauth_sub',{value:'secret',enumerable:false});
 const getter={...event};
 Object.defineProperty(getter,'member_ref',{get(){return 'member_1'},enumerable:true});
 const p=Proxy.revocable(event,{});p.revoke();
 for(const invalid of [{...event,event_type:'registration_grant'},
  {...event,brand_id:'hglobal'},{...event,member_ref:'person@example.com'},
  {...event,event_id:'short'},{...event,occurred_at_sec:-1},
  {...event,occurred_at_sec:Infinity},
  {...event,occurred_at_sec:101},hidden,getter,p.proxy]){
  assert.equal((await f.build().consume(invalid,100_500)).disposition,'retry');
 }
 assert.equal(f.stats().approved,0);assert.equal(f.stats().dbReads,0);
});
test('R14 legal/current Auth source refusal or unexpected event does not write',async()=>{
 const f=fixture({auth:false});
 assert.equal((await f.build().consume(event,100_500)).reason,'AUTH_DELETE_NOT_AUTHENTICATED');
 assert.equal(f.stats().dbReads,0);
});
test('R14 no approved Battery policy version means no mutation, no arbitrary X/Y',async()=>{
 for(const policy of [null,0,-1,NaN]){
  const f=fixture({policy});
  assert.equal((await f.build().consume(event,100_500)).reason,'BATTERY_POLICY_NOT_AUTHORIZED');
  assert.equal(f.stats().dbReads,0);
 }
});
test('R14 failed CAS/inbox/journal writes or D1 outage never ACK Queue',async()=>{
 for(const opts of [{failSql:true},{runResult:{success:false,meta:{changes:0}}},
  {runResult:{success:true,meta:{changes:0}}}]){
  const f=fixture(opts),r=await f.build().consume(event,100_500);
  assert.equal(r.disposition,'retry');
  assert.equal(r.may_ack_queue,false);
 }
});
test('R14 post-commit readback mismatch and uncertainty require retry without regrant',async()=>{
 for(const row of [null,{...result,balance:1},{...result,pending_holds:1},
  {...result,revoked:0},{...result,version:4},{...result,kind:'commit'},
  {...result,raw_oauth:'secret'}]){
  const f=fixture({row,readFailure:row===null});
  assert.equal((await f.build().consume(event,100_500)).disposition,'retry');
 }
});
test('R14 duplicate events or revoked Member cause transaction SQL failure; never fake success',async()=>{
 const f=fixture({failSql:true});
 assert.equal((await f.build().consume(event,100_500)).disposition,'retry');
 assert.equal(f.stats().mutations,1);
});
test('R14 no client authority object, no future Auth deletion, safe epoch multiplication',async()=>{
 const f=fixture();
 assert.equal((await f.build().consume({...event,occurred_at_sec:1000000},100_500)).disposition,'retry');
 assert.equal((await f.build().consume({...event,occurred_at_sec:Number.MAX_SAFE_INTEGER},100_500)).disposition,'retry');
 assert.equal(f.stats().approved,0);
});
