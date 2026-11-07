import { auditStatement } from '../lib/audit';
import type { AppEntry, AppStatus } from './registry';

/**
 * Spec S-PLT-01: config/apps.json is the default; an Owner or Admin can pause or kill
 * a single App at runtime through Admin Lite. Overrides are cached per isolate for
 * 30 seconds, so a kill switch reaches every location within half a minute.
 */
const CACHE_MS = 30 * 1000;
let cache: { at: number; overrides: Map<string, AppStatus> } | null = null;
let configCache: { at: number; values: Map<string, Record<string, unknown>> } | null = null;

export function clearAppStatusCache(): void {
  cache = null;
  configCache = null;
}

async function overrides(db: D1Database, now: number): Promise<Map<string, AppStatus>> {
  if (cache && now - cache.at < CACHE_MS) return cache.overrides;
  const rows = await db.prepare('SELECT app_id, status FROM app_status_overrides').all<{ app_id: string; status: AppStatus }>();
  cache = { at: now, overrides: new Map(rows.results.map((r) => [r.app_id, r.status])) };
  return cache.overrides;
}

async function configOverrides(db: D1Database, now: number): Promise<Map<string, Record<string, unknown>>> {
  if (configCache && now - configCache.at < CACHE_MS) return configCache.values;
  const rows = await db.prepare('SELECT app_id, key, value FROM app_config_overrides').all<{ app_id: string; key: string; value: string }>();
  const values = new Map<string, Record<string, unknown>>();
  for (const r of rows.results) {
    try {
      values.set(r.app_id, { ...values.get(r.app_id), [r.key]: JSON.parse(r.value) });
    } catch {
      // A damaged value is skipped; the App keeps its default.
    }
  }
  configCache = { at: now, values };
  return values;
}

/** The App with its remote-config overrides (and min_version) applied; a broken table never blocks the App. */
export async function withConfigOverrides(db: D1Database, app: AppEntry, now: number): Promise<AppEntry> {
  try {
    const extra = (await configOverrides(db, now)).get(app.app_id);
    if (!extra) return app;
    const { min_version: minVersion, ...rest } = extra;
    return { ...app, min_version: typeof minVersion === 'string' ? minVersion : app.min_version, config: { ...app.config, ...rest } };
  } catch {
    return app;
  }
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

const CONFIG_KEY = /^[a-z][a-z0-9_]{0,39}$/;
export const MAX_CONFIG_KEYS = 30;

/**
 * Parses the Admin Lite text box: one "name = value" per line. true/false and numbers keep their type, anything
 * else is text (quotes optional). Returns an error message for the first bad line.
 */
export function parseConfigText(text: string): { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  const values: Record<string, unknown> = {};
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq < 1) return { ok: false, error: `第 ${index + 1} 行格式不對，請寫成「名稱 = 值」。` };
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!CONFIG_KEY.test(key)) return { ok: false, error: `第 ${index + 1} 行的名稱「${key.slice(0, 40)}」只能用小寫英文、數字與底線，且要以英文字母開頭。` };
    if (key in values) return { ok: false, error: `名稱「${key}」重複了。` };
    if (value.length > 200) return { ok: false, error: `第 ${index + 1} 行的值太長（最多 200 字）。` };
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value === 'true' || value === 'false') values[key] = value === 'true';
    else if (value !== '' && Number.isFinite(Number(value)) && value.length <= 15) values[key] = Number(value);
    if (!(key in values)) values[key] = value;
    if (key === 'min_version' && !/^\d+\.\d+\.\d+$/.test(String(values[key]))) return { ok: false, error: '最低版本要寫成 1.2.3 的格式。' };
  }
  if (Object.keys(values).length > MAX_CONFIG_KEYS) return { ok: false, error: `最多 ${MAX_CONFIG_KEYS} 項設定。` };
  return { ok: true, values };
}

export function configToText(values: Record<string, unknown>): string {
  return Object.entries(values)
    .map(([k, v]) => `${k} = ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
    .join('\n');
}

export async function loadConfigOverrides(db: D1Database, appId: string): Promise<Record<string, unknown>> {
  const rows = await db.prepare('SELECT key, value FROM app_config_overrides WHERE app_id = ? ORDER BY key').bind(appId).all<{ key: string; value: string }>();
  const out: Record<string, unknown> = {};
  for (const r of rows.results) out[r.key] = JSON.parse(r.value);
  return out;
}

/** Replaces all of one App's overrides at once (an empty set clears them). */
export async function saveConfigOverrides(db: D1Database, actor: { userId: string; requestId: string | null }, appId: string, values: Record<string, unknown>, now: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM app_config_overrides WHERE app_id = ?').bind(appId),
    ...Object.entries(values).map(([key, value]) => db.prepare('INSERT INTO app_config_overrides (app_id, key, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)').bind(appId, key, JSON.stringify(value), now, actor.userId)),
    auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.app_config_saved', targetType: 'app', targetId: appId, appId, result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  clearAppStatusCache();
}

export const APP_STAGES = ['dev', 'test', 'live'] as const;
export type AppStage = (typeof APP_STAGES)[number];
export const STAGE_LABELS: Record<AppStage, string> = { dev: '開發中', test: '測試中', live: '已上架' };

export async function listAppStages(db: D1Database): Promise<Map<string, AppStage>> {
  const rows = await db.prepare('SELECT app_id, stage FROM app_stages').all<{ app_id: string; stage: AppStage }>();
  return new Map(rows.results.map((r) => [r.app_id, r.stage]));
}

export async function setAppStage(db: D1Database, appId: string, stage: string, actorUserId: string, now: number): Promise<boolean> {
  if (!(APP_STAGES as readonly string[]).includes(stage)) return false;
  await db
    .prepare('INSERT INTO app_stages (app_id, stage, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (app_id) DO UPDATE SET stage = excluded.stage, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
    .bind(appId, stage, now, actorUserId)
    .run();
  return true;
}
