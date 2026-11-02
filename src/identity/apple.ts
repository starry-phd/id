import { auditStatement } from '../lib/audit';
import { base64urlEncode, base64urlJson, toArrayBuffer, utf8 } from '../lib/encoding';
import { open, seal } from '../lib/sealed';

/**
 * Sign in with Apple token handling (spec S-ID-06). Apple requires apps to revoke the
 * user's tokens when the account is deleted, which needs a refresh token obtained by
 * exchanging the authorization code the App receives at sign-in.
 *
 * Needs the secrets APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (the .p8 key, PKCS#8 PEM)
 * and DATA_ENCRYPTION_KEY. Without them sign-in still works; exchange and revocation are skipped
 * and recorded in the audit log.
 */
export interface AppleConfig {
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  encryptionKey: string;
}

export interface AppleSecrets {
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  DATA_ENCRYPTION_KEY?: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const SEAL_CONTEXT = 'apple_refresh_token';
const MAX_ATTEMPTS = 10;

export function appleConfig(env: AppleSecrets): AppleConfig | null {
  if (!env.APPLE_TEAM_ID || !env.APPLE_KEY_ID || !env.APPLE_PRIVATE_KEY || !env.DATA_ENCRYPTION_KEY) return null;
  return { teamId: env.APPLE_TEAM_ID, keyId: env.APPLE_KEY_ID, privateKeyPem: env.APPLE_PRIVATE_KEY, encryptionKey: env.DATA_ENCRYPTION_KEY };
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const binary = atob(body);
  return toArrayBuffer(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** ES256 client secret JWT for appleid.apple.com, valid for 5 minutes. */
export async function clientSecret(config: AppleConfig, clientId: string, now: number): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(config.privateKeyPem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const iat = Math.floor(now / 1000);
  const input = `${base64urlJson({ alg: 'ES256', kid: config.keyId })}.${base64urlJson({ iss: config.teamId, iat, exp: iat + 300, aud: 'https://appleid.apple.com', sub: clientId })}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, toArrayBuffer(utf8(input)));
  return `${input}.${base64urlEncode(new Uint8Array(signature))}`;
}

function form(fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(fields).toString(),
  };
}

/** Exchanges the App's one-time authorization code for a refresh token; null on any failure. */
export async function exchangeAuthorizationCode(config: AppleConfig, clientId: string, code: string, fetchFn: FetchLike, now: number): Promise<string | null> {
  try {
    const res = await fetchFn(TOKEN_URL, form({ client_id: clientId, client_secret: await clientSecret(config, clientId, now), code, grant_type: 'authorization_code' }));
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const token = typeof body === 'object' && body !== null ? (body as { refresh_token?: unknown }).refresh_token : undefined;
    return typeof token === 'string' && token.length > 0 && token.length <= 2048 ? token : null;
  } catch {
    return null;
  }
}

export async function revokeRefreshToken(config: AppleConfig, clientId: string, refreshToken: string, fetchFn: FetchLike, now: number): Promise<boolean> {
  try {
    const res = await fetchFn(REVOKE_URL, form({ client_id: clientId, client_secret: await clientSecret(config, clientId, now), token: refreshToken, token_type_hint: 'refresh_token' }));
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Called after a successful Apple sign-in or link when the App sent an authorization code.
 * Failures never block sign-in; they are audited so missing revocation capability is visible.
 */
export async function rememberAppleToken(
  db: D1Database,
  env: AppleSecrets,
  fetchFn: FetchLike,
  input: { userId: string; subject: string; clientId: string; code: string; appId: string | null; requestId: string | null },
  now: number,
): Promise<boolean> {
  const config = appleConfig(env);
  const refreshToken = config ? await exchangeAuthorizationCode(config, input.clientId, input.code, fetchFn, now) : null;
  const sealed = config && refreshToken ? await seal(config.encryptionKey, SEAL_CONTEXT, refreshToken) : null;
  if (!sealed) {
    await auditStatement(db, { actorType: 'system', actorUserId: input.userId, action: 'apple.token_exchange', targetType: 'user', targetId: input.userId, appId: input.appId, result: 'error', requestId: input.requestId, retention: 'security' }, now).run();
    return false;
  }
  await db
    .prepare(
      `INSERT INTO apple_tokens (subject, client_id, user_id, refresh_token_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (subject, client_id) DO UPDATE SET user_id = excluded.user_id, refresh_token_enc = excluded.refresh_token_enc, updated_at = excluded.updated_at`,
    )
    .bind(input.subject, input.clientId, input.userId, sealed, now, now)
    .run();
  return true;
}

/** Works through queued revocations with exponential backoff (1 h, 2 h, … capped at 24 h). */
export async function processAppleRevocations(db: D1Database, env: AppleSecrets, fetchFn: FetchLike, now: number, limit = 20): Promise<{ revoked: number; failed: number; abandoned: number }> {
  const outcome = { revoked: 0, failed: 0, abandoned: 0 };
  const due = await db
    .prepare('SELECT revocation_id, client_id, refresh_token_enc, attempts FROM apple_revocations WHERE next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?')
    .bind(now, limit)
    .all<{ revocation_id: string; client_id: string; refresh_token_enc: string; attempts: number }>();
  const config = appleConfig(env);
  for (const row of due.results) {
    const token = config ? await open(config.encryptionKey, SEAL_CONTEXT, row.refresh_token_enc) : null;
    const ok = config !== null && token !== null && (await revokeRefreshToken(config, row.client_id, token, fetchFn, now));
    if (ok) {
      await db.batch([
        db.prepare('DELETE FROM apple_revocations WHERE revocation_id = ?').bind(row.revocation_id),
        auditStatement(db, { actorType: 'system', action: 'apple.token_revoked', targetType: 'apple_revocation', targetId: row.revocation_id, result: 'success', retention: 'security' }, now),
      ]);
      outcome.revoked++;
      continue;
    }
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await db.batch([
        db.prepare('DELETE FROM apple_revocations WHERE revocation_id = ?').bind(row.revocation_id),
        auditStatement(db, { actorType: 'system', action: 'apple.token_revoke_abandoned', targetType: 'apple_revocation', targetId: row.revocation_id, result: 'error', retention: 'security' }, now),
      ]);
      outcome.abandoned++;
      continue;
    }
    const backoff = Math.min(60 * 60 * 1000 * 2 ** (attempts - 1), 24 * 60 * 60 * 1000);
    await db.prepare('UPDATE apple_revocations SET attempts = ?, next_attempt_at = ? WHERE revocation_id = ?').bind(attempts, now + backoff, row.revocation_id).run();
    outcome.failed++;
  }
  return outcome;
}
