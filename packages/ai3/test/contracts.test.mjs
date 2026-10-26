import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BATTERY_POLICY, isEventEnvelope, isAuditRecord, assertScope,
  assertBatteryCapability, bindAi3TrustedOperations, bindAi3BillingAudit,
  planRetry, idempotencyNamespace,
} from '../src/index.ts';
const scope = Object.freeze({ brand_id: 'starry', app_id: 'starry-test-app', environment: 'staging' });
const event = Object.freeze({
  ...scope, event_id: 'evt_001', event_type: 'security.access.denied',
  schema_version: '0.1', occurred_at: '2026-10-26T00:00:00Z',
  correlation_id: 'corr_01', resource_type: 'session', resource_id: 'ses_01',
  result: 'denied', idempotency_key: 'key_01',
});
const audit = Object.freeze({ ...event, actor_kind: 'user', actor_id: 'uid_01',
  permission: 'audit:read', action: 'audit.read' });
test('Battery stays Starry-only and permanently free with unapproved ledger disabled', () => {
  assert.equal(BATTERY_POLICY.pricing, 'free');
  for (const key of ['purchasable','billing_grants_enabled','wallet_enabled','reserve_enabled','debit_enabled','expiry_enabled','overdraft_enabled'])
    assert.equal(BATTERY_POLICY[key], false);
  assert.doesNotThrow(() => assertBatteryCapability(scope, scope, 'battery.policy.read'));
  for (const capability of ['battery.grant','battery.purchase','battery.reserve','battery.debit','battery.expire','battery.overdraft'])
    assert.throws(() => assertBatteryCapability(scope, scope, capability), /NOT_APPROVED/);
});
test('Starry app and environment must match trusted server scope', () => {
  assert.doesNotThrow(() => assertScope(scope, scope));
  for (const mismatch of [{ brand_id:'hglobal' }, { app_id:'other' }, { environment:'production' }])
    assert.throws(() => assertScope(scope, { ...scope, ...mismatch }), /SCOPE_DENIED/);
  assert.throws(() => assertBatteryCapability(scope, { ...scope, brand_id:'hglobal' }, 'battery.policy.read'), /SCOPE_DENIED/);
});
test('P05 schema matches AI-0 envelope keys, denies extra PII/secrets and malformed data', () => {
  assert.equal(isEventEnvelope(event), true);
  for (const unsafe of [
    { ...event, access_token:'secret' }, { ...event, email:'alice@example.com' },
    { ...event, brand_id:'hglobal' }, { ...event, occurred_at:'not-time' },
    { ...event, idempotency_key:'' }, { ...event, app_id:'bad app' },
  ]) assert.equal(isEventEnvelope(unsafe), false);
  assert.equal(isEventEnvelope(null), false);
});
test('P06 audit record has opaque actor/permission and no freeform private values', () => {
  assert.equal(isAuditRecord(audit), true);
  assert.equal(isAuditRecord({ ...audit, actor_id:'alice@example.com' }), false);
  assert.equal(isAuditRecord({ ...audit, access_token:'token' }), false);
  assert.equal(isAuditRecord({ ...audit, after_value:'phone number' }), false);
  assert.equal(isAuditRecord({ ...audit, approval_ref:'approval_12' }), true);
  assert.equal(isAuditRecord({ ...audit, actor_kind:'anonymous', actor_id:null }), true);
  assert.equal(isAuditRecord({ ...audit, actor_kind:'anonymous', actor_id:'uid_01' }), false);
});
test('AI-1 audit guard rejects revoked grants and client-forged adminVerified',async()=>{
 let allowed=true;
 const ai1={
  authorizeAdmin:async()=>({allowed}),authorizeSession:async()=>({allowed:true}),
  resolveNotificationDelivery:async()=>({recipient_ref:'uid_01',allowed_channels:['email']})
 };
 const bound=bindAi3TrustedOperations(scope,ai1);
 await bound.assertAuditRead(scope);
 await assert.rejects(bound.assertAuditRead({...scope,environment:'production',adminVerified:true}),/SCOPE_DENIED/);
 allowed=false;
 await assert.rejects(bound.assertAuditRead({...scope,adminVerified:true}),/ACCESS_DENIED/);
});
test('AI-1 notification requires server-resolved recipient, consent and active session',async()=>{
 let active=true,channels=['email'];
 const ai1={
  authorizeAdmin:async()=>({allowed:false}),
  authorizeSession:async()=>({allowed:active}),
  resolveNotificationDelivery:async()=>({recipient_ref:'uid_01',allowed_channels:channels})
 };
 const bound=bindAi3TrustedOperations(scope,ai1);
 const req={event,recipient_ref:'uid_01',channel:'email',template_id:'incident.notice'};
 await bound.assertNotificationDelivery(req);
 for(const other of [
   {...req,adminVerified:true},{...req,consent:true},{...req,recipient_ref:'uid_02'},
   {...req,email:'secret@example.com'},{...req,event:{...event,brand_id:'hglobal'}},
   {...req,event:{...event,app_id:'another'}},{...req,event:{...event,environment:'production'}}
 ])await assert.rejects(bound.assertNotificationDelivery(other),/DENIED/);
 active=false;await assert.rejects(bound.assertNotificationDelivery(req),/DENIED/);
 active=true;channels=[];await assert.rejects(bound.assertNotificationDelivery(req),/DENIED/);
});
test('P05 idempotency namespace includes brand/app/env/type, rejects missing key', () => {
  assert.equal(idempotencyNamespace(event), 'starry|starry-test-app|staging|security.access.denied|key_01');
  assert.notEqual(idempotencyNamespace(event), idempotencyNamespace({ ...event, environment:'production' }));
  assert.throws(() => idempotencyNamespace({ ...event, idempotency_key:undefined }), /REQUIRED/);
});
test('retry is bounded, exponential, selective and fails closed', () => {
  assert.deepEqual(planRetry({attempt:1,status:503,idempotency_key:'key_01'}), {disposition:'retry', delay_ms:1000});
  assert.deepEqual(planRetry({attempt:3,failure:'timeout',idempotency_key:'key_01'}), {disposition:'retry', delay_ms:4000});
  assert.deepEqual(planRetry({attempt:5,status:429,idempotency_key:'key_01'}), {disposition:'dead_letter', delay_ms:0});
  for (const status of [400,401,403,409])
    assert.equal(planRetry({attempt:1,status,idempotency_key:'key_01'}).disposition, 'reject');
  assert.equal(planRetry({attempt:1,status:503}).disposition,'reject');
  assert.equal(planRetry({attempt:1,failure:'scope_denied',idempotency_key:'key_01'}).disposition,'reject');
  assert.equal(planRetry({attempt:0,status:503,idempotency_key:'key_01'}).disposition,'reject');
});

