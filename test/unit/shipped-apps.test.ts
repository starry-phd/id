// Migration 0028 registers the two Apps that used to live in config/apps.json. The test fixture must say the same thing,
// and a cold isolate must never answer "unknown App" while the first registry read is still running.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clearDynamicAppCache, refreshDynamicApps } from '../../src/apps/dynamic';
import { appDefinition, appRegistry, getApp, parseApp, setDynamicApps } from '../../src/apps/registry';
import { migratedDb } from '../support/sqlite-d1.mjs';
import { SHIPPED_APPS } from '../support/shipped-apps';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);

describe('the Apps registered by migration 0028', () => {
  test('the database rows equal the test fixture, are valid, and follow the central Team ID', async () => {
    const d = migratedDb() as unknown as D1Database;
    const rows = await d.prepare('SELECT app_id, definition FROM registered_apps ORDER BY app_id').all<{ app_id: string; definition: string }>();
    assert.deepEqual(rows.results.map((r) => r.app_id), ['echo', 'recordnote']);
    for (const row of rows.results) {
      const app = parseApp(JSON.parse(row.definition));
      assert.equal(app.app_id, row.app_id);
      assert.equal(app.ios_team_id, null, 'no Team ID of its own: it follows STARRY_APPLE_TEAM_ID');
      assert.deepEqual(appDefinition(app), appDefinition(SHIPPED_APPS.find((a) => a.app_id === row.app_id)!));
    }
  });

  test('values the file used to define are all there: bundle ids, audiences, origins, return URLs, scopes', () => {
    const echo = getApp('echo')!;
    assert.equal(echo.ios_bundle_id, 'phd.starry.echo');
    assert.equal(echo.android_package, 'phd.starry.echo');
    assert.deepEqual(echo.auth.apple, ['phd.starry.echo', 'phd.starry.id.web']);
    assert.equal(echo.auth.google.length, 2);
    assert.deepEqual(echo.web_origins, ['https://echo.starry.phd', 'https://echo-api-staging.starry-phd.workers.dev']);
    assert.deepEqual(echo.return_urls, ['echostarry://auth/apple']);
    const note = getApp('recordnote')!;
    assert.deepEqual(note.return_urls, ['recordnote://auth/google', 'recordnote://auth/apple']);
    assert.deepEqual(note.scopes, ['profile:read', 'profile:write']);
    assert.ok(getApp('account') && appRegistry.keys()[0] === 'account', 'the account center stays in config/apps.json');
  });

  test('a cold isolate: requests that arrive during the first read wait for it instead of seeing no Apps', async () => {
    const d = migratedDb() as unknown as D1Database;
    setDynamicApps(new Map());
    clearDynamicAppCache();
    const slow = new Proxy(d, {
      get(target, key) {
        if (key !== 'prepare') return Reflect.get(target, key, target) as unknown;
        return (sql: string) => {
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(s, k) {
              const value = Reflect.get(s, k, s) as unknown;
              if (k === 'all') return async () => { await new Promise((r) => setTimeout(r, 40)); return (value as () => Promise<unknown>).call(s); };
              return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(s) : value;
            },
          });
        };
      },
    });
    const first = refreshDynamicApps(slow, NOW);
    const seen: (string | undefined)[] = [];
    const second = refreshDynamicApps(slow, NOW + 5).then(() => seen.push(getApp('echo')?.app_id));
    const third = refreshDynamicApps(slow, NOW + 6).then(() => seen.push(getApp('recordnote')?.app_id));
    await Promise.all([first, second, third]);
    assert.deepEqual(seen, ['echo', 'recordnote']);
    setDynamicApps(new Map(SHIPPED_APPS.map((a) => [a.app_id, a])));
  });
});
