import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { authBindings, idTokenClaims, signJwt } from './auth-fixtures.mjs';
import { startWorker } from './helpers.mjs';

const ECHO_KEY = 'e'.repeat(40);
const OTHER_KEY = 'o'.repeat(40);
const json = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('Starry Battery API (S-BAT-03/04/06)', () => {
  let worker;
  let token;

  before(async () => {
    const keys = await authBindings();
    worker = await startWorker({ bindings: { ...keys.bindings, BATTERY_SERVICE_KEYS: JSON.stringify({ echo: ECHO_KEY, other: OTHER_KEY }) } });
    // A 100 allowance keeps the arithmetic below simple; the shipped default is 10.
    await worker.battery.prepare('UPDATE battery_policy SET monthly_allowance = 100').run();
    await worker.battery
      .prepare("INSERT INTO battery_task_types (task_type, app_id, label, unit_cost, max_units, timeout_ms, enabled, updated_at) VALUES ('echo.transcribe', 'echo', '語音轉文字', 2, 30, NULL, 1, 0)")
      .run();
    const nonce = (await (await worker.call('/v1/auth/nonce', json({ app_id: 'echo' }))).json()).nonce;
    const idToken = await signJwt(keys.google, idTokenClaims('google', { sub: 'battery-user', nonce }));
    token = (await (await worker.call('/v1/auth/google', json({ app_id: 'echo', id_token: idToken, nonce }))).json()).access_token;
  });
  after(async () => {
    await worker?.mf.dispose();
  });

  const member = () => ({ authorization: `Bearer ${token}` });
  const backend = (key = ECHO_KEY) => ({ ...member(), 'x-starry-app-key': key });
  const reserve = (body, headers = backend()) => worker.call('/v1/battery/reservations', json(body, headers));

  test('members read their own balance; Battery needs sign-in', async () => {
    assert.equal((await worker.call('/v1/me/battery')).status, 401);
    const res = await worker.call('/v1/me/battery', { headers: member() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.balance.allowance, 100);
    assert.equal(body.balance.remaining, 100);
    assert.deepEqual(body.activity, []);
    assert.equal(body.next_cursor, null);
  });

  test('only the App backend with its service key and the member token of the same App can reserve', async () => {
    const body = { task_type: 'echo.transcribe', units: 5, idempotency_key: 'idem-0001' };
    assert.equal((await reserve(body, member())).status, 401, 'the App itself has no service key');
    assert.equal((await reserve(body, backend('x'.repeat(40)))).status, 401);
    assert.equal((await reserve(body, backend(OTHER_KEY))).status, 403, "another App's backend cannot spend for Echo members");
    assert.equal((await worker.call('/v1/battery/reservations', json(body, { 'x-starry-app-key': ECHO_KEY }))).status, 401, 'the member token is required');
    assert.equal((await reserve({ ...body, task_type: 'echo.unknown' })).status, 404);
    assert.equal((await reserve({ ...body, units: 31 })).status, 400);
  });

  test('reserve, replay, commit and release', async () => {
    const created = await reserve({ task_type: 'echo.transcribe', units: 10, idempotency_key: 'idem-0002' });
    assert.equal(created.status, 201);
    const r = await created.json();
    assert.equal(r.amount, 20);
    assert.equal(r.status, 'reserved');
    const replay = await reserve({ task_type: 'echo.transcribe', units: 10, idempotency_key: 'idem-0002' });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).replayed, true);
    const conflict = await reserve({ task_type: 'echo.transcribe', units: 2, idempotency_key: 'idem-0002' });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, 'IDEMPOTENCY_CONFLICT');

    const commitUrl = `/v1/battery/reservations/${r.reservation_id}/commit`;
    assert.equal((await worker.call(commitUrl, json({}, { 'x-starry-app-key': OTHER_KEY }))).status, 404, 'other Apps cannot see it');
    const committed = await worker.call(commitUrl, json({ units: 8 }, { 'x-starry-app-key': ECHO_KEY }));
    assert.equal(committed.status, 200);
    assert.equal((await committed.json()).charged, 16);
    assert.equal((await worker.call(commitUrl, { method: 'POST', headers: { 'x-starry-app-key': ECHO_KEY } })).status, 200, 'commit is idempotent, body optional');
    const release = await worker.call(`/v1/battery/reservations/${r.reservation_id}/release`, { method: 'POST', headers: { 'x-starry-app-key': ECHO_KEY } });
    assert.equal(release.status, 409);
    assert.equal((await release.json()).error.code, 'RESERVATION_CLOSED');

    const second = await (await reserve({ task_type: 'echo.transcribe', units: 3, idempotency_key: 'idem-0003' })).json();
    const released = await worker.call(`/v1/battery/reservations/${second.reservation_id}/release`, { method: 'POST', headers: { 'x-starry-app-key': ECHO_KEY } });
    assert.equal(released.status, 200);
    assert.equal((await released.json()).status, 'released');

    const mine = await (await worker.call('/v1/me/battery', { headers: member() })).json();
    assert.deepEqual([mine.balance.used, mine.balance.reserved, mine.balance.remaining], [16, 0, 84]);
    assert.equal(mine.activity.length, 1);
    assert.deepEqual([mine.activity[0].kind, mine.activity[0].amount, mine.activity[0].task_label], ['usage', 16, '語音轉文字']);
  });

  test('a reservation that does not fit is refused with the balance', async () => {
    const res = await reserve({ task_type: 'echo.transcribe', units: 30, idempotency_key: 'idem-0004' });
    assert.equal(res.status, 201);
    const refused = await reserve({ task_type: 'echo.transcribe', units: 30, idempotency_key: 'idem-0005' });
    assert.equal(refused.status, 409);
    const body = await refused.json();
    assert.equal(body.error.code, 'BATTERY_INSUFFICIENT');
    assert.equal(body.balance.remaining, 24);
  });
});
