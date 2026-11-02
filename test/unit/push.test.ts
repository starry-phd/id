// Unit tests for push token storage, category opt-outs and Expo delivery (S-NTF-01).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { findOrCreateMember } from '../../src/identity/members';
import { getPreferences, isCategory, isPushToken, registerPushToken, sendPush, setPreferences, unregisterPushToken, type FetchLike } from '../../src/notify/push';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const T1 = 'ExponentPushToken[abcdefghij123]';
const T2 = 'ExpoPushToken[zyxwvutsrq987]';

async function setup() {
  const db = migratedDb();
  const d = db as unknown as D1Database;
  const a = (await findOrCreateMember(d, { provider: 'google', subject: 'p-a', email: null, isPrivateRelay: false }, { appId: 'echo', requestId: null }, NOW)).member.user_id;
  const b = (await findOrCreateMember(d, { provider: 'google', subject: 'p-b', email: null, isPrivateRelay: false }, { appId: 'echo', requestId: null }, NOW)).member.user_id;
  return { db, d, a, b };
}

describe('push notifications (S-NTF-01)', () => {
  test('validates token and category formats', () => {
    assert.equal(isPushToken(T1), true);
    assert.equal(isPushToken(T2), true);
    assert.equal(isPushToken('fcm-raw-token'), false);
    assert.equal(isCategory('reminders'), true);
    assert.equal(isCategory('Bad Category'), false);
  });

  test('a device token moves to whoever signs in on it; only the owner can remove it', async () => {
    const { db, d, a, b } = await setup();
    await registerPushToken(d, { userId: a, appId: 'echo', token: T1, platform: 'ios' }, NOW);
    await registerPushToken(d, { userId: b, appId: 'echo', token: T1, platform: 'ios' }, NOW + 1);
    assert.equal((await db.prepare('SELECT user_id FROM push_tokens WHERE token = ?').bind(T1).first())?.user_id, b);
    assert.equal(await unregisterPushToken(d, a, T1), false);
    assert.equal(await unregisterPushToken(d, b, T1), true);
  });

  test('sends to every device, honours opt-outs and inactive members, drops dead tokens', async () => {
    const { db, d, a } = await setup();
    await registerPushToken(d, { userId: a, appId: 'echo', token: T1, platform: 'ios' }, NOW);
    await registerPushToken(d, { userId: a, appId: 'echo', token: T2, platform: 'android' }, NOW);
    const bodies: unknown[] = [];
    const expo: FetchLike = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ data: [{ status: 'ok', id: '1' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] });
    };
    const message = { userId: a, appId: 'echo', category: 'reminders', title: '提醒', body: '今天的回聲已準備好' };
    assert.deepEqual(await sendPush(d, expo, message), { sent: 1, skipped: null, removed: 1 });
    assert.equal((bodies[0] as unknown[]).length, 2);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM push_tokens').first())?.n), 1);
    await setPreferences(d, a, 'echo', { reminders: false }, NOW);
    assert.deepEqual(await getPreferences(d, a, 'echo'), { reminders: false });
    assert.deepEqual(await sendPush(d, expo, message), { sent: 0, skipped: 'opted_out', removed: 0 });
    assert.deepEqual(await sendPush(d, expo, { ...message, appId: 'other' }), { sent: 0, skipped: 'no_devices', removed: 0 });
    await db.prepare("UPDATE users SET status = 'suspended' WHERE user_id = ?").bind(a).run();
    assert.deepEqual(await sendPush(d, expo, { ...message, category: 'news' }), { sent: 0, skipped: 'inactive', removed: 0 });
  });
});
