import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { authBindings, GOOGLE_AUDIENCE, idTokenClaims, sha256Hex, signJwt } from './auth-fixtures.mjs';
import { startWorker } from './helpers.mjs';

// Values from config/apps.json (echo) and the account center's Apple Services ID.
const ECHO_WEB = 'https://echo.starry.phd';
const SERVICES_ID = 'phd.starry.id.web';
const RETURN = 'echostarry://auth/apple';
const json = (body, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('App web versions and Android Apple sign-in', () => {
  let worker;
  let keys;

  before(async () => {
    keys = await authBindings();
    const audiences = { account: { apple: [SERVICES_ID], google: [GOOGLE_AUDIENCE] }, echo: { apple: ['phd.starry.echo', SERVICES_ID], google: [GOOGLE_AUDIENCE] } };
    worker = await startWorker({ bindings: { ...keys.bindings, AUTH_TEST_AUDIENCES: JSON.stringify(audiences) } });
  });
  after(async () => {
    await worker?.mf.dispose();
  });

  test('CORS: only registered App web origins may call /v1 from a browser', async () => {
    const preflight = await worker.call('/v1/auth/nonce', { method: 'OPTIONS', headers: { origin: ECHO_WEB, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), ECHO_WEB);
    assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /authorization/);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null, 'no cookies cross-site');
    const stranger = await worker.call('/v1/auth/nonce', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    assert.equal(stranger.headers.get('access-control-allow-origin'), null);

    const config = await worker.call('/v1/apps/echo/config', { headers: { origin: ECHO_WEB } });
    assert.equal(config.headers.get('access-control-allow-origin'), ECHO_WEB);
    assert.match(config.headers.get('access-control-expose-headers') ?? '', /etag/);
    assert.match(config.headers.get('vary') ?? '', /Origin/);
    assert.equal((await worker.call('/v1/apps/echo/config', { headers: { origin: 'https://evil.example' } })).headers.get('access-control-allow-origin'), null);
  });

  test('avatars may be embedded by other origins; everything else stays same-origin', async () => {
    assert.equal((await worker.call('/v1/health')).headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal((await worker.call('/v1/avatars/u/a.webp?exp=1&sig=x')).headers.get('cross-origin-resource-policy'), 'cross-origin');
  });

  test('the relay sends registered Apps to Apple with the Services ID and returns to their deep link only', async () => {
    const nonce = 'n'.repeat(32);
    const start = await worker.call(`/auth/apple/start?${new URLSearchParams({ app_id: 'echo', nonce: sha256Hex(nonce), return: RETURN, state: 'app-state-1' })}`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const apple = new URL(start.headers.get('location'));
    assert.equal(apple.origin + apple.pathname, 'https://appleid.apple.com/auth/authorize');
    assert.equal(apple.searchParams.get('client_id'), SERVICES_ID);
    assert.equal(apple.searchParams.get('redirect_uri'), 'https://api.test/auth/apple/callback');
    assert.equal(apple.searchParams.get('response_mode'), 'form_post');
    assert.equal(apple.searchParams.get('nonce'), sha256Hex(nonce));

    for (const bad of [
      { app_id: 'echo', nonce: sha256Hex(nonce), return: 'https://evil.example/steal' },
      { app_id: 'echo', nonce: 'raw-nonce-not-a-hash', return: RETURN },
      { app_id: 'account', nonce: sha256Hex(nonce), return: RETURN },
    ]) {
      assert.equal((await worker.call(`/auth/apple/start?${new URLSearchParams(bad)}`, { redirect: 'manual' })).status, 400, JSON.stringify(bad));
    }

    // Apple posts back cross-site (no Origin check, no cookie needed).
    const form = (data) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://appleid.apple.com' }, body: new URLSearchParams(data).toString() });
    const back = await worker.call('/auth/apple/callback', form({ state: apple.searchParams.get('state'), code: 'apple-code', id_token: 'h.p.s' }));
    assert.equal(back.status, 200);
    const pageHtml = await back.text();
    assert.ok(pageHtml.includes('href="echostarry://auth/apple?id_token=h.p.s&amp;code=apple-code&amp;state=app-state-1"'), pageHtml);
    assert.equal(back.headers.get('cache-control'), 'no-store');
    const cancelled = await (await worker.call('/auth/apple/callback', form({ state: apple.searchParams.get('state'), error: 'user_cancelled_authorize' }))).text();
    assert.ok(cancelled.includes('echostarry://auth/apple?error=user_cancelled_authorize'));
    assert.equal((await worker.call('/auth/apple/callback', form({ state: 'v1.forged.state', id_token: 'h.p.s', code: 'c' }))).status, 400);
  });

  test('Google relay returns to a page on the App\'s registered web origin, in the URL fragment', async () => {
    const nonce = 'g'.repeat(32);
    const back = `${ECHO_WEB}/login/done`;
    const start = await worker.call(`/auth/google/start?${new URLSearchParams({ app_id: 'echo', nonce: sha256Hex(nonce), return: back, state: 'web-1' })}`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const google = new URL(start.headers.get('location'));
    assert.equal(google.origin + google.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(google.searchParams.get('client_id'), GOOGLE_AUDIENCE);
    assert.equal(google.searchParams.get('redirect_uri'), 'https://api.test/auth/google/callback');
    assert.equal(google.searchParams.get('response_type'), 'id_token');
    assert.equal(google.searchParams.get('response_mode'), 'form_post');
    assert.equal(google.searchParams.get('nonce'), sha256Hex(nonce));
    for (const bad of [`https://evil.example/login`, 'http://echo.starry.phd/login', `${ECHO_WEB}/x#frag`]) {
      assert.equal((await worker.call(`/auth/google/start?${new URLSearchParams({ app_id: 'echo', nonce: sha256Hex(nonce), return: bad })}`, { redirect: 'manual' })).status, 400, bad);
    }
    assert.equal((await worker.call('/auth/github/start?app_id=echo')).status, 404);

    const form = (data) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://accounts.google.com' }, body: new URLSearchParams(data).toString() });
    const state = google.searchParams.get('state');
    const pageHtml = await (await worker.call('/auth/google/callback', form({ state, id_token: 'g.t.s' }))).text();
    assert.ok(pageHtml.includes(`href="${ECHO_WEB}/login/done#id_token=g.t.s&amp;state=web-1"`), pageHtml);
    assert.equal((await worker.call('/auth/apple/callback', form({ state, id_token: 'g.t.s', code: 'c' }))).status, 400, 'a Google state cannot finish an Apple sign-in');

    const { nonce: raw } = await (await worker.call('/v1/auth/nonce', json({ app_id: 'echo' }))).json();
    const idToken = await signJwt(keys.google, idTokenClaims('google', { sub: 'web-google-user', nonce: sha256Hex(raw) }));
    assert.equal((await worker.call('/v1/auth/google', json({ app_id: 'echo', id_token: idToken, nonce: raw }))).status, 200);
  });

  test('an Android App signs in with the relayed Apple token: Services ID audience, hashed nonce', async () => {
    const { nonce } = await (await worker.call('/v1/auth/nonce', json({ app_id: 'echo' }))).json();
    const idToken = await signJwt(keys.apple, idTokenClaims('apple', { sub: 'android-apple-user', nonce: sha256Hex(nonce), aud: SERVICES_ID }));
    const res = await worker.call('/v1/auth/apple', json({ app_id: 'echo', id_token: idToken, nonce, authorization_code: 'apple-code', redirect_uri: 'https://api.test/auth/apple/callback' }));
    assert.equal(res.status, 200, await res.clone().text());
    const body = await res.json();
    assert.equal(body.user.is_new, true);
    const stolen = await signJwt(keys.apple, idTokenClaims('apple', { sub: 'android-apple-user', nonce: sha256Hex(nonce), aud: SERVICES_ID }));
    assert.equal((await worker.call('/v1/auth/apple', json({ app_id: 'echo', id_token: stolen, nonce: sha256Hex(nonce) }))).status, 401, 'the hash alone is not the nonce');
  });
});
