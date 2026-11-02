import { auditStatement } from '../lib/audit';
import type { AppEntry, AppStatus } from './registry';

/**
 * Spec S-PLT-01: config/apps.json is the default; an Owner or Admin can pause or kill
 * a single App at runtime through Admin Lite. Overrides are cached per isolate for
 * 30 seconds, so a kill switch reaches every location within half a minute.
 */
const CACHE_MS = 30 * 1000;
let cache: { at: number; overrides: Map<string, AppStatus> } | null = null;

export function clearAppStatusCache(): void {
  cache = null;
}

async function overrides(db: D1Database, now: number): Promise<Map<string, AppStatus>> {
  if (cache && now - cache.at < CACHE_MS) return cache.overrides;
  const rows = await db.prepare('SELECT app_id, status FROM app_status_overrides').all<{ app_id: string; status: AppStatus }>();
  cache = { at: now, overrides: new Map(rows.results.map((r) => [r.app_id, r.status])) };
  return cache.overrides;
}

/** The App with its effective status; a broken override table never blocks sign-in. */
export async function withEffectiveStatus(db: D1Database, app: AppEntry, now: number): Promise<AppEntry> {
  try {
    const status = (await overrides(db, now)).get(app.app_id);
    return status && status !== app.status ? { ...app, status } : app;
  } catch {
    return app;
  }
}

export async function setAppStatusOverride(
  db: D1Database,
  actor: { userId: string; requestId: string | null },
  appId: string,
  status: AppStatus | null,
  reason: string | null,
  now: number,
): Promise<void> {
  const change =
    status === null
      ? db.prepare('DELETE FROM app_status_overrides WHERE app_id = ?').bind(appId)
      : db
          .prepare(
            `INSERT INTO app_status_overrides (app_id, status, reason, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (app_id) DO UPDATE SET status = excluded.status, reason = excluded.reason, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
          )
          .bind(appId, status, reason, now, actor.userId);
  await db.batch([
    change,
    auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: `admin.app_status.${status ?? 'default'}`, targetType: 'app', targetId: appId, appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  clearAppStatusCache();
}

export async function listAppStatusOverrides(db: D1Database): Promise<Map<string, { status: AppStatus; reason: string | null; updated_at: number }>> {
  const rows = await db.prepare('SELECT app_id, status, reason, updated_at FROM app_status_overrides').all<{ app_id: string; status: AppStatus; reason: string | null; updated_at: number }>();
  return new Map(rows.results.map((r) => [r.app_id, { status: r.status, reason: r.reason, updated_at: r.updated_at }]));
}