test('P05 RFC3339 parity positive and malformed timestamp negative cases',()=>{
 for(const time of ['2026-10-26T00:00:00Z','2026-10-26T08:00:00+08:00','2026-10-25T18:30:00-05:30','2026-10-26T00:00:00.123456789Z'])
  assert.equal(isEventEnvelope({...event,occurred_at:time}),true,time);
 for(const time of ['2026-10-26T00:00:00','2026-10-26 00:00:00Z','2026-13-26T00:00:00Z','2026-10-26T00:00:00+99:99','2026-10-26T00:00:00.1234567890Z'])
  assert.equal(isEventEnvelope({...event,occurred_at:time}),false,time);
});
test('AI-2 verified sandbox billing outbox: dedupe, inverse order and unauthorized refunds',async()=>{
 const env={...event,event_type:'billing.renewed',idempotency_key:'bill_01'};
 const fixture={envelope:env,store:'apple',store_environment:'sandbox',provider_event_id:'provider_1',transaction_ref:'txn_1'};
 let input=fixture,seen=false,last=null,refund=false;
 const ai2={
  readVerifiedOutbox:async()=>input,alreadyAudited:async()=>seen,
  latestAuditedAt:async()=>last,refundIsProviderVerified:async()=>refund
 };
 const bound=bindAi3BillingAudit(scope,ai2);
 assert.equal((await bound.plan('outbox_1')).disposition,'ready');
 seen=true;assert.equal((await bound.plan('outbox_1')).disposition,'duplicate');
 seen=false;last='2026-10-26T08:00:01+08:00';
 assert.equal((await bound.plan('outbox_1')).disposition,'stale_audit_only');
 last=null;
 for(const changes of [
  {store_environment:'production'},
  {envelope:{...env,brand_id:'hglobal'}},
  {envelope:{...env,app_id:'other'}},
  {envelope:{...env,environment:'production'}},
  {envelope:{...env,verifiedBy:'client'}},
  {envelope:{...env,event_type:'battery.purchase'}}
 ]){input={...fixture,...changes};assert.equal((await bound.plan('outbox_1')).disposition,'quarantine')}
 input={...fixture,envelope:{...env,event_type:'billing.refund_recorded'}};
 assert.equal((await bound.plan('outbox_1')).disposition,'quarantine');
 refund=true;assert.equal((await bound.plan('outbox_1')).disposition,'ready');
});
test('P05 uses actual pinned AI-0 #19 implementation for shared positive/negative parity',async(t)=>{
 const path=process.env.AI0_CANONICAL_MODULE;
 if(!path){t.skip('Standalone local run has no pinned PR #19 file; CI must supply it');return}
 const {pathToFileURL}=await import('node:url');
 const {isStarryEventEnvelope}=await import(pathToFileURL(path).href);
 for(const sample of [
  event,{...event,occurred_at:'2026-10-26T08:00:00+08:00'},
  {...event,occurred_at:'2026-10-26T00:00:00.123456789Z'},
  {...event,brand_id:'hglobal'},{...event,environment:'sandbox'},
  {...event,access_token:'secret'},{...event,email:'alice@example.com'},
  {...event,occurred_at:'2026-10-26T08:00:00'},
  {...event,occurred_at:'2026-13-26T08:00:00Z'}
 ])assert.equal(isEventEnvelope(sample),isStarryEventEnvelope(sample),JSON.stringify(sample));
});

