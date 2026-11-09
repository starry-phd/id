// The App frontend client (sdk/starry-client.ts): token handling, relay and Passkey sign-in, start-up check.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';
import { starrySettingsBlocks, base64urlDecode, base64urlEncode, compareVersions, memoryStorage, parseRelayResult, StarryClient, StarryError, type PasskeyAdapter, type StarryClientOptions } from '../../sdk/starry-client';

const BASE = 'https://id.test';
const NOW = Date.UTC(2026, 11, 1, 12, 0, 0);

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  auth: string | null;
}

/** A tiny fake Starry ID: handlers by "METHOD /path"; every call is recorded. */
function server(handlers: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const call: Call = { method: init?.method ?? 'GET', path: url.pathname, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null, auth: headers.get('authorization') };
    calls.push(call);
    const handler = handlers[`${call.method} ${call.path}`];
    if (!handler) return Response.json({ error: { code: 'NOT_FOUND', message: 'no' } }, { status: 404 });
    return handler(call);
  };
  return { calls, fetchFn };
}

const tokens = (n: number) => ({ token_type: 'Bearer', access_token: `access-${n}`, expires_in: 900, refresh_token: `refresh-${n}`, refresh_expires_in: 2592000 });
const signIn = (n: number, consent = false) => Response.json({ ...tokens(n), user: { user_id: 'u1', status: 'active', is_new: false, deletion_purge_at: null }, consent_required: consent });
const fail = (status: number, code: string) => Response.json({ error: { code, message: code, request_id: 'req-1' } }, { status });

function make(handlers: Parameters<typeof server>[0], extra: Partial<StarryClientOptions> = {}) {
  const s = server(handlers);
  const storage = memoryStorage();
  let clock = NOW;
  const client = new StarryClient({ baseUrl: BASE, appId: 'clock', storage, fetch: s.fetchFn, now: () => clock, randomState: () => 'state-abc', ...extra });
  return { client, storage, calls: s.calls, advance: (ms: number) => void (clock += ms) };
}

describe('helpers', () => {
  test('versions compare numerically', () => {
    assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
    assert.ok(compareVersions('1.4', '1.4.0') === 0);
    assert.ok(compareVersions('1.4.0-beta.2', '1.4.0') === 0);
    assert.ok(compareVersions('0.9.9', '1.0.0') < 0);
  });
  test('relay results are read after # (web) or ? (App scheme); other addresses are not results', () => {
    assert.deepEqual(parseRelayResult('https://clock.starry.phd/auth/done#id_token=a.b.c&state=s1'), { idToken: 'a.b.c', code: null, state: 's1', error: null });
    assert.deepEqual(parseRelayResult('clock://auth/apple?id_token=x&code=c1&state=s2'), { idToken: 'x', code: 'c1', state: 's2', error: null });
    assert.equal(parseRelayResult('clock://auth/google?error=access_denied&state=s3')?.error, 'access_denied');
    assert.equal(parseRelayResult('https://clock.starry.phd/page?x=1'), null);
  });
  test('base64url round-trips binary data', () => {
    const bytes = new Uint8Array([0, 250, 251, 252, 253, 254, 255, 62, 63]);
    assert.deepEqual([...base64urlDecode(base64urlEncode(bytes))], [...bytes]);
    assert.ok(!/[+/=]/.test(base64urlEncode(bytes)));
  });
});

