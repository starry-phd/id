import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {handleRequest} from '../src/index.ts';
import {
  R003_INTEROP_VERSION, R003_UPSTREAM_CANDIDATES, R003_REVIEW_ONLY,
  R003_PROPOSED_HTTP, R003_P05_ORDER,
  reviewR003QueueSequence, proposeR003PublicError
} from '../src/wave1-r003-protected-interop.ts';

const scope = (stages = []) => ({
  brand_id: 'starry', app_id: 'starry-id', environment: 'staging',
  event_ref: 'event-000123', actor_ref: 'actor-000123', stages
});
const denied = (r) => {
  assert.equal(r.contract, R003_INTEROP_VERSION);
  assert.equal(r.state, 'blocked');
  assert.equal(r.authorized, false);
  assert.equal(r.may_ack_queue, false);
  assert.equal(r.may_emit_p05, false);
  assert.equal(r.may_send_notification, false);
  assert.equal(r.may_write_d1, false);
  assert.equal(r.verified_live, false);
  assert.equal(r.publishable, false);
  assert.ok(Object.isFrozen(r));
};

test('R003 uses explicitly separate AI-1 and AI-3 candidate versions (not approved)', () => {
  assert.equal(R003_UPSTREAM_CANDIDATES.auth,
    'starry.auth.identity-authority.r003.v1-candidate');
  assert.equal(R003_UPSTREAM_CANDIDATES.p05,
    'starry.ai3.p05.commit-before-ack.r003.v1-candidate');
  assert.match(R003_UPSTREAM_CANDIDATES.authority, /AI-0_SINGLE_CANONICAL/);
  assert.equal(R003_REVIEW_ONLY.verified_signed_auth_live, false);
  assert.equal(R003_REVIEW_ONLY.queue_ack_authorized, false);
  assert.equal(R003_REVIEW_ONLY.cloudflare_preview_authorized, false);
  assert.ok(Object.values(R003_REVIEW_ONLY).every(v => v === false));
});

test('future 3 POST protected paths remain PROPOSED and non-executable', () => {
  assert.equal(R003_PROPOSED_HTTP.length, 3);
  assert.deepEqual(R003_PROPOSED_HTTP.map(r => r.domain_owner),
    ['AI-1', 'AI-2', 'AI-3']);
  for (const r of R003_PROPOSED_HTTP) {
    assert.equal(r.method, 'POST');
    assert.equal(r.status, 'PROPOSED_NOT_REGISTERED');
    assert.equal(r.public_openapi_path, false);
    assert.equal(r.executable_adapter, false);
    assert.ok(Object.isFrozen(r));
  }
});

test('actual Worker and public OpenAPI have only health; POSTs still 405', async () => {
  const yaml = readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8');
  assert.match(yaml, /^openapi: 3\.1\.0/m);
  assert.match(yaml, /^ {2}\/v1\/health:/m);
  const env = {STARRY_ENVIRONMENT: 'staging', STARRY_APP_ID: 'starry-id'};
  const healthy = handleRequest(new Request('https://starry.invalid/v1/health'), env);
  assert.equal(healthy.status, 200);
  for (const route of R003_PROPOSED_HTTP) {
    assert.equal(yaml.includes(route.path), false);
    const rejected = handleRequest(new Request('https://starry.invalid' + route.path,
      {method: 'POST'}), env);
    assert.equal(rejected.status, 405);
    const body = await rejected.text();
    assert.doesNotMatch(body, /s_user_id|session_binding|member_digest|token/i);
  }
});

test('full perfect-looking sequence is still just an untrusted string list: never ACK', () => {
  const r = reviewR003QueueSequence(scope([...R003_P05_ORDER]));
  denied(r);
  assert.equal(r.reason, 'GATE_NOT_AUTHORIZED');
  assert.equal(r.stage_count, 7);
});

test('empty and incomplete traces are denied even with plausible event IDs', () => {
  for (const stages of [
    [], ['canonical-p05-verify'],
    R003_P05_ORDER.slice(0, 5), R003_P05_ORDER.slice(0, 6)
  ]) {
    const r = reviewR003QueueSequence(scope(stages));
    denied(r);
    assert.equal(r.reason, 'UNVERIFIED_CANONICAL_AUTHORITY');
  }
});

test('premature Queue ACK before any verified durable commit is forbidden', () => {
  for (const stages of [
    ['queue-ack'],
    ['canonical-p05-verify', 'queue-ack'],
    ['canonical-p05-verify', 'current-session-fence', 'queue-ack']
  ]) {
    const r = reviewR003QueueSequence(scope(stages));
    denied(r);
    assert.equal(r.reason, 'PREMATURE_QUEUE_ACK');
  }
});

