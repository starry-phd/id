import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startWorker } from './helpers.mjs';

describe('platform Worker', () => {
  let worker;
  before(async () => {
    worker = await startWorker();
  });
  after(async () => {
    await worker?.mf.dispose();
  });

  test('GET /v1/health reports ok with a reachable D1', async () => {
    const res = await worker.call('/v1/health');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      status: 'ok',
      service: 'starry-api',
      environment: 'development',
      db: 'ok',
    });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
  });

  test('GET /v1/apps/echo/config returns only whitelisted fields', async () => {
    const res = await worker.call('/v1/apps/echo/config');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['app_id', 'config', 'min_version', 'status']);
    assert.equal(body.app_id, 'echo');
    assert.equal(body.status, 'active');
    assert.match(body.min_version, /^\d+\.\d+\.\d+$/);
  });

  test('unknown app returns APP_NOT_FOUND with the request id', async () => {
    const res = await worker.call('/v1/apps/not-an-app/config');
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'APP_NOT_FOUND');
    assert.equal(body.error.request_id, res.headers.get('x-request-id'));
  });

  test('unknown route and wrong method return NOT_FOUND', async () => {
    for (const [path, method] of [['/v1/nothing', 'GET'], ['/v1/health', 'POST'], ['/', 'GET']]) {
      const res = await worker.call(path, { method });
      assert.equal(res.status, 404, `${method} ${path}`);
      assert.equal((await res.json()).error.code, 'NOT_FOUND');
    }
  });
});

describe('health without a database schema', () => {
  test('still answers, because health only needs a D1 round trip', async () => {
    const worker = await startWorker({ migrate: false });
    try {
      const res = await worker.call('/v1/health');
      assert.equal(res.status, 200);
    } finally {
      await worker.mf.dispose();
    }
  });
});
