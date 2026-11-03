import { auditStatement } from '../lib/audit';
import { open, seal } from '../lib/sealed';
import { contactEmailVerificationEmail, sendEmail, type MailSettings } from '../notify/email';

/**
 * 02.01 main contact email: the member types it, so it is used for system email only after the
 * member opens the link sent to it. The link carries a sealed token (member, address, 24 hours);
 * nothing extra is stored.
 */
const CONTEXT = 'contact-email-v1';
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export async function sendContactEmailVerification(
  key: string | undefined,
  mail: MailSettings | null,
  userId: string,
  email: string,
  now: number,
): Promise<'sent' | 'unavailable' | 'failed'> {
  if (!key || !mail) return 'unavailable';
  const token = await seal(key, CONTEXT, JSON.stringify({ u: userId, e: email, exp: now + VERIFY_TTL_MS }));
  if (!token) return 'unavailable';
  const link = `${mail.baseUrl}/account/verify-email?t=${encodeURIComponent(token)}`;
  const outcome = await sendEmail(mail, contactEmailVerificationEmail(mail, email, link));
  return outcome.ok ? 'sent' : 'failed';
}

export type ConfirmResult = 'verified' | 'invalid' | 'expired' | 'changed';

export async function confirmContactEmail(db: D1Database, key: string | undefined, token: string, now: number): Promise<ConfirmResult> {
  const raw = key && token.length <= 2048 ? await open(key, CONTEXT, token) : null;
  let claim: { u?: unknown; e?: unknown; exp?: unknown } = {};
  try {
    claim = raw ? (JSON.parse(raw) as typeof claim) : {};
  } catch {
    return 'invalid';
  }
  if (typeof claim.u !== 'string' || typeof claim.e !== 'string' || typeof claim.exp !== 'number') return 'invalid';
  if (claim.exp <= now) return 'expired';
  const [update] = await db.batch([
    db.prepare('UPDATE profiles SET contact_email_verified_at = ? WHERE user_id = ? AND contact_email = ? AND contact_email_verified_at IS NULL').bind(now, claim.u, claim.e),
    auditStatement(db, { actorType: 'user', actorUserId: claim.u, action: 'profile.contact_email_verified', targetType: 'user', targetId: claim.u, result: 'success', retention: 'general' }, now),
  ]);
  if (update?.meta.changes === 1) return 'verified';
  const current = await db.prepare('SELECT contact_email, contact_email_verified_at FROM profiles WHERE user_id = ?').bind(claim.u).first<{ contact_email: string | null; contact_email_verified_at: number | null }>();
  return current?.contact_email === claim.e && current.contact_email_verified_at !== null ? 'verified' : 'changed';
}
