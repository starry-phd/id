import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANDIDATE_VERSION,BATTERY,rfc3339,isAuditMetadata,assertScope,assertEvent,
  batteryCapability,bindTrust,auditIngress,revocationOrder,retryPlan,erasureGate,
} from '../src/index.ts';
const scope=Object.freeze({brand_id:'starry',app_id:'starry-id',environment:'staging'});
const event=Object.freeze({...scope,schema_version:CANDIDATE_VERSION,event_id:'evt_1',
 event_type:'identity.session.revoked',occurred_at:'2026-10-26T11:00:00+08:00',
 correlation_id:'corr_1',idempotency_key:'idem_1',resource_ref:'anon_12',
 actor_ref:'service_1',result:'recorded',classification:'metadata_only'});
const provider=()=>({
 authorize:async()=>({outcome:'allow',subject_ref:'user_1'}),
 notificationPreference:async()=>({recipient_ref:'user_1',channels:['inbox']}),
});
test('BAT-001 stays permanently free, Starry-only and not a purchasable wallet',()=>{
 assert.equal(BATTERY.price,'free');
 for(const k of ['purchasable','grants','balances','reserve','debit','fefo','expiry','overdraft'])
  assert.equal(BATTERY[k],false);
 assert.doesNotThrow(()=>batteryCapability(scope,scope,'battery.policy.read'));
 for(const a of ['battery.purchase','battery.grant','battery.reserve','battery.debit','battery.fefo'])
  assert.throws(()=>batteryCapability(scope,scope,a),/BATTERY_UNAPPROVED/);
});
test('scope refuses cross brand/App/runtime environment',()=>{
 assert.doesNotThrow(()=>assertScope(scope,scope));
 for(const delta of [{brand_id:'hglobal'},{app_id:'other'},{environment:'production'}])
  assert.throws(()=>assertScope(scope,{...scope,...delta}),/SCOPE_DENIED/);
});
test('RFC3339 accepts timezone and real leap dates, rejects invalid calendar days and offsetless time',()=>{
 for(const stamp of ['2024-02-29T00:00:00Z','2026-10-26T11:00:00+08:00',
  '2026-10-25T21:30:00-05:30','2026-10-26T00:00:00.123456789Z'])
  assert.equal(rfc3339(stamp),true,stamp);
 for(const stamp of ['2026-02-29T00:00:00Z','2026-13-01T00:00:00Z',
  '2026-10-26T25:00:00Z','2026-10-26T00:00:00',
  '2026-10-26 00:00:00Z','2026-10-26T00:00:00+99:99',
  '2026-10-26T00:00:00.1234567890Z'])
  assert.equal(rfc3339(stamp),false,stamp);
});
test('only non-sensitive fixed fields and exact draft schema accepted',()=>{
 assert.equal(isAuditMetadata(event),true);
 for(const delta of [{email:'unsafe@example.com'},{token:'secret'},
  {before_value:'private'},{raw_payload:{body:'secret'}},{phone:'0900000000'},
  {actor_ref:'person@example.com'},{classification:'unfiltered'},
  {schema_version:'1.0'},{idempotency_key:''},{event_type:'billing.paid'},
  {brand_id:'hglobal'},{environment:'sandbox'}])
  assert.equal(isAuditMetadata({...event,...delta}),false);
});
test('audit metadata disallows prototypes, hidden properties, symbols, getters, revoked Proxy',()=>{
 assert.equal(isAuditMetadata(Object.assign(Object.create({unsafe:1}),event)),false);
 const hidden={...event};Object.defineProperty(hidden,'email',{value:'hidden',enumerable:false});
 assert.equal(isAuditMetadata(hidden),false);
 const getter={...event};Object.defineProperty(getter,'actor_ref',{get(){return 'fake'},enumerable:true});
 assert.equal(isAuditMetadata(getter),false);
 assert.equal(isAuditMetadata({...event,[Symbol('token')]:'token'}),false);
 const {proxy,revoke}=Proxy.revocable({...event},{});revoke();
 assert.equal(isAuditMetadata(proxy),false);
});
test('server-supplied idempotency namespace is scoped, never accepts client secrets',()=>{
 assert.deepEqual(auditIngress(scope,event),{namespace:'starry|starry-id|staging|idem_1',event_id:'evt_1'});
 const prod={...scope,environment:'production'};
 assert.notEqual(auditIngress(scope,event).namespace,
  auditIngress(prod,{...event,environment:'production'}).namespace);
 for(const bad of [{...event,app_id:'other'},{...event,email:'raw'},
  {...event,store_environment:'sandbox'},{...event,occurred_at:'invalid'}])
  assert.throws(()=>assertEvent(scope,bad));
});
test('audit read checks server-owned verified authorization, not client adminVerified',async()=>{
 let allowed=true;
 const gate=bindTrust(scope,{...provider(),authorize:async()=>({
   outcome:allowed?'allow':'deny',subject_ref:'user_1',
 })});
 await gate.auditRead(scope);
 await assert.rejects(gate.auditRead({...scope,adminVerified:true}),/AUDIT_READ_DENIED/);
 allowed=false;await assert.rejects(gate.auditRead(scope),/AUTH_DENIED/);
});
test('notification refuses forged recipient, client consent, secret or revoked session',async()=>{
 let active=true,recipient='user_1',channels=['inbox'];
 const gate=bindTrust(scope,{
  authorize:async()=>({outcome:active?'allow':'deny',subject_ref:'user_1'}),
  notificationPreference:async()=>({recipient_ref:recipient,channels}),
 });
 const request={event,recipient_ref:'user_1',channel:'inbox',template_id:'security.notice'};
 assert.equal((await gate.notification(request)).recipient_ref,'user_1');
 for(const patch of [
  {adminVerified:true},{consent:true},{recipient_ref:'user_2'},
  {email:'hidden@example.com'},{event:{...event,brand_id:'hglobal'}},
  {event:{...event,app_id:'other'}},
 ])await assert.rejects(gate.notification({...request,...patch}));
 active=false;await assert.rejects(gate.notification(request),/AUTH_DENIED/);
 active=true;channels=[];await assert.rejects(gate.notification(request),/NOTIFICATION_DENIED/);
 recipient='user_2';channels=['inbox'];
 await assert.rejects(gate.notification(request),/NOTIFICATION_DENIED/);
});
test('bounded retry permits transient only and sends exhausted attempts to dead-letter',()=>{
 assert.deepEqual(retryPlan({attempt:1,failure:'network',idempotency_key:'id_1'}),{decision:'retry',delay_ms:1000});
 assert.deepEqual(retryPlan({attempt:3,failure:'timeout',idempotency_key:'id_1'}),{decision:'retry',delay_ms:4000});
 assert.deepEqual(retryPlan({attempt:5,failure:'http',http_status:429,idempotency_key:'id_1'}),{decision:'dead_letter',delay_ms:0});
 for(const code of [400,401,403,404,409,422])
  assert.equal(retryPlan({attempt:1,failure:'http',http_status:code,idempotency_key:'id_1'}).decision,'reject');
 assert.equal(retryPlan({attempt:1,failure:'auth_denied',idempotency_key:'id_1'}).decision,'reject');
 assert.equal(retryPlan({attempt:0,failure:'network',idempotency_key:'id_1'}).decision,'reject');
 assert.equal(retryPlan({attempt:1,failure:'network'}).decision,'reject');
});
test('out-of-order session revocation never restores access',()=>{
 assert.equal(revocationOrder(2,3),'invalidate_only');
 assert.equal(revocationOrder(3,2),'stale_audit_only');
 assert.equal(revocationOrder(3,3),'stale_audit_only');
 for(const bad of [-1,NaN,2.5,Infinity])assert.throws(()=>revocationOrder(2,bad),/VERSION_DENIED/);
});
test('replay only submits a review proposal and cannot replay member deletion',async()=>{
 let allowed=true;
 const gate=bindTrust(scope,{...provider(),authorize:async()=>({
  outcome:allowed?'allow':'deny',subject_ref:'approver_1',
 })});
 const queued={...event,event_type:'notification.delivery.queued'};
 const approval={approval_ref:'approval_1',reason_code:'safe_retry'};
 assert.equal((await gate.replay(queued,approval)).disposition,'review_only');
 await assert.rejects(gate.replay(event,approval),/REPLAY_DENIED/);
 await assert.rejects(gate.replay(queued,{...approval,adminVerified:true}),/REPLAY_DENIED/);
 allowed=false;await assert.rejects(gate.replay(queued,approval),/AUTH_DENIED/);
});
test('privacy erasure remains AI-1 owned; reject PII and unaudited deletion',()=>{
 assert.deepEqual(erasureGate({kind:'member_erasure',request_ref:'req_1'}),{
  disposition:'policy_pending',performed:false,
 });
 for(const v of [{kind:'member_erasure',request_ref:'req_1',email:'pii'},
  {kind:'erase_now',request_ref:'req_1'}])
  assert.throws(()=>erasureGate(v),/PRIVACY_DENIED/);
});
test('sensitive nested values cannot infiltrate audit append metadata',()=>{
 for(const key of ['body','member','session','billing','raw_details'])
  assert.equal(isAuditMetadata({...event,[key]:{email:'private'}}),false);
});
