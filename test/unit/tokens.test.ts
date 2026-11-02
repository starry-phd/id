// Unit tests for ID-token verification, access tokens and refresh-token parsing.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadSigningKey, signAccessToken, verifyAccessToken } from '../../src/auth/access-token';
import { verifyIdToken } from '../../src/auth/id-token';
import { newRefreshToken, parseRefreshToken } from '../../src/auth/sessions';
import { base64urlDecode, base64urlEncode } from '../../src/lib/encoding';
import type { Env } from '../../src/env';
import { authBindings, idTokenClaims, sha256Hex, signJwt, GOOGLE_AUDIENCE } from '../auth-fixtures.mjs';

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

async function setup(overrides: Partial<Env> = {}) {
  const { apple, google, bindings } = await authBindings();
  const env = { STARRY_ENV: 'development', ...bindings, ...overrides } as unknown as Env;
  return { apple, google, env };
}

describe('base64url', () => {
  test('round-trips and rejects non-canonical input', () => {
    const bytes = new Uint8Array([0, 1, 250, 255, 62, 63]);
    assert.deepEqual(base64urlDecode(base64urlEncode(bytes)), bytes);
    assert.throws(() => base64urlDecode('ab+c'));
    assert.throws(() => base64urlDecode('abc='));
    assert.throws(() => base64urlDecode('a'));
    assert.throws(() => base64urlDecode('AB'.slice(0, 1) + 'F'));
  });
});

