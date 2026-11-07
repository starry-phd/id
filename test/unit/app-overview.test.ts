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
    assert.deepEqual(map.get('recordnote'), { members: 3, day: 1, week: 1, month: 2, entitlements: 1, batteryUsed: 0, batteryCap: 500, batteryUsed24h: 0, openTickets: 0, hourlyLimit: null, minVersionOverride: null });
    assert.equal(periodOf(NOW).length > 0, true);
  });
  test('adds the last 24 hours, open tickets, the surge limit and a remote-config minimum version', async () => {
    const identity = migratedDb('migrations/identity');
    const billing = migratedDb('migrations/billing');
    const battery = migratedDb('migrations/battery');
    await identity.prepare("INSERT INTO users (user_id, status, created_at, updated_at, status_changed_at, session_version) VALUES ('a', 'active', ?, ?, ?, 1)").bind(NOW, NOW, NOW).run();
    await identity.prepare('INSERT INTO member_apps (user_id, app_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)').bind('a', 'clock', NOW - 5 * DAY, NOW - 3600_000).run();
    const reservation = (id: string, status: string, charged: number | null, at: number) =>
      battery.prepare('INSERT INTO battery_reservations (reservation_id, user_id, app_id, task_type, idempotency_key, units, amount, status, charged, period, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)').bind(id, 'a', 'clock', 't', `key-${id}-123456`, 4, status, charged, periodOf(NOW), at, at + 60_000).run();
    await reservation('r1', 'committed', 3, NOW - 3600_000);
    await reservation('r2', 'reserved', null, NOW - 2 * 3600_000);
    await reservation('r3', 'released', 2, NOW - 3600_000);
    await reservation('r4', 'committed', 9, NOW - 3 * DAY);
    const ticket = (id: string, app: string | null, status: string) =>
      identity.prepare("INSERT INTO support_tickets (ticket_id, created_at, user_id, contact_email, category, app_id, message, status, updated_at) VALUES (?, ?, NULL, 'x@example.com', 'question', ?, 'm', ?, ?)").bind(id, NOW, app, status, NOW).run();
    await ticket('t1', 'clock', 'open');
    await ticket('t2', 'clock', 'closed');
    await ticket('t3', null, 'open');
    await identity.prepare('INSERT INTO app_surge_limits (app_id, hourly_limit, updated_at) VALUES (?, 500, ?)').bind('clock', NOW).run();
    await identity.prepare("INSERT INTO app_config_overrides (app_id, key, value, updated_at, updated_by) VALUES ('clock', 'min_version', '\"2.1.0\"', ?, 'o')").bind(NOW).run();
    await identity.prepare("INSERT INTO app_config_overrides (app_id, key, value, updated_at, updated_by) VALUES ('notes', 'min_version', '42', ?, 'o')").bind(NOW).run();
    const map = await appOverview({ identity: identity as unknown as D1Database, billing: billing as unknown as D1Database, battery: battery as unknown as D1Database }, NOW);
    const clock = map.get('clock');
    assert.equal(clock?.day, 1);
    assert.equal(clock?.batteryUsed24h, 3 + 4, 'committed (charged) plus reserved (amount) in the last day; released and old ones excluded');
    assert.equal(clock?.batteryUsed, 3 + 4 + 9, 'the month still counts the older committed one');
    assert.equal(clock?.openTickets, 1, 'closed and App-less tickets are not counted');
    assert.equal(clock?.hourlyLimit, 500);
    assert.equal(clock?.minVersionOverride, '2.1.0');
    assert.equal(map.get('notes')?.minVersionOverride ?? null, null, 'a non-text value is ignored');
  });
});
