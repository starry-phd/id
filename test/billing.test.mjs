import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { authBindings, idTokenClaims, signJwt } from './auth-fixtures.mjs';
import { startWorker } from './helpers.mjs';

const json = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('RevenueCat webhook and entitlements API', () => {
  let worker;
  let keys;
  let session;

  before(async () => {
    keys = await authBindings();
    worker = await startWorker({ bindings: { ...keys.bindings, REVENUECAT_WEBHOOK_AUTH: JSON.stringify({ echo: 'hook-secret' }) } });
    const nonce = (await (await worker.call('/v1/auth/nonce', json({ app_id: 'echo' }))).json()).nonce;
    const idToken = await signJwt(keys.google, idTokenClaims('google', { sub: 'buyer', nonce }));
    session = await (await worker.call('/v1/auth/google', json({ app_id: 'echo', id_token: idToken, nonce }))).json();
  });
  after(async () => {
    await worker?.mf.dispose();
  });

  const event = (id, type, extra = {}) => ({
    api_version: '1.0',
    event: { id, type, app_user_id: session.user.user_id, event_timestamp_ms: Date.now(), entitlement_ids: ['pro'], product_id: 'echo_monthly', expiration_at_ms: Date.now() + 30 * 86400000, environment: 'SANDBOX', store: 'APP_STORE', ...extra },
  });
  const entitlements = async () => (await (await worker.call('/v1/me/entitlements', { headers: { authorization: `Bearer ${session.access_token}` } })).json()).entitlements;

  async function eventually(check) {
    for (let i = 0; i < 40; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail('condition not reached');
  }

  test('rejects wrong authorization and unknown apps', async () => {
    assert.equal((await worker.call('/v1/billing/revenuecat/echo', json(event('e0', 'TEST'), { authorization: 'Bearer wrong' }))).status, 401);
    assert.equal((await worker.call('/v1/billing/revenuecat/echo', json(event('e0', 'TEST')))).status, 401);
    assert.equal((await worker.call('/v1/billing/revenuecat/nope', json(event('e0', 'TEST'), { authorization: 'Bearer hook-secret' }))).status, 404);
    assert.equal((await worker.call('/v1/billing/revenuecat/account', json(event('e0', 'TEST'), { authorization: 'Bearer hook-secret' }))).status, 404);
    assert.equal((await worker.call('/v1/billing/revenuecat/echo', json({ nope: 1 }, { authorization: 'Bearer hook-secret' }))).status, 400);
  });

  test('a purchase becomes an entitlement; redelivery is deduplicated; expiration removes it', async () => {
    const res = await worker.call('/v1/billing/revenuecat/echo', json(event('evt-1', 'INITIAL_PURCHASE'), { authorization: 'Bearer hook-secret' }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, duplicate: false });
    await eventually(async () => (await entitlements()).length === 1);
    assert.equal((await entitlements())[0].entitlement, 'pro');
    const again = await worker.call('/v1/billing/revenuecat/echo', json(event('evt-1', 'INITIAL_PURCHASE'), { authorization: 'hook-secret' }));
    assert.deepEqual(await again.json(), { received: true, duplicate: true });
    await worker.call('/v1/billing/revenuecat/echo', json(event('evt-2', 'EXPIRATION', { event_timestamp_ms: Date.now() + 1000 }), { authorization: 'Bearer hook-secret' }));
    await eventually(async () => (await entitlements()).length === 0);
    const stored = await worker.billing.prepare('SELECT COUNT(*) AS n FROM rc_events').first();
    assert.equal(stored.n, 2);
  });

  test('entitlements require sign-in', async () => {
    assert.equal((await worker.call('/v1/me/entitlements')).status, 401);
  });
});
