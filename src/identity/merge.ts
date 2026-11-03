import { forgetBatteryMembers } from '../battery/battery';
import { auditStatement } from '../lib/audit';
import { randomToken } from '../lib/crypto';
import type { VerifiedIdentity } from './link';
import { ownerIds } from './roles';

/**
 * Spec S-ID-02, amended 2026-11-03 at the owner's request: a person who first signed in with
 * Google and later, separately, with Apple ends up with two Starry accounts. When they link
 * the second sign-in from the first account (proving both), the duplicate account can be
 * merged: its sign-in moves over, its support tickets follow, and the rest of it is deleted.
 *
 * Merging is refused when it could lose something that matters: the duplicate holds a staff
 * role, is suspended (merging would lift it), has another sign-in still attached, or has any
 * purchase (RevenueCat keys purchases to the member ID, so support must move them).
 */
export type MergeBlocker = 'already_has_provider' | 'staff' | 'suspended' | 'other_sign_in' | 'purchases';

export interface MergeCandidate {
  userId: string;
  createdAt: number;
  displayName: string | null;
}

/** The other member holding this identity and whether it can merge into `intoUserId`; null if none. */
export async function findMergeCandidate(
  db: D1Database,
  billing: D1Database,
  ownerUserIds: string | undefined,
  intoUserId: string,
  identity: Pick<VerifiedIdentity, 'provider' | 'subject'>,
): Promise<{ candidate: MergeCandidate; blocker: MergeBlocker | null } | null> {
  const holder = await db
    .prepare(
      `SELECT u.user_id, u.status, u.created_at, p.display_name FROM auth_identities a
       JOIN users u ON u.user_id = a.user_id LEFT JOIN profiles p ON p.user_id = u.user_id
       WHERE a.provider = ? AND a.subject = ?`,
    )
    .bind(identity.provider, identity.subject)
    .first<{ user_id: string; status: string; created_at: number; display_name: string | null }>();
  if (!holder || holder.user_id === intoUserId) return null;
  const [sameProvider, others, role, purchases] = await Promise.all([
    db.prepare('SELECT 1 AS present FROM auth_identities WHERE user_id = ? AND provider = ?').bind(intoUserId, identity.provider).first(),
    db
      .prepare('SELECT COUNT(*) AS n FROM auth_identities WHERE user_id = ? AND NOT (provider = ? AND subject = ?)')
      .bind(holder.user_id, identity.provider, identity.subject)
      .first<{ n: number }>(),
    db.prepare('SELECT 1 AS present FROM user_roles WHERE user_id = ?').bind(holder.user_id).first(),
    billing
      .prepare('SELECT (SELECT COUNT(*) FROM entitlements WHERE user_id = ?) + (SELECT COUNT(*) FROM rc_events WHERE app_user_id = ?) AS n')
      .bind(holder.user_id, holder.user_id)
      .first<{ n: number }>(),
  ]);
  let blocker: MergeBlocker | null = null;
  if (sameProvider) blocker = 'already_has_provider';
  else if (role || ownerIds(ownerUserIds).has(holder.user_id)) blocker = 'staff';
  else if (holder.status === 'suspended') blocker = 'suspended';
  else if ((others?.n ?? 0) > 0) blocker = 'other_sign_in';
  else if ((purchases?.n ?? 0) > 0) blocker = 'purchases';
  return { candidate: { userId: holder.user_id, createdAt: holder.created_at, displayName: holder.display_name }, blocker };
}

/**
 * Moves the identity (and its Apple token) from `fromUserId` to the actor, moves the
 * duplicate's support tickets, then deletes the duplicate member; its sessions, profile,
 * consents and push tokens go with it (ON DELETE CASCADE). Every step is guarded so that
 * nothing happens if the identity no longer belongs to `fromUserId`. The caller removes the
 * duplicate's Battery rows and avatar file.
 */
export async function mergeInto(
  db: D1Database,
  actor: { userId: string; appId: string | null; requestId: string | null },
  identity: VerifiedIdentity,
  fromUserId: string,
  now: number,
): Promise<{ ok: true; avatarKey: string | null } | { ok: false }> {
  const profile = await db.prepare('SELECT avatar_key FROM profiles WHERE user_id = ?').bind(fromUserId).first<{ avatar_key: string | null }>();
  const heldByDuplicate = 'EXISTS (SELECT 1 FROM auth_identities WHERE provider = ? AND subject = ? AND user_id = ?)';
  // Marks the duplicate only if it still holds the identity when this transaction starts, so the
  // final DELETE removes it only as part of this merge.
  const marker = `merge:${randomToken(9)}`;
  let results: D1Result[];
  try {
    results = await db.batch([
      db.prepare(`UPDATE users SET status_reason = ?, status_changed_at = ? WHERE user_id = ? AND ${heldByDuplicate}`).bind(marker, now, fromUserId, identity.provider, identity.subject, fromUserId),
      db
        .prepare(`UPDATE apple_tokens SET user_id = ?, updated_at = ? WHERE user_id = ? AND subject = ? AND ${heldByDuplicate}`)
        .bind(actor.userId, now, fromUserId, identity.subject, identity.provider, identity.subject, fromUserId),
      db
        .prepare(`UPDATE support_tickets SET user_id = ? WHERE user_id = ? AND ${heldByDuplicate}`)
        .bind(actor.userId, fromUserId, identity.provider, identity.subject, fromUserId),
      db
        .prepare('UPDATE auth_identities SET user_id = ?, email = COALESCE(?, email), email_is_private_relay = ?, last_login_at = ? WHERE provider = ? AND subject = ? AND user_id = ?')
        .bind(actor.userId, identity.email, identity.isPrivateRelay ? 1 : 0, now, identity.provider, identity.subject, fromUserId),
      db
        .prepare('DELETE FROM users WHERE user_id = ? AND status_reason = ? AND NOT EXISTS (SELECT 1 FROM auth_identities WHERE user_id = ?) AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = ?)')
        .bind(fromUserId, marker, fromUserId, fromUserId),
    ]);
  } catch {
    return { ok: false }; // e.g. the member linked this provider meanwhile (one identity per provider)
  }
  const moved = results[3]?.meta.changes === 1;
  const deleted = results[4]?.meta.changes === 1;
  if (!moved) return { ok: false };
  await db.batch([
    auditStatement(db, { actorType: 'user', actorUserId: actor.userId, action: `account.merged.${identity.provider}`, targetType: 'user', targetId: fromUserId, appId: actor.appId, result: deleted ? 'success' : 'error', requestId: actor.requestId, retention: 'security' }, now),
    auditStatement(db, { actorType: 'user', actorUserId: actor.userId, action: `account.identity_linked.${identity.provider}`, targetType: 'user', targetId: actor.userId, appId: actor.appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  return { ok: true, avatarKey: deleted ? (profile?.avatar_key ?? null) : null };
}

/** Merge plus the clean-up outside the identity database: the duplicate's Battery rows and avatar file. */
export async function completeMerge(
  deps: { db: D1Database; battery: D1Database; avatars?: { delete(key: string): Promise<void> } },
  actor: { userId: string; appId: string | null; requestId: string | null },
  identity: VerifiedIdentity,
  fromUserId: string,
  now: number,
): Promise<boolean> {
  const merged = await mergeInto(deps.db, actor, identity, fromUserId, now);
  if (!merged.ok) return false;
  await forgetBatteryMembers(deps.battery, [fromUserId]);
  if (merged.avatarKey && deps.avatars) await deps.avatars.delete(merged.avatarKey).catch(() => undefined);
  return true;
}
