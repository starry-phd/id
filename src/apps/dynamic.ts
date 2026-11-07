import { WEB_APP_ID } from '../identity/web-sessions';
import { auditStatement } from '../lib/audit';
import { loadBuiltinOverrides } from './builtin-overrides';
import { appDefinition, getApp, isStaticApp, parseApp, registeredApp, setDynamicApps, type AppEntry } from './registry';

/**
 * Apps the Owner registers in Admin Lite. Stored as the same JSON an entry of config/apps.json uses,
 * validated by parseApp on every write and every read, and cached per isolate for 30 seconds
 * (the same window as the App status kill switch).
 */
const CACHE_MS = 30 * 1000;
/** After a failed read the database is left alone this long, so an outage does not add a failing query to every request. */
const RETRY_MS = 10 * 1000;
let nextLoadAt = 0;

export function clearDynamicAppCache(): void {
  nextLoadAt = 0;
}

/** Registered Apps whose stored definition failed validation at the last load (shown in Admin Lite). */
let invalidIds: readonly string[] = [];
export function invalidRegisteredApps(): readonly string[] {
  return invalidIds;
}

interface Row {
  app_id: string;
  definition: string;
}

/** Loads registered Apps into the registry. A broken row or table never blocks the Apps in config/apps.json. */
export async function refreshDynamicApps(db: D1Database, now: number): Promise<void> {
  if (now < nextLoadAt) return;
  // Set before reading: concurrent requests in this isolate share one read, and a failure backs off.
  nextLoadAt = now + CACHE_MS;
  await loadBuiltinOverrides(db);
  try {
    const rows = await db.prepare('SELECT app_id, definition FROM registered_apps ORDER BY app_id').all<Row>();
    const apps = new Map<string, AppEntry>();
    const invalid: string[] = [];
    for (const row of rows.results) {
      try {
        const app = parseApp(JSON.parse(row.definition));
        if (app.app_id !== row.app_id) throw new Error('app_id mismatch');
        if (app.app_id !== WEB_APP_ID && !isStaticApp(app.app_id)) apps.set(app.app_id, app);
      } catch {
        // A broken row must not take the App down: keep the definition that last loaded fine and flag it for the Owner.
        invalid.push(row.app_id);
        const previous = registeredApp(row.app_id);
        if (previous) apps.set(row.app_id, previous);
        console.error(JSON.stringify({ level: 'error', event: 'registered_app.invalid', app_id: row.app_id, kept_previous: previous !== undefined }));
      }
    }
    invalidIds = invalid;
    setDynamicApps(apps);
  } catch (error) {
    nextLoadAt = now + RETRY_MS;
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
  android_cert_sha256?: string;
}

function lines(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Accepts a pasted Android certificate fingerprint the way Play Console, keytool or apksigner print it (upper or lower
 * case, with or without colons, with an optional "SHA256:" prefix) and returns AA:BB:… or null when it is not 32 bytes.
 */
export function normalizeFingerprint(raw: string): string | null {
  const hex = raw.trim().replace(/^sha-?256\s*[:=]?\s*/i, '').replace(/[:\s-]/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return hex.match(/../g)!.join(':');
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Builds the definition an Owner form describes (with defaults: true, blank platform fields are derived from the app_id). Sign-in works through the shared Starry relay by default:
 * the Apple Services ID and Google Web client of the account center are accepted for every new App, so
 * nothing has to be added in the Apple or Google consoles for a web or Android version.
 */
export function definitionFromForm(form: AppForm, options: { defaults?: boolean } = {}): { ok: true; app: AppEntry } | { ok: false; error: string } {
  const appId = (form.app_id ?? '').trim();
  const shared = getApp(WEB_APP_ID);
  if (!shared) return { ok: false, error: '帳號中心的登入設定遺失，無法建立 App。' };
  // Every Starry App ships on iOS, Android and the web, so a new App gets names derived from its app_id.
  const compact = appId.replace(/-/g, '');
  const ios = (form.ios_bundle_id ?? '').trim() || (options.defaults ? `phd.starry.${compact}` : null);
  const android = (form.android_package ?? '').trim() || (options.defaults ? `phd.starry.${compact}` : null);
  const scheme = (form.scheme ?? '').trim() || compact;
  const webOrigins = lines(form.web_origins);
  if (webOrigins.length === 0 && options.defaults) webOrigins.push(`https://${appId}.starry.phd`);
  const fingerprints: string[] = [];
  for (const raw of (form.android_cert_sha256 ?? '').split(/[\n,;]+/).map((v) => v.trim()).filter((v) => v.length > 0)) {
    const normalized = normalizeFingerprint(raw);
    if (!normalized) return { ok: false, error: `Android 簽章指紋格式不正確：「${raw.slice(0, 40)}」。需要 SHA-256（32 組兩位十六進位，例如 AA:BB:CC:…），請從 Play Console 的「應用程式簽署」整行複製。` };
    fingerprints.push(normalized);
  }
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
    web_origins: webOrigins,
    return_urls: unique(returnUrls),
    // Apple Team ID is shared by the whole ecosystem (STARRY_APPLE_TEAM_ID), so an App never stores its own.
    ios_team_id: null,
    android_cert_sha256: unique(fingerprints),
  };
  try {
    return { ok: true, app: parseApp(definition) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.replace(/^App registry: /, '') : '欄位格式不正確。' };
  }
}

function serialize(app: AppEntry): string {
  return JSON.stringify(appDefinition(app));
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
