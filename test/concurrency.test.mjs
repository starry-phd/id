// Concurrency: many requests at once must never overspend Battery, fork a refresh token chain,
// overwrite a profile edit or duplicate an idempotent reservation (spec S-BAT-03, S-ID-04, S-ID-08).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { authBindings, idTokenClaims, signJwt } from './auth-fixtures.mjs';
import { startWorker } from './helpers.mjs';

const KEY = 'c'.repeat(40);
const json = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const count = (statuses, status) => statuses.filter((s) => s === status).length;

describe('concurrent requests', () => {
  let worker;
  let keys;

  before(async () => {
    keys = await authBindings();
    worker = await startWorker({ bindings: { ...keys.bindings, BATTERY_SERVICE_KEYS: JSON.stringify({ echo: KEY }) } });
  });
  after(async () => {
    await worker?.mf.dispose();
  });

  async function signIn(sub) {
    const { nonce } = await (await worker.call('/v1/auth/nonce', json({ app_id: 'echo' }))).json();
    const res = await worker.call('/v1/auth/google', json({ app_id: 'echo', id_token: await signJwt(keys.google, idTokenClaims('google', { sub, nonce })), nonce }));
    assert.equal(res.status, 200);
    return res.json();
  }

  test('40 parallel reservations against a 10-Battery month: exactly 10 succeed', async () => {
    const s = await signIn('parallel-battery');
    const headers = { authorization: `Bearer ${s.access_token}`, 'x-starry-app-key': KEY };
    const statuses = await Promise.all(
      Array.from({ length: 40 }, (_, i) => worker.call('/v1/battery/reservations', json({ task_type: 'echo.ai', units: 1, idempotency_key: `parallel-${String(i).padStart(4, '0')}` }, headers)).then((r) => r.status)),
    );
    assert.equal(count(statuses, 201), 10, JSON.stringify(statuses));
    assert.equal(count(statuses, 409), 30);
    const balance = (await (await worker.call('/v1/me/battery', { headers: { authorization: `Bearer ${s.access_token}` } })).json()).balance;
    assert.deepEqual([balance.reserved, balance.remaining], [10, 0]);
  });

  test('the same idempotency key sent 15 times at once makes one reservation', async () => {
    const s = await signIn('parallel-idempotent');
    const headers = { authorization: `Bearer ${s.access_token}`, 'x-starry-app-key': KEY };
    const responses = await Promise.all(Array.from({ length: 15 }, () => worker.call('/v1/battery/reservations', json({ task_type: 'echo.ai', units: 3, idempotency_key: 'same-key-0001' }, headers))));
    const bodies = await Promise.all(responses.map((r) => r.json()));
    assert.equal(new Set(bodies.map((b) => b.reservation_id)).size, 1);
    assert.equal(count(responses.map((r) => r.status), 201), 1);
    const commits = await Promise.all(Array.from({ length: 10 }, () => worker.call(`/v1/battery/reservations/${bodies[0].reservation_id}/commit`, { method: 'POST', headers: { 'x-starry-app-key': KEY } })));
    assert.ok(commits.every((r) => r.status === 200));
    const balance = (await (await worker.call('/v1/me/battery', { headers: { authorization: `Bearer ${s.access_token}` } })).json()).balance;
    assert.deepEqual([balance.used, balance.reserved], [3, 0], 'ten simultaneous commits charge once');
  });

  test('one refresh token used 10 times at once never yields two usable tokens', async () => {
    const s = await signIn('parallel-refresh');
    const results = await Promise.all(Array.from({ length: 10 }, () => worker.call('/v1/auth/refresh', json({ refresh_token: s.refresh_token }))));
    const ok = results.filter((r) => r.status === 200);
    assert.ok(ok.length <= 1, `${ok.length} refreshes succeeded`);
    assert.ok(results.every((r) => r.status === 200 || r.status === 401));
  });

  test('10 profile edits from the same version: one is saved, nine get 409', async () => {
    const s = await signIn('parallel-profile');
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        worker.call('/v1/me/profile', { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': '"1"', authorization: `Bearer ${s.access_token}` }, body: JSON.stringify({ motto: `版本 ${i}` }) }).then((r) => r.status),
      ),
    );
    assert.deepEqual([count(results, 200), count(results, 409)], [1, 9]);
  });

  test('25 first sign-ins of the same new person create one member', async () => {
    const nonces = await Promise.all(Array.from({ length: 25 }, async () => (await (await worker.call('/v1/auth/nonce', json({ app_id: 'echo' }))).json()).nonce));
    const results = await Promise.all(
      nonces.map(async (nonce) => (await worker.call('/v1/auth/google', json({ app_id: 'echo', id_token: await signJwt(keys.google, idTokenClaims('google', { sub: 'race-new', nonce })), nonce }))).json()),
    );
    assert.equal(new Set(results.map((r) => r.user.user_id)).size, 1);
    assert.equal(await worker.db.prepare("SELECT COUNT(*) AS n FROM auth_identities WHERE subject = 'race-new'").first('n'), 1);
  });
});
