import { createHash, webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const b64u = (data) => Buffer.from(data).toString('base64url');

export const APPLE_AUDIENCE = 'phd.starry.echo';
export const GOOGLE_AUDIENCE = 'echo-web-client.apps.googleusercontent.com';
export const ISSUERS = { apple: 'https://appleid.apple.com', google: 'https://accounts.google.com' };

/** A fake Apple or Google signing key pair; only the public JWK is given to the Worker. */
export async function makeProviderKey(kid) {
  const pair = await subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await subtle.exportKey('jwk', pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kty: 'RSA', n: jwk.n, e: jwk.e, kid, alg: 'RS256', use: 'sig' } };
}

export async function signJwt(key, claims, header = { alg: 'RS256', kid: key.kid }) {
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  const signature = await subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, Buffer.from(input));
  return `${input}.${b64u(signature)}`;
}

/** ES256 private JWK in the same shape as the ACCESS_TOKEN_PRIVATE_JWK secret. */
export async function makeAccessKeyJwk(kid = 'test-access-1') {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', pair.privateKey);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, kid });
}

export const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

export function idTokenClaims(provider, { sub, nonce, aud, email, now = Date.now(), ...rest }) {
  const iat = Math.floor(now / 1000);
  return {
    iss: ISSUERS[provider],
    aud: aud ?? (provider === 'apple' ? APPLE_AUDIENCE : GOOGLE_AUDIENCE),
    sub,
    nonce,
    iat,
    exp: iat + 600,
    ...(email ? { email, email_verified: provider === 'apple' ? 'true' : true } : {}),
    ...rest,
  };
}

export async function authBindings() {
  const apple = await makeProviderKey('apple-1');
  const google = await makeProviderKey('google-1');
  const bindings = {
    TERMS_VERSION: 'terms-2026-11-03',
    PRIVACY_VERSION: 'privacy-2026-11-03',
    ACCESS_TOKEN_PRIVATE_JWK: await makeAccessKeyJwk(),
    AUTH_TEST_JWKS: JSON.stringify({ apple: { keys: [apple.jwk] }, google: { keys: [google.jwk] } }),
    AUTH_TEST_AUDIENCES: JSON.stringify({ echo: { apple: [APPLE_AUDIENCE], google: [GOOGLE_AUDIENCE] } }),
  };
  return { apple, google, bindings };
}
