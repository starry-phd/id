import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { revenueSummary } from '../../src/billing/revenue';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe('revenue summary', () => {
  test('sums real and test purchases apart, counts refunds and ignores old events', async () => {
    const db = migratedDb('migrations/billing');
    const d = db as unknown as D1Database;
    let n = 0;
    const event = async (type: string, env: string, price: number | null, ageDays: number, app = 'recordnote') =>
      db
        .prepare('INSERT INTO rc_events (event_id, app_id, app_user_id, type, environment, event_timestamp_ms, payload, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(`e${++n}`, app, 'u', type, env, NOW - ageDays * DAY, JSON.stringify(price === null ? {} : { price }), NOW)
        .run();
    await event('INITIAL_PURCHASE', 'PRODUCTION', 4.99, 1);
    await event('RENEWAL', 'PRODUCTION', 4.99, 2);
    await event('NON_RENEWING_PURCHASE', 'PRODUCTION', 1.99, 3);
    await event('CANCELLATION', 'PRODUCTION', -1.99, 3);
    await event('EXPIRATION', 'PRODUCTION', null, 4);
    await event('BILLING_ISSUE', 'PRODUCTION', null, 4);
    await event('INITIAL_PURCHASE', 'SANDBOX', 9.99, 1);
    await event('INITIAL_PURCHASE', 'PRODUCTION', 100, 40);
    await db
      .prepare("INSERT INTO entitlements (user_id, app_id, entitlement, active, last_event_ms, updated_at, environment) VALUES ('u1', 'recordnote', 'pro', 1, ?, ?, 'PRODUCTION'), ('u2', 'recordnote', 'pro', 0, ?, ?, 'PRODUCTION')")
      .bind(NOW, NOW, NOW, NOW)
      .run();

    const rows = await revenueSummary(d, NOW - 30 * DAY);
    assert.equal(rows.length, 2);
    const [real, test_] = rows;
    assert.deepEqual(real, { appId: 'recordnote', sandbox: false, newPurchases: 1, renewals: 1, oneTime: 1, cancellations: 1, expirations: 1, billingIssues: 1, revenueUsd: 4.99 + 4.99 + 1.99, refundedUsd: 1.99, activeNow: 1 });
    assert.equal(test_?.sandbox, true);
    assert.equal(test_?.revenueUsd, 9.99);
    assert.equal(test_?.refundedUsd, 0);
  });

  test('no events gives an empty list', async () => {
    assert.deepEqual(await revenueSummary(migratedDb('migrations/billing') as unknown as D1Database, 0), []);
  });
});
