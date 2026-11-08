import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { authBindings, idTokenClaims, makeProviderKey, sha256Hex, signJwt } from './auth-fixtures.mjs';
import { startWorker } from './helpers.mjs';

const json = (body, headers = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

describe('Starry ID sign-in, sessions and profile', () => {
  let worker;
  let keys;

  before(async () => {
    keys = await authBindings();
    worker = await startWorker({ bindings: keys.bindings });
  });
  after(async () => {
    await worker?.mf.dispose();
  });

  async function nonce() {
    const res = await worker.call('/v1/auth/nonce', json({ app_id: 'echo' }));
    assert.equal(res.status, 200);
    return (await res.json()).nonce;
  }

  async function signIn(provider, sub, { claims = {}, hashNonce = false, email } = {}) {
    const n = await nonce();
    const token = await signJwt(keys[provider], idTokenClaims(provider, { sub, nonce: hashNonce ? sha256Hex(n) : n, email, ...claims }));
    return worker.call(`/v1/auth/${provider}`, json({ app_id: 'echo', id_token: token, nonce: n, device_label: 'test phone' }));
  }

  async function signInOk(provider, sub, options) {
    const res = await signIn(provider, sub, options);
    assert.equal(res.status, 200, await res.clone().text());
    return res.json();
  }

  const authed = (token, init = {}) => ({ ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });

  test('Google sign-up creates a member; signing in again returns the same member', async () => {
    const first = await signInOk('google', 'google-sub-1', { email: 'a@example.com' });
    assert.equal(first.token_type, 'Bearer');
    assert.equal(first.expires_in, 900);
    assert.equal(first.user.is_new, true);
    assert.equal(first.user.status, 'active');
    assert.equal(first.consent_required, true);
    assert.match(first.user.user_id, /^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    const second = await signInOk('google', 'google-sub-1');
    assert.equal(second.user.user_id, first.user.user_id);
    assert.equal(second.user.is_new, false);
  });

  test('Apple sign-in accepts a SHA-256 hashed nonce', async () => {
    const body = await signInOk('apple', 'apple-sub-1', { hashNonce: true, email: 'x@privaterelay.appleid.com', claims: { is_private_email: 'true' } });
    assert.equal(body.user.is_new, true);
  });

  test('the same email on another provider never merges into an existing member', async () => {
    const google = await signInOk('google', 'google-sub-merge', { email: 'same@example.com' });
    const apple = await signInOk('apple', 'apple-sub-merge', { email: 'same@example.com' });
    assert.notEqual(google.user.user_id, apple.user.user_id);
  });

  test('rejects tokens with the wrong audience, issuer, lifetime, signature or nonce', async () => {
    const now = Date.now();
    const cases = {
      audience: { aud: 'someone-elses-app' },
      issuer: { iss: 'https://evil.example.com' },
      expired: { iat: Math.floor(now / 1000) - 7200, exp: Math.floor(now / 1000) - 3600 },
      futureIat: { iat: Math.floor(now / 1000) + 3600 },
      nonce: { nonce: 'a-completely-different-nonce' },
    };
    for (const [name, claims] of Object.entries(cases)) {
      const res = await signIn('google', `bad-${name}`, { claims });
      assert.equal(res.status, 401, name);
      assert.equal((await res.json()).error.code, 'INVALID_TOKEN', name);
    }
    const impostor = await makeProviderKey('google-1');
    const n = await nonce();
    const forged = await signJwt(impostor, idTokenClaims('google', { sub: 'forged', nonce: n }));
    const res = await worker.call('/v1/auth/google', json({ app_id: 'echo', id_token: forged, nonce: n }));
    assert.equal(res.status, 401);
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'google-1' })).toString('base64url')}.${Buffer.from(JSON.stringify(idTokenClaims('google', { sub: 'none', nonce: n }))).toString('base64url')}.`;
    assert.equal((await worker.call('/v1/auth/google', json({ app_id: 'echo', id_token: none, nonce: n }))).status, 401);
  });

  test('a nonce works once and only for the app that requested it', async () => {
    const n = await nonce();
    const token = await signJwt(keys.google, idTokenClaims('google', { sub: 'nonce-once', nonce: n }));
    const body = { app_id: 'echo', id_token: token, nonce: n };
    assert.equal((await worker.call('/v1/auth/google', json(body))).status, 200);
    const replay = await worker.call('/v1/auth/google', json(body));
    assert.equal(replay.status, 401);
    assert.equal((await replay.json()).error.code, 'INVALID_NONCE');
    const unknownNonce = 'x'.repeat(32);
    const token2 = await signJwt(keys.google, idTokenClaims('google', { sub: 'nonce-unknown', nonce: unknownNonce }));
    const res = await worker.call('/v1/auth/google', json({ app_id: 'echo', id_token: token2, nonce: unknownNonce }));
    assert.equal((await res.json()).error.code, 'INVALID_NONCE');
  });

  test('expired nonces are cleaned up when new ones are issued', async () => {
    const old = Date.now() - 60 * 60 * 1000;
    await worker.db
      .prepare('INSERT INTO auth_nonces (nonce, app_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind('stale-nonce-0000000000', 'echo', old, old + 1000)
      .run();
    await nonce();
    const row = await worker.db.prepare("SELECT COUNT(*) AS n FROM auth_nonces WHERE nonce = 'stale-nonce-0000000000'").first();
    assert.equal(row.n, 0);
  });

  test('bad requests are rejected before any token work', async () => {
    assert.equal((await worker.call('/v1/auth/nonce', json({ app_id: 'nope' }))).status, 400);
    assert.equal((await worker.call('/v1/auth/google', json({ app_id: 'echo' }))).status, 400);
    const notJson = await worker.call('/v1/auth/google', { method: 'POST', body: 'not json' });
    assert.equal(notJson.status, 415);
    assert.equal((await notJson.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE');
    const malformed = await worker.call('/v1/auth/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'BAD_REQUEST');
    assert.equal((await worker.call('/v1/auth/facebook', json({}))).status, 404);
  });

  test('GET /v1/me requires a valid access token and returns profile and consent state', async () => {
    assert.equal((await worker.call('/v1/me')).status, 401);
    assert.equal((await worker.call('/v1/me', authed('not.a.token'))).status, 401);
    const session = await signInOk('google', 'me-sub', { email: 'me@example.com' });
    const res = await worker.call('/v1/me', authed(session.access_token));
    assert.equal(res.status, 200);
    const me = await res.json();
    assert.equal(me.user_id, session.user.user_id);
    assert.equal(me.profile.version, 1);
    assert.equal(me.profile.locale, 'zh-TW');
    assert.deepEqual(me.identities, [{ provider: 'google', email: 'me@example.com', email_is_private_relay: false }]);
    assert.equal(me.consent.required, true);
    assert.equal(res.headers.get('etag'), '"1"');
  });

  test('consent must match the current versions', async () => {
    const session = await signInOk('google', 'consent-sub');
    const wrong = await worker.call('/v1/me/consents', authed(session.access_token, json({ terms_version: 'old', privacy_version: 'old' })));
    assert.equal(wrong.status, 400);
    const ok = await worker.call(
      '/v1/me/consents',
      authed(session.access_token, json({ terms_version: 'terms-2026-11-03', privacy_version: 'privacy-2026-11-03' })),
    );
    assert.equal(ok.status, 204);
    const me = await (await worker.call('/v1/me', authed(session.access_token))).json();
    assert.equal(me.consent.required, false);
    const again = await signInOk('google', 'consent-sub');
    assert.equal(again.consent_required, false);
  });

  test('profile updates need If-Match and reject stale versions', async () => {
    const session = await signInOk('google', 'profile-sub');
    const patch = (body, ifMatch) =>
      worker.call('/v1/me/profile', authed(session.access_token, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...(ifMatch ? { 'if-match': ifMatch } : {}) },
        body: JSON.stringify(body),
      }));
    assert.equal((await patch({ display_name: '小星' })).status, 428);
    const ok = await patch({ display_name: ' 小星 ', birthday: '1990-02-28', locale: 'zh-TW' }, '"1"');
    assert.equal(ok.status, 200);
    const okBody = await ok.json();
    assert.deepEqual([okBody.profile.display_name, okBody.profile.birthday, okBody.profile.version], ['小星', '1990-02-28', 2]);
    const stale = await patch({ display_name: '舊畫面' }, '"1"');
    assert.equal(stale.status, 409);
    const staleBody = await stale.json();
    assert.equal(staleBody.error.code, 'VERSION_CONFLICT');
    assert.equal(staleBody.profile.display_name, '小星');
    for (const body of [{ birthday: '1990-02-30' }, { birthday: '2999-01-01' }, { display_name: '' }, { user_id: 'x' }, { locale: 'Chinese' }, {}]) {
      assert.equal((await patch(body, '"2"')).status, 400, JSON.stringify(body));
    }
  });

  test('refresh rotates the token; reusing an old refresh token revokes the session', async () => {
    const session = await signInOk('apple', 'refresh-sub');
    const refresh = (token) => worker.call('/v1/auth/refresh', json({ refresh_token: token }));
    const r1 = await refresh(session.refresh_token);
    assert.equal(r1.status, 200);
    const rotated = await r1.json();
    assert.notEqual(rotated.refresh_token, session.refresh_token);
    assert.equal((await worker.call('/v1/me', authed(rotated.access_token))).status, 200);
    const reuse = await refresh(session.refresh_token);
    assert.equal(reuse.status, 401);
    assert.equal((await reuse.json()).error.code, 'REFRESH_REUSED');
    assert.equal((await worker.call('/v1/me', authed(rotated.access_token))).status, 401);
    assert.equal((await refresh(rotated.refresh_token)).status, 401);
    assert.equal((await refresh('garbage')).status, 401);
  });

  test('logout ends only the current session', async () => {
    const a = await signInOk('google', 'logout-sub');
    const b = await signInOk('google', 'logout-sub');
    assert.equal((await worker.call('/v1/auth/logout', authed(a.access_token, { method: 'POST' }))).status, 204);
    assert.equal((await worker.call('/v1/me', authed(a.access_token))).status, 401);
    assert.equal((await worker.call('/v1/auth/refresh', json({ refresh_token: a.refresh_token }))).status, 401);
    assert.equal((await worker.call('/v1/me', authed(b.access_token))).status, 200);
  });

  test('logout-all invalidates every session immediately', async () => {
    const a = await signInOk('google', 'logout-all-sub');
    const b = await signInOk('google', 'logout-all-sub');
    assert.equal((await worker.call('/v1/auth/logout-all', authed(a.access_token, { method: 'POST' }))).status, 204);
    assert.equal((await worker.call('/v1/me', authed(a.access_token))).status, 401);
    assert.equal((await worker.call('/v1/me', authed(b.access_token))).status, 401);
    assert.equal((await worker.call('/v1/auth/refresh', json({ refresh_token: b.refresh_token }))).status, 401);
    const fresh = await signInOk('google', 'logout-all-sub');
    assert.equal((await worker.call('/v1/me', authed(fresh.access_token))).status, 200);
  });

  test('device sign-on: one sign-in reaches other Apps, a switch or sign-out follows everywhere', async () => {
    const post = (path, body, token) => worker.call(path, json(body, token ? { authorization: `Bearer ${token}` } : {}));
    const a = await signInOk('google', 'sso-sub-a');
    const started = await post('/v1/auth/sso/start', {}, a.access_token);
    assert.equal(started.status, 200);
    const { sso_token } = await started.json();
    // Another App signs in with the shared token as the same member.
    const ex = await post('/v1/auth/sso/exchange', { app_id: 'recordnote', sso_token });
    assert.equal(ex.status, 200, await ex.clone().text());
    const other = await ex.json();
    assert.equal(other.user.user_id, a.user.user_id);
    assert.equal((await worker.call('/v1/me', authed(other.access_token))).status, 200);
    assert.equal((await (await post('/v1/auth/sso/status', { sso_token })).json()).user_id, a.user.user_id);
    // A forged or unknown token and an unknown App are refused.
    assert.equal((await post('/v1/auth/sso/exchange', { app_id: 'recordnote', sso_token: `${sso_token.slice(0, -3)}AAA` })).status, 401);
    assert.equal((await post('/v1/auth/sso/exchange', { app_id: 'nope', sso_token })).status, 400);
    // Another member signs in on this device: the first member's sessions end in every App.
    const b = await signInOk('google', 'sso-sub-b');
    const switched = await post('/v1/auth/sso/start', { previous_sso_token: sso_token }, b.access_token);
    assert.equal(switched.status, 200);
    const next = (await switched.json()).sso_token;
    assert.equal((await (await post('/v1/auth/sso/status', { sso_token })).json()).active, false);
    assert.equal((await post('/v1/auth/refresh', { refresh_token: other.refresh_token })).status, 401);
    assert.equal((await worker.call('/v1/me', authed(a.access_token))).status, 401);
    const nb = await (await post('/v1/auth/sso/exchange', { app_id: 'recordnote', sso_token: next })).json();
    assert.equal(nb.user.user_id, b.user.user_id);
    // Signing out once signs out every App on the device.
    assert.equal((await post('/v1/auth/sso/logout', { sso_token: next })).status, 204);
    assert.equal((await worker.call('/v1/me', authed(nb.access_token))).status, 401);
    assert.equal((await worker.call('/v1/me', authed(b.access_token))).status, 401);
    assert.equal((await post('/v1/auth/sso/exchange', { app_id: 'recordnote', sso_token: next })).status, 401);
    assert.equal((await post('/v1/auth/sso/logout', { sso_token: next })).status, 204);
  });

  test('logout-all also ends the device sign-on token', async () => {
    const a = await signInOk('google', 'sso-all-sub');
    const { sso_token } = await (await worker.call('/v1/auth/sso/start', json({}, { authorization: `Bearer ${a.access_token}` }))).json();
    assert.equal((await worker.call('/v1/auth/logout-all', authed(a.access_token, { method: 'POST' }))).status, 204);
    assert.equal((await worker.call('/v1/auth/sso/exchange', json({ app_id: 'recordnote', sso_token }))).status, 401);
  });

  test('web device sign-on: adopt, check, exchange once, sign out everywhere', async () => {
    const WEB = 'https://echo.starry.phd/app';
    const post = (path, body, token) => worker.call(path, json(body, token ? { authorization: `Bearer ${token}` } : {}));
    const fragment = (res) => new URLSearchParams(new URL(res.headers.get('location')).hash.slice(1));
    const a = await signInOk('google', 'web-sso-sub');
    const { sso_token } = await (await post('/v1/auth/sso/start', {}, a.access_token)).json();
    const { code } = await (await post('/v1/auth/sso/web-code', { sso_token })).json();
    const query = (extra) => new URLSearchParams({ app_id: 'echo', return: WEB, ...extra }).toString();
    // The browser keeps the device token in a cookie on id.starry.phd.
    const adopt = await worker.call(`/auth/sso/adopt?${query({ c: code })}`, { redirect: 'manual' });
    assert.equal(adopt.status, 302);
    assert.equal(fragment(adopt).get('sso_adopted'), '1');
    const setCookie = adopt.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /__Host-starry_sso=/);
    assert.match(setCookie, /HttpOnly/i);
    const cookie = { cookie: `__Host-starry_sso=${/__Host-starry_sso=([^;]+)/.exec(setCookie)[1]}` };
    // Another web App asks who is signed in and exchanges the one-time code.
    const n = await nonce();
    const check = await worker.call(`/auth/sso/check?${query({ nonce: sha256Hex(n), state: 's1' })}`, { redirect: 'manual', headers: cookie });
    const got = fragment(check);
    assert.equal(got.get('sso_user'), a.user.user_id);
    assert.equal(got.get('state'), 's1');
    const wrongNonce = await post('/v1/auth/sso/web-exchange', { app_id: 'echo', code: got.get('sso_code'), nonce: 'x'.repeat(32) });
    assert.equal(wrongNonce.status, 401);
    const ex = await post('/v1/auth/sso/web-exchange', { app_id: 'echo', code: got.get('sso_code'), nonce: n });
    assert.equal(ex.status, 200, await ex.clone().text());
    const session = await ex.json();
    assert.equal(session.user.user_id, a.user.user_id);
    assert.equal((await post('/v1/auth/sso/web-exchange', { app_id: 'echo', code: got.get('sso_code'), nonce: n })).status, 401, 'one use only');
    // Without the cookie, or with a forged or bad return address, nothing is released.
    assert.equal(fragment(await worker.call(`/auth/sso/check?${query({ nonce: sha256Hex(n) })}`, { redirect: 'manual' })).get('sso_none'), '1');
    assert.equal((await worker.call(`/auth/sso/check?${new URLSearchParams({ app_id: 'echo', return: 'https://evil.example/x', nonce: sha256Hex(n) })}`, { redirect: 'manual', headers: cookie })).status, 400);
    assert.equal(fragment(await worker.call(`/auth/sso/adopt?${query({ c: 'v1.forged.code' })}`, { redirect: 'manual' })).get('sso_none'), '1');
    // Signing out once ends every App of this browser.
    const out = await worker.call(`/auth/sso/logout?${query()}`, { redirect: 'manual', headers: cookie });
    assert.equal(out.status, 302);
    assert.equal((await worker.call('/v1/me', authed(session.access_token))).status, 401);
    const n2 = await nonce();
    assert.equal(fragment(await worker.call(`/auth/sso/check?${query({ nonce: sha256Hex(n2) })}`, { redirect: 'manual', headers: cookie })).get('sso_none'), '1');
  });

  test('an App opens the member block and member pages in its web view without a second sign-in', async () => {
    const a = await signInOk('google', 'web-link-sub');
    const link = (body, token = a.access_token) => worker.call('/v1/me/web-link', json(body, { authorization: `Bearer ${token}` }));
    assert.equal((await worker.call('/v1/me/web-link', json({ page: 'card' }))).status, 401, 'needs the App sign-in');
    assert.equal((await link({ page: 'admin' })).status, 400, 'only the fixed member pages');
    const first = await link({ page: 'card' });
    assert.equal(first.status, 200);
    const { url, expires_in } = await first.json();
    assert.equal(expires_in, 120);
    assert.match(url, /^https:\/\/[^/]+\/auth\/app-open\?c=/);
    const path = url.slice(new URL(url).origin.length);
    const open = await worker.call(path, { redirect: 'manual' });
    assert.equal(open.status, 302);
    assert.equal(open.headers.get('location'), '/account/card?app=echo');
    assert.equal(open.headers.get('cache-control'), 'no-store');
    const setCookie = open.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /__Host-starry_session=/);
    assert.match(setCookie, /HttpOnly/i);
    const cookie = { cookie: `__Host-starry_session=${/__Host-starry_session=([^;]+)/.exec(setCookie)[1]}` };
    const card = await worker.call('/account/card?app=echo', { headers: cookie });
    assert.equal(card.status, 200);
    const text = await card.text();
    assert.match(text, /🔋/);
    assert.match(text, /⚛️/);
    assert.match(text, /Passkey <b>0<\/b>/);
    assert.doesNotMatch(text, /共用月額度|恢復|預留/, 'no battery explanation on the standard block');
    assert.doesNotMatch(text, /class="starnav"/, 'no site menu inside the App');
    assert.equal((await worker.call('/account/card', { redirect: 'manual' })).status, 303, 'signed out: sent to sign-in');
    // The code works once, only for the member and App it was made for, and not after logout-all.
    assert.equal((await worker.call(path, { redirect: 'manual' })).status, 400);
    assert.equal((await worker.call('/auth/app-open?c=v1.forged.code', { redirect: 'manual' })).status, 400);
    const profile = await (await link({ page: 'profile' })).json();
    const second = await worker.call(profile.url.slice(new URL(profile.url).origin.length), { redirect: 'manual' });
    assert.equal(second.headers.get('location'), '/account/profile');
    const late = await (await link({ page: 'network' })).json();
    assert.equal((await worker.call('/v1/auth/logout-all', authed(a.access_token, { method: 'POST' }))).status, 204);
    assert.equal((await worker.call(late.url.slice(new URL(late.url).origin.length), { redirect: 'manual' })).status, 400);
    const audited = await worker.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'web.login.app' AND result = 'success'").first();
    assert.equal(audited.n, 2);
  });

  test('a suspended member cannot use existing tokens or sign in', async () => {
    const session = await signInOk('google', 'suspend-sub');
    await worker.db.prepare("UPDATE users SET status = 'suspended' WHERE user_id = ?").bind(session.user.user_id).run();
    const me = await worker.call('/v1/me', authed(session.access_token));
    assert.equal(me.status, 403);
    assert.equal((await me.json()).error.code, 'ACCOUNT_SUSPENDED');
    assert.equal((await signIn('google', 'suspend-sub')).status, 403);
  });

  test('sign-in, sign-up and refresh reuse are audited without secrets', async () => {
    const { results } = await worker.db.prepare('SELECT action, result FROM audit_log').all();
    const actions = new Set(results.map((r) => `${r.action}:${r.result}`));
    for (const expected of ['auth.signup:success', 'auth.login.google:success', 'auth.login.google:denied', 'auth.refresh_reuse:denied', 'auth.logout_all:success']) {
      assert.ok(actions.has(expected), expected);
    }
    const dump = JSON.stringify((await worker.db.prepare('SELECT * FROM audit_log').all()).results);
    assert.doesNotMatch(dump, /eyJ/);
  });

  test('JWKS publishes the public key only', async () => {
    const res = await worker.call('/.well-known/jwks.json');
    assert.equal(res.status, 200);
    const { keys: published } = await res.json();
    assert.equal(published.length, 1);
    assert.equal(published[0].kty, 'EC');
    assert.equal(published[0].d, undefined);
  });
});

describe('fail-closed configuration', () => {
  test('without a signing key, sign-in and JWKS answer 503', async () => {
    const { bindings } = await authBindings();
    delete bindings.ACCESS_TOKEN_PRIVATE_JWK;
    const worker = await startWorker({ bindings });
    try {
      const n = (await (await worker.call('/v1/auth/nonce', json({ app_id: 'echo' }))).json()).nonce;
      const res = await worker.call('/v1/auth/google', json({ app_id: 'echo', id_token: 'a.b.c', nonce: n }));
      assert.equal(res.status, 503);
      assert.equal((await res.json()).error.code, 'AUTH_NOT_CONFIGURED');
      assert.equal((await worker.call('/.well-known/jwks.json')).status, 503);
    } finally {
      await worker.mf.dispose();
    }
  });

  test('outside development a bad token is refused against the configured audiences', async () => {
    // test/unit/registry.test.ts checks that the test-only key and audience overrides are ignored.
    const { bindings } = await authBindings();
    const worker = await startWorker({ bindings: { ...bindings, STARRY_ENV: 'staging' } });
    try {
      const n = (await (await worker.call('/v1/auth/nonce', json({ app_id: 'echo' }))).json()).nonce;
      const res = await worker.call('/v1/auth/google', json({ app_id: 'echo', id_token: 'a.b.c', nonce: n }));
      assert.equal(res.status, 401);
      assert.equal((await res.json()).error.code, 'INVALID_TOKEN');
    } finally {
      await worker.mf.dispose();
    }
  });
});
