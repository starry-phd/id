import { WEB_APP_ID } from '../identity/web-sessions';
import { auditStatement } from '../lib/audit';
import { appDefinition, baselineApp, parseApp, setBuiltinOverrides, type AppEntry } from './registry';

/**
 * Admin changes to the built-in Apps. config/apps.json stays the baseline and the fallback: a row of
 * builtin_app_overrides holds only the fields the Owner changed, and the merged result must pass parseApp.
 * A broken row, a missing table or a database outage leaves the App exactly as the file defines it.
 */

/** Fields an override may change. The account center (the sign-in hub itself) only gets low-risk fields. */
const COMMON_FIELDS = ['name', 'status', 'min_version', 'scopes', 'config', 'web_origins', 'return_urls', 'ios_bundle_id', 'android_package', 'ios_team_id', 'android_cert_sha256'] as const;
const ACCOUNT_FIELDS = ['name', 'min_version'] as const;

export function editableFields(appId: string): readonly string[] {
  return appId === WEB_APP_ID ? ACCOUNT_FIELDS : COMMON_FIELDS;
}

export type Patch = Record<string, unknown>;

/** Applies a patch over the file baseline; throws when a field is not editable or the result is not a valid App. */
export function applyPatch(base: AppEntry, patch: unknown): AppEntry {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw new Error('override must be an object');
  const allowed = editableFields(base.app_id);
  const merged: Record<string, unknown> = { ...appDefinition(base) };
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.includes(key)) throw new Error(`field ${key} cannot be overridden`);
    merged[key] = value;
  }
  return parseApp(merged);
}

interface Row {
  app_id: string;
  patch: string;
}

/** Reads the overrides into the registry. On any failure the previous (last good) overrides stay in place. */
export async function loadBuiltinOverrides(db: D1Database): Promise<void> {
  try {
    const rows = await db.prepare('SELECT app_id, patch FROM builtin_app_overrides').all<Row>();
    const apps = new Map<string, AppEntry>();
    for (const row of rows.results) {
      const base = baselineApp(row.app_id);
      if (!base) continue;
      try {
        apps.set(row.app_id, applyPatch(base, JSON.parse(row.patch)));
      } catch {
        console.error(JSON.stringify({ level: 'error', event: 'builtin_override.invalid', app_id: row.app_id }));
      }
    }
    setBuiltinOverrides(apps);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'builtin_override.load_failed', message: error instanceof Error ? error.message : 'failed' }));
  }
}

export async function listOverriddenFields(db: D1Database): Promise<Map<string, string[]>> {
  const rows = await db.prepare('SELECT app_id, patch FROM builtin_app_overrides').all<Row>();
  const result = new Map<string, string[]>();
  for (const row of rows.results) {
    try {
      result.set(row.app_id, Object.keys(JSON.parse(row.patch) as Patch));
    } catch {
      result.set(row.app_id, []);
    }
  }
  return result;
}

export type OverrideResult = 'saved' | 'reverted' | 'unknown_app' | 'invalid';

/** Owner only (checked by the caller). Stores the merged patch and the audit entry in one batch. */
export async function saveBuiltinOverride(
  db: D1Database,
  actor: { userId: string; requestId: string | null },
  appId: string,
  patch: Patch,
  now: number,
): Promise<{ result: OverrideResult; error?: string }> {
  const base = baselineApp(appId);
  if (!base) return { result: 'unknown_app' };
  const changed: Patch = {};
  const baseline = appDefinition(base);
  for (const [key, value] of Object.entries(patch)) {
    if (JSON.stringify(value) !== JSON.stringify(baseline[key])) changed[key] = value;
  }
  try {
    applyPatch(base, changed);
  } catch (error) {
    return { result: 'invalid', error: error instanceof Error ? error.message.replace(/^App registry: /, '') : 'invalid' };
  }
  if (Object.keys(changed).length === 0) return revertBuiltinOverride(db, actor, appId, now);
  await db.batch([
    db
      .prepare('INSERT INTO builtin_app_overrides (app_id, patch, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(app_id) DO UPDATE SET patch = excluded.patch, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
      .bind(appId, JSON.stringify(changed), now, actor.userId),
    auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.builtin_app_overridden', targetType: 'app', targetId: appId, appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  await loadBuiltinOverrides(db);
  return { result: 'saved' };
}

/** Back to the file's values: deletes the override row. */
export async function revertBuiltinOverride(
  db: D1Database,
  actor: { userId: string; requestId: string | null },
  appId: string,
  now: number,
): Promise<{ result: OverrideResult }> {
  if (!baselineApp(appId)) return { result: 'unknown_app' };
  await db.batch([
    db.prepare('DELETE FROM builtin_app_overrides WHERE app_id = ?').bind(appId),
    auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.builtin_app_reverted', targetType: 'app', targetId: appId, appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  await loadBuiltinOverrides(db);
  return { result: 'reverted' };
}
