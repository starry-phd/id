import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STARRY_BRAND_ID, CROSS_BRAND_MEMBER_SYNC_ENABLED,
  isStarryEventEnvelope, assertStarryResourceScope, isStarryEnvironment,
  isRfc3339Timestamp, assertStarryEventForScope,
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

test('P05: RFC3339 rejects calendar rollover and invalid timezone', () => {
  for (const value of [
    '2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z',
    '2026-13-01T00:00:00Z', '2026-10-26T00:00:00+24:00',
    '2026-10-26T00:00:00+08:60', '2026-10-26T24:00:00Z',
    '2026-10-26T12:00:60Z', '2026-10-26T00:00:00',
    '2026-10-26T00:00:00.1234567890Z', '0000-01-01T00:00:00Z',
  ]) assert.equal(isRfc3339Timestamp(value), false, value);
  for (const value of [
    '2024-02-29T00:00:00Z', '2026-10-26T08:00:00+08:00',
    '2026-10-25T20:30:00-04:30', '2026-10-26T00:00:00.123456789Z',
  ]) assert.equal(isRfc3339Timestamp(value), true, value);
});

test('P05: rejects unsafe machine metadata and undefined idempotency keys', () => {
  for (const field of [
    'event_id', 'event_type', 'schema_version', 'app_id', 'correlation_id',
    'resource_type', 'resource_id', 'result',
  ]) {
    assert.equal(isStarryEventEnvelope({...valid, [field]: 'bad\nlabel'}), false, field);
    assert.equal(isStarryEventEnvelope({...valid, [field]: 'a'.repeat(129)}), false, field);
    assert.equal(isStarryEventEnvelope({...valid, [field]: 'john@example.com'}), false, field);
  }
  assert.equal(isStarryEventEnvelope({...valid, idempotency_key: undefined}), false);
  assert.equal(isStarryEventEnvelope({...valid, idempotency_key: 'retry:01-aaa'}), true);
  assert.equal(isStarryEventEnvelope(new Date()), false);
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
  assert.throws(() => assertStarryResourceScope(trusted, {...trusted, app_id: 'unsafe app'}), /SCOPE_DENIED/);
  assert.throws(() => assertStarryResourceScope(trusted, {...trusted, access_token: 'secret'}), /SCOPE_DENIED/);
  assert.throws(() => assertStarryResourceScope(trusted, Object.create(trusted)), /SCOPE_DENIED/);
  assert.throws(() => assertStarryResourceScope(trusted, undefined), /SCOPE_DENIED/);
});

test('P01/P05: event scope binds to trusted Starry app and environment', () => {
  assert.doesNotThrow(() => assertStarryEventForScope(trusted, valid));
  assert.throws(() => assertStarryEventForScope(trusted, {...valid, app_id: 'other-app'}), /SCOPE_DENIED/);
  assert.throws(() => assertStarryEventForScope(trusted, {...valid, environment: 'production'}), /SCOPE_DENIED/);
  assert.throws(() => assertStarryEventForScope(trusted, {...valid, brand_id: 'hglobal'}), /ENVELOPE_DENIED/);
  assert.throws(() => assertStarryEventForScope(trusted, {...valid, access_token: 'secret'}), /ENVELOPE_DENIED/);
});

test('cross-brand member sync remains disabled', () => {
  assert.equal(CROSS_BRAND_MEMBER_SYNC_ENABLED, false);
});