test('replay, duplicates, reordering and same-ledger shortcuts are never accepted', () => {
  for (const stages of [
    ['canonical-p05-verify', 'canonical-p05-verify'],
    ['current-session-fence', 'canonical-p05-verify'],
    ['canonical-p05-verify', 'durable-receipt-read'],
    ['canonical-p05-verify', 'current-session-fence',
      'lawful-q104-q119', 'durable-receipt-read',
      'commit-confirmed', 'independent-anti-pitr-read'],
  ]) {
    const r = reviewR003QueueSequence(scope(stages));
    denied(r);
    assert.equal(r.reason, 'DUPLICATE_OR_REORDERED_STAGE');
  }
});

test('wrong brand, app, environment and production are never reviewed', () => {
  for (const changes of [
    {brand_id: 'hglobal'}, {app_id: 'starry-other'},
    {environment: 'dev-prod'}, {environment: 'production'},
  ]) {
    const r = reviewR003QueueSequence({...scope(), ...changes});
    denied(r);
    assert.equal(r.reason, changes.environment === 'production' ?
      'PRODUCTION_DISABLED' : 'SCOPE_DENIED');
  }
});

test('caller claims are not cryptographic proof: unexpected keys fail closed', () => {
  for (const claims of [
    {signature_verified: true}, {caller: 'server_asserted'},
    {physical_d1_ok: true}, {verified_live: true},
    {queue_ack_authorized: true}
  ]) {
    const r = reviewR003QueueSequence({...scope([...R003_P05_ORDER]), ...claims});
    denied(r);
    assert.equal(r.reason, 'INVALID_TRACE');
  }
});

test('invalid metadata, proto inheritance and dangerous keys do not enter trust path', () => {
  for (const raw of [
    null, 42, 'fake', [], {}, {...scope(), event_ref: 'x'},
    {...scope(), actor_ref: 'actor/../escape'},
    Object.assign(Object.create({admin: true}), scope()),
    {...scope(), stages: ['fake-verified']},
    {...scope(), stages: Array(2).fill('canonical-p05-verify').concat(['queue-ack'])}
  ]) {
    denied(reviewR003QueueSequence(raw));
  }
});

test('accessor-injected root trace cannot execute attacker getter', () => {
  let touched = 0;
  const raw = scope([...R003_P05_ORDER]);
  Object.defineProperty(raw, 'stages', {enumerable: true, get() {
    touched++;
    throw Error('must never read this');
  }});
  const r = reviewR003QueueSequence(raw);
  denied(r);
  assert.equal(r.reason, 'INVALID_TRACE');
  assert.equal(touched, 0);
});

test('SDK protected error proposal allows only 400/401/403/404/405/409/503', () => {
  const codes = {
    400: 'INVALID_REQUEST', 401: 'AUTH_REQUIRED', 403: 'SCOPE_DENIED',
    404: 'ROUTE_NOT_AVAILABLE', 405: 'METHOD_NOT_ALLOWED',
    409: 'VERSION_CONFLICT', 503: 'OWNER_GATE_PENDING'
  };
  for (const [status, expected] of Object.entries(codes)) {
    const r = proposeR003PublicError(Number(status));
    assert.equal(r.http_status, Number(status));
    assert.equal(r.body.error.code, expected);
    assert.equal(r.body.error.message, 'Operation unavailable');
    assert.equal(r.may_dispatch, false);
    assert.equal(r.source, 'sdk_error_proposal_not_worker_response');
    assert.ok(Object.isFrozen(r));
    assert.ok(Object.isFrozen(r.body));
    assert.ok(Object.isFrozen(r.body.error));
  }
});

test('invalid success statuses, secrets, request bodies and object getters never echo', () => {
  for (const status of [
    200, 201, 204, 299, 301, 0, -1, NaN, Infinity,
    '200', null, undefined, {authorization:'Bearer private-secret'},
  ]) {
    const r = proposeR003PublicError(status);
    assert.equal(r.http_status, 503);
    assert.equal(r.body.error.code, 'OWNER_GATE_PENDING');
    assert.doesNotMatch(JSON.stringify(r), /private-secret|Bearer|digest|session_id/i);
  }
  let touched = 0;
  const o = {};
  Object.defineProperty(o, 'status', {get() {touched++; throw Error('secret');}});
  proposeR003PublicError(o);
  assert.equal(touched, 0);
});
