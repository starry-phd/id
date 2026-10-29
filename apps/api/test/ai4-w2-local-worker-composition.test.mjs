import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {webcrypto as crypto} from 'node:crypto';
import {signServerSession} from '../../../modules/starry-id-v1/src/session-crypto.ts';
import {
  createLocalOnlyStarryWorkerComposition,
  LOCAL_WORKER_COMPOSITION_IS_DEPLOYED,
} from '../test-support/ai4-w2-local-worker-composition.ts';
import {handleRequest} from '../src/index.ts';
import {SELF_PROFILE_PATH} from '../../../packages/integration/src/ai0-w1-isolated-self-profile.ts';
import {
  createIsolatedSelfProfileClient,
  SELF_PROFILE_CLIENT_PATH,
} from '../../../packages/integration/src/ai0-w1-isolated-self-profile-client.ts';

const now = 1793000000;
const scope = {brand_id: 'starry', app_id: 'starry-id', environment: 'staging'};
const workerEnv = {STARRY_APP_ID: 'starry-id', STARRY_ENVIRONMENT: 'staging'};
const origin = 'https://id.starry.example';
const expected = {
  s_user_id: 'u1',
  display_name: 'Own profile',
  directory_opt_in: false,
  display_name_public: false,
  profile_revision: 1,
};

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('../../../modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql', import.meta.url), 'utf8'));
  for (const [id, name] of [['u1', 'Own profile'], ['u2', 'Other member private']]) {
    db.prepare("INSERT INTO starry_members VALUES(?,'active',3,1,?,0,0,?,?)")
      .run(id, name, now, now);
  }
  db.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
    .run('apple', 'apple-sub', 'u1');
  db.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES(?,?,?,?,?,?,?)')
    .run('s1', 'u1', 'starry-id', 'staging', 3, 'a'.repeat(64), now + 300);

  const state = {reads: 0, keys: 0, initialDbFailure: false, finalDbFailure: false,
    snapshotHook: null, extra: false, clock: now};
  const authDb = {prepare(sql) {
    assert.match(sql, /^SELECT /);
    return {bind(...args) {return {first: async () => {
      state.reads++;
      const final = sql.startsWith('SELECT m.s_user_id');
      if ((final && state.finalDbFailure) || (!final && state.initialDbFailure)) {
        throw new Error('PRIVATE_AUTH_DATABASE_KEY');
      }
      if (final && state.snapshotHook) state.snapshotHook();
      const row = db.prepare(sql).get(...args) ?? null;
      return row && state.extra ? {...row, oauth_email: 'private@example.invalid',
        refresh_hash: 'PRIVATE_REFRESH_SECRET', provider_subject: 'private-subject'} : row;
    }};}}};
  }};
  const key = await crypto.subtle.generateKey({name: 'HMAC', hash: 'SHA-256', length: 256},
    false, ['sign', 'verify']);
  const claims = {...scope, provider: 'apple', provider_subject: 'apple-sub',
    s_user_id: 'u1', session_id: 's1', auth_version: 3, expires_at: now + 300,
    issued_at: now, key_id: 'local-kid'};
  const token = await signServerSession(claims, scope, now, {kid: 'local-kid', key});
  const deps = {serverScope: scope, runtimeEnv: workerEnv, expectedOrigin: origin,
    authDb, getVerificationKey: async kid => {state.keys++; return kid === 'local-kid' ? key : null;},
    now: () => state.clock};
  const composition = enabled => createLocalOnlyStarryWorkerComposition({...deps, enabled});
  const req = (path = SELF_PROFILE_PATH, headers = {}, method = 'GET') =>
    new Request(origin + path, {method, headers: {authorization: 'Bearer ' + token, ...headers}});
  const client = (dispatcher, getBearer = async () => token) =>
    createIsolatedSelfProfileClient({
      enabled: true, origin, environment: 'staging', getBearer,
      fetchImpl: request => dispatcher.dispatchLocal(request),
    });
  return {db, state, token, deps, composition, req, client, close: () => db.close()};
}

