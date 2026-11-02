import type { Env } from '../env';
import { randomToken, sha256Hex } from '../lib/crypto';
import { ACCESS_TOKEN_TTL_SEC, loadSigningKey, signAccessToken } from './access-token';

export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export interface TokenPair {
  token_type: 'Bearer';
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
}

/** Refresh tokens look like "<session_id>.<secret>"; only SHA-256(secret) is stored. */
export async function newRefreshToken(sessionId: string): Promise<{ token: string; hash: string }> {
  const secret = randomToken(32);
  return { token: `${sessionId}.${secret}`, hash: await sha256Hex(secret) };
}

export function parseRefreshToken(token: unknown): { sessionId: string; secret: string } | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const dot = token.indexOf('.');
  const sessionId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  return dot > 0 && UUID.test(sessionId) && SECRET.test(secret) ? { sessionId, secret } : null;
}

export async function issueTokenPair(
  env: Env,
  session: { userId: string; appId: string; sessionId: string; sessionVersion: number; refreshToken: string },
  now: number,
): Promise<TokenPair> {
  const key = await loadSigningKey(env);
  if (!key) throw new Error('ACCESS_TOKEN_KEY_MISSING');
  const access = await signAccessToken(
    key,
    env,
    { sub: session.userId, app_id: session.appId, sid: session.sessionId, sv: session.sessionVersion },
    Math.floor(now / 1000),
  );
  return {
    token_type: 'Bearer',
    access_token: access,
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: session.refreshToken,
    refresh_expires_in: Math.floor(REFRESH_TTL_MS / 1000),
  };
}
