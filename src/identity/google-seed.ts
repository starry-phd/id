import { auditStatement } from '../lib/audit';

/**
 * Basic profile fields start from what Google already knows (owner decision 2026-11-08): the name, the language and
 * the verified e-mail address that the Google sign-in token carries. The profile version is not bumped: only empty fields change. Only empty fields the member has never touched
 * (no profile_field_updates row) are filled, so nothing the member typed or cleared is ever overwritten.
 * Birthday, phone, address and the like are not in the sign-in token and need separate Google permission, so they stay empty.
 */
export interface GoogleSeed {
  name: string | null;
  locale: string | null;
  email: string | null;
  emailVerified: boolean;
  isPrivateRelay: boolean;
}

const LOCALE_MAP: Record<string, string> = { zh: 'zh-TW', 'zh-TW': 'zh-TW', 'zh-HK': 'zh-TW', 'zh-Hant': 'zh-TW', en: 'en-US', 'en-US': 'en-US', 'en-GB': 'en-US', ja: 'ja-JP', 'ja-JP': 'ja-JP' };

/** The supported Starry locale for a Google language tag, or null. */
export function localeFromGoogle(tag: string | null): string | null {
  if (!tag) return null;
  const clean = tag.replace('_', '-');
  return LOCALE_MAP[clean] ?? LOCALE_MAP[clean.split('-')[0] ?? ''] ?? null;
}

const UNTOUCHED = (field: string) => `NOT EXISTS (SELECT 1 FROM profile_field_updates f WHERE f.user_id = profiles.user_id AND f.field = '${field}')`;

/** Fills the member's empty basic-profile fields from a Google sign-in. Best effort, never throws. */
export async function seedProfileFromGoogle(db: D1Database, subject: string, seed: GoogleSeed, now: number): Promise<void> {
  try {
    const owner = await db.prepare("SELECT user_id FROM auth_identities WHERE provider = 'google' AND subject = ?").bind(subject).first<{ user_id: string }>();
    if (!owner) return;
    const statements: D1PreparedStatement[] = [];
    if (seed.name) {
      statements.push(
        db
          .prepare(`UPDATE profiles SET display_name = ?, updated_at = ? WHERE user_id = ? AND (display_name IS NULL OR display_name = '') AND ${UNTOUCHED('display_name')}`)
          .bind(seed.name, now, owner.user_id),
      );
    }
    const locale = localeFromGoogle(seed.locale);
    if (locale) {
      statements.push(
        db.prepare(`UPDATE profiles SET locale = ?, updated_at = ? WHERE user_id = ? AND locale <> ? AND ${UNTOUCHED('locale')}`).bind(locale, now, owner.user_id, locale),
      );
    }
    if (seed.email && seed.emailVerified && !seed.isPrivateRelay) {
      statements.push(
        db
          .prepare(
            `UPDATE profiles SET contact_email = ?, contact_email_verified_at = ?, updated_at = ?
             WHERE user_id = ? AND (contact_email IS NULL OR contact_email = '') AND ${UNTOUCHED('contact_email')}`,
          )
          .bind(seed.email, now, now, owner.user_id),
      );
    }
    if (statements.length === 0) return;
    const results = await db.batch(statements);
    if (results.some((r) => r.meta.changes > 0)) {
      await auditStatement(db, { actorType: 'user', actorUserId: owner.user_id, action: 'profile.seeded_from_google', targetType: 'user', targetId: owner.user_id, appId: null, result: 'success', requestId: null, retention: 'general' }, now).run();
    }
  } catch {
    // The profile can always be filled in by hand.
  }
}
