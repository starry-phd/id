import { auditStatement } from '../lib/audit';

/**
 * Legacy: before 2026-11-07 deletion waited 7 days. Deletion is now immediate (deleteMemberNow); this only
 * remains so accounts already waiting are still purged on their original schedule.
 */
export const DELETION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

interface Actor {
  userId: string;
  appId: string | null;
  requestId: string | null;
}

export type DeletionRequestResult = { ok: true; purgeAt: number } | { ok: false; reason: 'not_active' | 'not_found' };

/**
 * Starts the deletion grace period: the account is disabled at once (all sessions end,
 * every App rejects old tokens) and is purged after DELETION_GRACE_MS.
 */
export async function requestDeletion(db: D1Database, actor: Actor, now: number): Promise<DeletionRequestResult> {
  const row = await db.prepare('SELECT status FROM users WHERE user_id = ?').bind(actor.userId).first<{ status: string }>();
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.status !== 'active') return { ok: false, reason: 'not_active' };
  const [update] = await db.batch([
    db
      .prepare(
        `UPDATE users SET status = 'pending_deletion', deletion_requested_at = ?, status_changed_at = ?,
           session_version = session_version + 1, updated_at = ?
         WHERE user_id = ? AND status = 'active'`,
      )
      .bind(now, now, now, actor.userId),
    db
      .prepare("UPDATE sessions SET revoked_at = ?, revoke_reason = 'deletion_requested' WHERE user_id = ? AND revoked_at IS NULL")
      .bind(now, actor.userId),
    auditStatement(db, { actorType: 'user', actorUserId: actor.userId, action: 'account.deletion_requested', targetType: 'user', targetId: actor.userId, appId: actor.appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  if (update?.meta.changes !== 1) return { ok: false, reason: 'not_active' };
  return { ok: true, purgeAt: now + DELETION_GRACE_MS };
}

/** Cancels a pending deletion; only possible before the purge ran. */
export async function cancelDeletion(db: D1Database, actor: Actor, now: number): Promise<boolean> {
  const update = await db
    .prepare(
      `UPDATE users SET status = 'active', deletion_requested_at = NULL, status_changed_at = ?, updated_at = ?
       WHERE user_id = ? AND status = 'pending_deletion'`,
    )
    .bind(now, now, actor.userId)
    .run();
  if (update.meta.changes !== 1) return false;
  await auditStatement(db, { actorType: 'user', actorUserId: actor.userId, action: 'account.deletion_cancelled', targetType: 'user', targetId: actor.userId, appId: actor.appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  return true;
}

export interface PurgeResult {
  purgedUserIds: string[];
  /** R2 keys of avatars that belonged to purged members; the caller deletes the objects. */
  avatarKeys: string[];
}

/**
 * Permanently removes members whose grace period ended. Identities, sessions, profile,
 * consents and roles go with the user row (ON DELETE CASCADE); audit rows stay, keyed only
 * by the random member ID. Apple tokens move to the revocation queue first.
 */
export async function purgeExpiredDeletions(db: D1Database, now: number, limit = 25): Promise<PurgeResult> {
  const due = await db
    .prepare(
      `SELECT u.user_id, p.avatar_key FROM users u LEFT JOIN profiles p ON p.user_id = u.user_id
       WHERE u.status = 'pending_deletion' AND u.deletion_requested_at <= ?
       ORDER BY u.deletion_requested_at LIMIT ?`,
    )
    .bind(now - DELETION_GRACE_MS, limit)
    .all<{ user_id: string; avatar_key: string | null }>();
  const result: PurgeResult = { purgedUserIds: [], avatarKeys: [] };
  const cutoff = now - DELETION_GRACE_MS;
  // Every step re-checks that the member is still due, inside one transaction,
  // so a cancellation that lands between the SELECT and the batch always wins.
  const STILL_DUE = "EXISTS (SELECT 1 FROM users WHERE user_id = ? AND status = 'pending_deletion' AND deletion_requested_at <= ?)";
  for (const row of due.results) {
    const [, , deleted] = await db.batch([
      db
        .prepare(
          `INSERT INTO apple_revocations (revocation_id, client_id, refresh_token_enc, next_attempt_at, created_at)
           SELECT lower(hex(randomblob(16))), client_id, refresh_token_enc, ?, ? FROM apple_tokens
           WHERE user_id = ? AND ${STILL_DUE}`,
        )
        .bind(now, now, row.user_id, row.user_id, cutoff),
      db
        .prepare(
          `INSERT OR IGNORE INTO retired_member_numbers (member_no, retired_at)
           SELECT member_no, ? FROM users WHERE user_id = ? AND member_no IS NOT NULL AND status = 'pending_deletion' AND deletion_requested_at <= ?`,
        )
        .bind(now, row.user_id, cutoff),
      db.prepare("DELETE FROM users WHERE user_id = ? AND status = 'pending_deletion' AND deletion_requested_at <= ?").bind(row.user_id, cutoff),
    ]);
    if (deleted?.meta.changes !== 1) continue;
    await auditStatement(db, { actorType: 'system', action: 'account.purged', targetType: 'user', targetId: row.user_id, result: 'success', retention: 'security' }, now).run();
    result.purgedUserIds.push(row.user_id);
    if (row.avatar_key) result.avatarKeys.push(row.avatar_key);
  }
  return result;
}

export type DeleteNowResult = { ok: true; avatarKey: string | null; memberNo: string | null } | { ok: false; reason: 'not_found' };

/**
 * Deletes a member for good, right now (owner decision 2026-11-07: no waiting period). Identities, sessions,
 * profile, consents, roles and tickets go with the user row (ON DELETE CASCADE); Apple tokens move to the
 * revocation queue; the member number is retired so it is never issued again; the audit row keeps only the
 * random member ID. The caller then removes the avatar object and the billing / Battery rows (cleanupAfterDeletion).
 * `staffId` is set when an Owner deletes the member from Admin Lite.
 */
export async function deleteMemberNow(db: D1Database, actor: Actor & { staffId?: string }, now: number): Promise<DeleteNowResult> {
  const row = await db
    .prepare('SELECT u.member_no, p.avatar_key FROM users u LEFT JOIN profiles p ON p.user_id = u.user_id WHERE u.user_id = ?')
    .bind(actor.userId)
    .first<{ member_no: string | null; avatar_key: string | null }>();
  if (!row) return { ok: false, reason: 'not_found' };
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO apple_revocations (revocation_id, client_id, refresh_token_enc, next_attempt_at, created_at)
         SELECT lower(hex(randomblob(16))), client_id, refresh_token_enc, ?, ? FROM apple_tokens WHERE user_id = ?`,
      )
      .bind(now, now, actor.userId),
    db
      .prepare('INSERT OR IGNORE INTO retired_member_numbers (member_no, retired_at) SELECT member_no, ? FROM users WHERE user_id = ? AND member_no IS NOT NULL')
      .bind(now, actor.userId),
    db.prepare('DELETE FROM users WHERE user_id = ?').bind(actor.userId),
    auditStatement(
      db,
      actor.staffId
        ? { actorType: 'admin', actorUserId: actor.staffId, action: 'admin.member_deleted', targetType: 'user', targetId: actor.userId, result: 'success', requestId: actor.requestId, retention: 'security' }
        : { actorType: 'user', actorUserId: actor.userId, action: 'account.deleted', targetType: 'user', targetId: actor.userId, appId: actor.appId, result: 'success', requestId: actor.requestId, retention: 'security' },
      now,
    ),
  ]);
  // D1 counts cascaded rows in meta.changes, so confirm by looking the member up instead.
  if (results.length < 4 || (await db.prepare('SELECT 1 AS present FROM users WHERE user_id = ?').bind(actor.userId).first())) return { ok: false, reason: 'not_found' };
  return { ok: true, avatarKey: row.avatar_key, memberNo: row.member_no };
}
