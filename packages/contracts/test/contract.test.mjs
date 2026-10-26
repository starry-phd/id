import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STARRY_BRAND_ID, CROSS_BRAND_MEMBER_SYNC_ENABLED,
  isStarryEventEnvelope, assertStarryResourceScope, isStarryEnvironment,
} from '../src/index.ts';

const valid = Object.freeze({
  event_id: 'evt-1', event_type: 'auth.session.revoked', schema_version: '0.1',
  brand_id: 'starry', app_id: 'example-starry-app', environment: 'staging',
  occurred_at: '2026-10-26T00:00:00Z', correlation_id: 'request-1',
  resource_type: 'session', resource_id: 'session-1', result: 'success',
});
const trusted = {brand_id: 'starry', app_id: 'example-starry-app', environment: 'staging'};

test('P05: accepts valid Starry event envelope', () => {
  assert.equal(STARRY_BRAND_ID, 'starry');
  assert.equal(isStarryEventEnvelope(valid), true);
  assert.equal(isStarryEventEnvelope({...valid, idempotency_key: 'retry-1'}), true);
  assert.equal(isStarryEventEnvelope({...valid, occurred_at: '2026-10-26T08:00:00+08:00'}), true);
});

test('P05: rejects cross-brand, bad environment, extra fields and malformed event', () => {
  assert.equal(isStarryEventEnvelope({...valid, brand_id: 'hglobal'}), false);
  assert.equal(isStarryEventEnvelope({...valid, environment: 'test-production'}), false);
  assert.equal(isStarryEventEnvelope({...valid, access_token: 'secret'}), false);
  assert.equal(isStarryEventEnvelope({...valid, event_id: ' '}), false);
  assert.equal(isStarryEventEnvelope({...valid, occurred_at: 'yesterday'}), false);
  assert.equal(isStarryEventEnvelope({...valid, occurred_at: '2026-10-26'}), false);
  assert.equal(isStarryEventEnvelope({...valid, occurred_at: '2026-10-26T25:00:00Z'}), false);
  assert.equal(isStarryEventEnvelope({...valid, idempotency_key: ''}), false);
  assert.equal(isStarryEventEnvelope(null), false);
  assert.equal(isStarryEventEnvelope(Object.create(valid)), false);
});

test('P01: environment values explicit', () => {
  assert.equal(isStarryEnvironment('staging'), true);
  assert.equal(isStarryEnvironment('production'), true);
  assert.equal(isStarryEnvironment('preview'), false);
});

test('P01: only exact trusted brand/app/environment matches', () => {
  assert.doesNotThrow(() => assertStarryResourceScope(trusted, trusted));
  assert.throws(() => assertStarryResourceScope(trusted, {...trusted, brand_id: 'hglobal'}), /SCOPE_DENIED/);
  assert.throws(() => assertStarryResourceScope(trusted, {...trusted, app_id: 'other-app'}), /SCOPE_DENIED/);
  assert.throws(() => assertStarryResourceScope(trusted, {...trusted, environment: 'production'}), /SCOPE_DENIED/);
  assert.throws(() => assertStarryResourceScope(trusted, undefined), /SCOPE_DENIED/);
});

test('cross-brand member sync remains disabled', () => {
  assert.equal(CROSS_BRAND_MEMBER_SYNC_ENABLED, false);
});
