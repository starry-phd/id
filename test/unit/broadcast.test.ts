// App-wide broadcast (ADR 0009): audience, chunking onto the queue, per-chunk sending and counters, redelivery safety.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { NotifyMessage } from '../../src/env';
import { audienceSize, BROADCAST_CHUNK, processBroadcastChunk, recentBroadcasts, startBroadcast } from '../../src/notify/broadcast';
import { registerPushToken, setPreferences, type FetchLike } from '../../src/notify/push';
import { ANNOUNCEMENT_CATEGORY } from '../../src/notify/bulk';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const token = (n: number) => `ExponentPushToken[broadcast${String(n).padStart(5, '0')}]`;

async function addUser(d: D1Database, id: string, status = 'active'): Promise<void> {
  await d.prepare('INSERT INTO users (user_id, status, created_at, updated_at, status_changed_at, session_version) VALUES (?, ?, ?, ?, ?, 1)').bind(id, status, NOW, NOW, NOW).run();
}

function fakeQueue(): { queue: Queue<NotifyMessage>; sent: NotifyMessage[]; batches: number[] } {
  const sent: NotifyMessage[] = [];
  const batches: number[] = [];
  const queue = {
    send: async () => undefined,
    sendBatch: async (messages: Iterable<{ body: NotifyMessage }>) => {
      const list = [...messages];
      batches.push(list.length);
      sent.push(...list.map((m) => m.body));
    },
  } as unknown as Queue<NotifyMessage>;
  return { queue, sent, batches };
}

const okExpo = (log: string[] = []): FetchLike => async (_url, init) => {
  const batch = JSON.parse(String(init?.body)) as { to: string }[];
  log.push(...batch.map((m) => m.to));
  return Response.json({ data: batch.map(() => ({ status: 'ok' })) });
};

describe('broadcast', () => {
  test('the audience is active members with a device in that App only', async () => {
    const d = migratedDb() as unknown as D1Database;
    for (const id of ['a', 'b', 'c']) await addUser(d, id);
    await addUser(d, 'gone', 'suspended');
    await registerPushToken(d, { userId: 'a', appId: 'clock', token: token(1), platform: 'ios' }, NOW);
    await registerPushToken(d, { userId: 'a', appId: 'clock', token: token(2), platform: 'android' }, NOW);
    await registerPushToken(d, { userId: 'b', appId: 'notes', token: token(3), platform: 'ios' }, NOW);
    await registerPushToken(d, { userId: 'gone', appId: 'clock', token: token(4), platform: 'ios' }, NOW);
    assert.equal(await audienceSize(d, 'clock'), 1);
    assert.equal(await audienceSize(d, 'notes'), 1);
    assert.equal(await audienceSize(d, 'none'), 0);
  });

  test('an empty audience starts nothing', async () => {
    const d = migratedDb() as unknown as D1Database;
    const { queue, sent } = fakeQueue();
    assert.deepEqual(await startBroadcast(d, queue, { appId: 'clock', title: 't', body: 'b', actorUserId: 'staff' }, NOW), { ok: false, error: 'empty' });
    assert.equal(sent.length, 0);
    assert.equal((await recentBroadcasts(d)).length, 0);
  });

  test('members are split into chunks of 50, one queue message each, and the counters add up', async () => {
    const d = migratedDb() as unknown as D1Database;
    const total = BROADCAST_CHUNK * 2 + 7;
    for (let i = 0; i < total; i++) {
      const id = `m${String(i).padStart(4, '0')}`;
      await addUser(d, id);
      await registerPushToken(d, { userId: id, appId: 'clock', token: token(i + 100), platform: 'ios' }, NOW);
    }
    await setPreferences(d, 'm0000', 'clock', { [ANNOUNCEMENT_CATEGORY]: false }, NOW);
    const { queue, sent, batches } = fakeQueue();
    const started = await startBroadcast(d, queue, { appId: 'clock', title: '維護', body: '今晚維護', actorUserId: 'staff' }, NOW);
    assert.ok(started.ok);
    assert.equal(started.ok && started.members, total);
    assert.equal(started.ok && started.chunks, 3);
    assert.deepEqual(batches, [3]);
    assert.deepEqual(sent.map((m) => m.userIds.length), [50, 50, 7]);
    assert.deepEqual(sent.map((m) => m.chunk), [0, 1, 2]);
    const log: string[] = [];
    for (const message of sent) assert.equal(await processBroadcastChunk(d, okExpo(log), message, NOW + 1000), 'sent');
    const [row] = await recentBroadcasts(d);
    assert.equal(row?.chunks_done, 3);
    assert.equal(row?.finished_at, NOW + 1000);
    assert.equal(row?.reached, total - 1);
    assert.equal(row?.opted_out, 1);
    assert.equal(row?.failed, 0);
    assert.equal(log.length, total - 1, 'the member who turned announcements off got nothing');
  });

  test('a redelivered chunk is not sent twice or counted twice; an unknown broadcast is ignored', async () => {
    const d = migratedDb() as unknown as D1Database;
    await addUser(d, 'a');
    await registerPushToken(d, { userId: 'a', appId: 'clock', token: token(1), platform: 'ios' }, NOW);
    const { queue, sent } = fakeQueue();
    await startBroadcast(d, queue, { appId: 'clock', title: 't', body: 'b', actorUserId: 'staff' }, NOW);
    const log: string[] = [];
    assert.equal(await processBroadcastChunk(d, okExpo(log), sent[0]!, NOW), 'sent');
    assert.equal(await processBroadcastChunk(d, okExpo(log), sent[0]!, NOW), 'duplicate');
    assert.equal(log.length, 1);
    assert.equal((await recentBroadcasts(d))[0]?.reached, 1);
    assert.equal(await processBroadcastChunk(d, okExpo(log), { broadcastId: 'nope', chunk: 0, userIds: ['a'] }, NOW), 'missing');
  });

  test('a push service error is counted as failed and the broadcast still finishes', async () => {
    const d = migratedDb() as unknown as D1Database;
    await addUser(d, 'a');
    await registerPushToken(d, { userId: 'a', appId: 'clock', token: token(1), platform: 'ios' }, NOW);
    const { queue, sent } = fakeQueue();
    await startBroadcast(d, queue, { appId: 'clock', title: 't', body: 'b', actorUserId: 'staff' }, NOW);
    await processBroadcastChunk(d, async () => new Response('down', { status: 503 }), sent[0]!, NOW + 5);
    const [row] = await recentBroadcasts(d);
    assert.equal(row?.failed, 1);
    assert.equal(row?.finished_at, NOW + 5);
  });

  test('when the queue refuses the messages the record is removed', async () => {
    const d = migratedDb() as unknown as D1Database;
    await addUser(d, 'a');
    await registerPushToken(d, { userId: 'a', appId: 'clock', token: token(1), platform: 'ios' }, NOW);
    const broken = { sendBatch: async () => { throw new Error('queue down'); } } as unknown as Queue<NotifyMessage>;
    assert.deepEqual(await startBroadcast(d, broken, { appId: 'clock', title: 't', body: 'b', actorUserId: 'staff' }, NOW), { ok: false, error: 'queue_failed' });
    assert.equal((await recentBroadcasts(d)).length, 0);
  });
});
