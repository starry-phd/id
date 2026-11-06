// Unit tests for Apps registered by the Owner in Admin Lite (registered_apps) and the handoff instruction.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clearDynamicAppCache, definitionFromForm, listRegisteredAppIds, refreshDynamicApps, saveRegisteredApp } from '../../src/apps/dynamic';
import { buildHandoff } from '../../src/apps/handoff';
import { appRegistry, getApp, setDynamicApps } from '../../src/apps/registry';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const asD1 = (db: ReturnType<typeof migratedDb>) => db as unknown as D1Database;
const actor = { userId: 'owner-1', requestId: null };
const clock = { app_id: 'clock', name: '繁星時鐘', ios_bundle_id: 'phd.starry.clock', android_package: 'phd.starry.clock', web_origins: 'https://clock.starry.phd' };

function build(form: Parameters<typeof definitionFromForm>[0]) {
  const built = definitionFromForm(form);
  assert.ok(built.ok, built.ok ? '' : built.error);
  return built.app;
}

describe('registering an App without a code change', () => {
  test('the form adds the shared Starry relay clients and default deep links', () => {
    const app = build(clock);
    assert.deepEqual(app.auth.apple, ['phd.starry.clock', 'phd.starry.id.web']);
    assert.deepEqual(app.auth.google, getApp('account')?.auth.google);
    assert.deepEqual(app.return_urls, ['clock://auth/apple', 'clock://auth/google']);
    assert.deepEqual(app.web_origins, ['https://clock.starry.phd']);
    assert.equal(app.status, 'active');
    assert.equal(app.min_version, '0.0.0');
  });

  test('bad input is rejected with a readable error and nothing unsafe gets through', () => {
    for (const form of [
      { ...clock, app_id: 'Bad Id' },
      { ...clock, name: '' },
      { ...clock, web_origins: 'http://clock.example' },
      { ...clock, return_urls: 'https://evil.example/cb' },
      { ...clock, min_version: 'one' },
    ]) {
      assert.equal(definitionFromForm(form).ok, false, JSON.stringify(form));
    }
  });

  test('saving makes the App available to the registry; duplicates and shipped app_ids are refused', async () => {
    const d = asD1(migratedDb());
    clearDynamicAppCache();
    setDynamicApps(new Map());
    assert.equal(await saveRegisteredApp(d, actor, build(clock), 'create', NOW), 'created');
    assert.equal(getApp('clock')?.name, '繁星時鐘');
    assert.ok(appRegistry.keys().includes('clock'));
    assert.ok(appRegistry.values().some((a) => a.web_origins.includes('https://clock.starry.phd')));
    assert.equal(await saveRegisteredApp(d, actor, build(clock), 'create', NOW + 1), 'exists');
    assert.equal(await saveRegisteredApp(d, actor, build({ ...clock, app_id: 'echo' }), 'create', NOW + 1), 'reserved');
    assert.equal(await saveRegisteredApp(d, actor, build({ ...clock, app_id: 'account' }), 'create', NOW + 1), 'reserved');
    assert.equal(await saveRegisteredApp(d, actor, build({ ...clock, app_id: 'other' }), 'update', NOW + 1), 'not_found');
    assert.equal(await saveRegisteredApp(d, actor, build({ ...clock, name: '繁星時鐘 2' }), 'update', NOW + 2), 'updated');
    assert.equal(getApp('clock')?.name, '繁星時鐘 2');
    assert.deepEqual([...(await listRegisteredAppIds(d))], ['clock']);
    const audit = await d.prepare("SELECT action FROM audit_log WHERE target_id = 'clock' ORDER BY occurred_at, audit_id").all<{ action: string }>();
    assert.deepEqual(audit.results.map((r) => r.action), ['admin.app_registered', 'admin.app_updated']);
  });

  test('another isolate picks the App up from the database; a broken row is skipped', async () => {
    const d = asD1(migratedDb());
    await saveRegisteredApp(d, actor, build(clock), 'create', NOW);
    await d.prepare("INSERT INTO registered_apps (app_id, definition, created_at, updated_at) VALUES ('broken', '{not json', ?, ?)").bind(NOW, NOW).run();
    setDynamicApps(new Map());
    clearDynamicAppCache();
    await refreshDynamicApps(d, NOW + 10);
    assert.equal(getApp('clock')?.app_id, 'clock');
    assert.equal(getApp('broken'), undefined);
    assert.equal(getApp('echo')?.app_id, 'echo', 'shipped Apps are untouched');
  });

  test('the handoff instruction carries the registered values and no secret', () => {
    const text = buildHandoff(build(clock), 'https://id.starry.phd');
    for (const expected of ['clock', 'phd.starry.clock', 'https://clock.starry.phd', 'clock://auth/google', 'https://id.starry.phd/v1/apps/clock/config', 'integration-guide.md', 'starry-phd']) {
      assert.ok(text.includes(expected), expected);
    }
    assert.ok(!/secret_key|BEGIN PRIVATE|BATTERY_SERVICE_KEYS=/i.test(text));
  });
});