describe('tokens', () => {
  test('sign-in stores the Refresh Token, keeps the Access Token in memory, and announces it', async () => {
    const { client, storage } = make({ 'POST /v1/auth/google': () => signIn(1) });
    const events: string[] = [];
    client.onAuthChange((e) => events.push(e));
    const result = await client.signInWithIdToken('google', { idToken: 'idt', nonce: 'n'.repeat(20) });
    assert.equal(result.user.user_id, 'u1');
    assert.equal(await storage.get('starry.refresh.clock'), 'refresh-1');
    assert.equal(await client.getAccessToken(), 'access-1');
    assert.equal(client.signedIn, true);
    assert.deepEqual(events, ['signed-in']);
  });

  test('concurrent requests with an expired Access Token share ONE refresh, and the new Refresh Token replaces the old', async () => {
    let refreshes = 0;
    const { client, storage, calls, advance } = make({
      'POST /v1/auth/google': () => signIn(1),
      'POST /v1/auth/refresh': async () => {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 10));
        return Response.json(tokens(2));
      },
      'GET /v1/me': () => Response.json({ user_id: 'u1' }),
    });
    await client.signInWithIdToken('google', { idToken: 'idt', nonce: 'n'.repeat(20) });
    advance(16 * 60 * 1000);
    await Promise.all([client.request('GET', '/v1/me'), client.request('GET', '/v1/me'), client.request('GET', '/v1/me')]);
    assert.equal(refreshes, 1);
    assert.equal(await storage.get('starry.refresh.clock'), 'refresh-2');
    assert.deepEqual(calls.filter((c) => c.path === '/v1/auth/refresh').map((c) => c.body), [{ refresh_token: 'refresh-1' }]);
    assert.ok(calls.filter((c) => c.path === '/v1/me').every((c) => c.auth === 'Bearer access-2'));
  });

  test('a 401 triggers one refresh and one retry', async () => {
    let me = 0;
    const { client } = make({
      'POST /v1/auth/google': () => signIn(1),
      'POST /v1/auth/refresh': () => Response.json(tokens(2)),
      'GET /v1/me': (call) => (me++ === 0 ? fail(401, 'UNAUTHORIZED') : Response.json({ user_id: 'u1', auth: call.auth })),
    });
    await client.signInWithIdToken('google', { idToken: 'idt', nonce: 'n'.repeat(20) });
    assert.deepEqual(await client.request('GET', '/v1/me'), { user_id: 'u1', auth: 'Bearer access-2' });
    assert.equal(me, 2);
  });

  test('a rejected or reused Refresh Token signs the member out; a network failure does not', async () => {
    for (const code of ['INVALID_REFRESH', 'REFRESH_REUSED']) {
      const { client, storage, advance } = make({ 'POST /v1/auth/google': () => signIn(1), 'POST /v1/auth/refresh': () => fail(401, code) });
      await client.signInWithIdToken('google', { idToken: 'idt', nonce: 'n'.repeat(20) });
      const events: string[] = [];
      client.onAuthChange((e) => events.push(e));
      advance(20 * 60 * 1000);
      assert.equal(await client.getAccessToken(), null);
      assert.equal(await storage.get('starry.refresh.clock'), null, code);
      assert.deepEqual(events, ['signed-out']);
    }
    const offline = make({ 'POST /v1/auth/google': () => signIn(1) });
    await offline.client.signInWithIdToken('google', { idToken: 'idt', nonce: 'n'.repeat(20) });
    offline.advance(20 * 60 * 1000);
    const broken = new StarryClient({ baseUrl: BASE, appId: 'clock', storage: offline.storage, fetch: async () => Promise.reject(new TypeError('offline')), now: () => NOW + 20 * 60 * 1000 });
    await assert.rejects(broken.getAccessToken(), (e: unknown) => e instanceof StarryError && e.code === 'NETWORK');
    assert.equal(await offline.storage.get('starry.refresh.clock'), 'refresh-1', 'the session survives being offline');
    assert.equal(await broken.restore(), true, 'restore() keeps the member signed in while offline');
  });

  test('a suspended account is signed out; signOut never throws and always clears', async () => {
    const suspended = make({ 'POST /v1/auth/google': () => signIn(1), 'GET /v1/me': () => fail(403, 'ACCOUNT_SUSPENDED') });
    await suspended.client.signInWithIdToken('google', { idToken: 'idt', nonce: 'n'.repeat(20) });
    await assert.rejects(suspended.client.me(), (e: unknown) => e instanceof StarryError && e.suspended);
    assert.equal(suspended.client.signedIn, false);
    assert.equal(await suspended.storage.get('starry.refresh.clock'), null);

    const down = make({ 'POST /v1/auth/google': () => signIn(1), 'POST /v1/auth/logout': () => fail(500, 'INTERNAL'), 'DELETE /v1/me/push-tokens': () => fail(500, 'INTERNAL') });
    await down.client.signInWithIdToken('google', { idToken: 'idt', nonce: 'n'.repeat(20) });
    await down.client.signOut({ pushToken: 'ExponentPushToken[abc]' });
    assert.equal(down.client.signedIn, false);
    assert.equal(await down.storage.get('starry.refresh.clock'), null);
    assert.deepEqual(down.calls.map((c) => `${c.method} ${c.path}`).slice(1), ['DELETE /v1/me/push-tokens', 'POST /v1/auth/logout'], 'push token first, then logout');
  });

  test('a request while signed out fails without calling the server', async () => {
    const { client, calls } = make({});
    await assert.rejects(client.me(), (e: unknown) => e instanceof StarryError && e.code === 'NOT_SIGNED_IN');
    assert.equal(calls.length, 0);
  });
});

