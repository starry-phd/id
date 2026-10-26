import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarryHealthClient, disabledMemberSyncPort} from '../src/index.ts';
const healthy = {status:'ok',brand_id:'starry',app_id:'starry-id',environment:'staging',service:'id-api',kind:'liveness-only'};
test('typed SDK checks Starry-only liveness and strips credentials', async () => {
  let called = 0;
  const client = createStarryHealthClient('https://api.example.invalid/unused', async (url, init) => {
    called++;
    assert.equal(url, 'https://api.example.invalid/v1/health');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    return Response.json(healthy);
  });
  assert.deepEqual(await client.check(), healthy);
  assert.equal(called, 1);
});
test('SDK rejects insecure non-local HTTP and credentials in URL', () => {
  assert.throws(() => createStarryHealthClient('http://api.example.invalid'), /INSECURE_API_ORIGIN/);
  assert.throws(() => createStarryHealthClient('https://user:pass@api.example.invalid'), /INVALID_API_ORIGIN/);
});
test('SDK refuses wrong brand or production liveness payloads', async () => {
  for (const wrong of [{...healthy,brand_id:'hglobal'}, {...healthy,environment:'production'}]) {
    const client = createStarryHealthClient('https://api.example.invalid', async () => Response.json(wrong));
    await assert.rejects(client.check(), /STARRY_HEALTH_RESPONSE_INVALID/);
  }
});
test('cross-brand port remains disabled with no network path', async () => {
  assert.deepEqual(await disabledMemberSyncPort.sync(), {ok:false,code:'FEATURE_DISABLED'});
});
