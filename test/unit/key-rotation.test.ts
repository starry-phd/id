// Signing key rotation: tokens signed with the retired key stay valid until they expire, new tokens use the new key,
// and an unknown or removed key is refused.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSigningKey, signAccessToken, verifyAccessToken } from '../../src/auth/access-token';
import type { Env } from '../../src/env';

async function newJwk(kid: string) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, kid };
}
const claims = { sub: 'u', app_id: 'a', sid: 's', sv: 1 };
const NOW = Math.floor(Date.now() / 1000);

test('a retired key keeps verifying until it is removed', async () => {
  const oldJwk = await newJwk('k1');
  const newer = await newJwk('k2');
  const base = { STARRY_ENV: 'test' } as Env;
  const oldKey = await loadSigningKey({ ...base, ACCESS_TOKEN_PRIVATE_JWK: JSON.stringify(oldJwk) });
  assert.ok(oldKey);
  const oldToken = await signAccessToken(oldKey, base, claims, NOW);

  const rotated = { ...base, ACCESS_TOKEN_PRIVATE_JWK: JSON.stringify(newer), ACCESS_TOKEN_PREVIOUS_JWKS: JSON.stringify([{ kty: 'EC', crv: 'P-256', x: oldJwk.x, y: oldJwk.y, kid: 'k1' }]) };
  const key = await loadSigningKey(rotated);
  assert.ok(key);
  assert.equal(key.kid, 'k2');
  assert.deepEqual(key.retired.map((r) => r.kid), ['k1']);
  assert.ok(await verifyAccessToken(key, rotated, oldToken, NOW), 'old token still valid');
  assert.ok(await verifyAccessToken(key, rotated, await signAccessToken(key, rotated, claims, NOW), NOW), 'new token valid');

  const removed = await loadSigningKey({ ...base, ACCESS_TOKEN_PRIVATE_JWK: JSON.stringify(newer) });
  assert.ok(removed);
  assert.equal(await verifyAccessToken(removed, base, oldToken, NOW), null, 'old token refused after the retired key is removed');
});