describe('relay sign-in', () => {
  const nonce = 'N'.repeat(24);
  const hash = createHash('sha256').update(nonce).digest('hex');
  const base = {
    'POST /v1/auth/nonce': () => Response.json({ nonce, expires_in: 600 }),
    'POST /v1/auth/google': () => signIn(1, true),
    'POST /v1/auth/apple': () => signIn(1),
  };
  const sha256Hex = async (t: string) => createHash('sha256').update(t).digest('hex');

  test('opens the relay with the SHA-256 of the nonce, checks state, then signs in with the original nonce', async () => {
    let opened = '';
    const { client, calls } = make(base, {
      sha256Hex,
      openAuthSession: async (url) => {
        opened = url;
        return 'clock://auth/google?id_token=tok123&state=state-abc';
      },
    });
    const result = await client.signInWithRelay('google', { returnUrl: 'clock://auth/google' });
    const u = new URL(opened);
    assert.equal(u.origin + u.pathname, `${BASE}/auth/google/start`);
    assert.deepEqual(Object.fromEntries(u.searchParams), { app_id: 'clock', nonce: hash, return: 'clock://auth/google', state: 'state-abc' });
    assert.equal(result.consent_required, true);
    assert.deepEqual(calls.at(-1)?.body, { app_id: 'clock', id_token: 'tok123', nonce });
  });

  test('Apple also sends the code and the relay redirect_uri', async () => {
    const { client, calls } = make(base, { sha256Hex, openAuthSession: async () => 'clock://auth/apple?id_token=tok&code=c9&state=state-abc' });
    await client.signInWithRelay('apple', { returnUrl: 'clock://auth/apple' });
    assert.deepEqual(calls.at(-1)?.body, { app_id: 'clock', id_token: 'tok', nonce, authorization_code: 'c9', redirect_uri: `${BASE}/auth/apple/callback` });
  });

  test('a wrong state, a cancelled sheet, a provider error and a missing Apple code are all refused before sign-in', async () => {
    const attempt = async (resultUrl: string | null, provider: 'google' | 'apple' = 'google') => {
      const { client, calls } = make(base, { sha256Hex, openAuthSession: async () => resultUrl });
      const error = await client.signInWithRelay(provider, { returnUrl: 'clock://auth' }).then(
        () => null,
        (e: unknown) => e as StarryError,
      );
      assert.equal(calls.some((c) => c.path === `/v1/auth/${provider}`), false, 'no sign-in call was made');
      return error;
    };
    assert.equal((await attempt('clock://auth?id_token=t&state=OTHER'))?.code, 'RELAY_STATE_MISMATCH');
    assert.equal((await attempt(null))?.cancelled, true);
    assert.equal((await attempt('clock://auth?error=access_denied&state=state-abc'))?.cancelled, true);
    assert.equal((await attempt('clock://auth?error=server_error&state=state-abc'))?.code, 'RELAY_FAILED');
    assert.equal((await attempt('clock://auth?id_token=t&state=state-abc', 'apple'))?.code, 'RELAY_FAILED');
  });

  test('web: the redirect keeps nonce and state across the page change and the result is used once', async () => {
    let navigated = '';
    const { client, storage, calls } = make(base, { sha256Hex, navigate: (u) => void (navigated = u) });
    await client.beginRelayRedirect('google', { returnUrl: 'https://clock.starry.phd/auth/done' });
    assert.ok(navigated.startsWith(`${BASE}/auth/google/start?`));
    assert.equal(new URL(navigated).searchParams.get('nonce'), hash);
    assert.equal(await client.completeRelayRedirect('https://clock.starry.phd/home'), null, 'a page with no result is left alone');
    const result = await client.completeRelayRedirect('https://clock.starry.phd/auth/done#id_token=tok&state=state-abc');
    assert.equal(result?.user.user_id, 'u1');
    assert.deepEqual(calls.at(-1)?.body, { app_id: 'clock', id_token: 'tok', nonce });
    assert.equal(await storage.get('starry.relay.clock'), null);
    await assert.rejects(client.completeRelayRedirect('https://clock.starry.phd/auth/done#id_token=tok&state=state-abc'), (e: unknown) => e instanceof StarryError && e.code === 'RELAY_STATE_MISMATCH');
  });
});

