import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  assertTrustedAuditRead, assertTrustedRefundReview,
  canonicalAuditIdempotencyKey, projectServerVerifiedSandboxEvent,
} from '../src/index.ts';
import { handleRequest } from '../../../apps/api/src/index.ts';

const NOW = Date.parse('2026-10-26T08:00:00Z') / 1000;
const SCOPE = Object.freeze({brand_id:'starry', app_id:'starry.demo', environment:'staging'});
const member = Object.freeze({s_user_id:'s_user_1', status:'active', auth_version:2});
const principal = Object.freeze({brand_id:'starry',app_id:'starry.demo',environment:'staging',
  s_user_id:'s_user_1',session_id:'sess_1',auth_version:2,expires_at:NOW+3600});
const session = Object.freeze({s_user_id:'s_user_1',session_id:'sess_1',app_id:'starry.demo',
  environment:'staging',auth_version:2,expires_at:NOW+3600,revoked_at:null,step_up_until:NOW+240});
const auditGrant = Object.freeze({s_user_id:'s_user_1',brand_id:'starry',app_id:'starry.demo',
  environment:'staging',resource:'system',action:'read',expires_at:NOW+3600,revoked_at:null});
const refundGrant = Object.freeze({...auditGrant,resource:'billing',action:'refund'});
const backend = (overrides={}) => ({scope:SCOPE, principal, session, member, grant:auditGrant,
  verified_step_up_at:NOW-60,...overrides});
const audit = (state=backend()) => ({loadTrustedState:()=>state});
const billingEvent = Object.freeze({verifiedBy:'apple-app-store-server-api',store:'apple',
  storeEnvironment:'sandbox',storeAppId:'phd.starry.demo',appId:'starry.demo',productId:'test.monthly',
  transactionId:'tx1',originalTransactionId:'orig1',eventId:'evt1',
  occurredAt:'2026-10-26T07:00:00Z',expiresAt:'2026-11-26T07:00:00Z',
  accountBinding:'server-binding',lifecycle:'PURCHASED'});
const billing = (overrides={}) => ({auth:backend(),store_environment:'sandbox',
  store:'apple',store_app_id:'phd.starry.demo',account_binding:'server-binding',
  catalog:[{appId:'starry.demo',store:'apple',storeAppId:'phd.starry.demo',
    productId:'test.monthly',kind:'subscription',entitlementKey:'test.premium'}],
  provider_verified_event:billingEvent,current:null,already_processed:false,...overrides});
const order = (context=billing()) => ({loadTrustedBilling:()=>context});
const event = Object.freeze({...SCOPE,event_id:'ev_1',event_type:'audit.read',
  schema_version:'0.1',occurred_at:'2026-10-26T08:00:00Z',correlation_id:'corr_1',
  resource_type:'session',resource_id:'ses_1',result:'denied',idempotency_key:'dedupe_1'});

