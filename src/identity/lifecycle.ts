import { auditStatement } from '../lib/audit';

interface Actor {
  userId: string;
  appId: string | null;
  requestId: string | null;
}

export type DeleteNowResult = { ok: true; avatarKey: string | null; memberNo: string | null } | { ok: false; reason: 'not_found' };

/**
 * Deletes a member for good, right now (owner decision 2026-11-07: no waiting period). Identities, sessions,
 * profile, consents, roles and tickets go with the user row (ON DELETE CASCADE); Apple tokens move to the
 * revocation queue; the member number is released for reuse; the audit row keeps only the
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
  if (results.length < 3 || (await db.prepare('SELECT 1 AS present FROM users WHERE user_id = ?').bind(actor.userId).first())) return { ok: false, reason: 'not_found' };
  return { ok: true, avatarKey: row.avatar_key, memberNo: row.member_no };
}
