// The web routes that can be hammered (Passkey sign-in, invite and owner codes, e-mail checks) are rate limited.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { app } from '../../src/app';

const blocked = { RL_WEB: { limit: async () => ({ success: false }) } };

describe('web rate limits (S-PLT-05)', () => {
  for (const [method, path] of [
    ['POST', '/account/passkey/login-options'],
    ['POST', '/account/passkey/login'],
    ['POST', '/account/redeem'],
    ['POST', '/account/claim-owner'],
    ['POST', '/account/contact-email/verify'],
    ['GET', '/account/verify-email'],
  ] as const) {
    test(`${method} ${path} answers 429 when the limiter says no`, async () => {
      const res = await app.fetch(new Request(`https://id.starry.phd${path}`, { method }), blocked as never);
      assert.equal(res.status, 429);
      assert.equal(res.headers.get('retry-after'), '60');
    });
  }

  test('an unrelated page is not limited by it', async () => {
    const res = await app.fetch(new Request('https://id.starry.phd/v1/health'), blocked as never);
    assert.notEqual(res.status, 429);
  });
});
