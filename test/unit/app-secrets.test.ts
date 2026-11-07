import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadRevenueCatSecrets, revenueCatStatus, saveRevenueCatSecret } from '../../src/billing/app-secrets';
import { migratedDb } from '../support/sqlite-d1.mjs';

const KEY = Buffer.alloc(32, 7).toString('base64url');
const env = (extra: Record<string, string> = {}) => ({ DB_BILLING: migratedDb('migrations/billing') as unknown as D1Database, DATA_ENCRYPTION_KEY: KEY, ...extra });

test('Admin Lite secrets are sealed, override Worker secrets per App, and can be cleared', async () => {
  const e = env({ REVENUECAT_WEBHOOK_AUTH: JSON.stringify({ recordnote: 'worker-hook', echo: 'worker-echo' }), REVENUECAT_API_KEYS: JSON.stringify({ recordnote: 'worker-api' }) });
  assert.deepEqual(await revenueCatStatus(e, 'recordnote'), { webhook: 'worker', api: 'worker' });
  assert.equal(await saveRevenueCatSecret(e, { appId: 'recordnote', kind: 'webhook', value: 'admin-hook', actorUserId: 'u' }, 1), true);
  assert.equal(await saveRevenueCatSecret(e, { appId: 'recordnote', kind: 'api', value: 'sk_admin', actorUserId: 'u' }, 2), true);
  const loaded = await loadRevenueCatSecrets(e);
  assert.equal(loaded.webhook.recordnote, 'admin-hook');
  assert.equal(loaded.webhook.echo, 'worker-echo');
  assert.equal(loaded.api.recordnote, 'sk_admin');
  assert.deepEqual(await revenueCatStatus(e, 'recordnote'), { webhook: 'admin', api: 'admin' });
  const raw = await e.DB_BILLING.prepare('SELECT webhook_secret_sealed AS w, api_key_sealed AS a FROM app_revenuecat').first<{ w: string; a: string }>();
  assert.ok(raw && !raw.w.includes('admin-hook') && !raw.a.includes('sk_admin'), 'stored sealed');
  await saveRevenueCatSecret(e, { appId: 'recordnote', kind: 'webhook', value: null, actorUserId: 'u' }, 3);
  await saveRevenueCatSecret(e, { appId: 'recordnote', kind: 'api', value: null, actorUserId: 'u' }, 4);
  assert.deepEqual((await loadRevenueCatSecrets(e)).webhook.recordnote, 'worker-hook');
});

test('without a data encryption key nothing is stored and Worker secrets keep working', async () => {
  const e = { ...env({ REVENUECAT_WEBHOOK_AUTH: JSON.stringify({ a: 'x' }) }), DATA_ENCRYPTION_KEY: undefined };
  assert.equal(await saveRevenueCatSecret(e, { appId: 'a', kind: 'webhook', value: 'v', actorUserId: 'u' }, 1), false);
  assert.equal((await loadRevenueCatSecrets(e)).webhook.a, 'x');
});
