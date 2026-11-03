import { auditStatement } from '../lib/audit';
import { uuidv7 } from '../lib/crypto';
import type { VerifiedIdentity } from './link';
import { PROFILE_SQL, saveProfile, type EditableField, type ProfileRow } from './profile';

export interface MemberRow {
  user_id: string;
  status: 'active' | 'suspended' | 'pending_deletion';
  session_version: number;
  deletion_requested_at: number | null;
}

export function findMember(db: D1Database, provider: string, subject: string): Promise<MemberRow | null> {
  return db
    .prepare(
      `SELECT u.user_id, u.status, u.session_version, u.deletion_requested_at FROM auth_identities i
       JOIN users u ON u.user_id = i.user_id WHERE i.provider = ? AND i.subject = ?`,
    )
    .bind(provider, subject)
    .first<MemberRow>();
}

/**
 * Spec S-ID-01/S-ID-03: the member is found only by provider + subject. A new identity
 * creates a new member (UUIDv7 ID, empty profile); email never merges accounts.
 * Safe under concurrent first sign-ins: the loser of the insert race reads the winner's row.
 */
export async function findOrCreateMember(
  db: D1Database,
  identity: VerifiedIdentity,
  context: { appId: string; requestId: string | null },
  now: number,
): Promise<{ member: MemberRow; isNew: boolean }> {
  const existing = await findMember(db, identity.provider, identity.subject);
  if (existing) return { member: existing, isNew: false };
  const userId = uuidv7(now);
  let isNew = false;
  try {
    await db.batch([
      db.prepare('INSERT INTO users (user_id, created_at, updated_at) VALUES (?, ?, ?)').bind(userId, now, now),
      db
        .prepare(
          `INSERT INTO auth_identities (provider, subject, user_id, email, email_is_private_relay, created_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(identity.provider, identity.subject, userId, identity.email, identity.isPrivateRelay ? 1 : 0, now, now),
      db.prepare('INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)').bind(userId, now),
      auditStatement(db, { actorType: 'user', actorUserId: userId, action: 'auth.signup', targetType: 'user', targetId: userId, appId: context.appId, result: 'success', requestId: context.requestId, retention: 'security' }, now),
    ]);
    isNew = true;
  } catch {
    // A parallel request created the same identity first; use that member.
  }
  const member = await findMember(db, identity.provider, identity.subject);
  if (!member) throw new Error('MEMBER_CREATE_FAILED');
  return { member, isNew };
}

/** Whether the member still has to accept the current terms and privacy policy (S-ID-09). */
export async function consentRequired(db: D1Database, userId: string, termsVersion: string, privacyVersion: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM consents
       WHERE user_id = ? AND withdrawn_at IS NULL
         AND ((document = 'terms' AND version = ?) OR (document = 'privacy' AND version = ?))`,
    )
    .bind(userId, termsVersion, privacyVersion)
    .first<{ n: number }>();
  return (row?.n ?? 0) < 2;
}

/** Records acceptance of the current versions; idempotent. */
export async function acceptConsents(
  db: D1Database,
  input: { userId: string; termsVersion: string; privacyVersion: string; appId: string | null; requestId: string | null },
  now: number,
): Promise<void> {
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO consents (user_id, document, version, accepted_at) VALUES (?, 'terms', ?, ?)").bind(input.userId, input.termsVersion, now),
    db.prepare("INSERT OR IGNORE INTO consents (user_id, document, version, accepted_at) VALUES (?, 'privacy', ?, ?)").bind(input.userId, input.privacyVersion, now),
    auditStatement(db, { actorType: 'user', actorUserId: input.userId, action: 'consent.accept', targetType: 'user', targetId: input.userId, appId: input.appId, result: 'success', requestId: input.requestId, retention: 'security' }, now),
  ]);
}

export { PROFILE_SQL, type ProfileRow } from './profile';

export type ProfileChanges = Partial<Record<EditableField, string | null>>;

/**
 * Optimistic profile update (S-ID-08) for already validated values: written only if
 * `expectedVersion` is still current. Returns the profile as stored afterwards.
 */
export async function updateProfile(
  db: D1Database,
  input: { userId: string; expectedVersion: number; changes: ProfileChanges; appId: string | null; requestId: string | null },
  now: number,
): Promise<{ written: boolean; profile: ProfileRow | null }> {
  const result = await saveProfile(
    db,
    { userId: input.userId, expectedVersion: input.expectedVersion, changes: { fields: input.changes, visibility: {} }, source: 'member', actorUserId: input.userId, appId: input.appId, requestId: input.requestId },
    now,
  );
  return { written: result.written, profile: await db.prepare(PROFILE_SQL).bind(input.userId).first<ProfileRow>() };
}
