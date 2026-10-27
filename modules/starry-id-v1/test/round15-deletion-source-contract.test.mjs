import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineAuthDeletionEventSource,isSealedAuthDeletionSource,
 LIVE_AUTH_DELETION_EVENT_DELIVERY_ENABLED,BILLING_HMAC_DELETION_MAPPING_APPROVED,
 AUTH_DELETION_SOURCE_SELECT} from '../src/round15-deletion-source-contract.ts';
const time=1793000000,id='starry-delete-'+'a'.repeat(64),scope={
 brand_id:'starry',environment:'staging'};
const user='u1';
const row={event_id:id,s_user_id:user,occurred_at:time,
 event_type:'account_deleted',auth_version:4,member_status:'deleted',
 member_updated_at:time,profile_name:null,directory_opt_in:0,
 display_name_public:0,pending_sessions:0};
function fake(cfg={}){
 const calls={policy:0,time:0,db:0};
 const db={prepare(sql){
  calls.db++;assert.equal(sql,AUTH_DELETION_SOURCE_SELECT);
  return {bind(...args){assert.deepEqual(args,[id]);return{
   first:async()=>{if(cfg.outage)throw Error('D1 unavailable');
    return Object.hasOwn(cfg,'row')?cfg.row:row;},
  };}};
 }};
 const source=createOfflineAuthDeletionEventSource({enabled:cfg.enabled??true,
  scope,db,legalDeletionProcessingApprovedNow:async()=>{
   calls.policy++;return Object.hasOwn(cfg,'legal')?cfg.legal:true;},
  readServerNow:()=>{calls.time++;return Object.hasOwn(cfg,'now')?cfg.now:time;},
 });
 return {source,calls};
}
test('OFF by default, wrong brand and missing legal Gate read NO Auth DB',async()=>{
 assert.equal(LIVE_AUTH_DELETION_EVENT_DELIVERY_ENABLED,false);
 assert.equal(BILLING_HMAC_DELETION_MAPPING_APPROVED,false);
 const a=fake({enabled:false});
 assert.equal(await a.source.readBatteryEvent(id),null);
 assert.equal(a.calls.policy,0);assert.equal(a.calls.db,0);
 for(const legal of [false,null,undefined]){
  const x=fake({legal});
  assert.equal(await x.source.readBatteryEvent(id),null);
  assert.equal(x.calls.db,0);
 }
 assert.throws(()=>createOfflineAuthDeletionEventSource({scope:{...scope,brand_id:'hglobal'},
  db:{prepare(){throw Error('unexpected')}} ,readServerNow:()=>time,
  legalDeletionProcessingApprovedNow:async()=>true}),/AUTH_DELETION_SOURCE_SCOPE_DENIED/);
});
test('real committed Auth event normalized to AI-3 EXACT four-field DTO and sealed source',async()=>{
 const x=fake(),v=await x.source.readCommitted(id);
 assert.equal(isSealedAuthDeletionSource(v),true);
 assert.equal(isSealedAuthDeletionSource({...v}),false);
 assert.deepEqual(v,{event_id:id,s_user_id:user,occurred_at:time,
  event_type:'account_deleted',auth_version:4});
 const dto=await x.source.readBatteryEvent(id);
 assert.deepEqual(dto,{event_id:id,member_ref:user,
  occurred_at_sec:time,event_type:'account_deleted'});
 assert.deepEqual(Object.keys(dto).sort(),[
  'event_id','member_ref','occurred_at_sec','event_type'].sort());
 assert.equal('auth_version' in dto,false);
 assert.equal('verified' in dto,false);
 assert.equal(x.source.billingContractStatus,'BLOCKED_LEGAL_HMAC_PROTOCOL');
 assert.equal(x.calls.db,2);
});
test('AI-3 consumer recheck callback obtains CURRENT Auth proof rather than trusting supplied DTO',async()=>{
 const x=fake();const dto=await x.source.readBatteryEvent(id);
 assert.equal(await x.source.verifyCommittedDeletion(scope,dto),true);
 assert.equal(await x.source.verifyCommittedDeletion(scope,{...dto,member_ref:'other'}),false);
 assert.equal(await x.source.verifyCommittedDeletion(scope,{...dto,occurred_at_sec:time-1}),false);
 assert.equal(await x.source.verifyCommittedDeletion(scope,{...dto,extra:true}),false);
 assert.equal(await x.source.verifyCommittedDeletion({brand_id:'hglobal',environment:'staging'},dto),false);
 assert.equal(await x.source.verifyCommittedDeletion({brand_id:'starry',environment:'production'},dto),false);
 assert.equal(await x.source.verifyCommittedDeletion(scope,{event_id:id,member_ref:'u1',
  occurred_at_sec:time,event_type:'account_deleted',verified:true}),false);
});
test('deleted member must be current, no live sessions, redacted and event timestamp exact',async()=>{
 for(const patch of [{member_status:'active'},{member_status:'suspended'},
  {auth_version:1},{member_updated_at:time+1},{profile_name:'name'},
  {directory_opt_in:1},{display_name_public:1},{pending_sessions:1},
  {event_type:'wrong'},{event_id:'other'},{occurred_at:time+1},
  {auth_version:'4'},{pending_sessions:'0'},{s_user_id:'u/'+user}]){
  const x=fake({row:{...row,...patch}});
  assert.equal(await x.source.readCommitted(id),null,JSON.stringify(patch));
 }
});
test('malformed/future/outage/invalid ID and hostile proof never authorize',async()=>{
 for(const cfg of [{row:null},{row:undefined},{outage:true},{now:time-1},
  {now:NaN}]){
  const x=fake(cfg);
  assert.equal(await x.source.readBatteryEvent(id),null);
 }
 const x=fake();
 assert.equal(await x.source.readBatteryEvent('short'),null);
 assert.equal(x.calls.db,0);
 const evil={event_id:id,member_ref:user,occurred_at_sec:time,event_type:'account_deleted'};
 Object.defineProperty(evil,'member_ref',{enumerable:true,get(){throw Error('getter')}});
 assert.equal(await x.source.verifyCommittedDeletion(scope,evil),false);
 const revoked=Proxy.revocable({...evil},{});revoked.revoke();
 assert.equal(await x.source.verifyCommittedDeletion(scope,revoked.proxy),false);
});
test('AI-3 contract parser accepts exact normalized DTO, not raw AI-1 outbox keys',async()=>{
 const x=fake();
 const dto=await x.source.readBatteryEvent(id);
 const accept=(v)=>Object.keys(v).sort().join(',')==='event_id,event_type,member_ref,occurred_at_sec';
 assert.equal(accept(dto),true);
 assert.equal(accept({event_id:id,s_user_id:user,occurred_at:time,event_type:'account_deleted'}),false);
});