test('W2 local dispatcher is not a public Worker and defaults OFF without changing health', async () => {
  const x = await setup(); try {
    const local = x.composition();
    assert.equal(LOCAL_WORKER_COMPOSITION_IS_DEPLOYED, false);
    assert.deepEqual([local.local_only, local.deployed, local.profile_registered_in_public_worker],
      [true, false, false]);
    const health = new Request(origin + '/v1/health');
    const actual = await local.dispatchLocal(health);
    const original = handleRequest(health, workerEnv);
    assert.equal(actual.status, original.status);
    assert.deepEqual(await actual.json(), await original.json());
    assert.equal((await local.dispatchLocal(x.req())).status, 503);
    assert.equal(x.state.reads, 0);
    assert.equal(x.state.keys, 0);
    assert.equal((await handleRequest(x.req(), workerEnv)).status, 404);
  } finally { x.close(); }
});

test('W2 exact local dispatch reuses real signed HMAC + SQLite and #245 five-field client', async () => {
  const x = await setup(); try {
    const dispatcher = x.composition(true);
    x.state.extra = true;
    let calls = 0;
    const client = createIsolatedSelfProfileClient({
      enabled: true, origin, environment: 'staging', getBearer: async () => x.token,
      fetchImpl: request => {
        calls++;
        assert.equal(request.url, origin + SELF_PROFILE_PATH);
        assert.equal(request.method, 'GET');
        assert.equal(request.credentials, 'omit');
        assert.equal(request.redirect, 'error');
        assert.equal(request.cache, 'no-store');
        assert.equal(request.headers.has('cookie'), false);
        return dispatcher.dispatchLocal(request);
      },
    });
    assert.equal(SELF_PROFILE_CLIENT_PATH, SELF_PROFILE_PATH);
    assert.deepEqual(await client.readSelf(), {ok: true, profile: expected});
    assert.equal(calls, 1);
    assert.equal(x.state.reads, 4);
    assert.equal(Object.keys(expected).length, 5);
    const raw = await dispatcher.dispatchLocal(x.req());
    assert.equal(raw.status, 200);
    assert.equal(raw.headers.get('cache-control'), 'no-store');
    assert.equal(raw.headers.get('x-content-type-options'), 'nosniff');
    const body = await raw.text();
    assert.deepEqual(JSON.parse(body), expected);
    assert.doesNotMatch(body, /private|refresh_hash|oauth_email|provider_subject|apple-sub/i);
  } finally { x.close(); }
});

test('W2 constructor denies production, unknown env, foreign brand/app and mismatched trusted Worker vars', async () => {
  const x = await setup(); try {
    for (const change of [
      {serverScope: {...scope, brand_id: 'hglobal'}},
      {serverScope: {...scope, app_id: 'other'}},
      {serverScope: {...scope, environment: 'production'}},
      {serverScope: {...scope, environment: 'preview'}},
      {runtimeEnv: {...workerEnv, STARRY_APP_ID: 'hglobal-id'}},
      {runtimeEnv: {...workerEnv, STARRY_ENVIRONMENT: 'production'}},
      {runtimeEnv: {...workerEnv, STARRY_ENVIRONMENT: 'development'}},
    ]) assert.throws(() => createLocalOnlyStarryWorkerComposition({...x.deps, ...change}),
      /LOCAL_WORKER_TRUSTED_SCOPE_DENIED/);
    assert.equal(x.state.reads, 0);
  } finally { x.close(); }
});

test('W2 constructor requires pinned HTTPS origin without credentials/query/path/fragment', async () => {
  const x = await setup(); try {
    for (const expectedOrigin of ['http://id.starry.example', 'https://u:p@id.starry.example',
      origin + '/v1', origin + '/?token=private', origin + '/#secret', '://bad']) {
      assert.throws(() => createLocalOnlyStarryWorkerComposition({...x.deps, expectedOrigin}),
        /LOCAL_WORKER_TRUSTED_ORIGIN_DENIED/);
    }
  } finally { x.close(); }
});

