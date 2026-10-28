import test from 'node:test';
import assert from 'node:assert/strict';
import {CANDIDATE_VERSION} from '../src/index.ts';
import {createWave1SecurityNotificationFence,WAVE1_SECURITY_FENCE_VERSION,
 WAVE1_SECURITY_FENCE_LIVE} from '../src/wave1-security-notification-fence.ts';

const scope={brand_id:'starry',app_id:'starry-echo',environment:'staging'};
const event={...scope,schema_version:CANDIDATE_VERSION,
 event_id:'event_123456789',event_type:'notification.delivery.queued',
 occurred_at:'2026-10-28T04:30:00Z',correlation_id:'correlation_1',
 idempotency_key:'idempotent_1234',resource_ref:'pseudo_resource_1',
 actor_ref:'pseudo_actor_1',result:'queued',classification:'metadata_only'};
const req=(e=event,ch='inbox')=>({event:e,channel:ch});
const session={state:'active',auth_version:3,session_version:7};
const copy=x=>structuredClone(x);
function fixture(options={}){
 const calls={session:0,signed:0,dedupe:0,retention:0,preference:0};
 const val=async(k,defaults)=>{calls[k]++;const v=options[k];
  if(typeof v==='function')return v(calls[k]);
  return v===undefined?copy(defaults):v;
 };
 const config={enabled:options.enabled??true,scope:options.scope??scope,
  ports:{
   readSessionFence:async()=>val('session',session),
   verifyCanonicalSource:async()=>val('signed','verified'),
   readDedupe:async()=>val('dedupe','unseen'),
   lawfulRetentionNow:async()=>val('retention',true),
   notificationPreference:async()=>val('preference','allow')
  }};
 return {calls,make:(override={})=>createWave1SecurityNotificationFence({...config,...override})};
}
const noRights=x=>{
 assert.equal(x.schema_version,WAVE1_SECURITY_FENCE_VERSION);
 for(const k of ['may_send','may_enqueue','may_ack_queue','may_retry',
  'may_replay','may_grant_battery','may_purchase_battery',
  'may_restore_member','may_purge','live'])assert.equal(x[k],false,k);
 assert.equal(JSON.stringify(x).includes(event.idempotency_key),false);
 assert.equal(JSON.stringify(x).includes(event.actor_ref),false);
};
test('Round001 explicitly OFF and never grants Battery or notification send',async()=>{
 assert.equal(WAVE1_SECURITY_FENCE_LIVE,false);
 const f=fixture({enabled:false}),x=await f.make().review(req());
 assert.equal(x.reason,'DISABLED');assert.deepEqual(f.calls,
  {session:0,signed:0,dedupe:0,retention:0,preference:0});noRights(x);
});
test('all trusted mock checks yield review-only, never send/ACK',async()=>{
 const f=fixture(),x=await f.make().review(req());
 assert.equal(x.status,'review_only');
 assert.equal(x.reason,'CANDIDATE_REQUIRES_APPROVED_BACKEND');
 assert.deepEqual(f.calls,{session:2,signed:2,dedupe:2,retention:2,preference:2});
 noRights(x);
});
test('wrong app, brand, env, P05 schema and extra fields deny before private read',async()=>{
 for(const e of [{...event,app_id:'other-app'},
  {...event,brand_id:'hglobal'}, {...event,environment:'production'},
  {...event,schema_version:'v2'},{...event,balance:9999},{...event,card_token:'x'},
  {...event,event_type:'store.purchase'},{...event,result:'sent'},null]){
  const f=fixture(),x=await f.make().review(req(e));
  assert.equal(x.reason,'INVALID_SCOPE_OR_EVENT');noRights(x);
  assert.equal(f.calls.session,0);
 }
});
test('deleted member and revoked Session never notify, including delayed arrival',async()=>{
 for(const v of [{...session,state:'revoked'},{...session,state:'deleted'},
  n=>n===1?session:{...session,state:'revoked'}]){
  const f=fixture({session:v}),x=await f.make().review(req());
  assert.equal(x.status,'blocked');noRights(x);
 }
});
test('security revoke/erasure events can never become notification permissions',async()=>{
 for(const type of ['identity.session.revoked','identity.member.deleted',
  'identity.grant.revoked','privacy.erasure.requested','audit.replay.requested']){
  const f=fixture(),x=await f.make().review(req({...event,event_type:type}));
  assert.equal(x.reason,'NON_DELIVERABLE_SECURITY_EVENT');noRights(x);
  assert.equal(f.calls.session,0);
 }
});
test('unverified AI0 P05 source fails even if app claims sent/queued',async()=>{
 for(const signed of ['unverified','unknown']){
  const f=fixture({signed}),x=await f.make().review(req());
  assert.equal(x.reason,'SOURCE_UNVERIFIED');noRights(x);
 }
});
test('duplicate delivery and unknown durable receipt never auto ACK',async()=>{
 for(const dedupe of ['committed','unknown']){
  const f=fixture({dedupe}),x=await f.make().review(req());
  assert.equal(x.reason,'DUPLICATE_OR_UNKNOWN');noRights(x);
 }
});
test('notification opt-out and unknown preference deny',async()=>{
 for(const preference of ['deny','unknown']){
  const f=fixture({preference}),x=await f.make().review(req());
  assert.equal(x.reason,'CONSENT_DENIED_OR_UNKNOWN');noRights(x);
 }
});
test('lawful purpose/retention false blocks before auth and after provenance',async()=>{
 for(const retention of [false,n=>n===1]){
  const f=fixture({retention}),x=await f.make().review(req());
  assert.equal(x.reason,'LAWFUL_RETENTION_UNAPPROVED');noRights(x);
  if(retention===false)assert.equal(f.calls.session,0);
 }
});
test('late session fence/auth version change invalidates in-flight event',async()=>{
 for(const sessionValue of [
  n=>n===1?session:{...session,auth_version:4},
  n=>n===1?session:{...session,session_version:8}]){
  const f=fixture({session:sessionValue}),x=await f.make().review(req());
  assert.equal(x.reason,'STATE_CHANGED');noRights(x);
 }
});
test('source signer and inbox replay state changing between reads denies',async()=>{
 for(const o of [
  {signed:n=>n===1?'verified':'unverified'},
  {dedupe:n=>n===1?'unseen':'committed'},
  {preference:n=>n===1?'allow':'deny'}]){
  const f=fixture(o),x=await f.make().review(req());
  assert.equal(x.reason,'STATE_CHANGED');noRights(x);
 }
});
test('invalid session proof cannot create permissions or leak PII',async()=>{
 for(const s of [null,{}, {...session,raw_email:'private@example.org'},
  {...session,auth_version:0},{...session,state:'unknown'},
  {...session,session_version:-2}]){
  const f=fixture({session:s}),x=await f.make().review(req());
  assert.equal(x.status,'blocked');noRights(x);
 }
});
test('backend outages fail closed and do not pretend delivery succeeded',async()=>{
 for(const kind of ['session','signed','dedupe','retention','preference']){
  const f=fixture({[kind]:()=>{throw Error('simulated offline')}}),
   x=await f.make().review(req());
  assert.equal(x.reason,'PORT_UNAVAILABLE');noRights(x);
 }
});
test('no client-shaped input may replace trusted server scope or ports',async()=>{
 const f=fixture();
 assert.throws(()=>f.make({scope:{...scope,brand_id:'hglobal'}}),/SCOPE/);
 assert.throws(()=>f.make({scope:{...scope,environment:'production'}}),/SCOPE/);
 assert.throws(()=>f.make({ports:{readSessionFence:async()=>session}}),/PORT/);
 for(const channel of ['sms','paid','store',null]){
  const x=await f.make().review(req(event,channel));
  assert.equal(x.reason,'INVALID_SCOPE_OR_EVENT');noRights(x);
 }
});
test('strange accessor on P05 payload never reaches server trust ports',async()=>{
 const bad={...event};Object.defineProperty(bad,'event_id',{enumerable:true,
  get(){throw Error('getter attempted side effect')}});
 const f=fixture(),x=await f.make().review(req(bad));
 assert.equal(x.reason,'INVALID_SCOPE_OR_EVENT');noRights(x);
 assert.equal(f.calls.session,0);
});
test('no API exposes grants, delivery, Queue transport or D1 writes',()=>{
 const f=fixture(),obj=f.make();
 assert.deepEqual(Object.keys(obj),['review']);
 for(const key of ['send','dispatch','enqueue','ack','purchase',
  'grantBattery','replay','purge','restore'])assert.equal(key in obj,false);
});
