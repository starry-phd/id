import { auditStatement } from '../lib/audit';

export interface VerifiedIdentity {
  provider: 'apple' | 'google';
  subject: string;
  email: string | null;
  isPrivateRelay: boolean;
}

export type LinkResult = 'linked' | 'already_linked' | 'provider_in_use' | 'identity_in_use';

/**
 * Spec S-ID-02: a signed-in member adds the other sign-in method. The caller has already
 * verified a fresh ID token for it. An identity that belongs to another member is never moved,
 * and a member holds at most one identity per provider.
 */
export async function linkIdentity(
  db: D1Database,
  actor: { userId: string; appId: string | null; requestId: string | null },
  identity: VerifiedIdentity,
  now: number,
): Promise<LinkResult> {
  const evaluate = async (): Promise<LinkResult | null> => {
    const owner = await db
      .prepare('SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ?')
      .bind(identity.provider, identity.subject)
      .first<{ user_id: string }>();
    if (owner) return owner.user_id === actor.userId ? 'already_linked' : 'identity_in_use';
    const same = await db
      .prepare('SELECT 1 AS present FROM auth_identities WHERE user_id = ? AND provider = ?')
      .bind(actor.userId, identity.provider)
      .first();
    return same ? 'provider_in_use' : null;
  };
  const blocked = await evaluate();
  if (blocked) return blocked;
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO auth_identities (provider, subject, user_id, email, email_is_private_relay, created_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(identity.provider, identity.subject, actor.userId, identity.email, identity.isPrivateRelay ? 1 : 0, now, now),
      auditStatement(db, { actorType: 'user', actorUserId: actor.userId, action: `account.identity_linked.${identity.provider}`, targetType: 'user', targetId: actor.userId, appId: actor.appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
    ]);
    return 'linked';
  } catch {
    // Lost a race against another request; report what is there now.
    return (await evaluate()) ?? 'identity_in_use';
  }
}
