// Staff notification to several members (item 7): per-member outcomes are counted and one failure never stops the rest.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ANNOUNCEMENT_CATEGORY, bulkPush } from '../../src/notify/bulk';
import { registerPushToken, setPreferences, type FetchLike } from '../../src/notify/push';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const token = (n: number) => `ExponentPushToken[bulkdevice${String(n).padStart(4, '0')}]`;

async function addUser(d: D1Database, id: string, status = 'active'): Promise<void> {
  await d.prepare('INSERT INTO users (user_id, status, created_at, updated_at, status_changed_at, session_version) VALUES (?, ?, ?, ?, ?, 1)').bind(id, status, NOW, NOW, NOW).run();
}

describe('bulk push', () => {
  test('counts reached, opted-out, no-device and inactive members; sends only to the chosen App', async () => {
    const d = migratedDb() as unknown as D1Database;
    for (const id of ['reached', 'opted', 'nodev', 'otherapp']) await addUser(d, id);
    await addUser(d, 'gone', 'suspended');
    await registerPushToken(d, { userId: 'reached', appId: 'clock', token: token(1), platform: 'ios' }, NOW);
    await registerPushToken(d, { userId: 'reached', appId: 'clock', token: token(2), platform: 'android' }, NOW);
    await registerPushToken(d, { userId: 'opted', appId: 'clock', token: token(3), platform: 'ios' }, NOW);
    await registerPushToken(d, { userId: 'otherapp', appId: 'notes', token: token(4), platform: 'ios' }, NOW);
    await registerPushToken(d, { userId: 'gone', appId: 'clock', token: token(5), platform: 'ios' }, NOW);
    await setPreferences(d, 'opted', 'clock', { [ANNOUNCEMENT_CATEGORY]: false }, NOW);
    const sent: { to: string; title: string; body: string; channelId: string }[] = [];
    const expo: FetchLike = async (_url, init) => {
      const batch = JSON.parse(String(init?.body)) as typeof sent;
      sent.push(...batch);
      return Response.json({ data: batch.map(() => ({ status: 'ok' })) });
    };
    const summary = await bulkPush(d, expo, ['reached', 'opted', 'nodev', 'otherapp', 'gone', 'reached'], { appId: 'clock', title: '維護', body: '今晚維護' });
    assert.deepEqual(summary, { reached: 1, devices: 2, optedOut: 1, noDevices: 2, inactive: 1, failed: 0, removed: 0 });
    assert.deepEqual(sent.map((m) => m.to).sort(), [token(1), token(2)], 'only the reached member\'s devices in that App; duplicates in the list are sent once');
    assert.ok(sent.every((m) => m.title === '維護' && m.body === '今晚維護' && m.channelId === ANNOUNCEMENT_CATEGORY));
  });

  test('a push service error counts as failed and the other members are still attempted', async () => {
    const d = migratedDb() as unknown as D1Database;
    for (const id of ['a', 'b']) await addUser(d, id);
    await registerPushToken(d, { userId: 'a', appId: 'clock', token: token(11), platform: 'ios' }, NOW);
    await registerPushToken(d, { userId: 'b', appId: 'clock', token: token(12), platform: 'ios' }, NOW);
    let calls = 0;
    const flaky: FetchLike = async (_url, init) => {
      calls += 1;
      if (calls === 1) return new Response('down', { status: 503 });
      return Response.json({ data: JSON.parse(String(init?.body)).map(() => ({ status: 'ok' })) });
    };
    const summary = await bulkPush(d, flaky, ['a', 'b'], { appId: 'clock', title: 't', body: 'b' });
    assert.equal(summary.failed, 1);
    assert.equal(summary.reached, 1);
    assert.equal(calls, 2);
  });

  test('dead tokens reported by Expo are removed and not counted as delivered', async () => {
    const d = migratedDb() as unknown as D1Database;
    await addUser(d, 'a');
    await registerPushToken(d, { userId: 'a', appId: 'clock', token: token(21), platform: 'ios' }, NOW);
    const dead: FetchLike = async () => Response.json({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] });
    const summary = await bulkPush(d, dead, ['a'], { appId: 'clock', title: 't', body: 'b' });
    assert.equal(summary.removed, 1);
    assert.equal(summary.reached, 0);
    assert.equal((await d.prepare('SELECT COUNT(*) AS n FROM push_tokens').first<{ n: number }>())?.n, 0);
  });
});
