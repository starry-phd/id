import type { Env } from '../env';
import type { AppEntry } from './registry';

const TEAM_ID = /^[A-Z0-9]{10}$/;

/**
 * The Apple Developer Team ID of the whole Starry ecosystem. It is public (it appears in apple-app-site-association),
 * so it is a plain Worker variable (STARRY_APPLE_TEAM_ID in wrangler.jsonc), not a secret. An invalid value counts as unset.
 */
export function centralTeamId(env: Pick<Env, 'STARRY_APPLE_TEAM_ID'>): string | null {
  const value = (env.STARRY_APPLE_TEAM_ID ?? '').trim().toUpperCase();
  return TEAM_ID.test(value) ? value : null;
}

/** An App follows the central Team ID; a value stored on the App itself (older registrations) still wins. */
export function effectiveTeamId(app: Pick<AppEntry, 'ios_team_id'>, env: Pick<Env, 'STARRY_APPLE_TEAM_ID'>): string | null {
  return app.ios_team_id ?? centralTeamId(env);
}