describe('Passkey', () => {
  const publicKey = { challenge: 'Y2hhbGxlbmdl', rpId: 'id.test', userVerification: 'required', timeout: 120000, allowCredentials: [] };
  const handlers = {
    'POST /v1/auth/passkey/options': () => Response.json({ publicKey, expires_in: 600 }),
    'POST /v1/auth/passkey': () => signIn(1),
    'POST /v1/me/passkeys/options': () => Response.json({ publicKey: { challenge: 'Y3I', user: { id: 'dQ' } }, expires_in: 600 }),
    'POST /v1/me/passkeys': () => Response.json({ ok: true }, { status: 201 }),
  };

  test('sign-in sends the assertion the adapter produced, with the App id', async () => {
    const seen: unknown[] = [];
    const passkey: PasskeyAdapter = {
      get: async (pk) => (seen.push(pk), { id: 'cred1', clientDataJSON: 'cd', authenticatorData: 'ad', signature: 'sig' }),
      create: async () => ({ clientDataJSON: 'cd', attestationObject: 'ao' }),
    };
    const { client, calls } = make(handlers, { passkey, deviceLabel: 'Pixel' });
    const result = await client.signInWithPasskey();
    assert.equal(result.user.user_id, 'u1');
    assert.deepEqual(seen, [publicKey]);
    assert.deepEqual(calls.at(-1)?.body, { app_id: 'clock', id: 'cred1', clientDataJSON: 'cd', authenticatorData: 'ad', signature: 'sig', device_label: 'Pixel' });
  });

  test('a cancelled sheet is "cancelled", an existing Passkey is PASSKEY_EXISTS, and nothing is sent to the server', async () => {
    for (const [name, expected] of [['NotAllowedError', 'PASSKEY_CANCELLED'], ['InvalidStateError', 'PASSKEY_EXISTS'], ['NotSupportedError', 'PASSKEY_UNSUPPORTED']] as const) {
      const passkey: PasskeyAdapter = {
        get: async () => Promise.reject(Object.assign(new Error('x'), { name })),
        create: async () => Promise.reject(Object.assign(new Error('x'), { name })),
      };
      const { client, calls } = make(handlers, { passkey });
      const error = await client.signInWithPasskey().then(() => null, (e: unknown) => e as StarryError);
      assert.equal(error?.code, expected);
      assert.equal(error?.cancelled, expected === 'PASSKEY_CANCELLED');
      assert.equal(calls.some((c) => c.path === '/v1/auth/passkey'), false);
    }
  });

  test('registering needs sign-in, then posts the attestation with the name', async () => {
    const passkey: PasskeyAdapter = {
      get: async () => ({ id: 'cred1', clientDataJSON: 'cd', authenticatorData: 'ad', signature: 'sig' }),
      create: async () => ({ clientDataJSON: 'cd2', attestationObject: 'ao' }),
    };
    const { client, calls } = make(handlers, { passkey });
    await assert.rejects(client.registerPasskey('我的手機'), (e: unknown) => e instanceof StarryError && e.code === 'NOT_SIGNED_IN');
    assert.equal(calls.length, 0);
    await client.signInWithPasskey();
    await client.registerPasskey('我的手機');
    assert.deepEqual(calls.at(-1)?.body, { clientDataJSON: 'cd2', attestationObject: 'ao', name: '我的手機' });
    assert.equal(calls.at(-1)?.auth, 'Bearer access-1');
  });
});

