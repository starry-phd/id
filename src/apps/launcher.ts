import { appRegistry } from './registry';

export interface LauncherRow {
  app_id: string;
  sort_order: number;
  name: string | null;
  icon_key: string | null;
  web_url: string | null;
  play_url: string | null;
  appstore_url: string | null;
  summary: string | null;
}

export interface LauncherItem {
  appId: string;
  name: string;
  iconKey: string | null;
  web: string | null;
  play: string | null;
  appstore: string | null;
  summary: string | null;
  paused: boolean;
}

/** The App's public web address: a starry.phd origin first (workers.dev origins are previews and may be empty), else the first one. */
export function defaultWeb(origins: readonly string[]): string | null {
  return origins.find((o) => /^https:\/\/[a-z0-9-]+\.starry\.phd$/.test(o)) ?? origins[0] ?? null;
}

export const ICON_MAX_BYTES = 300 * 1024;
const URL_MAX = 300;
const HTTPS_URL = /^https:\/\/[^\s<>"']+$/;

export async function listLauncherRows(db: D1Database): Promise<Map<string, LauncherRow>> {
  const rows = await db
    .prepare('SELECT app_id, sort_order, name, icon_key, web_url, play_url, appstore_url, summary FROM app_launcher')
    .all<LauncherRow>();
  return new Map((rows.results ?? []).map((r) => [r.app_id, r]));
}

/** Every App except killed ones, in the Owner's order (Apps never moved keep registry order, account centre first). */
export function launcherItems(rows: ReadonlyMap<string, LauncherRow>, includeKilled = false): LauncherItem[] {
  return appRegistry
    .values()
    .map((app, index) => ({ app, index, row: rows.get(app.app_id) }))
    .filter(({ app }) => includeKilled || app.status !== 'killed')
    .sort((a, b) => (a.row?.sort_order ?? a.index * 10) - (b.row?.sort_order ?? b.index * 10) || a.index - b.index)
    .map(({ app, row }) => ({
      appId: app.app_id,
      name: row?.name ?? app.name,
      iconKey: row?.icon_key ?? null,
      web: row?.web_url ?? (app.app_id === 'account' ? '/account' : defaultWeb(app.web_origins)),
      play: row?.play_url ?? null,
      appstore: row?.appstore_url ?? null,
      summary: row?.summary ?? null,
      paused: app.status === 'paused',
    }));
}

export interface LauncherInput {
  name: string;
  web: string;
  play: string;
  appstore: string;
  summary: string;
}

export type LauncherResult = { ok: true } | { ok: false; error: string };

function url(value: string, label: string, allowPath: boolean): string | null | { error: string } {
  const v = value.trim();
  if (v === '') return null;
  if (v.length > URL_MAX) return { error: `${label}網址太長（最多 ${URL_MAX} 字）。` };
  if (allowPath && v.startsWith('/') && !v.startsWith('//') && !/\s/.test(v)) return v;
  if (!HTTPS_URL.test(v)) return { error: `${label}網址必須以 https:// 開頭。` };
  return v;
}

/** Validates the Owner's text fields; empty fields mean "use the default". */
export function parseLauncherInput(input: LauncherInput, appId: string): { ok: true; value: Omit<LauncherRow, 'app_id' | 'sort_order' | 'icon_key'> } | { ok: false; error: string } {
  const name = input.name.trim();
  const summary = input.summary.trim();
  if (name.length > 40) return { ok: false, error: '應用名稱最多 40 字。' };
  if ([...summary].length > 60) return { ok: false, error: '簡易說明最多 60 字。' };
  const web = url(input.web, '網頁版', appId === 'account');
  const play = url(input.play, 'Google Play ', false);
  const appstore = url(input.appstore, 'App Store ', false);
  for (const u of [web, play, appstore]) if (u !== null && typeof u === 'object') return { ok: false, error: u.error };
  return { ok: true, value: { name: name || null, web_url: web as string | null, play_url: play as string | null, appstore_url: appstore as string | null, summary: summary || null } };
}

export async function saveLauncherText(db: D1Database, appId: string, input: LauncherInput, actor: string, now: number): Promise<LauncherResult> {
  if (!appRegistry.has(appId)) return { ok: false, error: '找不到此 App。' };
  const parsed = parseLauncherInput(input, appId);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  await db
    .prepare(
      `INSERT INTO app_launcher (app_id, sort_order, name, web_url, play_url, appstore_url, summary, updated_at, updated_by)
       VALUES (?1, COALESCE((SELECT sort_order FROM app_launcher WHERE app_id = ?1), ?9), ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (app_id) DO UPDATE SET name = excluded.name, web_url = excluded.web_url, play_url = excluded.play_url,
         appstore_url = excluded.appstore_url, summary = excluded.summary, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(appId, v.name, v.web_url, v.play_url, v.appstore_url, v.summary, now, actor, defaultOrder(appId))
    .run();
  return { ok: true };
}

function defaultOrder(appId: string): number {
  return Math.max(0, appRegistry.keys().indexOf(appId)) * 10;
}

/** Image type by magic bytes (never trust the browser's content type). */
export function sniffImage(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length > 12 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export async function saveLauncherIcon(db: D1Database, bucket: R2Bucket, appId: string, bytes: Uint8Array, actor: string, now: number): Promise<LauncherResult> {
  if (!appRegistry.has(appId)) return { ok: false, error: '找不到此 App。' };
  if (bytes.length === 0 || bytes.length > ICON_MAX_BYTES) return { ok: false, error: '圖片太大，請選 300 KB 以內的圖片。' };
  const type = sniffImage(bytes);
  if (!type) return { ok: false, error: '圖片格式只接受 PNG、JPG、WebP。' };
  const key = `app-icons/${appId}/${crypto.randomUUID()}`;
  const old = await db.prepare('SELECT icon_key FROM app_launcher WHERE app_id = ?').bind(appId).first<{ icon_key: string | null }>();
  await bucket.put(key, bytes, { httpMetadata: { contentType: type } });
  await db
    .prepare(
      `INSERT INTO app_launcher (app_id, sort_order, icon_key, updated_at, updated_by) VALUES (?1, ?5, ?2, ?3, ?4)
       ON CONFLICT (app_id) DO UPDATE SET icon_key = excluded.icon_key, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(appId, key, now, actor, defaultOrder(appId))
    .run();
  if (old?.icon_key) await bucket.delete(old.icon_key).catch(() => undefined);
  return { ok: true };
}

export async function removeLauncherIcon(db: D1Database, bucket: R2Bucket | undefined, appId: string, actor: string, now: number): Promise<void> {
  const old = await db.prepare('SELECT icon_key FROM app_launcher WHERE app_id = ?').bind(appId).first<{ icon_key: string | null }>();
  await db.prepare('UPDATE app_launcher SET icon_key = NULL, updated_at = ?, updated_by = ? WHERE app_id = ?').bind(now, actor, appId).run();
  if (old?.icon_key && bucket) await bucket.delete(old.icon_key).catch(() => undefined);
}

/** Forgets every customisation of one App (name, links, summary, icon, position) and returns it to the registry defaults. */
export async function resetLauncher(db: D1Database, bucket: R2Bucket | undefined, appId: string): Promise<void> {
  const old = await db.prepare('SELECT icon_key FROM app_launcher WHERE app_id = ?').bind(appId).first<{ icon_key: string | null }>();
  await db.prepare('DELETE FROM app_launcher WHERE app_id = ?').bind(appId).run();
  if (old?.icon_key && bucket) await bucket.delete(old.icon_key).catch(() => undefined);
}

/** Moves one App up or down by one place; every App gets an explicit position (10, 20, …) so the order is stable. */
export async function moveLauncher(db: D1Database, appId: string, direction: 'up' | 'down', actor: string, now: number): Promise<boolean> {
  const rows = await listLauncherRows(db);
  const ids = launcherItems(rows, true).map((i) => i.appId);
  const at = ids.indexOf(appId);
  const to = direction === 'up' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= ids.length) return false;
  [ids[at], ids[to]] = [ids[to] as string, ids[at] as string];
  await db.batch(
    ids.map((id, i) =>
      db
        .prepare(
          `INSERT INTO app_launcher (app_id, sort_order, updated_at, updated_by) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (app_id) DO UPDATE SET sort_order = excluded.sort_order, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .bind(id, (i + 1) * 10, now, actor),
    ),
  );
  return true;
}