test('canonical P05 takes RFC3339 timezone offsets and retains identical namespace',()=>{
  assert.equal(canonicalAuditIdempotencyKey(SCOPE,event),
    canonicalAuditIdempotencyKey(SCOPE,{...event,occurred_at:'2026-10-26T16:00:00+08:00'}));
  assert.equal(canonicalAuditIdempotencyKey(SCOPE,event),'starry|starry.demo|staging|audit.read|dedupe_1');
});
test('canonical P05 blocks cross-brand/app/environment, credentials and bad timestamp',()=>{
  for(const e of [{...event,brand_id:'hglobal'},{...event,app_id:'foreign'},
    {...event,environment:'production'},{...event,access_token:'secret'},
    {...event,occurred_at:'2026-10-26T08:00:00'},
    {...event,occurred_at:'2026-10-26T25:00:00Z'}])
    assert.throws(()=>canonicalAuditIdempotencyKey(SCOPE,e),/DENIED/);
});
test('Audit read obtains scoped backend grant, not client adminVerified',()=>{
  assert.doesNotThrow(()=>assertTrustedAuditRead(audit(),SCOPE,NOW));
  assert.throws(()=>assertTrustedAuditRead(audit(backend({grant:null})),
    {...SCOPE,adminVerified:true},NOW),/ADMIN_DENIED/);
  assert.throws(()=>assertTrustedAuditRead({loadTrustedState:()=>null},SCOPE,NOW),/TRUSTED_BACKEND/);
});
test('Audit read blocks revoked session, suspended user, missing/old step-up',()=>{
  const cases=[backend({session:{...session,revoked_at:NOW-1}}),
    backend({member:{...member,status:'suspended'}}),
    backend({verified_step_up_at:null}),
    backend({verified_step_up_at:NOW-301}),
    backend({session:{...session,step_up_until:NOW-1}})];
  for(const state of cases)assert.throws(()=>assertTrustedAuditRead(audit(state),SCOPE,NOW));
});
test('Audit denies mis-scoped trusted grant and client fake context',()=>{
  for(const state of [backend({grant:{...auditGrant,app_id:'foreign'}}),
    backend({grant:{...auditGrant,environment:'development'}}),
    backend({scope:{...SCOPE,brand_id:'hglobal'}}),
    backend({scope:{...SCOPE,environment:'production'}})])
    assert.throws(()=>assertTrustedAuditRead(audit(state),SCOPE,NOW));
  assert.throws(()=>assertTrustedAuditRead(audit(),{...SCOPE,app_id:'foreign',adminVerified:true},NOW));
});
test('Billing only consumes server verified event with split runtime/stores sandbox axes',()=>{
  const r=projectServerVerifiedSandboxEvent(order(),SCOPE,NOW);
  assert.equal(r.applied,true);
  assert.equal(r.projection.entitlement,'active');
  assert.equal(r.projection.environment,'sandbox');
  assert.equal(r.projection.appId,'starry.demo');
  assert.equal(r.projection.userId,'s_user_1');
});
test('client-supplied verifiedBy does not stand in for server provider verification',()=>{
  assert.throws(()=>projectServerVerifiedSandboxEvent(
    order(billing({provider_verified_event:null})),{...SCOPE,verifiedBy:'apple-app-store-server-api'},NOW),
    /SERVER_PROVIDER_VERIFICATION_REQUIRED/);
  assert.throws(()=>projectServerVerifiedSandboxEvent({loadTrustedBilling:()=>null},SCOPE,NOW),
    /TRUSTED_BACKEND_CONTEXT_REQUIRED/);
});
test('Billing refuses runtime production, store production, other app or user suspension',()=>{
  const bad=[billing({store_environment:'production'}),
    billing({auth:backend({scope:{...SCOPE,environment:'production'}})}),
    billing({auth:backend({scope:{...SCOPE,brand_id:'hglobal'}})}),
    billing({auth:backend({member:{...member,status:'suspended'}})}),
    billing({provider_verified_event:{...billingEvent,appId:'different'}}),
    billing({provider_verified_event:{...billingEvent,storeEnvironment:'production'}})];
  for(const one of bad) assert.throws(()=>projectServerVerifiedSandboxEvent(order(one),SCOPE,NOW));
});
test('Billing duplicate / delayed event cannot mutate trusted projection',()=>{
  const first=projectServerVerifiedSandboxEvent(order(),SCOPE,NOW).projection;
  const dupe=projectServerVerifiedSandboxEvent(order(billing({current:first,already_processed:true})),SCOPE,NOW);
  assert.equal(dupe.reason,'duplicate');assert.strictEqual(dupe.projection,first);
  const delayed=projectServerVerifiedSandboxEvent(order(billing({current:first,
    provider_verified_event:{...billingEvent,eventId:'older',occurredAt:'2026-10-25T07:00:00Z'}})),SCOPE,NOW);
  assert.equal(delayed.reason,'stale');
});
test('Refund reviewer must have AI-1 billing refund grant plus backend approval and recent step-up',()=>{
  const base={auth:backend({grant:refundGrant}),store_environment:'sandbox',
    server_approval_id:'server_case_1'};
  const source=(c)=>({loadRefundContext:()=>c});
  assert.doesNotThrow(()=>assertTrustedRefundReview(source(base),SCOPE,'reason supplied',NOW));
  assert.throws(()=>assertTrustedRefundReview(source({...base,auth:backend({grant:auditGrant})}),
    {...SCOPE,adminVerified:true},'fraud',NOW),/ADMIN_DENIED/);
  assert.throws(()=>assertTrustedRefundReview(source({...base,server_approval_id:null}),
    SCOPE,'fraud',NOW),/SERVER_APPROVAL_REQUIRED/);
  assert.throws(()=>assertTrustedRefundReview(source({...base,auth:backend({
    grant:refundGrant,verified_step_up_at:NOW-400})}),SCOPE,'fraud',NOW),/STEP_UP/);
  assert.throws(()=>assertTrustedRefundReview(source({...base,store_environment:'production'}),
    SCOPE,'fraud',NOW),/STORE_ENVIRONMENT_DENIED/);
});
test('Deployed route contract remains liveness-only; no candidate Auth/Billing/Admin exposed',()=>{
  const yaml=readFileSync('apps/api/openapi.yaml','utf8');
  assert.deepEqual([...yaml.matchAll(/^  (\/v1\/[^:]+):/gm)].map(x=>x[1]),['/v1/health']);
  const env={STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'};
  for(const path of ['/v1/admin','/v1/auth/session','/v1/billing/refund'])
    assert.equal(handleRequest(new Request('https://localhost'+path),env).status,404);
  assert.equal(handleRequest(new Request('https://localhost/v1/health'),env).status,200);
  assert.equal(handleRequest(new Request('https://localhost/v1/health'),
    {...env,STARRY_ENVIRONMENT:'production'}).status,503);
});
