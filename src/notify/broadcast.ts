import { uuidv7 } from '../lib/crypto';
import type { NotifyMessage } from '../env';
import { bulkPush, type BulkPushSummary } from './bulk';
import type { FetchLike } from './push';

/** Members per queue message; the same cap the bulk action in the member list uses. */
export const BROADCAST_CHUNK = 50;
/** One broadcast reaches at most this many members (400 queue messages); a larger audience needs a decision first. */
export const BROADCAST_MAX_MEMBERS = 20_000;
const SEND_BATCH = 100;

export interface BroadcastRow {
  broadcast_id: string;
  app_id: string;
  title: string;
  created_by: string;
  created_at: number;
  chunks_total: number;
  chunks_done: number;
  members_total: number;
  reached: number;
  devices: number;
  opted_out: number;
  no_devices: number;
  inactive: number;
  failed: number;
  removed: number;
  finished_at: number | null;
}

/** Active members who have at least one device registered in this App, oldest first. */
export async function broadcastAudience(db: D1Database, appId: string, limit = BROADCAST_MAX_MEMBERS + 1): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT t.user_id FROM push_tokens t JOIN users u ON u.user_id = t.user_id
       WHERE t.app_id = ? AND u.status = 'active' ORDER BY t.user_id LIMIT ?`,
    )
    .bind(appId, limit)
    .all<{ user_id: string }>();
  return rows.results.map((r) => r.user_id);
}

export async function audienceSize(db: D1Database, appId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(DISTINCT t.user_id) AS n FROM push_tokens t JOIN users u ON u.user_id = t.user_id WHERE t.app_id = ? AND u.status = 'active'`)
    .bind(appId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export type StartResult = { ok: true; broadcastId: string; members: number; chunks: number } | { ok: false; error: 'empty' | 'too_many' | 'queue_failed' };

/**
 * Records a broadcast and puts one queue message per chunk of members on the queue. The text is kept in D1 (not in
 * every message) so messages stay small. If the queue refuses the messages the record is removed again, so a
 * broadcast that never started never shows up as unfinished.
 */
export async function startBroadcast(
  db: D1Database,
  queue: Queue<NotifyMessage>,
  input: { appId: string; title: string; body: string; actorUserId: string },
  now: number,
): Promise<StartResult> {
  const audience = await broadcastAudience(db, input.appId);
  if (audience.length === 0) return { ok: false, error: 'empty' };
  if (audience.length > BROADCAST_MAX_MEMBERS) return { ok: false, error: 'too_many' };
  const chunks: string[][] = [];
  for (let i = 0; i < audience.length; i += BROADCAST_CHUNK) chunks.push(audience.slice(i, i + BROADCAST_CHUNK));
  const broadcastId = uuidv7(now);
  await db
    .prepare('INSERT INTO notify_broadcasts (broadcast_id, app_id, title, body, created_by, created_at, chunks_total, members_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(broadcastId, input.appId, input.title, input.body, input.actorUserId, now, chunks.length, audience.length)
    .run();
  try {
    for (let i = 0; i < chunks.length; i += SEND_BATCH) {
      await queue.sendBatch(chunks.slice(i, i + SEND_BATCH).map((userIds, n) => ({ body: { broadcastId, chunk: i + n, userIds } satisfies NotifyMessage })));
    }
  } catch {
    // Chunks already queued find no record and are acknowledged without sending anything.
    await db.batch([db.prepare('DELETE FROM notify_broadcast_chunks WHERE broadcast_id = ?').bind(broadcastId), db.prepare('DELETE FROM notify_broadcasts WHERE broadcast_id = ?').bind(broadcastId)]);
    return { ok: false, error: 'queue_failed' };
  }
  return { ok: true, broadcastId, members: audience.length, chunks: chunks.length };
}

export type ChunkOutcome = 'sent' | 'missing' | 'duplicate';

/**
 * Queue consumer step: sends one chunk and adds its counts to the broadcast. A redelivered message whose chunk is
 * already recorded does nothing, so normal redelivery never sends twice. If the worker dies between sending and
 * recording, the retry can send that one chunk again; a repeated notification is the accepted cost of never losing one.
 */
export async function processBroadcastChunk(
  db: D1Database,
  fetchFn: FetchLike,
  message: NotifyMessage,
  now: number,
  options: { accessToken?: string | undefined } = {},
): Promise<ChunkOutcome> {
  const broadcast = await db.prepare('SELECT app_id, title, body FROM notify_broadcasts WHERE broadcast_id = ?').bind(message.broadcastId).first<{ app_id: string; title: string; body: string }>();
  if (!broadcast) return 'missing';
  const seen = await db.prepare('SELECT 1 AS ok FROM notify_broadcast_chunks WHERE broadcast_id = ? AND chunk_no = ?').bind(message.broadcastId, message.chunk).first();
  if (seen) return 'duplicate';
  const s: BulkPushSummary = await bulkPush(db, fetchFn, message.userIds, { appId: broadcast.app_id, title: broadcast.title, body: broadcast.body }, options);
  const claimed = await db.prepare('INSERT OR IGNORE INTO notify_broadcast_chunks (broadcast_id, chunk_no, done_at) VALUES (?, ?, ?)').bind(message.broadcastId, message.chunk, now).run();
  if (claimed.meta.changes !== 1) return 'duplicate';
  await db
    .prepare(
      `UPDATE notify_broadcasts SET chunks_done = chunks_done + 1, reached = reached + ?, devices = devices + ?, opted_out = opted_out + ?,
         no_devices = no_devices + ?, inactive = inactive + ?, failed = failed + ?, removed = removed + ?,
         finished_at = CASE WHEN chunks_done + 1 >= chunks_total THEN ? ELSE finished_at END
       WHERE broadcast_id = ?`,
    )
    .bind(s.reached, s.devices, s.optedOut, s.noDevices, s.inactive, s.failed, s.removed, now, message.broadcastId)
    .run();
  return 'sent';
}

export async function recentBroadcasts(db: D1Database, limit = 15): Promise<BroadcastRow[]> {
  const rows = await db
    .prepare(
      `SELECT broadcast_id, app_id, title, created_by, created_at, chunks_total, chunks_done, members_total, reached, devices, opted_out,
              no_devices, inactive, failed, removed, finished_at FROM notify_broadcasts ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all<BroadcastRow>();
  return rows.results;
}
