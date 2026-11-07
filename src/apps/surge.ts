import { auditStatement } from '../lib/audit';
import { contactEmailOf, sendEmail, type MailSettings, type OutgoingEmail } from '../notify/email';
import { clearAppStatusCache } from './status';

/**
 * Surge guard (S-PLT-01): an Owner sets, per App, how many Battery reservations one hour may hold.
 * Going over pauses the App by itself and mails the staff. Restoring the App is a human decision,
 * and counting restarts from that moment so a restore is not undone by the old numbers.
 */
export interface SurgeLimit {
  app_id: string;
  hourly_limit: number;
  last_triggered_at: number | null;
}

const HOUR_MS = 3600 * 1000;

export async function listSurgeLimits(db: D1Database): Promise<Map<string, SurgeLimit>> {
  const rows = await db.prepare('SELECT app_id, hourly_limit, last_triggered_at FROM app_surge_limits').all<SurgeLimit>();
  return new Map(rows.results.map((r) => [r.app_id, r]));
}

/** limit null removes the guard. False when the number is not 1～10000000. */
export async function setSurgeLimit(db: D1Database, actor: { userId: string; requestId: string | null }, appId: string, limit: number | null, now: number): Promise<boolean> {
  if (limit === null) {
    await db.batch([
      db.prepare('DELETE FROM app_surge_limits WHERE app_id = ?').bind(appId),
      auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.surge_limit_removed', targetType: 'app', targetId: appId, appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
    ]);
    return true;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000_000) return false;
  await db.batch([
    db
      .prepare('INSERT INTO app_surge_limits (app_id, hourly_limit, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (app_id) DO UPDATE SET hourly_limit = excluded.hourly_limit, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
      .bind(appId, limit, now, actor.userId),
    auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.surge_limit_set', targetType: 'app', targetId: appId, appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  return true;
}

export interface SurgeHit {
  appId: string;
  count: number;
  limit: number;
}

/** Pauses every App over its hourly limit; returns the ones paused this run. Never throws for one App's problem. */
export async function runSurgeGuard(dbs: { identity: D1Database; battery: D1Database }, now: number): Promise<SurgeHit[]> {
  const limits = await listSurgeLimits(dbs.identity);
  if (limits.size === 0) return [];
  const hits: SurgeHit[] = [];
  for (const limit of limits.values()) {
    const since = Math.max(now - HOUR_MS, limit.last_triggered_at ?? 0);
    const row = await dbs.battery.prepare('SELECT COUNT(*) AS n FROM battery_reservations WHERE app_id = ? AND created_at > ?').bind(limit.app_id, since).first<{ n: number }>();
    const count = row?.n ?? 0;
    if (count <= limit.hourly_limit) continue;
    const reason = `用量暴增自動暫停（1 小時 ${count} 次，上限 ${limit.hourly_limit}）`.slice(0, 200);
    await dbs.identity.batch([
      dbs.identity
        .prepare(
          `INSERT INTO app_status_overrides (app_id, status, reason, updated_at, updated_by) VALUES (?, 'paused', ?, ?, NULL)
           ON CONFLICT (app_id) DO UPDATE SET status = 'paused', reason = excluded.reason, updated_at = excluded.updated_at, updated_by = NULL`,
        )
        .bind(limit.app_id, reason, now),
      dbs.identity.prepare('UPDATE app_surge_limits SET last_triggered_at = ? WHERE app_id = ?').bind(now, limit.app_id),
      auditStatement(dbs.identity, { actorType: 'system', action: 'system.surge_pause', targetType: 'app', targetId: limit.app_id, appId: limit.app_id, result: 'success', retention: 'security' }, now),
    ]);
    hits.push({ appId: limit.app_id, count, limit: limit.hourly_limit });
  }
  if (hits.length > 0) clearAppStatusCache();
  return hits;
}

export function surgeAlertEmail(s: MailSettings, to: string, hit: SurgeHit & { appName: string }): Omit<OutgoingEmail, 'from'> {
  return {
    to,
    subject: `[Starry 警示] ${hit.appName} 用量暴增，已自動暫停`,
    text: `${hit.appName}（${hit.appId}）在 1 小時內有 ${hit.count} 次 Battery 預留，超過設定的上限 ${hit.limit}，系統已自動暫停這個 App。

請到 Admin Lite 查看原因；確認沒問題後，在「App」頁按「恢復」即可。
${s.baseUrl}/admin/apps

這是系統自動寄出的警示信。`,
  };
}

/** Support address plus the contact email of every Owner and Admin, without repeats. */
export async function alertRecipients(db: D1Database, s: MailSettings, ownerUserIds: string | undefined): Promise<string[]> {
  const roleRows = await db.prepare("SELECT user_id FROM user_roles WHERE role IN ('owner', 'admin')").all<{ user_id: string }>();
  const ids = new Set([...roleRows.results.map((r) => r.user_id), ...(ownerUserIds ?? '').split(',').map((v) => v.trim()).filter((v) => v)]);
  const emails = new Set<string>([s.supportAddress]);
  for (const id of ids) {
    const email = await contactEmailOf(db, id).catch(() => null);
    if (email) emails.add(email);
  }
  return [...emails];
}

export async function sendSurgeAlerts(db: D1Database, s: MailSettings, ownerUserIds: string | undefined, hits: (SurgeHit & { appName: string })[]): Promise<number> {
  let sent = 0;
  const recipients = await alertRecipients(db, s, ownerUserIds);
  for (const hit of hits) for (const to of recipients) if ((await sendEmail(s, surgeAlertEmail(s, to, hit))).ok) sent += 1;
  return sent;
}
