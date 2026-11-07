import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { listSurgeLimits, runSurgeGuard, setSurgeLimit, surgeAlertEmail, alertRecipients } from '../../src/apps/surge';
import { clearAppStatusCache, withEffectiveStatus } from '../../src/apps/status';
import { activeScopedNotices, addScopedNotice, deleteScopedNotice, listScopedNotices, parseTaipeiLocal } from '../../src/lib/scoped-notices';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const HOUR = 3600 * 1000;
const actor = { userId: 'owner1', requestId: null };

describe('scoped announcements', () => {
  test('Taipei local time parses to UTC and bad dates are refused', () => {
    assert.equal(parseTaipeiLocal('2026-11-08T09:30'), Date.UTC(2026, 10, 8, 1, 30));
    assert.equal(parseTaipeiLocal('2026-02-30T09:30'), null);
    assert.equal(parseTaipeiLocal('hello'), null);
  });

  test('an announcement shows only inside its window and only for its App', async () => {
    const d = migratedDb('migrations/identity') as unknown as D1Database;
    assert.deepEqual(await addScopedNotice(d, { appId: 'echo', message: '明天維護', startsAt: NOW + HOUR, endsAt: NOW + 3 * HOUR }, actor, NOW), { ok: true });
    await addScopedNotice(d, { appId: null, message: '全站公告', startsAt: NOW - HOUR, endsAt: NOW + HOUR }, actor, NOW);
    assert.deepEqual((await activeScopedNotices(d, NOW, 'echo')).map((n) => n.message), ['全站公告'], 'not started yet');
    assert.deepEqual((await activeScopedNotices(d, NOW + 2 * HOUR, 'echo')).map((n) => n.message), ['明天維護']);
    assert.deepEqual(await activeScopedNotices(d, NOW + 2 * HOUR, 'recordnote'), [], 'other App unaffected');
    assert.deepEqual((await activeScopedNotices(d, NOW)).map((n) => n.message), ['全站公告'], 'account center shows all-App ones only');
    assert.equal((await listScopedNotices(d, NOW)).length, 2);
    assert.equal((await listScopedNotices(d, NOW + 4 * HOUR)).length, 0, 'ended ones drop out');
  });

  test('bad input is refused and a notice can be deleted', async () => {
    const d = migratedDb('migrations/identity') as unknown as D1Database;
    assert.equal((await addScopedNotice(d, { appId: null, message: '  ', startsAt: NOW, endsAt: NOW + HOUR }, actor, NOW)).ok, false);
    assert.equal((await addScopedNotice(d, { appId: null, message: 'x', startsAt: NOW, endsAt: NOW - 1 }, actor, NOW)).ok, false);
    assert.equal((await addScopedNotice(d, { appId: null, message: 'x', startsAt: NOW - 2 * HOUR, endsAt: NOW - HOUR }, actor, NOW)).ok, false, 'already over');
    assert.equal((await addScopedNotice(d, { appId: null, message: 'x'.repeat(501), startsAt: NOW, endsAt: NOW + HOUR }, actor, NOW)).ok, false);
    await addScopedNotice(d, { appId: null, message: 'ok', startsAt: NOW, endsAt: NOW + HOUR }, actor, NOW);
    const id = (await listScopedNotices(d, NOW))[0]!.notice_id;
    assert.equal(await deleteScopedNotice(d, id, actor, NOW), true);
    assert.equal(await deleteScopedNotice(d, id, actor, NOW), false);
  });
});

describe('surge guard', () => {
  async function setup(count: number) {
    const identity = migratedDb('migrations/identity');
    const battery = migratedDb('migrations/battery');
    for (let i = 0; i < count; i++) {
      await battery
        .prepare("INSERT INTO battery_reservations (reservation_id, user_id, app_id, task_type, idempotency_key, units, amount, status, period, created_at, expires_at) VALUES (?, 'u', 'echo', 'echo_task', ?, 1, 1, 'released', '2026-11', ?, ?)")
        .bind(`r${i}`, `idem-key-${i}`, NOW - 60_000, NOW + 60_000)
        .run();
    }
    return { identity: identity as unknown as D1Database, battery: battery as unknown as D1Database };
  }

  test('limits validate and can be removed', async () => {
    const { identity } = await setup(0);
    assert.equal(await setSurgeLimit(identity, actor, 'echo', 0, NOW), false);
    assert.equal(await setSurgeLimit(identity, actor, 'echo', 5, NOW), true);
    assert.equal((await listSurgeLimits(identity)).get('echo')?.hourly_limit, 5);
    assert.equal(await setSurgeLimit(identity, actor, 'echo', null, NOW), true);
    assert.equal((await listSurgeLimits(identity)).size, 0);
  });

  test('over the limit pauses the App once, with an audit entry; under it does nothing', async () => {
    const { identity, battery } = await setup(6);
    await setSurgeLimit(identity, actor, 'echo', 10, NOW);
    assert.deepEqual(await runSurgeGuard({ identity, battery }, NOW), []);
    await setSurgeLimit(identity, actor, 'echo', 5, NOW);
    const hits = await runSurgeGuard({ identity, battery }, NOW);
    assert.deepEqual(hits, [{ appId: 'echo', count: 6, limit: 5 }]);
    clearAppStatusCache();
    const app = { app_id: 'echo', status: 'active' } as never;
    assert.equal((await withEffectiveStatus(identity, app, NOW)).status, 'paused');
    const audit = await identity.prepare("SELECT actor_type FROM audit_log WHERE action = 'system.surge_pause'").first<{ actor_type: string }>();
    assert.equal(audit?.actor_type, 'system');
    assert.deepEqual(await runSurgeGuard({ identity, battery }, NOW + 1000), [], 'old numbers do not pause it again after a restore');
  });

  test('the alert names the App and goes to support plus owners and admins once each', async () => {
    const { identity } = await setup(0);
    const mail = { sender: { send: async () => ({ messageId: 'm' }) }, from: { email: 'f@x.tw' }, supportAddress: 'support@x.tw', baseUrl: 'https://id.example' };
    const to = await alertRecipients(identity, mail, 'o1,a1');
    assert.deepEqual(to, ['support@x.tw'], 'members without a contact email add nothing');
    const m = surgeAlertEmail(mail, 'support@x.tw', { appId: 'echo', appName: 'Echo App', count: 6, limit: 5 });
    assert.match(m.subject, /Echo App/);
    assert.match(m.text, /https:\/\/id\.example\/admin\/apps/);
  });
});
