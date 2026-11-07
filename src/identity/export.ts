import { loadProfile } from './profile';

/**
 * A member's own copy of the data Starry holds about them (data portability). Secrets such as tokens, provider
 * subject IDs, session IDs and staff-only notes are left out on purpose.
 */
export async function exportMemberData(env: { DB_IDENTITY: D1Database; DB_BATTERY: D1Database }, userId: string, now: number): Promise<Record<string, unknown> | null> {
  const db = env.DB_IDENTITY;
  const user = await db.prepare('SELECT user_id, status, created_at FROM users WHERE user_id = ?').bind(userId).first<{ user_id: string; status: string; created_at: number }>();
  if (!user) return null;
  const [profile, logins, consents, apps, usage, quantum, quantumLedger] = await Promise.all([
    loadProfile(db, userId),
    db.prepare('SELECT provider, email, created_at, last_login_at FROM auth_identities WHERE user_id = ? ORDER BY created_at').bind(userId).all(),
    db.prepare('SELECT document, version, accepted_at, withdrawn_at FROM consents WHERE user_id = ? ORDER BY accepted_at').bind(userId).all(),
    db.prepare('SELECT app_id, first_seen_at, last_seen_at FROM member_apps WHERE user_id = ? ORDER BY first_seen_at').bind(userId).all(),
    env.DB_BATTERY.prepare("SELECT created_at, kind, amount, app_id, task_type, task_label FROM battery_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 1000").bind(userId).all(),
    env.DB_BATTERY.prepare('SELECT app_id, balance FROM quantum_accounts WHERE user_id = ? ORDER BY app_id').bind(userId).all(),
    env.DB_BATTERY.prepare('SELECT created_at, app_id, kind, amount, product_id, task_label FROM quantum_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 1000').bind(userId).all(),
  ]);
  const profileFields: Record<string, unknown> = { ...profile?.row };
  delete profileFields.avatar_key; // an internal storage path
  return {
    exported_at: now,
    member: { user_id: user.user_id, status: user.status, joined_at: user.created_at },
    profile: profileFields,
    login_methods: logins.results,
    consents: consents.results,
    apps_used: apps.results,
    battery_history: usage.results,
    quantum_battery: { balances: quantum.results, history: quantumLedger.results },
  };
}
