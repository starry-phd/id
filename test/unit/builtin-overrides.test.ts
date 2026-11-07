// Built-in Apps: config/apps.json is the baseline; admin overrides sit on top and never take the file away.
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { applyPatch, editableFields, loadBuiltinOverrides, revertBuiltinOverride, saveBuiltinOverride } from '../../src/apps/builtin-overrides';
import { clearDynamicAppCache, refreshDynamicApps } from '../../src/apps/dynamic';
import { appRegistry, baselineApp, getApp, setBuiltinOverrides } from '../../src/apps/registry';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const asD1 = (db: ReturnType<typeof migratedDb>) => db as unknown as D1Database;
const actor = { userId: 'owner-1', requestId: null };

afterEach(() => {
  setBuiltinOverrides(new Map());
  clearDynamicAppCache();
});

function failingDb(): D1Database {
  return {
    prepare: () => {
      throw new Error('D1 is down');
    },
    batch: () => {
      throw new Error('D1 is down');
    },
  } as unknown as D1Database;
}

describe('built-in App overrides', () => {
  test('without overrides every App is exactly what config/apps.json says', async () => {
    const db = asD1(migratedDb('migrations/identity'));
    await loadBuiltinOverrides(db);
    for (const app of appRegistry.values()) assert.equal(app, baselineApp(app.app_id) ?? app);
  });

  test('a saved override changes only the fields given, and reverting restores the file', async () => {
    const db = asD1(migratedDb('migrations/identity'));
    const before = baselineApp('recordnote');
    assert.ok(before);
    const saved = await saveBuiltinOverride(db, actor, 'recordnote', { min_version: '1.2.0', name: '改名測試' }, NOW);
    assert.equal(saved.result, 'saved');
    const now = getApp('recordnote');
    assert.equal(now?.min_version, '1.2.0');
    assert.equal(now?.name, '改名測試');
    assert.deepEqual(now?.web_origins, before.web_origins);
    assert.deepEqual(now?.auth, before.auth);
    assert.equal(baselineApp('recordnote')?.min_version, before.min_version);
    const audit = await db.prepare("SELECT action FROM audit_log WHERE action = 'admin.builtin_app_overridden'").all();
    assert.equal(audit.results.length, 1);
    assert.equal((await revertBuiltinOverride(db, actor, 'recordnote', NOW)).result, 'reverted');
    assert.equal(getApp('recordnote')?.min_version, before.min_version);
    assert.equal(getApp('recordnote')?.name, before.name);
  });

  test('values equal to the file are not stored; saving only file values removes the override', async () => {
    const db = asD1(migratedDb('migrations/identity'));
    const base = baselineApp('echo');
    assert.ok(base);
    await saveBuiltinOverride(db, actor, 'echo', { min_version: '3.0.0' }, NOW);
    assert.equal((await saveBuiltinOverride(db, actor, 'echo', { min_version: base.min_version, name: base.name }, NOW)).result, 'reverted');
    const rows = await db.prepare('SELECT * FROM builtin_app_overrides').all();
    assert.equal(rows.results.length, 0);
  });

  test('invalid values and unknown Apps are refused and nothing is stored', async () => {
    const db = asD1(migratedDb('migrations/identity'));
    assert.equal((await saveBuiltinOverride(db, actor, 'recordnote', { min_version: 'abc' }, NOW)).result, 'invalid');
    assert.equal((await saveBuiltinOverride(db, actor, 'recordnote', { app_id: 'other' }, NOW)).result, 'invalid');
    assert.equal((await saveBuiltinOverride(db, actor, 'recordnote', { web_origins: ['http://insecure.example'] }, NOW)).result, 'invalid');
    assert.equal((await saveBuiltinOverride(db, actor, 'nope', { name: 'x' }, NOW)).result, 'unknown_app');
    assert.equal((await db.prepare('SELECT * FROM builtin_app_overrides').all()).results.length, 0);
  });

  test('the account center only accepts its low-risk fields', async () => {
    const db = asD1(migratedDb('migrations/identity'));
    assert.deepEqual(editableFields('account'), ['name', 'min_version']);
    for (const patch of [{ web_origins: ['https://evil.example'] }, { return_urls: ['evil://x/y'] }, { status: 'killed' }, { auth: {} }]) {
      assert.equal((await saveBuiltinOverride(db, actor, 'account', patch, NOW)).result, 'invalid');
    }
    assert.equal((await saveBuiltinOverride(db, actor, 'account', { name: '新名稱' }, NOW)).result, 'saved');
    assert.throws(() => applyPatch(baselineApp('account')!, { status: 'paused' }));
  });

  test('a broken row is ignored: that App falls back to the file, the others keep their overrides', async () => {
    const db = migratedDb('migrations/identity');
    const d1 = asD1(db);
    await saveBuiltinOverride(d1, actor, 'echo', { min_version: '2.0.0' }, NOW);
    db.prepare("INSERT INTO builtin_app_overrides (app_id, patch, updated_at) VALUES ('recordnote', '{\"min_version\":\"bad\"}', 1)").run();
    db.prepare("INSERT INTO builtin_app_overrides (app_id, patch, updated_at) VALUES ('ghost', '{}', 1)").run();
    setBuiltinOverrides(new Map());
    await loadBuiltinOverrides(d1);
    assert.equal(getApp('echo')?.min_version, '2.0.0');
    assert.equal(getApp('recordnote')?.min_version, baselineApp('recordnote')?.min_version);
    assert.equal(getApp('ghost'), undefined);
  });

  test('database outage: cold start uses the file, a warm isolate keeps the last good overrides', async () => {
    const db = asD1(migratedDb('migrations/identity'));
    await loadBuiltinOverrides(failingDb());
    assert.equal(getApp('recordnote')?.min_version, baselineApp('recordnote')?.min_version);
    await saveBuiltinOverride(db, actor, 'recordnote', { min_version: '1.5.0' }, NOW);
    await loadBuiltinOverrides(failingDb());
    assert.equal(getApp('recordnote')?.min_version, '1.5.0');
  });

  test('a missing table (older database) does not break the Apps', async () => {
    const bare = asD1(migratedDb('migrations/billing'));
    await loadBuiltinOverrides(bare);
    assert.ok(getApp('account'));
  });
});

describe('registry refresh backoff', () => {
  test('after a failed read the database is not queried again for 10 seconds', async () => {
    let calls = 0;
    const db = {
      prepare: () => {
        calls += 1;
        throw new Error('D1 is down');
      },
    } as unknown as D1Database;
    clearDynamicAppCache();
    await refreshDynamicApps(db, NOW);
    const first = calls;
    assert.ok(first > 0);
    await refreshDynamicApps(db, NOW + 3000);
    await refreshDynamicApps(db, NOW + 9000);
    assert.equal(calls, first);
    await refreshDynamicApps(db, NOW + 31000);
    assert.ok(calls > first);
  });
});
