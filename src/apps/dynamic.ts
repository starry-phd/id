import { WEB_APP_ID } from '../identity/web-sessions';
import { auditStatement } from '../lib/audit';
import { getApp, isStaticApp, parseApp, setDynamicApps, type AppEntry } from './registry';

/**
 * Apps the Owner registers in Admin Lite. Stored as the same JSON an entry of config/apps.json uses,
 * validated by parseApp on every write and every read, and cached per isolate for 30 seconds
 * (the same window as the App status kill switch).
 */
const CACHE_MS = 30 * 1000;
let loadedAt = 0;

export function clearDynamicAppCache(): void {
  loadedAt = 0;
}

interface Row {
  app_id: string;
  definition: string;
}

/** Loads registered Apps into the registry. A broken row or table never blocks the Apps in config/apps.json. */
export async function refreshDynamicApps(db: D1Database, now: number): Promise<void> {
  if (loadedAt !== 0 && now - loadedAt < CACHE_MS) return;
  try {
    const rows = await db.prepare('SELECT app_id, definition FROM registered_apps ORDER BY app_id').all<Row>();
    const apps = new Map<string, AppEntry>();
    for (const row of rows.results) {
      try {
        const app = parseApp(JSON.parse(row.definition));
        if (app.app_id === row.app_id && app.app_id !== WEB_APP_ID && !isStaticApp(app.app_id)) apps.set(app.app_id, app);
      } catch {
        console.error(JSON.stringify({ level: 'error', event: 'registered_app.invalid', app_id: row.app_id }));
      }
    }
    setDynamicApps(apps);
    loadedAt = now;
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'registered_app.load_failed', message: error instanceof Error ? error.message : 'failed' }));
  }
}

export async function listRegisteredAppIds(db: D1Database): Promise<Set<string>> {
  const rows = await db.prepare('SELECT app_id FROM registered_apps').all<{ app_id: string }>();
  return new Set(rows.results.map((r) => r.app_id));
}

export interface AppForm {
  app_id?: string;
  name?: string;
  ios_bundle_id?: string;
  android_package?: string;
  scheme?: string;
  web_origins?: string;
  return_urls?: string;
  extra_apple_audiences?: string;
  extra_google_audiences?: string;
  min_version?: string;
  battery?: string;
}

function lines(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Builds the definition an Owner form describes. Sign-in works through the shared Starry relay by default:
 * the Apple Services ID and Google Web client of the account center are accepted for every new App, so
 * nothing has to be added in the Apple or Google consoles for a web or Android version.
 */
export function definitionFromForm(form: AppForm): { ok: true; app: AppEntry } | { ok: false; error: string } {
  const appId = (form.app_id ?? '').trim();
  const shared = getApp(WEB_APP_ID);
  if (!shared) return { ok: false, error: '帳號中心的登入設定遺失，無法建立 App。' };
  const ios = (form.ios_bundle_id ?? '').trim() || null;
  const android = (form.android_package ?? '').trim() || null;
  const scheme = (form.scheme ?? '').trim() || appId.replace(/-/g, '');
  const returnUrls = lines(form.return_urls);
  if (returnUrls.length === 0) returnUrls.push(`${scheme}://auth/apple`, `${scheme}://auth/google`);
  const definition = {
    app_id: appId,
    name: (form.name ?? '').trim(),
    ios_bundle_id: ios,
    android_package: android,
    status: 'active',
    scopes: ['profile:read', 'profile:write'],
    min_version: (form.min_version ?? '').trim() || '0.0.0',
    config: {},
    auth: {
      apple_audiences: unique([...(ios ? [ios] : []), ...shared.auth.apple, ...lines(form.extra_apple_audiences)]),
      google_audiences: unique([...shared.auth.google, ...lines(form.extra_google_audiences)]),
    },
    web_origins: lines(form.web_origins),
    return_urls: unique(returnUrls),
  };
  try {
    return { ok: true, app: parseApp(definition) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.replace(/^App registry: /, '') : '欄位格式不正確。' };
  }
}

function serialize(app: AppEntry): string {
  return JSON.stringify({
    app_id: app.app_id,
    name: app.name,
    ios_bundle_id: app.ios_bundle_id,
    android_package: app.android_package,
    status: app.status,
    scopes: app.scopes,
    min_version: app.min_version,
    config: app.config,
    auth: { apple_audiences: app.auth.apple, google_audiences: app.auth.google },
    web_origins: app.web_origins,
    return_urls: app.return_urls,
  });
}

export type SaveResult = 'created' | 'updated' | 'reserved' | 'exists' | 'not_found';

/** Owner only (checked by the caller). One batch: the App row and its audit entry. */
export async function saveRegisteredApp(
  db: D1Database,
  actor: { userId: string; requestId: string | null },
  app: AppEntry,
  mode: 'create' | 'update',
  now: number,
): Promise<SaveResult> {
  if (app.app_id === WEB_APP_ID || isStaticApp(app.app_id)) return 'reserved';
  const existing = await db.prepare('SELECT 1 AS found FROM registered_apps WHERE app_id = ?').bind(app.app_id).first<{ found: number }>();
  if (mode === 'create' && existing) return 'exists';
  if (mode === 'update' && !existing) return 'not_found';
  const write =
    mode === 'create'
      ? db.prepare('INSERT INTO registered_apps (app_id, definition, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)').bind(app.app_id, serialize(app), now, actor.userId, now, actor.userId)
      : db.prepare('UPDATE registered_apps SET definition = ?, updated_at = ?, updated_by = ? WHERE app_id = ?').bind(serialize(app), now, actor.userId, app.app_id);
  await db.batch([
    write,
    auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: mode === 'create' ? 'admin.app_registered' : 'admin.app_updated', targetType: 'app', targetId: app.app_id, appId: app.app_id, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  clearDynamicAppCache();
  await refreshDynamicApps(db, now);
  return mode === 'create' ? 'created' : 'updated';
}