describe('start-up check', () => {
  const config = (over: Record<string, unknown>) => () => Response.json({ app_id: 'clock', status: 'active', min_version: '1.2.0', config: { theme: 'dark' }, notices: [], ...over });

  test('ok, maintenance, killed and update_required', async () => {
    const run = async (over: Record<string, unknown>, version = '1.4.0') => (await make({ 'GET /v1/apps/clock/config': config(over) }).client.checkApp(version)).state;
    assert.equal(await run({}), 'ok');
    assert.equal(await run({ status: 'paused' }), 'maintenance');
    assert.equal(await run({ status: 'killed' }), 'killed');
    assert.equal(await run({}, '1.1.9'), 'update_required');
    assert.equal(await run({ status: 'paused' }, '0.1.0'), 'maintenance', 'maintenance wins over update');
  });

  test('only announcements running right now are returned, with the remote config', async () => {
    const { client } = make({
      'GET /v1/apps/clock/config': config({
        notices: [
          { message: 'now', starts_at: NOW - 1000, ends_at: NOW + 1000 },
          { message: 'later', starts_at: NOW + 1000, ends_at: NOW + 2000 },
          { message: 'over', starts_at: NOW - 2000, ends_at: NOW - 1000 },
        ],
      }),
    });
    const gate = await client.checkApp('1.4.0');
    assert.deepEqual(gate.notices.map((n) => n.message), ['now']);
    assert.deepEqual(gate.config, { theme: 'dark' });
    assert.equal(gate.minVersion, '1.2.0');
  });

  test('when Starry ID cannot be reached the state is "unreachable" (not an exception)', async () => {
    const client = new StarryClient({ baseUrl: BASE, appId: 'clock', storage: memoryStorage(), fetch: async () => Promise.reject(new TypeError('offline')) });
    assert.equal((await client.checkApp('1.0.0')).state, 'unreachable');
  });

  test('a server error is not hidden as "unreachable"', async () => {
    const { client } = make({ 'GET /v1/apps/clock/config': () => fail(500, 'INTERNAL') });
    await assert.rejects(client.checkApp('1.0.0'), (e: unknown) => e instanceof StarryError && e.status === 500);
  });
});

describe('device sign-on (shared storage)', () => {
  const jwt = (sub: string) => `h.${base64urlEncode(new TextEncoder().encode(JSON.stringify({ sub })))}.s`;
  const pair = (n: number, sub: string) => ({ ...tokens(n), access_token: jwt(sub) });
  const sso = (n: number, sub: string) => () => Response.json({ ...pair(n, sub), user: { user_id: sub, status: 'active', is_new: false, deletion_purge_at: null }, consent_required: false });

  test('signing in shares the device token; another App signs in from it', async () => {
    const shared = memoryStorage();
    const a = make({ 'POST /v1/auth/google': sso(1, 'u1'), 'POST /v1/auth/sso/start': () => Response.json({ sso_token: 'sso-1' }) }, { sharedStorage: shared });
    await a.client.signInWithIdToken('google', { idToken: 'idt', nonce: 'n'.repeat(20) });
    assert.equal(await shared.get('starry.sso'), 'sso-1');
    const b = make({ 'POST /v1/auth/sso/status': () => Response.json({ active: true, user_id: 'u1' }), 'POST /v1/auth/sso/exchange': sso(2, 'u1') }, { sharedStorage: shared, appId: 'recordnote' });
    assert.equal(await b.client.restore(), true);
    assert.equal(b.calls.find((c) => c.path === '/v1/auth/sso/exchange')?.body?.app_id, 'recordnote');
  });

  test('signed out elsewhere signs this App out; another member elsewhere switches this App', async () => {
    const shared = memoryStorage();
    await shared.set('starry.sso', 'sso-1');
    let active = true;
    let who = 'u1';
    const c = make(
      { 'POST /v1/auth/sso/status': () => Response.json({ active, user_id: active ? who : null }), 'POST /v1/auth/sso/exchange': () => sso(3, who)(), 'POST /v1/auth/refresh': () => Response.json(pair(9, 'u1')) },
      { sharedStorage: shared },
    );
    assert.equal(await c.client.restore(), true);
    who = 'u2';
    assert.equal(await c.client.syncDeviceSignIn(), true);
    assert.equal(c.calls.filter((x) => x.path === '/v1/auth/sso/exchange').length, 2);
    active = false;
    assert.equal(await c.client.syncDeviceSignIn(), false);
    assert.equal(await shared.get('starry.sso'), null);
    assert.equal(c.client.signedIn, false);
  });

  test('signing out ends the device token for every App; offline keeps the session', async () => {
    const shared = memoryStorage();
    const a = make({ 'POST /v1/auth/google': sso(1, 'u1'), 'POST /v1/auth/sso/start': () => Response.json({ sso_token: 'sso-1' }), 'POST /v1/auth/logout': () => new Response(null, { status: 204 }), 'POST /v1/auth/sso/logout': () => new Response(null, { status: 204 }) }, { sharedStorage: shared });
    await a.client.signInWithIdToken('google', { idToken: 'idt', nonce: 'n'.repeat(20) });
    await a.client.signOut();
    assert.ok(a.calls.some((x) => x.path === '/v1/auth/sso/logout' && x.body?.sso_token === 'sso-1'));
    assert.equal(await shared.get('starry.sso'), null);
    const offline = make({}, { sharedStorage: shared, fetch: async () => Promise.reject(new Error('offline')) });
    await shared.set('starry.sso', 'sso-2');
    await offline.storage.set('starry.refresh.clock', 'r');
    assert.equal(await offline.client.syncDeviceSignIn(), true);
  });
});

