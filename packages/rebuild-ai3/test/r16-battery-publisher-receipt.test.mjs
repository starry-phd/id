import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_BATTERY_R16_PUBLISHER_SYNC_ENABLED,R16_CANDIDATE_SINGLE_PUBLISHER,
 BATTERY_R16_RECEIPT_SQL,createOfflineBatteryPublisherReceiptSync}
 from '../src/r16-battery-publisher-receipt.ts';
import {VERIFIED_AUTH_OUTBOX_SQL} from '../src/auth-deletion-battery-bridge.ts';

const scope={brand_id:'starry',environment:'staging'};
const eventId='delete_event_12345678901234567890';
const raw={event_id:eventId,s_user_id:'member_1',occurred_at:110,event_type:'account_deleted'};
const proof={...raw,status:'deleted',auth_version:2,deleted_at:110,unrevoked_sessions:0};
const persisted={event_id:eventId,member_ref:'member_1',event_type:'account_deleted',
 occurred_at_ms:110000,policy_version:1,applied:1,revoked:1,balance:0,
 wallet_version:3,journal_revision:3,kind:'revoke',delta:-3,balance_after:0,
 reason_code:'ACCOUNT_DELETED',pending_holds:0};
function fixture(opts={}){
 const count={legal:0,origin:0,auth:0,receipts:0,writes:0};
 let saved=opts.saved===undefined?null:structuredClone(opts.saved);
 const publisher={
  async readCommittedOriginal(ref,s){
   count.origin++;
   assert.equal(ref,eventId);
   assert.deepEqual(s,scope);
   if(opts.downPublisher)throw Error('DOWN');
   if(typeof opts.source==='function')return opts.source(count.origin);
   return opts.source===undefined?structuredClone(raw):opts.source;
  }
 };
 const authDb={
  prepare(sql){
   assert.equal(sql,VERIFIED_AUTH_OUTBOX_SQL);
   return {
    bind(...params){
     assert.deepEqual(params,[eventId,'member_1',110,'staging']);
     return {
      async first(){
       count.auth++;
       if(typeof opts.proof==='function')return opts.proof(count.auth);
       return opts.proof===undefined?structuredClone(proof):opts.proof;
      }
     };
    }
   };
  }
 };
 const batteryReadDb={
  prepare(sql){
   assert.equal(sql,BATTERY_R16_RECEIPT_SQL);
   return {
    bind(...params){
     assert.deepEqual(params,['staging',eventId,'member_1',110000]);
     return {
      async first(){
       count.receipts++;
       if(opts.downReceipt)throw Error('DB DOWN');
       if(typeof opts.receipt==='function')return opts.receipt(count.receipts);
       return saved===null?null:structuredClone(saved);
      }
     };
    }
   };
  }
 };
 const batteryWriteDb={
  prepare(_sql){
   return {
    bind(..._args){
     return {
      async run(){
       count.writes++;
       if(opts.downWrite)throw Error('DB DOWN');
       saved=structuredClone(persisted);
       return opts.ambiguous?{success:false,meta:{changes:0}}:
        {success:true,meta:{changes:1}};
      },
      async first(){
       if(opts.r14Fail)return null;
       return {applied:1,revoked:1,balance:0,version:3,
        journal_revision:3,kind:'revoke',delta:-3,balance_after:0,
        reason_code:'ACCOUNT_DELETED',pending_holds:0};
      }
     };
    }
   };
  }
 };
 const build=(override={})=>createOfflineBatteryPublisherReceiptSync({
  enabled:true,scope,publisher_id:R16_CANDIDATE_SINGLE_PUBLISHER,
  publisher,authDb,batteryReadDb,batteryWriteDb,
  lawfulProcessingApprovedNow:async()=>{count.legal++;return opts.legal!==false;},
  readApprovedBatteryPolicyVersion:async()=>1,
  ...override
 });
 return {build,count};
}
test('R16 single local AI-1 publisher candidate, new write only via R15/R14, never ACK',async()=>{
 assert.equal(LIVE_BATTERY_R16_PUBLISHER_SYNC_ENABLED,false);
 assert.match(BATTERY_R16_RECEIPT_SQL,/ai3_r14_deletion_inbox/);
 const f=fixture();const r=await f.build().sync(eventId,110500);
 assert.deepEqual(r,{status:'applied_offline',reason:'BATTERY_LOCAL_COMMIT_CONFIRMED',
  may_ack_queue:false,may_regrant:false,may_restore:false,live:false});
 assert.equal(f.count.writes,1);assert.equal(f.count.auth,4);
});
test('R16 duplicate immutable receipt returns read-only outcome with zero mutation',async()=>{
 const f=fixture({saved:persisted});
 const r=await f.build().sync(eventId,110500);
 assert.equal(r.status,'already_applied_offline');
 assert.equal(f.count.writes,0);assert.equal(f.count.receipts,2);
});
test('R16 lost postcommit response reconciles existing receipt, remains no ACK',async()=>{
 const f=fixture({ambiguous:true});
 const r=await f.build().sync(eventId,110500);
 assert.equal(r.status,'already_applied_offline');assert.equal(f.count.writes,1);
 assert.equal(r.may_ack_queue,false);
});
test('R16 only opaque locator accepted, not untrusted event object or false publisher',async()=>{
 const f=fixture();
 for(const bad of [null,raw,{event_id:eventId,verified:true},'bad',12]){
  assert.equal((await f.build().sync(bad,110500)).status,'blocked');
 }
 assert.equal(f.count.origin,0);
 assert.throws(()=>f.build({publisher_id:'ai4.relay.v0'}),/SINGLE_PUBLISHER/);
 assert.throws(()=>f.build({scope:{brand_id:'hglobal',environment:'staging'}}),/SINGLE_PUBLISHER/);
});
test('R16 disabled, legal deny and malformed clock never read protected sources',async()=>{
 const disabled=fixture();assert.equal((await disabled.build({enabled:false})
  .sync(eventId,110500)).status,'blocked');
 assert.equal(disabled.count.origin,0);
 const legal=fixture({legal:false});
 assert.equal((await legal.build().sync(eventId,110500)).reason,'LAWFUL_PURPOSE_DENIED');
 assert.equal(legal.count.origin,0);
 const clock=fixture();assert.equal((await clock.build().sync(eventId,NaN)).status,'blocked');
});
test('R16 rejects forged source refs, changed members, PII, future time',async()=>{
 for(const v of [{...raw,s_user_id:'person@example.com'},
  {...raw,s_user_id:'member_2'}, {...raw,occurred_at:111},
  {...raw,event_id:'delete_event_another_12345678901234567890'},
  {...raw,event_type:'account_restored'}, {...raw,oauth_subject:'secret'}]){
  const f=fixture({source:v});
  assert.equal((await f.build().sync(eventId,110500)).status,'blocked');
  assert.equal(f.count.writes,0);
 }
});
test('R16 current Auth version, member status and revoked sessions required',async()=>{
 for(const v of [null,{...proof,status:'active'},{...proof,auth_version:1},
  {...proof,unrevoked_sessions:1},{...proof,deleted_at:109}]){
  const f=fixture({proof:v});
  assert.equal((await f.build().sync(eventId,110500)).status,'blocked');
  assert.equal(f.count.writes,0);
 }
});
test('R16 conflicting durable receipt cannot be treated as idempotent',async()=>{
 for(const v of [{...persisted,member_ref:'member_2'},
  {...persisted,event_id:'another_event'},
  {...persisted,occurred_at_ms:109000},{...persisted,balance:1},
  {...persisted,pending_holds:1},{...persisted,wallet_version:4},
  {...persisted,journal_revision:4,kind:'commit'},
  {...persisted,session_token:'secret'}]){
  const f=fixture({saved:v,downWrite:true});
  const r=await f.build().sync(eventId,110500);
  assert.equal(r.status,'blocked');assert.equal(r.may_ack_queue,false);
 }
});
test('R16 Auth changes during duplicate verification => no new write',async()=>{
 const f=fixture({saved:persisted,proof:n=>n===1?proof:{...proof,unrevoked_sessions:2}});
 assert.equal((await f.build().sync(eventId,110500)).status,'blocked');
 assert.equal(f.count.writes,0);
});
test('R16 publisher member replacement on duplicate is never stable',async()=>{
 const f=fixture({saved:persisted,source:n=>n===1?raw:{...raw,s_user_id:'member_2'}});
 assert.equal((await f.build().sync(eventId,110500)).status,'blocked');
 assert.equal(f.count.writes,0);
});
test('R16 receipt revision changes between reads is not a durable replay match',async()=>{
 const f=fixture({saved:persisted,receipt:n=>n===1?persisted:{...persisted,wallet_version:4}});
 assert.equal((await f.build().sync(eventId,110500)).status,'blocked');
 assert.equal(f.count.writes,0);
});
test('R16 after local commit, newly active Auth member cannot yield local confirmation',async()=>{
 const f=fixture({proof:n=>n<=3?proof:{...proof,status:'active'}});
 const r=await f.build().sync(eventId,110500);
 assert.equal(r.status,'blocked');assert.equal(f.count.writes,1);
});
test('R16 outages and missing durable local receipt always require manual reconciliation',async()=>{
 for(const opts of [{downPublisher:true},{downReceipt:true},{downWrite:true},
  {r14Fail:true,downReceipt:true}]){
  const f=fixture(opts),r=await f.build().sync(eventId,110500);
  assert.equal(r.status,'blocked');assert.equal(r.may_ack_queue,false);
 }
});
test('R16 getter, hidden fields and revoked Proxy fail closed',async()=>{
 const getter={...raw};Object.defineProperty(getter,'s_user_id',
  {get(){throw Error('SECRET')},enumerable:true});
 const hidden={...raw};Object.defineProperty(hidden,'private_email',
  {value:'secret',enumerable:false});
 const revoked=Proxy.revocable(raw,{});revoked.revoke();
 for(const bad of [getter,hidden,revoked.proxy]){
  const f=fixture({source:bad});
  assert.equal((await f.build().sync(eventId,110500)).status,'blocked');
 }
});
