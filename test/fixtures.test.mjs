// The JSON examples in docs/fixtures are for App developers' offline tests. This suite produces
// each response for real and fails when an example's structure (keys and value types) drifts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { authBindings, idTokenClaims, signJwt } from './auth-fixtures.mjs';
import { startWorker } from './helpers.mjs';

const fixture = (name) => JSON.parse(readFileSync(`docs/fixtures/${name}`, 'utf8'));
const json = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const authed = (token, init = {}) => ({ ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
// Objects whose keys are data (one entry per changed field), compared value by value.
const RECORD_SUFFIXES = ['.profile.field_updated_at'];

function assertShape(actual, expected, path = '$') {
  if (expected === null || actual === null) return; // nullable either way
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path} should be an array`);
    if (expected.length > 0 && actual.length > 0) assertShape(actual[0], expected[0], `${path}[0]`);
    return;
  }
  if (typeof expected === 'object') {
    assert.equal(typeof actual, 'object', `${path} should be an object`);
    if (RECORD_SUFFIXES.some((suffix) => path.endsWith(suffix))) {
      const sample = Object.values(expected)[0];
      for (const [key, value] of Object.entries(actual)) assertShape(value, sample, `${path}.${key}`);
      return;
    }
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path} keys`);
    for (const key of Object.keys(expected)) assertShape(actual[key], expected[key], `${path}.${key}`);
    return;
  }
  assert.equal(typeof actual, typeof expected, `${path} type`);
}

async function matches(res, name, status) {
  assert.equal(res.status, status, `${name}: ${await res.clone().text()}`);
  assertShape(await res.json(), fixture(name), name);
}

describe('docs/fixtures match real responses', () => {
  let worker;
  let keys;
  let session;

  before(async () => {
    keys = await authBindings();
    worker = await startWorker({ bindings: { ...keys.bindings, REVENUECAT_WEBHOOK_AUTH: JSON.stringify({ echo: 'hook' }), BATTERY_SERVICE_KEYS: JSON.stringify({ echo: 'k'.repeat(40) }) } });
  });
  after(async () => {
    await worker?.mf.dispose();
  });

  const nonce = async () => (await (await worker.call('/v1/auth/nonce', json({ app_id: 'echo' }))).json()).nonce;
  const signIn = async (provider, sub) => {
    const n = await nonce();
    return worker.call(`/v1/auth/${provider}`, json({ app_id: 'echo', id_token: await signJwt(keys[provider], idTokenClaims(provider, { sub, nonce: n, email: `${sub}@example.com` })), nonce: n }));
  };

  test('launch and sign-in', async () => {
    await matches(await worker.call('/v1/apps/echo/config'), 'apps-config.200.json', 200);
    await matches(await worker.call('/v1/auth/nonce', json({ app_id: 'echo' })), 'auth-nonce.200.json', 200);
    const res = await signIn('google', 'fixture-user');
    session = await res.clone().json();
    await matches(res, 'auth-sign-in.200.json', 200);
    const refreshed = await worker.call('/v1/auth/refresh', json({ refresh_token: session.refresh_token }));
    const next = await refreshed.clone().json();
    await matches(refreshed, 'auth-refresh.200.json', 200);
    session = { ...session, ...next };
    await matches(await worker.call('/v1/me'), 'error.json', 401);
  });

  test('profile', async () => {
    const patch = (body, version) => worker.call('/v1/me/profile', authed(session.access_token, { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': `"${version}"` }, body: JSON.stringify(body) }));
    const body = { display_name: '小星', phone: '0912345678', country: 'TW', region: '臺北市', city: '大安區', birthday: '1990-02-28', motto: '慢慢來，比較快。', contact_email: 'me@example.com', visibility: { birthday: 'public' } };
    await matches(await patch(body, 1), 'me-profile.200.json', 200);
    await matches(await patch({ motto: '舊畫面' }, 1), 'me-profile.409.json', 409);
    await matches(await worker.call('/v1/me', authed(session.access_token)), 'me.200.json', 200);
  });

  test('linking a sign-in that made its own account, then merging it', async () => {
    assert.equal((await signIn('apple', 'fixture-apple')).status, 200);
    const link = async (extra = {}) => {
      const n = await nonce();
      return worker.call('/v1/me/identities/apple', authed(session.access_token, json({ id_token: await signJwt(keys.apple, idTokenClaims('apple', { sub: 'fixture-apple', nonce: n })), nonce: n, ...extra })));
    };
    await matches(await link(), 'me-identities.409.json', 409);
    await matches(await link({ merge_other_account: true }), 'me-identities.201.json', 201);
  });

  test('entitlements and Battery', async () => {
    const event = { api_version: '1.0', event: { id: 'fx-1', type: 'INITIAL_PURCHASE', app_user_id: session.user.user_id, event_timestamp_ms: Date.now(), entitlement_ids: ['pro'], product_id: 'echo_monthly', expiration_at_ms: Date.now() + 86400000, environment: 'PRODUCTION', store: 'APP_STORE' } };
    assert.equal((await worker.call('/v1/billing/revenuecat/echo', json(event, { authorization: 'Bearer hook' }))).status, 200);
    let entitlements;
    for (let i = 0; i < 40 && !(entitlements?.entitlements?.length > 0); i++) {
      await new Promise((r) => setTimeout(r, 50));
      entitlements = await (await worker.call('/v1/me/entitlements', authed(session.access_token))).json();
    }
    assertShape(entitlements, fixture('me-entitlements.200.json'), 'me-entitlements.200.json');
    assert.equal(entitlements.entitlements.length, 1);

    await worker.battery.prepare("INSERT INTO battery_task_types (task_type, app_id, label, unit_cost, max_units, timeout_ms, enabled, updated_at) VALUES ('echo.transcribe', 'echo', '語音轉文字', 1, 5, NULL, 1, 0)").run();
    const backend = { ...authed(session.access_token).headers, 'x-starry-app-key': 'k'.repeat(40) };
    const r = await (await worker.call('/v1/battery/reservations', json({ task_type: 'echo.transcribe', units: 2, idempotency_key: 'fixture-0001' }, backend))).json();
    assert.equal((await worker.call(`/v1/battery/reservations/${r.reservation_id}/commit`, { method: 'POST', headers: { 'x-starry-app-key': 'k'.repeat(40) } })).status, 200);
    await matches(await worker.call('/v1/me/battery', authed(session.access_token)), 'me-battery.200.json', 200);
  });

  test('deletion', async () => {
    await matches(await worker.call('/v1/me/deletion', authed(session.access_token, json({ confirm: true }))), 'me-deletion.202.json', 202);
  });
});
