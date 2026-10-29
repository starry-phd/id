import test from 'node:test';
import assert from 'node:assert/strict';
import {URL, fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {parseRestrictedWrangler} from '../../../scripts/promotion/m0-guard-policy.mjs';

// This suite executes the actual bundled Worker in workerd via Miniflare,
// not Node's direct handleRequest() mock and not a remote Cloudflare deployment.
const config = parseRestrictedWrangler(readFileSync(
  new URL('../wrangler.toml', import.meta.url), 'utf8'));
const bundle = build({
  entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
  write: false, logLevel: 'silent',
});
const origin = 'https://runtime-test.invalid';
async function withWorkerd(bindings, callback) {
  const result = await bundle;
  assert.equal(result.outputFiles.length, 1);
  const mf = new Miniflare({
    modules: true,
    script: result.outputFiles[0].text,
    compatibilityDate: config[''].compatibility_date,
    bindings,
  });
  try { await callback(mf); } finally { await mf.dispose(); }
}

test('workerd runtime: approved staging health responds with liveness only', async () => {
  await withWorkerd(config['env.staging.vars'], async runtime => {
    const res = await runtime.dispatchFetch(origin + '/v1/health');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(await res.json(), {
      status: 'ok', brand_id: 'starry', app_id: 'starry-id',
      environment: 'staging', service: 'id-api', kind: 'liveness-only',
    });
  });
});

test('workerd runtime: production / preview / foreign app never expose health', async () => {
  for (const bindings of [
    {...config['env.staging.vars'], STARRY_ENVIRONMENT: 'production'},
    {...config['env.staging.vars'], STARRY_ENVIRONMENT: 'preview'},
    {...config['env.staging.vars'], STARRY_APP_ID: 'foreign'},
  ]) {
    await withWorkerd(bindings, async runtime => {
      const res = await runtime.dispatchFetch(origin + '/v1/health');
      assert.equal(res.status, bindings.STARRY_APP_ID === 'foreign' ? 403 : 503);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      const body = await res.text();
      assert.doesNotMatch(body, /email|session|token|secret|member_id/i);
    });
  }
});

test('workerd runtime: authenticated, billing, admin and cross-brand routes remain 404', async () => {
  await withWorkerd(config['env.staging.vars'], async runtime => {
    for (const path of [
      '/v1/auth/login', '/v1/starry-id/members/me', '/v1/sessions',
      '/v1/billing', '/v1/admin', '/v1/hglobal/sync',
    ]) {
      const res = await runtime.dispatchFetch(origin + path);
      assert.equal(res.status, 404, path);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await res.json(), {error: {code: 'NOT_FOUND', message: 'Resource not found'}});
    }
    const denied = await runtime.dispatchFetch(origin + '/v1/health', {method: 'POST'});
    assert.equal(denied.status, 405);
  });
});
