// Unit tests for Apps registered by the Owner in Admin Lite (registered_apps) and the handoff instruction.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clearDynamicAppCache, definitionFromForm, listRegisteredAppIds, refreshDynamicApps, saveRegisteredApp } from '../../src/apps/dynamic';
import { buildHandoff } from '../../src/apps/handoff';
import { anyStoredKeys, appForStoredKey, enableAppBattery, hasAppBatteryKey } from '../../src/battery/battery';
import { appRegistry, getApp, setDynamicApps } from '../../src/apps/registry';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const asD1 = (db: ReturnType<typeof migratedDb>) => db as unknown as D1Database;
const actor = { userId: 'owner-1', requestId: null };
const clock = { app_id: 'clock', name: '繁星時鐘', ios_bundle_id: 'phd.starry.clock', android_package: 'phd.starry.clock', web_origins: 'https://clock.starry.phd' };

function build(form: Parameters<typeof definitionFromForm>[0], options?: Parameters<typeof definitionFromForm>[1]) {
  const built = definitionFromForm(form, options);
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

  test('a new App needs only app_id and name: platform names and the web origin are derived', () => {
    const app = build({ app_id: 'my-clock', name: '時鐘' }, { defaults: true });
    assert.equal(app.ios_bundle_id, 'phd.starry.myclock');
    assert.equal(app.android_package, 'phd.starry.myclock');
    assert.deepEqual(app.web_origins, ['https://my-clock.starry.phd']);
    assert.deepEqual(app.return_urls, ['myclock://auth/apple', 'myclock://auth/google']);
    assert.deepEqual(app.auth.apple, ['phd.starry.myclock', 'phd.starry.id.web']);
    assert.equal(build({ app_id: 'my-clock', name: '時鐘', ios_bundle_id: 'com.example.clock' }, { defaults: true }).ios_bundle_id, 'com.example.clock', 'advanced values win');
    assert.equal(build({ app_id: 'my-clock', name: '時鐘' }).ios_bundle_id, null, 'editing never invents values');
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
    assert.ok(text.includes('一律使用 Starry 登入中繼') && text.includes('不要使用原生'));
    assert.ok(!/secret_key|BEGIN PRIVATE|BATTERY_SERVICE_KEYS=/i.test(text));
  });

  test('enabling Battery creates a default task and a key that only its App can use; rotating revokes the old key', async () => {
    const db = asD1(migratedDb('migrations/battery'));
    assert.equal(await anyStoredKeys(db), false);
    const first = await enableAppBattery(db, 'clock', 'owner-1', NOW);
    assert.match(first.serviceKey, /^sbk_[A-Za-z0-9_-]{43}$/);
    assert.equal(first.taskType, 'clock.ai');
    assert.equal(await hasAppBatteryKey(db, 'clock'), true);
    assert.equal(await appForStoredKey(db, first.serviceKey), 'clock');
    assert.equal(await appForStoredKey(db, `${first.serviceKey}x`), null);
    assert.equal(await appForStoredKey(db, undefined), null);
    const stored = await db.prepare('SELECT key_hash FROM battery_app_keys').all<{ key_hash: string }>();
    assert.ok(!JSON.stringify(stored.results).includes(first.serviceKey), 'only a hash is stored');
    await db.prepare("UPDATE battery_task_types SET unit_cost = 5 WHERE task_type = 'clock.ai'").run();
    const second = await enableAppBattery(db, 'clock', 'owner-1', NOW + 1);
    assert.notEqual(second.serviceKey, first.serviceKey);
    assert.equal(await appForStoredKey(db, first.serviceKey), null, 'rotation revokes the old key');
    assert.equal(await appForStoredKey(db, second.serviceKey), 'clock');
    const task = await db.prepare("SELECT unit_cost FROM battery_task_types WHERE task_type = 'clock.ai'").first<{ unit_cost: number }>();
    assert.equal(task?.unit_cost, 5, 'an edited task is never overwritten');
  });

  test('the handoff mentions Battery only as set up or not yet set up, never with a key', () => {
    const app = build(clock);
    assert.ok(buildHandoff(app, 'https://id.starry.phd', { battery: true }).includes('clock.ai'));
    assert.ok(buildHandoff(app, 'https://id.starry.phd', { battery: true }).includes('STARRY_BATTERY_KEY'));
    assert.ok(buildHandoff(app, 'https://id.starry.phd', { battery: true }).includes('.gitleaks.toml'));
    assert.ok(buildHandoff(app, 'https://id.starry.phd').includes('尚未'));
  });
});