describe('verifyIdToken (S-ID-01)', () => {
  test('accepts a valid Google token with raw nonce and an Apple token with hashed nonce', async () => {
    const { apple, google, env } = await setup();
    const g = await signJwt(google, idTokenClaims('google', { sub: 'g1', nonce: 'n'.repeat(32), email: 'a@example.com', now: NOW }));
    const id = await verifyIdToken(env, 'google', g, { audiences: [GOOGLE_AUDIENCE], nonce: 'n'.repeat(32), now: NOW });
    assert.deepEqual(id, { provider: 'google', subject: 'g1', audience: GOOGLE_AUDIENCE, email: 'a@example.com', emailVerified: true, isPrivateRelay: false });
    const a = await signJwt(apple, idTokenClaims('apple', { sub: 'a1', nonce: sha256Hex('m'.repeat(32)), email: 'x@privaterelay.appleid.com', is_private_email: 'true', now: NOW }));
    const aid = await verifyIdToken(env, 'apple', a, { audiences: ['phd.starry.echo'], nonce: 'm'.repeat(32), now: NOW });
    assert.equal(aid?.isPrivateRelay, true);
    assert.equal(aid?.emailVerified, true);
  });

  test('rejects wrong audience, issuer, expiry, future iat, nonce, signature, alg and extra header keys', async () => {
    const { google, env } = await setup();
    const nonce = 'n'.repeat(32);
    const base = { sub: 'g', nonce, now: NOW };
    const sec = NOW / 1000;
    const bad: Record<string, string> = {
      aud: await signJwt(google, idTokenClaims('google', { ...base, aud: 'other' })),
      iss: await signJwt(google, idTokenClaims('google', { ...base, iss: 'https://evil.example' })),
      exp: await signJwt(google, idTokenClaims('google', { ...base, iat: sec - 7200, exp: sec - 3600 })),
      iat: await signJwt(google, idTokenClaims('google', { ...base, iat: sec + 3600 })),
      nonce: await signJwt(google, idTokenClaims('google', { ...base, nonce: 'other-nonce-value-000000000000' })),
      kid: await signJwt(google, idTokenClaims('google', base), { alg: 'RS256', kid: 'unknown' }),
      header: await signJwt(google, idTokenClaims('google', base), { alg: 'RS256', kid: 'google-1', jku: 'https://evil' }),
      alg: await signJwt(google, idTokenClaims('google', base), { alg: 'HS256', kid: 'google-1' }),
    };
    const good = await signJwt(google, idTokenClaims('google', base));
    const [h, p, s] = good.split('.');
    bad.tampered = `${h}.${base64urlEncode(Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), sub: 'admin' })))}.${s}`;
    bad.parts = `${h}.${p}`;
    for (const [name, token] of Object.entries(bad)) {
      assert.equal(await verifyIdToken(env, 'google', token, { audiences: [GOOGLE_AUDIENCE], nonce, now: NOW }), null, name);
    }
    assert.notEqual(await verifyIdToken(env, 'google', good, { audiences: [GOOGLE_AUDIENCE], nonce, now: NOW }), null);
    assert.equal(await verifyIdToken(env, 'google', good, { audiences: [], nonce, now: NOW }), null, 'no audiences configured');
  });

  test('ignores the test JWKS override outside development and then uses the network keys', async () => {
    const { google, env } = await setup({ STARRY_ENV: 'staging' } as Partial<Env>);
    const token = await signJwt(google, idTokenClaims('google', { sub: 'g', nonce: 'n'.repeat(32), now: NOW }));
    const realFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = (async (url: string) => {
      requested.push(String(url));
      return Response.json({ keys: [] });
    }) as typeof fetch;
    try {
      assert.equal(await verifyIdToken(env, 'google', token, { audiences: [GOOGLE_AUDIENCE], nonce: 'n'.repeat(32), now: NOW }), null);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.ok(requested.every((u) => u === 'https://www.googleapis.com/oauth2/v3/certs'));
    assert.ok(requested.length >= 1);
  });
});

describe('access tokens (S-ID-04)', () => {
  test('sign and verify; reject tampering, expiry, other environment', async () => {
    const { env } = await setup();
    const key = await loadSigningKey(env);
    assert.ok(key);
    const sec = NOW / 1000;
    const token = await signAccessToken(key, env, { sub: 'u1', app_id: 'echo', sid: 's1', sv: 3 }, sec);
    const claims = await verifyAccessToken(key, env, token, sec + 60);
    assert.deepEqual(claims, { iss: 'starry-id:development', aud: 'starry', sub: 'u1', app_id: 'echo', sid: 's1', sv: 3, iat: sec, exp: sec + 900 });
    assert.equal(await verifyAccessToken(key, env, token, sec + 900), null, 'expired');
    const staging = { ...env, STARRY_ENV: 'staging' } as Env;
    assert.equal(await verifyAccessToken(key, staging, token, sec), null, 'issuer of another environment');
    const [h, p, s] = token.split('.');
    const forged = `${h}.${base64urlEncode(Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, 'base64url').toString()), sub: 'u2' })))}.${s}`;
    assert.equal(await verifyAccessToken(key, env, forged, sec), null, 'tampered');
    assert.equal(await verifyAccessToken(key, env, 'x.y.z', sec), null);
    assert.equal(key.publicJwk.kid, 'test-access-1');
    assert.equal((key.publicJwk as { d?: string }).d, undefined);
  });

  test('a malformed or missing signing key fails closed', async () => {
    assert.equal(await loadSigningKey({ ACCESS_TOKEN_PRIVATE_JWK: undefined } as unknown as Env), null);
    assert.equal(await loadSigningKey({ ACCESS_TOKEN_PRIVATE_JWK: '{"kty":"RSA"}' } as unknown as Env), null);
    assert.equal(await loadSigningKey({ ACCESS_TOKEN_PRIVATE_JWK: 'not json' } as unknown as Env), null);
  });
});

describe('refresh tokens', () => {
  test('format is <uuidv7>.<43-char secret> and parsing is strict', async () => {
    const sid = '01900000-0000-7000-8000-000000000000';
    const { token, hash } = await newRefreshToken(sid);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(parseRefreshToken(token)?.sessionId, sid);
    for (const bad of ['', 'abc', `${sid}.short`, `not-a-uuid.${'a'.repeat(43)}`, `${sid}.${'a'.repeat(43)}x`, 42, null]) {
      assert.equal(parseRefreshToken(bad), null, String(bad));
    }
  });
});
