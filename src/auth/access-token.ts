import type { Env } from '../env';
import { base64urlDecode, base64urlEncode, base64urlJson, parseBase64urlJson, toArrayBuffer, utf8 } from '../lib/encoding';

export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
export const ACCESS_TOKEN_AUDIENCE = 'starry';

export interface AccessClaims {
  iss: string;
  aud: typeof ACCESS_TOKEN_AUDIENCE;
  sub: string;
  app_id: string;
  sid: string;
  sv: number;
  iat: number;
  exp: number;
}

interface SigningKey {
  source: string;
  kid: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey & { kid: string; alg: 'ES256'; use: 'sig' };
}

let loaded: SigningKey | null = null;
const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

/**
 * Loads the ES256 private key from the ACCESS_TOKEN_PRIVATE_JWK secret.
 * Returns null when the secret is missing or malformed; auth endpoints then
 * answer 503 instead of issuing tokens (fail closed).
 */
export async function loadSigningKey(env: Env): Promise<SigningKey | null> {
  const source = env.ACCESS_TOKEN_PRIVATE_JWK;
  if (!source) return null;
  if (loaded?.source === source) return loaded;
  try {
    const jwk = JSON.parse(source) as JsonWebKey & { kid?: unknown };
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string' || typeof jwk.kid !== 'string') return null;
    const kid = jwk.kid;
    const privateKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }, ALGORITHM, false, ['sign']);
    const publicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid, alg: 'ES256', use: 'sig' } as const;
    const publicKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, ALGORITHM, false, ['verify']);
    loaded = { source, kid, privateKey, publicKey, publicJwk: { ...publicJwk } };
    return loaded;
  } catch {
    return null;
  }
}

export function tokenIssuer(env: Env): string {
  return `starry-id:${env.STARRY_ENV}`;
}

export async function signAccessToken(
  key: SigningKey,
  env: Env,
  claims: Pick<AccessClaims, 'sub' | 'app_id' | 'sid' | 'sv'>,
  nowSec: number,
): Promise<string> {
  const header = base64urlJson({ alg: 'ES256', typ: 'JWT', kid: key.kid });
  const body: AccessClaims = {
    iss: tokenIssuer(env),
    aud: ACCESS_TOKEN_AUDIENCE,
    ...claims,
    iat: nowSec,
    exp: nowSec + ACCESS_TOKEN_TTL_SEC,
  };
  const signingInput = `${header}.${base64urlJson(body)}`;
  const signature = await crypto.subtle.sign(SIGN, key.privateKey, utf8(signingInput));
  return `${signingInput}.${base64urlEncode(new Uint8Array(signature))}`;
}

/** Verifies signature, issuer, audience and lifetime. Session state is checked separately against D1. */
export async function verifyAccessToken(key: SigningKey, env: Env, token: string, nowSec: number): Promise<AccessClaims | null> {
  try {
    if (token.length > 2048) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = parseBase64urlJson(headerPart);
    if (!header || header.alg !== 'ES256' || header.kid !== key.kid) return null;
    const ok = await crypto.subtle.verify(SIGN, key.publicKey, toArrayBuffer(base64urlDecode(signaturePart)), utf8(`${headerPart}.${payloadPart}`));
    if (!ok) return null;
    const c = parseBase64urlJson(payloadPart);
    if (!c || c.iss !== tokenIssuer(env) || c.aud !== ACCESS_TOKEN_AUDIENCE) return null;
    if (typeof c.sub !== 'string' || typeof c.app_id !== 'string' || typeof c.sid !== 'string') return null;
    if (typeof c.sv !== 'number' || typeof c.iat !== 'number' || typeof c.exp !== 'number') return null;
    if (c.exp <= nowSec || c.iat > nowSec + 60) return null;
    return c as unknown as AccessClaims;
  } catch {
    return null;
  }
}
