import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { grantEntitlement, GRANT_STORE, listGrants, MAX_ACTIVE_GRANTS, revokeGrant } from '../../src/billing/grants';
import { activeEntitlements, forgetMembers } from '../../src/billing/revenuecat';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const base = { userId: 'u1', appId: 'recordnote', entitlement: 'pro', expiresAt: NOW + 30 * DAY, reason: '補償遺失的購買', actorUserId: 'staff' };

describe('entitlement grants', () => {
  test('a grant shows up as an active entitlement until it ends or is revoked', async () => {
    const d = migratedDb('migrations/billing') as unknown as D1Database;
    const r = await grantEntitlement(d, base, NOW);
    assert.equal(r.ok, true);
    const list = await activeEntitlements(d, 'u1', 'recordnote', NOW);
    assert.deepEqual(list, [{ entitlement: 'pro', expires_at: NOW + 30 * DAY, product_id: null, store: GRANT_STORE, environment: null }]);
    assert.deepEqual(await activeEntitlements(d, 'u1', 'recordnote', NOW + 31 * DAY), [], 'ends by itself');
    assert.deepEqual(await activeEntitlements(d, 'u1', 'other', NOW), [], 'other App unaffected');
    const grantId = (await listGrants(d, 'u1', NOW))[0]!.grant_id;
    assert.equal(await revokeGrant(d, 'someone-else', grantId, NOW), null, 'only the owner member');
    assert.deepEqual(await revokeGrant(d, 'u1', grantId, NOW), { appId: 'recordnote', entitlement: 'pro' });
    assert.equal(await revokeGrant(d, 'u1', grantId, NOW), null, 'already ended');
    assert.deepEqual(await activeEntitlements(d, 'u1', 'recordnote', NOW), []);
  });

  test('a purchase and a grant for the same entitlement count once, the longer one wins', async () => {
    const db = migratedDb('migrations/billing');
    const d = db as unknown as D1Database;
    await db
      .prepare("INSERT INTO entitlements (user_id, app_id, entitlement, active, expires_at, product_id, store, environment, last_event_ms, updated_at) VALUES ('u1', 'recordnote', 'pro', 1, ?, 'p1', 'APP_STORE', 'PRODUCTION', ?, ?)")
      .bind(NOW + 5 * DAY, NOW, NOW)
      .run();
    await grantEntitlement(d, base, NOW);
    const [e] = await activeEntitlements(d, 'u1', 'recordnote', NOW);
    assert.equal(e?.store, GRANT_STORE);
    await grantEntitlement(d, { ...base, entitlement: 'plus', expiresAt: null }, NOW);
    await grantEntitlement(d, { ...base, entitlement: 'plus', expiresAt: NOW + DAY }, NOW);
    assert.equal((await activeEntitlements(d, 'u1', 'recordnote', NOW)).find((x) => x.entitlement === 'plus')?.expires_at, null, 'no end date is longest');
  });

  test('input is checked and the number of active grants is capped', async () => {
    const d = migratedDb('migrations/billing') as unknown as D1Database;
    assert.deepEqual(await grantEntitlement(d, { ...base, entitlement: 'bad name!' }, NOW), { ok: false, reason: 'bad_entitlement' });
    assert.deepEqual(await grantEntitlement(d, { ...base, reason: '  ' }, NOW), { ok: false, reason: 'bad_reason' });
    assert.deepEqual(await grantEntitlement(d, { ...base, expiresAt: NOW - 1 }, NOW), { ok: false, reason: 'bad_expiry' });
    for (let i = 0; i < MAX_ACTIVE_GRANTS; i++) assert.equal((await grantEntitlement(d, { ...base, entitlement: `e${i}` }, NOW)).ok, true);
    assert.deepEqual(await grantEntitlement(d, { ...base, entitlement: 'one-too-many' }, NOW), { ok: false, reason: 'too_many' });
  });

  test('grants are removed with the member', async () => {
    const d = migratedDb('migrations/billing') as unknown as D1Database;
    await grantEntitlement(d, base, NOW);
    await grantEntitlement(d, { ...base, userId: 'u2' }, NOW);
    await forgetMembers(d, ['u1'], ['recordnote'], NOW);
    assert.equal((await listGrants(d, 'u1', NOW)).length, 0);
    assert.equal((await listGrants(d, 'u2', NOW)).length, 1);
  });
});
