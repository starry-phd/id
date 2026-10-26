import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BATTERY_POLICY, isEventEnvelope, isAuditRecord, assertScope,
  assertBatteryCapability, assertAuditRead, assertNotificationRequest,
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
test('P06 audit reads fail closed without externally verified Starry admin scope', () => {
  assert.throws(() => assertAuditRead(scope, scope, false, 'audit:read'), /ACCESS_DENIED/);
  assert.throws(() => assertAuditRead(scope, scope, true, 'audit:write'), /ACCESS_DENIED/);
  assert.throws(() => assertAuditRead(scope, { ...scope, environment:'production' }, true, 'audit:read'), /SCOPE_DENIED/);
  assert.doesNotThrow(() => assertAuditRead(scope, scope, true, 'audit:read'));
});
test('notification delivery requires checked event, recipient and consented channel', () => {
  const request = { event, recipient_ref:'uid_01', channel:'email', template_id:'incident.notice' };
  assert.doesNotThrow(() => assertNotificationRequest(scope, request, 'uid_01', ['inbox','email']));
  assert.throws(() => assertNotificationRequest(scope, request, 'uid_02', ['email']), /DENIED/);
  assert.throws(() => assertNotificationRequest(scope, request, 'uid_01', ['inbox']), /DENIED/);
  assert.throws(() => assertNotificationRequest(scope, { ...request, email:'secret@example.com' }, 'uid_01', ['email']), /DENIED/);
  assert.throws(() => assertNotificationRequest(scope, { ...request, event:{...event, brand_id:'hglobal'} }, 'uid_01', ['email']), /DENIED/);
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
