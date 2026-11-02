import type { Env } from '../env';
import { sha256Hex } from '../lib/crypto';
import { base64urlDecode, parseBase64urlJson, toArrayBuffer, utf8 } from '../lib/encoding';
import { getProviderKeys, PROVIDERS, type Provider, type ProviderJwk } from './provider-keys';

export interface ProviderIdentity {
  provider: Provider;
  subject: string;
  audience: string;
  email: string | null;
  emailVerified: boolean;
  isPrivateRelay: boolean;
}

const MAX_TOKEN_LENGTH = 8192;
const CLOCK_SKEW_SEC = 60;
const MAX_TOKEN_AGE_SEC = 60 * 60;

function isTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

async function verifySignature(jwk: ProviderJwk, signingInput: string, signature: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, toArrayBuffer(signature), toArrayBuffer(utf8(signingInput)));
  } catch {
    return false;
  }
}

/**
 * Verifies an Apple or Google ID token obtained natively by the App (spec S-ID-01).
 * Accepts the nonce either as sent or as its SHA-256 hex digest, because some
 * client SDKs hash the nonce before handing it to the provider.
 * Returns null for every failure; callers must not reveal which check failed.
 */
export async function verifyIdToken(
  env: Env,
  provider: Provider,
  token: string,
  expected: { audiences: readonly string[]; nonce: string; now: number },
): Promise<ProviderIdentity | null> {
  if (token.length > MAX_TOKEN_LENGTH || expected.audiences.length === 0) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = parseBase64urlJson(headerPart);
  if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  if (Object.keys(header).some((k) => !['alg', 'kid', 'typ'].includes(k))) return null;

  let signature: Uint8Array;
  try {
    signature = base64urlDecode(signaturePart);
  } catch {
    return null;
  }
  const signingInput = `${headerPart}.${payloadPart}`;
  let keys = await getProviderKeys(env, provider, expected.now);
  let key = keys.find((k) => k.kid === header.kid);
  if (!key) {
    keys = await getProviderKeys(env, provider, expected.now, true);
    key = keys.find((k) => k.kid === header.kid);
  }
  if (!key || !(await verifySignature(key, signingInput, signature))) return null;

  const claims = parseBase64urlJson(payloadPart);
  if (!claims) return null;
  const nowSec = Math.floor(expected.now / 1000);
  const { iss, aud, sub, exp, iat, nonce } = claims;
  if (typeof iss !== 'string' || !PROVIDERS[provider].issuers.includes(iss)) return null;
  if (typeof sub !== 'string' || sub.length < 1 || sub.length > 255) return null;
  if (typeof exp !== 'number' || exp + CLOCK_SKEW_SEC <= nowSec) return null;
  if (typeof iat !== 'number' || iat > nowSec + CLOCK_SKEW_SEC || iat < nowSec - MAX_TOKEN_AGE_SEC) return null;

  const audiences = typeof aud === 'string' ? [aud] : Array.isArray(aud) ? aud : [];
  const audience = audiences.find((a): a is string => typeof a === 'string' && expected.audiences.includes(a));
  if (!audience) return null;

  if (typeof nonce !== 'string' || (nonce !== expected.nonce && nonce !== (await sha256Hex(expected.nonce)))) return null;

  const email = typeof claims.email === 'string' && claims.email.length <= 320 ? claims.email : null;
  return {
    provider,
    subject: sub,
    audience,
    email,
    emailVerified: isTrue(claims.email_verified),
    isPrivateRelay: provider === 'apple' && isTrue(claims.is_private_email),
  };
}
