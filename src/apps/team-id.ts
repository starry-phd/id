import type { Env } from '../env';
import { auditStatement } from '../lib/audit';
import type { AppEntry } from './registry';

const TEAM_ID = /^[A-Z0-9]{10}$/;
const CACHE_MS = 30_000;
const RETRY_MS = 10_000;
interface CachedTeam { value: string | null; loaded: boolean; nextAt: number; pending: Promise<void> | null }
const cache = new WeakMap<D1Database, CachedTeam>();

/** Apple Developer Team IDs are public (AASA exposes them), but must be validated before storage or use. */
export function parseTeamId(input: string | undefined | null): string | null {
  const value = (input ?? '').trim().toUpperCase();
  return TEAM_ID.test(value) ? value : null;
}

/**
 * Read the single D1 setting before handling a request, not once per App. A cold isolate waits for the first
 * read; subsequent requests use a 30s cache. On D1 trouble, retain the last valid value. The Worker variable
 * exists only as a backwards-compatible emergency fallback before migration or on a cold read failure.
 */
export async function refreshCentralTeamId(db: D1Database, now: number, fallback?: string): Promise<void> {
  let state = cache.get(db);
  if (!state) {
    state = { value: parseTeamId(fallback), loaded: false, nextAt: 0, pending: null };
    cache.set(db, state);
  }
  if (now < state.nextAt) {
    if (state.pending) await state.pending;
    return;
  }
  state.nextAt = now + CACHE_MS;
  const current = state;
  const run = (async () => {
    try {
      const row = await db.prepare("SELECT value FROM platform_settings WHERE key = 'apple_team_id'").first<{ value: string }>();
      const valid = parseTeamId(row?.value);
      if (!valid || valid !== row?.value) throw new Error('central Team ID absent or invalid');
      current.value = valid;
      current.loaded = true;
    } catch {
      current.nextAt = now + RETRY_MS;
      // The last successful D1 value wins even if the database later becomes unavailable.
      if (!current.loaded) current.value = parseTeamId(fallback);
      console.error(JSON.stringify({ level: 'error', event: 'platform.apple_team_id.load_failed' }));
    } finally {
      current.pending = null;
    }
  })();
  state.pending = run;
  await run;
}

/** Resolves the D1 value loaded by middleware; falls back to the legacy Worker variable only if necessary. */
export function centralTeamId(env: Pick<Env, 'STARRY_APPLE_TEAM_ID'> & Partial<Pick<Env, 'DB_IDENTITY'>>): string | null {
  return (env.DB_IDENTITY && cache.get(env.DB_IDENTITY)?.value) || parseTeamId(env.STARRY_APPLE_TEAM_ID);
}

/** No App-specific overrides: all old and new Apps inherit the *same* central Team ID. */
export function effectiveTeamId(_app: Pick<AppEntry, 'ios_team_id'>, env: Pick<Env, 'STARRY_APPLE_TEAM_ID'> & Partial<Pick<Env, 'DB_IDENTITY'>>): string | null {
  return centralTeamId(env);
}

/** Caller must have Owner role + a successful staff Passkey step-up. Atomic change + security audit. */
export async function saveCentralTeamId(
  db: D1Database,
  actor: { userId: string; requestId: string | null },
  raw: string,
  now: number,
): Promise<'updated' | 'unchanged' | 'invalid'> {
  const team = parseTeamId(raw);
  if (!team) return 'invalid';
  const existing = await db.prepare("SELECT value FROM platform_settings WHERE key = 'apple_team_id'").first<{ value: string }>();
  if (existing?.value === team) return 'unchanged';
  await db.batch([
    db.prepare("INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('apple_team_id', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
      .bind(team, now, actor.userId),
    auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.apple_team_id_updated', targetType: 'platform_setting', targetId: 'apple_team_id', result: 'success', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  const state = cache.get(db);
  if (state) {
    state.value = team;
    state.loaded = true;
    state.nextAt = now + CACHE_MS;
  }
  return 'updated';
}
