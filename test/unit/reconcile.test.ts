// Unit tests for the daily RevenueCat reconciliation (S-BIL-04).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { entitlementsFromSubscriber, reconcileWithRevenueCat, type RcSubscriber } from '../../src/billing/reconcile';
import { activeEntitlements, forgetMembers } from '../../src/billing/revenuecat';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 3, 4, 0, 0);
const A = '01900000-0000-7000-8000-00000000000a';
const B = '01900000-0000-7000-8000-00000000000b';
type Db = ReturnType<typeof migratedDb>;
const asD1 = (db: Db) => db as unknown as D1Database;
const iso = (ms: number) => new Date(ms).toISOString();

function projection(db: Db, userId: string, entitlement: string, active: boolean, expiresAt: number | null, lifetime: string | null = null) {
  return db
    .prepare(
      `INSERT INTO entitlements (user_id, app_id, entitlement, active, expires_at, product_id, lifetime_product_id, store, environment, last_event_ms, updated_at)
       VALUES (?, 'echo', ?, ?, ?, 'p', ?, 'APP_STORE', 'PRODUCTION', ?, ?)`,
    )
    .bind(userId, entitlement, active ? 1 : 0, expiresAt, lifetime, NOW - 1000, NOW - 1000)
    .run();
}

function fakeRevenueCat(customers: Record<string, RcSubscriber | number>) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
    const id = decodeURIComponent(url.split('/').pop() ?? '');
    const customer = customers[id];
    if (typeof customer === 'number') return new Response('{}', { status: customer });
    return Response.json({ subscriber: customer ?? { entitlements: {} } });
  };
  return { calls, fetchFn };
}

describe('RevenueCat customer to projection', () => {
  test('active, expired, grace period and lifetime entitlements', () => {
    const rows = entitlementsFromSubscriber(
      {
        entitlements: {
          pro: { expires_date: iso(NOW + 86_400_000), product_identifier: 'monthly' },
          old: { expires_date: iso(NOW - 86_400_000), product_identifier: 'monthly' },
          grace: { expires_date: iso(NOW - 1000), grace_period_expires_date: iso(NOW + 3_600_000), product_identifier: 'yearly' },
          forever: { expires_date: null, product_identifier: 'lifetime' },
        },
        subscriptions: { monthly: { store: 'app_store', is_sandbox: false }, yearly: { store: 'play_store', is_sandbox: true } },
        non_subscriptions: { lifetime: [{ store: 'app_store', is_sandbox: false }] },
      },
      NOW,
    );
    const by = Object.fromEntries(rows.map((r) => [r.entitlement, r]));
    assert.deepEqual([by.pro?.active, by.old?.active, by.grace?.active, by.forever?.active], [true, false, true, true]);
    assert.equal(by.grace?.expiresAt, NOW + 3_600_000);
    assert.deepEqual([by.forever?.expiresAt, by.forever?.lifetimeProductId], [null, 'lifetime']);
    assert.deepEqual([by.pro?.store, by.pro?.environment, by.grace?.environment], ['APP_STORE', 'PRODUCTION', 'SANDBOX']);
  });
});

describe('daily reconciliation', () => {
  test('repairs a missed purchase, a missed expiry and an entitlement RevenueCat no longer has', async () => {
    const db = migratedDb('migrations/billing');
    const d = asD1(db);
    await projection(db, A, 'pro', true, NOW + 86_400_000); // RevenueCat says it expired (missed EXPIRATION webhook)
    await projection(db, A, 'gone', true, NOW + 86_400_000); // RevenueCat does not know it at all
    await db.prepare("INSERT INTO rc_events (event_id, app_id, app_user_id, type, event_timestamp_ms, payload, received_at) VALUES ('e1', 'echo', ?, 'TEST', ?, '{}', ?)").bind(B, NOW, NOW).run();
    const { calls, fetchFn } = fakeRevenueCat({
      [A]: { entitlements: { pro: { expires_date: iso(NOW - 60_000), product_identifier: 'p' } } },
      [B]: { entitlements: { pro: { expires_date: null, product_identifier: 'lifetime' } } }, // missed purchase
    });
    const report = await reconcileWithRevenueCat(d, { echo: 'sk_echo' }, fetchFn, NOW);
    assert.deepEqual(report, { checked: 2, fixed: 2, errors: 0, rateLimited: false });
    assert.ok(calls.every((c) => c.auth === 'Bearer sk_echo'));
    assert.deepEqual(await activeEntitlements(d, A, 'echo', NOW), []);
    assert.deepEqual((await activeEntitlements(d, B, 'echo', NOW)).map((e) => [e.entitlement, e.expires_at]), [['pro', null]]);

    const again = await reconcileWithRevenueCat(d, { echo: 'sk_echo' }, fetchFn, NOW + 1000);
    assert.deepEqual(again, { checked: 2, fixed: 0, errors: 0, rateLimited: false }, 'a second pass finds nothing to fix');
  });

  test('errors leave the projection alone; rate limits stop the run; oldest checks go first', async () => {
    const db = migratedDb('migrations/billing');
    const d = asD1(db);
    await projection(db, A, 'pro', true, NOW + 86_400_000);
    await projection(db, B, 'pro', true, NOW + 86_400_000);
    const failing = fakeRevenueCat({ [A]: 500, [B]: 500 });
    assert.deepEqual(await reconcileWithRevenueCat(d, { echo: 'k' }, failing.fetchFn, NOW), { checked: 2, fixed: 0, errors: 2, rateLimited: false });
    assert.equal((await activeEntitlements(d, A, 'echo', NOW)).length, 1, 'a failed lookup never removes access');

    await db.prepare('UPDATE reconcile_state SET checked_at = ? WHERE user_id = ?').bind(NOW - 5000, B).run();
    const limited = fakeRevenueCat({ [A]: 429, [B]: 429 });
    const report = await reconcileWithRevenueCat(d, { echo: 'k' }, limited.fetchFn, NOW + 1, 1);
    assert.deepEqual(report, { checked: 0, fixed: 0, errors: 0, rateLimited: true });
    assert.ok(limited.calls[0]?.url.endsWith(B), 'the pair checked longest ago is first');
  });

  test('Apps without an API key are skipped; purged members are never looked up', async () => {
    const db = migratedDb('migrations/billing');
    const d = asD1(db);
    await projection(db, A, 'pro', true, null, 'lifetime');
    assert.deepEqual(await reconcileWithRevenueCat(d, {}, fakeRevenueCat({}).fetchFn, NOW), { checked: 0, fixed: 0, errors: 0, rateLimited: false });
    await reconcileWithRevenueCat(d, { echo: 'k' }, fakeRevenueCat({ [A]: { entitlements: { pro: { expires_date: null, product_identifier: 'lifetime' } } } }).fetchFn, NOW);
    await forgetMembers(d, [A], ['echo'], NOW);
    const after = fakeRevenueCat({});
    assert.equal((await reconcileWithRevenueCat(d, { echo: 'k' }, after.fetchFn, NOW + 1)).checked, 0);
    assert.equal(after.calls.length, 0);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM reconcile_state').first('n')) ?? 0), 0);
  });
});