test('Pinned AI-1 real session/admin policy: suspended, deleted, revoked, stale, cross-scope denied',async(t)=>{
 const path=process.env.AI1_GUARDS_MODULE;
 if(!path){t.skip('CI pins AI-1 #22; standalone smoke may skip');return}
 const {pathToFileURL}=await import('node:url');
 const {authorizeSession,authorizeAdmin}=await import(pathToFileURL(path).href);
 const now=1780000000;
 const principal={brand_id:'starry',app_id:scope.app_id,environment:'staging',s_user_id:'uid_01',session_id:'sess_01',auth_version:2,expires_at:now+1000};
 const session={s_user_id:'uid_01',session_id:'sess_01',app_id:scope.app_id,environment:'staging',auth_version:2,expires_at:now+1000,revoked_at:null,step_up_until:now+500};
 const member={s_user_id:'uid_01',status:'active',auth_version:2};
 const grant={s_user_id:'uid_01',brand_id:'starry',app_id:scope.app_id,environment:'staging',resource:'system',action:'read',expires_at:now+1000,revoked_at:null};
 let liveSession=session,liveMember=member,liveGrant=grant,livePrincipal=principal;
 const bound=bindAi3TrustedOperations(scope,{
   authorizeSession:async(s)=>authorizeSession(s,livePrincipal,liveSession,liveMember,now),
   authorizeAdmin:async(s,op)=>authorizeAdmin(s,livePrincipal,liveSession,liveMember,liveGrant,op,now),
   resolveNotificationDelivery:async()=>({recipient_ref:'uid_01',allowed_channels:['inbox']})
 });
 await bound.assertAuditRead(scope);
 const req={event,recipient_ref:'uid_01',channel:'inbox',template_id:'incident.notice'};
 await bound.assertNotificationDelivery(req);
 for(const status of ['suspended','deleted']){
  liveMember={...member,status};
  await assert.rejects(bound.assertAuditRead(scope),/ACCESS_DENIED/);
  await assert.rejects(bound.assertNotificationDelivery(req),/DENIED/);
 }
 liveMember=member;liveGrant={...grant,revoked_at:now};
 await assert.rejects(bound.assertAuditRead(scope),/ACCESS_DENIED/);
 liveGrant=grant;liveSession={...session,revoked_at:now};
 await assert.rejects(bound.assertAuditRead(scope),/ACCESS_DENIED/);
 await assert.rejects(bound.assertNotificationDelivery(req),/DENIED/);
 liveSession=session;livePrincipal={...principal,auth_version:1};
 await assert.rejects(bound.assertAuditRead(scope),/ACCESS_DENIED/);
 livePrincipal={...principal,app_id:'other-app'};
 await assert.rejects(bound.assertAuditRead(scope),/ACCESS_DENIED/);
});
test('Pinned AI-2 reducer maintains transaction ownership, dedupe, out-of-order refund safeguards',async(t)=>{
 const path=process.env.AI2_BILLING_MODULE;
 if(!path){t.skip('CI pins AI-2 #23; standalone smoke may skip');return}
 const {pathToFileURL}=await import('node:url');
 const {applyVerifiedEvent}=await import(pathToFileURL(path).href);
 const bs={brandId:'starry',environment:'sandbox',appId:scope.app_id,store:'apple',storeAppId:'test.bundle',
  userId:'uid_01',accountBinding:'bind_01',evaluatedAt:'2026-10-26T00:00:00Z'};
 const catalog=[{appId:scope.app_id,store:'apple',storeAppId:'test.bundle',productId:'test.monthly',kind:'subscription',entitlementKey:'pro'}];
 const p={verifiedBy:'apple-app-store-server-api',store:'apple',storeEnvironment:'sandbox',storeAppId:'test.bundle',
  appId:scope.app_id,productId:'test.monthly',transactionId:'txn_new',originalTransactionId:'txn_origin',
  eventId:'provider_renewed',occurredAt:'2026-10-26T00:00:00Z',
  expiresAt:'2026-11-26T00:00:00Z',accountBinding:'bind_01',lifecycle:'RENEWED'};
 const applied=applyVerifiedEvent(null,p,bs,catalog);
 assert.equal(applied.projection.entitlement,'active');
 assert.equal(applyVerifiedEvent(applied.projection,p,bs,catalog,true).reason,'duplicate');
 assert.equal(applyVerifiedEvent(applied.projection,{...p,eventId:'older_refund',occurredAt:'2026-10-25T00:00:00Z',lifecycle:'REFUNDED'},bs,catalog).reason,'stale');
 assert.equal(applyVerifiedEvent(applied.projection,{...p,eventId:'newer_refund',occurredAt:'2026-10-27T00:00:00Z',lifecycle:'REFUNDED'},bs,catalog).projection.entitlement,'inactive');
 for(const bad of [
  {...p,verifiedBy:'client-paid'},
  {...p,storeEnvironment:'production'},
  {...p,appId:'wrong'},
  {...p,productId:'battery.monthly'}
 ])assert.throws(()=>applyVerifiedEvent(null,bad,bs,catalog));
});
