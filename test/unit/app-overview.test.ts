import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { appOverview } from '../../src/apps/overview';
import { periodOf } from '../../src/battery/battery';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe('App overview', () => {
  test('gathers members, activity, entitlements and Battery per App', async () => {
    const identity = migratedDb('migrations/identity');
    const billing = migratedDb('migrations/billing');
    const battery = migratedDb('migrations/battery');
    for (const [u, last] of [['a', NOW - DAY], ['b', NOW - 20 * DAY], ['c', NOW - 90 * DAY]] as const) {
      await identity.prepare("INSERT INTO users (user_id, status, created_at, updated_at, status_changed_at, session_version) VALUES (?, 'active', ?, ?, ?, 1)").bind(u, NOW, NOW, NOW).run();
      await identity.prepare('INSERT INTO member_apps (user_id, app_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)').bind(u, 'recordnote', NOW - 100 * DAY, last).run();
    }
    await billing.prepare("INSERT INTO entitlements (user_id, app_id, entitlement, active, expires_at, last_event_ms, updated_at, environment) VALUES ('a', 'recordnote', 'pro', 1, NULL, 1, 1, 'PRODUCTION'), ('b', 'recordnote', 'pro', 1, NULL, 1, 1, 'SANDBOX')").run();
    await battery.prepare("INSERT INTO battery_app_limits (app_id, monthly_cap, updated_by, updated_at) VALUES ('recordnote', 500, 'o', 1)").run();
    const map = await appOverview({ identity: identity as unknown as D1Database, billing: billing as unknown as D1Database, battery: battery as unknown as D1Database }, NOW);
    assert.deepEqual(map.get('recordnote'), { members: 3, week: 1, month: 2, entitlements: 1, batteryUsed: 0, batteryCap: 500 });
    assert.equal(periodOf(NOW).length > 0, true);
  });
});