describe('web single sign-on', () => {
  const jwt = (sub: string) => `h.${base64urlEncode(new TextEncoder().encode(JSON.stringify({ sub })))}.s`;
  const session = (n: number, sub: string) => () => Response.json({ ...tokens(n), access_token: jwt(sub), user: { user_id: sub, status: 'active', is_new: false, deletion_purge_at: null }, consent_required: false });
  const web = (handlers: Parameters<typeof server>[0]) => {
    const went: string[] = [];
    const c = make({ 'POST /v1/auth/nonce': () => Response.json({ nonce: 'n'.repeat(24) }), ...handlers }, { navigate: (url: string) => void went.push(url) });
    return { ...c, went };
  };
  const back = (fragment: string) => `https://clock.starry.phd/app#${fragment}`;

  test('check goes to id.starry.phd once per interval; the code signs this App in', async () => {
    const c = web({ 'POST /v1/auth/sso/web-exchange': session(1, 'u1') });
    assert.equal(await c.client.syncWebSignIn({ returnUrl: 'https://clock.starry.phd/app' }), true);
    assert.match(c.went[0] ?? '', /^https:\/\/id\.test\/auth\/sso\/check\?app_id=clock&nonce=[a-f0-9]{64}&return=.+&state=state-abc$/);
    assert.equal(await c.client.syncWebSignIn({ returnUrl: 'https://clock.starry.phd/app' }), false, 'throttled');
    assert.equal(await c.client.completeWebSsoCheck(back('sso_code=code1&sso_user=u1&state=state-abc')), true);
    assert.equal(c.calls.find((x) => x.path === '/v1/auth/sso/web-exchange')?.body?.code, 'code1');
    assert.equal(c.client.signedIn, true);
    assert.equal(await c.client.completeWebSsoCheck('https://clock.starry.phd/app'), null);
  });

  test('a wrong state is ignored; the same member keeps their session; another member switches', async () => {
    const c = web({ 'POST /v1/auth/sso/web-exchange': session(2, 'u2'), 'POST /v1/auth/google': session(1, 'u1'), 'POST /v1/auth/refresh': () => Response.json({ ...tokens(5), access_token: jwt('u1') }) });
    await c.client.signInWithIdToken('google', { idToken: 'idt', nonce: 'n'.repeat(20) });
    await c.client.syncWebSignIn({ returnUrl: 'https://clock.starry.phd/app', everyMs: 0 });
    assert.equal(await c.client.completeWebSsoCheck(back('sso_code=c&sso_user=u2&state=wrong')), true);
    assert.equal(c.calls.filter((x) => x.path === '/v1/auth/sso/web-exchange').length, 0);
    await c.client.syncWebSignIn({ returnUrl: 'https://clock.starry.phd/app', everyMs: 0 });
    assert.equal(await c.client.completeWebSsoCheck(back('sso_code=c&sso_user=u1&state=state-abc')), true);
    assert.equal(c.calls.filter((x) => x.path === '/v1/auth/sso/web-exchange').length, 0, 'same member: nothing to do');
    await c.client.syncWebSignIn({ returnUrl: 'https://clock.starry.phd/app', everyMs: 0 });
    assert.equal(await c.client.completeWebSsoCheck(back('sso_code=c&sso_user=u2&state=state-abc')), true);
    assert.equal(c.calls.filter((x) => x.path === '/v1/auth/sso/web-exchange').length, 1);
  });

  test('signed out elsewhere signs out only an App that shared its sign-in', async () => {
    const c = web({ 'POST /v1/auth/google': session(1, 'u1'), 'POST /v1/auth/sso/start': () => Response.json({ sso_token: 't' }), 'POST /v1/auth/sso/web-code': () => Response.json({ code: 'c1' }) });
    await c.client.signInWithIdToken('google', { idToken: 'idt', nonce: 'n'.repeat(20) });
    assert.equal(await c.client.completeWebSsoCheck(back('sso_none=1&state=')), true, 'never shared: keeps the session');
    await c.client.shareWebSignIn({ returnUrl: 'https://clock.starry.phd/app' });
    assert.match(c.went.at(-1) ?? '', /\/auth\/sso\/adopt\?app_id=clock&c=c1&return=/);
    assert.equal(await c.client.completeWebSsoCheck(back('sso_none=1&state=')), false);
    assert.equal(c.client.signedIn, false);
  });
});

