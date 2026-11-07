// Unit tests for the App registry (S-PLT-01) and the test-only overrides used by integration tests.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getProviderKeys } from '../../src/auth/provider-keys';
import { audiencesFor, getApp, parseRegistry } from '../../src/apps/registry';
import type { Env } from '../../src/env';

const env = (values: Partial<Env>) => values as Env;
const entry = (extra: Record<string, unknown>) => ({
  brand: 'starry',
  apps: [{ app_id: 'demo', name: 'Demo', ios_bundle_id: null, android_package: null, status: 'active', scopes: [], min_version: '1.0.0', config: {}, auth: { apple_audiences: [], google_audiences: [] }, ...extra }],
});

describe('App registry', () => {
  test('Echo is registered with its bundle IDs, audiences, web origin and Apple return link', () => {
    const echo = getApp('echo');
    assert.ok(echo);
    assert.equal(echo.ios_bundle_id, 'phd.starry.echo');
    assert.equal(echo.android_package, 'phd.starry.echo');
    assert.deepEqual(echo.auth.apple, ['phd.starry.echo', 'phd.starry.id.web']);
    assert.deepEqual(echo.web_origins, ['https://echo.starry.phd', 'https://echo-api-staging.starry-phd.workers.dev']);
    assert.deepEqual(echo.return_urls, ['echostarry://auth/apple']);
    assert.deepEqual(getApp('account')?.web_origins, [], 'optional lists default to empty');
  });

  test('web origins must be bare https origins; return links must be custom-scheme deep links', () => {
    for (const bad of ['http://x.example', 'https://x.example/', 'https://x.example/path', '*']) {
      assert.throws(() => parseRegistry(entry({ web_origins: [bad] })), /web_origins/, bad);
    }
    for (const bad of ['https://evil.example/cb', 'javascript://x', 'intent://x', 'echostarry:auth', 'echostarry://a b']) {
      assert.throws(() => parseRegistry(entry({ return_urls: [bad] })), /return_urls/, bad);
    }
    const ok = parseRegistry(entry({ web_origins: ['https://app.example.com:8443'], return_urls: ['demo-app://auth/apple'] })).get('demo');
    assert.deepEqual([ok?.web_origins, ok?.return_urls], [['https://app.example.com:8443'], ['demo-app://auth/apple']]);
  });
});

describe('test-only overrides are ignored outside development', () => {
  const overrides = { AUTH_TEST_AUDIENCES: JSON.stringify({ echo: { google: ['fake-audience'] } }), AUTH_TEST_JWKS: JSON.stringify({ google: { keys: [{ kty: 'RSA', kid: 'fake', n: 'x', e: 'AQAB' }] } }) };

  test('audiences', () => {
    const echo = getApp('echo');
    assert.ok(echo);
    assert.deepEqual(audiencesFor(env({ STARRY_ENV: 'development', ...overrides }), echo, 'google'), ['fake-audience']);
    for (const STARRY_ENV of ['staging', 'production'] as const) {
      assert.deepEqual(audiencesFor(env({ STARRY_ENV, ...overrides }), echo, 'google'), echo.auth.google);
    }
  });

  test('provider keys come from Google, not from the override', async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      return Response.json({ keys: [{ kty: 'RSA', kid: 'google-real', n: 'x', e: 'AQAB' }] });
    }) as typeof fetch;
    try {
      const dev = await getProviderKeys(env({ STARRY_ENV: 'development', ...overrides }), 'google', 1, true);
      assert.deepEqual(dev.map((k) => k.kid), ['fake']);
      assert.equal(calls.length, 0);
      const staging = await getProviderKeys(env({ STARRY_ENV: 'staging', ...overrides }), 'google', 1, true);
      assert.deepEqual(staging.map((k) => k.kid), ['google-real']);
      assert.deepEqual(calls, ['https://www.googleapis.com/oauth2/v3/certs']);
    } finally {
      globalThis.fetch = original;
    }
  });
});