test('W2 wrong host/Host/Origin and legacy alias cannot reach protected handler or SQLite', async () => {
  const x = await setup(); try {
    const local = x.composition(true);
    for (const r of [
      new Request('https://foreign.example' + SELF_PROFILE_PATH),
      new Request(origin + SELF_PROFILE_PATH, {headers: {host: 'foreign.example'}}),
      new Request(origin + SELF_PROFILE_PATH, {headers: {origin: 'https://foreign.example'}}),
      new Request('https://foreign.example/v1/health'),
      x.req('/v1/member/self'),
      x.req('/v1/starry-id/members/u2'),
    ]) {
      const response = await local.dispatchLocal(r);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal((await local.dispatchLocal(x.req(SELF_PROFILE_PATH + '?s_user_id=u2'))).status, 400);
    const methodDenied = await local.dispatchLocal(x.req(SELF_PROFILE_PATH, {}, 'POST'));
    assert.equal(methodDenied.status, 405);
    assert.equal(methodDenied.headers.get('allow'), 'GET');
    assert.equal(x.state.reads, 0);
    assert.equal(x.state.keys, 0);
  } finally { x.close(); }
});

test('W2 unsigned/tampered bearer, cookies and client-supplied identity are denied', async () => {
  const x = await setup(); try {
    const local = x.composition(true);
    for (const header of [
      {authorization: ''},
      {authorization: 'Bearer invalid'},
      {authorization: 'Bearer ' + x.token.slice(0, -2) + 'xy'},
      {cookie: 'session=not-trusted'},
      {'x-forwarded-authorization': 'Bearer ' + x.token},
      {'x-starry-member-id': 'u2', authorization: ''},
    ]) {
      const response = await local.dispatchLocal(x.req(SELF_PROFILE_PATH, header));
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.doesNotMatch(await response.text(), /private|apple-sub|refresh_hash/i);
    }
    assert.equal(x.state.reads, 0);
  } finally { x.close(); }
});

test('W2 subsequent revocation and auth-version bump deny current profile in real SQLite', async () => {
  for (const sql of [
    "UPDATE starry_sessions SET revoked_at=1793000000 WHERE session_id='s1'",
    "UPDATE starry_members SET auth_version=4 WHERE s_user_id='u1'",
    "DELETE FROM starry_identities WHERE s_user_id='u1'",
  ]) {
    const x = await setup(); try {
      const local = x.composition(true);
      const client = x.client(local);
      assert.deepEqual(await client.readSelf(), {ok: true, profile: expected});
      x.db.exec(sql);
      assert.deepEqual(await client.readSelf(), {ok: false, code: 'AUTH_REQUIRED'});
    } finally { x.close(); }
  }
});

test('W2 final-snapshot revoke race maps real current-record denial to HTTP 403', async () => {
  const x = await setup(); try {
    x.state.snapshotHook = () => x.db.exec(
      "UPDATE starry_sessions SET revoked_at=1793000000 WHERE session_id='s1'");
    const local = x.composition(true);
    const response = await local.dispatchLocal(x.req());
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {error: {code: 'CURRENT_RECORD_DENIED'}});
    assert.deepEqual(await x.client(local).readSelf(), {ok: false, code: 'AUTH_REQUIRED'});
  } finally { x.close(); }
});

test('W2 preserves initial verifier/DB 401 vs final storage 503; never echoes secrets', async () => {
  for (const [kind, status, code] of [
    ['initialDbFailure', 401, 'AUTH_REQUIRED'],
    ['finalDbFailure', 503, 'SERVICE_UNAVAILABLE'],
  ]) {
    const x = await setup(); try {
      x.state[kind] = true;
      const local = x.composition(true);
      const response = await local.dispatchLocal(x.req());
      assert.equal(response.status, status);
      const text = await response.text();
      assert.doesNotMatch(text, /PRIVATE_AUTH_DATABASE_KEY|refresh_hash|apple-sub|Bearer/i);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await x.client(local).readSelf(), {ok: false, code});
    } finally { x.close(); }
  }
});

test('W2 invalid trusted clock stays 503 and does not turn protected route on', async () => {
  const x = await setup(); try {
    x.state.clock = NaN;
    const local = x.composition(true);
    assert.equal((await local.dispatchLocal(x.req())).status, 503);
    assert.equal(x.state.reads, 0);
    // The shipped Worker never imports this test-support dispatcher.
    const workerSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const workerConfig = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    assert.doesNotMatch(workerSource, /ai4-w2-local-worker-composition|createLocalOnlyStarryWorkerComposition/);
    assert.match(workerConfig, /main\s*=\s*"src\/index\.ts"/);
    assert.equal((await handleRequest(x.req(), workerEnv)).status, 404);
  } finally { x.close(); }
});