describe('settings page blocks', () => {
  const me = { member_no: 'TW0067527', profile: { shown_name: '繁星管理員', initials: '繁星', avatar_url: null } };
  test('three fixed blocks in order, with the agreed wording and buttons', () => {
    const blocks = starrySettingsBlocks({ me, battery: { balance: { remaining: 19 }, quantum: { available: 15 } }, passkeys: [{ id: 'p1', name: 'macOS' }] });
    assert.deepEqual(blocks.map((b) => b.id), ['battery', 'member', 'passkey']);
    assert.deepEqual(blocks[0], { id: 'battery', title: '繁星電池艙', lines: ['🔋 19 顆普通電池', '⚛️ 15 顆量子電池'], buttons: [{ id: 'battery-history', label: '電池消耗明細' }] });
    assert.equal(blocks[1]?.title, '我的中央會員');
    assert.equal(blocks[1]?.name, '繁星管理員');
    assert.deepEqual(blocks[1]?.avatar, { url: null, initials: '繁星' });
    assert.deepEqual(blocks[1]?.lines, ['會員編號：TW0067527']);
    assert.deepEqual(blocks[1]?.buttons.map((b) => b.label), ['公開基本資料', '分享邀請連結', '會員中心', '聯絡客服', '登出所有繁星 App', '永久刪除中央帳號']);
    assert.equal(blocks[1]?.buttons.at(-1)?.danger, true);
    assert.deepEqual(blocks[2]?.passkeys, [{ id: 'p1', name: 'macOS', removeLabel: '移除' }]);
    assert.deepEqual(blocks[2]?.buttons, [{ id: 'add-passkey', label: '新增 Passkey' }]);
    // Nothing explanatory anywhere: no parentheses and no refresh button.
    const all = JSON.stringify(blocks);
    assert.doesNotMatch(all, /[（(]/);
    assert.doesNotMatch(all, /重新整理|重新查詢/);
  });

  test('not loaded yet, no member number, no photo, ten Passkeys', () => {
    const blocks = starrySettingsBlocks({ me: null, battery: null, passkeys: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, name: 'k' })) });
    assert.deepEqual(blocks[0]?.lines, ['🔋 – 顆普通電池', '⚛️ – 顆量子電池']);
    assert.equal(blocks[1]?.name, '星友');
    assert.deepEqual(blocks[1]?.lines, []);
    assert.deepEqual(blocks[2]?.buttons, []);
  });
});
