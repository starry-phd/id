import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_AUTH_OUTBOX_BATTERY_BRIDGE_ENABLED,VERIFIED_AUTH_OUTBOX_SQL,
 createOfflineVerifiedAuthDeletionBatteryBridge}
 from '../src/auth-deletion-battery-bridge.ts';

const scope={brand_id:'starry',environment:'staging'};
const event={event_id:'delete_event_12345678901234567890',
 s_user_id:'member_1',occurred_at:110,event_type:'account_deleted'};
const verified={...event,status:'deleted',auth_version:2,deleted_at:110,unrevoked_sessions:0};
const receipt={applied:1,revoked:1,balance:0,version:3,journal_revision:3,
 kind:'revoke',delta:-3,balance_after:0,reason_code:'ACCOUNT_DELETED',pending_holds:0};
function fixture(options={}){
 const calls={law:0,auth:0,batteryWrites:0,batteryReads:0,policies:0};
 const authDb={
  prepare(sql){
   assert.equal(sql,VERIFIED_AUTH_OUTBOX_SQL);
   return {
    bind(...params){
     return {
      async first(){
       calls.auth++;
       assert.deepEqual(params,[event.event_id,event.s_user_id,event.occurred_at,'staging']);
       if(options.authException)throw Error('AUTH OFFLINE');
       if(options.authRows)return options.authRows(calls.auth);
       return options.authRow===undefined?structuredClone(verified):options.authRow;
      }
     };
    }
   };
  }
 };
 const batteryDb={
  prepare(_sql){
   return {
    bind(){
     return {
      async run(){calls.batteryWrites++;return {success:true,meta:{changes:1}};},
      async first(){calls.batteryReads++;return options.receipt??structuredClone(receipt);}
     };
    }
   };
  }
 };
 const policy={
  async lawfulDeletionRetentionApproved(){calls.law++;return options.law??true;},
  async readApprovedBatteryPolicyVersion(){calls.policies++;return options.policy??1;}
 };
 const build=(change={})=>createOfflineVerifiedAuthDeletionBatteryBridge({
  enabled:true,scope,authDb,batteryDb,policy,...change
 });
 return {build,calls};
}
test('R15 default flag false; verified exact AI-1 source maps into existing R14 Battery',async()=>{
 assert.equal(LIVE_AUTH_OUTBOX_BATTERY_BRIDGE_ENABLED,false);
 assert.match(VERIFIED_AUTH_OUTBOX_SQL,/JOIN starry_deletion_challenge_scope/);
 assert.match(VERIFIED_AUTH_OUTBOX_SQL,/m.auth_version=c.auth_version\+1/);
 assert.match(VERIFIED_AUTH_OUTBOX_SQL,/revoked_at IS NULL/);
 const f=fixture();const r=await f.build().consume(event,110500);
 assert.deepEqual(r,{disposition:'receipt_only',reason:'BATTERY_LOCAL_REVOCATION_RECORDED',
  may_regrant:false,may_ack_queue:false,live:false});
 assert.deepEqual(f.calls,{law:1,auth:2,batteryWrites:1,batteryReads:1,policies:1});
});
test('R15 disabled bridge does not read Auth, Policy or Battery',async()=>{
 const f=fixture();
 assert.equal((await f.build({enabled:false}).consume(event,110500)).reason,'DISABLED');
 assert.deepEqual(f.calls,{law:0,auth:0,batteryWrites:0,batteryReads:0,policies:0});
});
test('R15 strict source contract refuses invented AI-2 fields or client brand/scope',async()=>{
 const f=fixture();
 for(const v of [{...event,brand_id:'starry'}, {...event,event_digest:'0'.repeat(64)},
  {...event,auth_version:2},{...event,environment:'staging'},
  {...event,s_user_id:'long_'+('a'.repeat(130))},
  {...event,occurred_at:111},{...event,occurred_at:-1},
  {...event,event_id:'short'}, {...event,event_type:'account_restored'}]){
  assert.equal((await f.build().consume(v,110500)).disposition,'retry');
 }
 assert.equal(f.calls.auth,0);assert.equal(f.calls.law,0);
});
test('R15 fail closed on getter, hidden OAuth subject and revoked Proxy',async()=>{
 const f=fixture(),a={...event};
 Object.defineProperty(a,'event_id',{enumerable:true,get(){throw Error('private')}}); 
 const b={...event};Object.defineProperty(b,'oauth_sub',{value:'secret',enumerable:false});
 const p=Proxy.revocable(event,{});p.revoke();
 for(const v of [a,b,p.proxy])assert.equal((await f.build().consume(v,110500)).disposition,'retry');
 assert.equal(f.calls.auth,0);
});
test('R15 legal refusal occurs before any Auth DB query or Battery write',async()=>{
 const f=fixture({law:false});
 assert.equal((await f.build().consume(event,110500)).reason,'PRIVACY_LEGAL_APPROVAL_MISSING');
 assert.equal(f.calls.auth,0);assert.equal(f.calls.batteryWrites,0);
});
test('R15 source MUST currently be deleted and no live session, matching version/time',async()=>{
 for(const patch of [
  {status:'active'},{auth_version:1},{deleted_at:109},{unrevoked_sessions:1},
  {event_id:'delete_event_DIFFERENT_01234567890'},
  {s_user_id:'member_2'},{occurred_at:109},{event_type:'account_registered'},
  {unused_field:'secret'}
 ]){
  const f=fixture({authRow:{...verified,...patch}});
  assert.equal((await f.build().consume(event,110500)).reason,'CURRENT_AUTH_OUTBOX_NOT_COMMITTED');
  assert.equal(f.calls.batteryWrites,0);
 }
});
test('R15 current Authoritative Auth is read twice; mid-review race blocks wallet write',async()=>{
 const f=fixture({authRows:(reads)=>reads===1?verified:{...verified,unrevoked_sessions:1}});
 const r=await f.build().consume(event,110500);
 assert.equal(r.disposition,'retry');assert.equal(r.may_ack_queue,false);
 assert.equal(f.calls.auth,2);assert.equal(f.calls.batteryWrites,0);
});
test('R15 Auth outage, missing committed source and no approved policy all fail closed',async()=>{
 const cases=[{authException:true},{authRow:null},{policy:0}];
 for(const opt of cases){
  const f=fixture(opt),r=await f.build().consume(event,110500);
  assert.equal(r.disposition,'retry');assert.equal(f.calls.batteryWrites,0);
 }
});
test('R15 reject HGlobal or production BEFORE any read or side effect',()=>{
 const f=fixture();
 for(const s of [{...scope,brand_id:'hglobal'}, {...scope,environment:'production'}]){
  assert.throws(()=>f.build({scope:s}),/SCOPE_DENIED/);
 }
 assert.equal(f.calls.auth,0);
});
test('R15 no derived digest, auth_version, OAuth subjects or Queue ACK ever exposed',async()=>{
 const f=fixture();const r=await f.build().consume(event,110500);
 for(const name of ['event_digest','auth_version','oauth_sub','may_grant','may_ack']){
  assert.equal(Object.hasOwn(r,name),false);
 }
 assert.equal(r.may_ack_queue,false);assert.equal(r.may_regrant,false);
});
