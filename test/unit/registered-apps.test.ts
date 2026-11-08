// Unit tests for Apps registered by the Owner in Admin Lite (registered_apps) and the handoff instruction.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { clearDynamicAppCache, definitionFromForm, invalidRegisteredApps, listRegisteredAppIds, normalizeFingerprint, refreshDynamicApps, saveRegisteredApp } from '../../src/apps/dynamic';
import { createHash } from 'node:crypto';
import { buildHandoff, HANDOFF_UPDATED, HANDOFF_VERSION } from '../../src/apps/handoff';
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

  test('saving makes the App available to the registry; duplicates and the account center are refused', async () => {
    const d = asD1(migratedDb());
    clearDynamicAppCache();
    setDynamicApps(new Map());
    assert.equal(await saveRegisteredApp(d, actor, build(clock), 'create', NOW), 'created');
    assert.equal(getApp('clock')?.name, '繁星時鐘');
    assert.ok(appRegistry.keys().includes('clock'));
    assert.ok(appRegistry.values().some((a) => a.web_origins.includes('https://clock.starry.phd')));
    assert.equal(await saveRegisteredApp(d, actor, build(clock), 'create', NOW + 1), 'exists');
    assert.equal(await saveRegisteredApp(d, actor, build({ ...clock, app_id: 'echo' }), 'create', NOW + 1), 'exists', 'echo is registered like any other App');
    assert.equal(await saveRegisteredApp(d, actor, build({ ...clock, app_id: 'account' }), 'create', NOW + 1), 'reserved');
    assert.equal(await saveRegisteredApp(d, actor, build({ ...clock, app_id: 'other' }), 'update', NOW + 1), 'not_found');
    assert.equal(await saveRegisteredApp(d, actor, build({ ...clock, name: '繁星時鐘 2' }), 'update', NOW + 2), 'updated');
    assert.equal(getApp('clock')?.name, '繁星時鐘 2');
    assert.deepEqual([...(await listRegisteredAppIds(d))].sort(), ['clock', 'echo', 'recordnote']);
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
    assert.equal(getApp('echo')?.app_id, 'echo', 'the Apps from migration 0028 load from the database');
  });

  test('a broken stored row keeps the last good definition of that App and is flagged; fixing it clears the flag', async () => {
    const d = asD1(migratedDb());
    await saveRegisteredApp(d, actor, build(clock), 'create', NOW);
    clearDynamicAppCache();
    await refreshDynamicApps(d, NOW + 10);
    assert.deepEqual(invalidRegisteredApps(), []);
    await d.prepare("UPDATE registered_apps SET definition = '{broken' WHERE app_id = 'clock'").run();
    clearDynamicAppCache();
    await refreshDynamicApps(d, NOW + 20);
    assert.equal(getApp('clock')?.name, '繁星時鐘', 'the App does not disappear');
    assert.deepEqual(invalidRegisteredApps(), ['clock']);
    await saveRegisteredApp(d, actor, build({ ...clock, name: '新名稱' }), 'update', NOW + 30);
    assert.equal(getApp('clock')?.name, '新名稱');
    assert.deepEqual(invalidRegisteredApps(), []);
  });

  test('Android fingerprints: typed at creation, left empty, or added later; any common paste format is accepted; the Team ID is never stored per App', () => {
    const FP = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
    assert.equal(normalizeFingerprint(FP), FP);
    assert.equal(normalizeFingerprint(FP.toLowerCase()), FP);
    assert.equal(normalizeFingerprint(FP.replaceAll(':', '')), FP);
    assert.equal(normalizeFingerprint(`SHA256: ${FP}`), FP);
    assert.equal(normalizeFingerprint('AA:BB'), null);
    assert.equal(build(clock).android_cert_sha256.length, 0, 'empty is allowed');
    const second = FP.replace(/^AA/, '11');
    assert.deepEqual(build({ ...clock, android_cert_sha256: `${FP}\n${second.toLowerCase()}\n${FP}` }).android_cert_sha256, [FP, second], 'several, de-duplicated, upper-cased');
    const bad = definitionFromForm({ ...clock, android_cert_sha256: 'not-a-fingerprint' });
    assert.ok(!bad.ok && /Android 簽章指紋格式不正確/.test(bad.error));
    assert.equal(build({ ...clock, android_cert_sha256: FP, ios_team_id: 'ZZZZZZZZZZ' } as Parameters<typeof definitionFromForm>[0]).ios_team_id, null, 'follows the central Team ID');
  });

  test('the handoff names the central Team ID and does not claim Android Passkeys work without a fingerprint', () => {
    const text = buildHandoff(build(clock), 'https://id.starry.phd', { battery: false, teamId: '4W7QRTXN5Y' });
    assert.ok(text.includes('全生態系共用') && text.includes('4W7QRTXN5Y'));
    assert.ok(text.includes('業主尚未登記') && text.includes('不要對業主宣稱 Android Passkey 已可用'));
    assert.ok(text.includes('Upload key'), 'explains which certificate to register');
  });

  test('the handoff instruction carries the registered values and no secret', () => {
    const text = buildHandoff(build(clock), 'https://id.starry.phd');
    for (const expected of ['clock', 'phd.starry.clock', 'https://clock.starry.phd', 'clock://auth/google', 'https://id.starry.phd/v1/apps/clock/config', 'integration-guide.md', 'starry-phd']) {
      assert.ok(text.includes(expected), expected);
    }
    assert.ok(text.includes('一律使用 Starry 登入中繼') && text.includes('不要使用原生'));
    assert.ok(!/secret_key|BEGIN PRIVATE|BATTERY_SERVICE_KEYS=/i.test(text));
  });

  test('enabling Battery creates a key that only its App can use; rotating revokes the old key', async () => {
    const db = asD1(migratedDb('migrations/battery'));
    assert.equal(await anyStoredKeys(db), false);
    const first = await enableAppBattery(db, 'clock', 'owner-1', NOW);
    assert.match(first.serviceKey, /^sbk_[A-Za-z0-9_-]{43}$/);
    assert.equal(await hasAppBatteryKey(db, 'clock'), true);
    assert.equal(await appForStoredKey(db, first.serviceKey), 'clock');
    assert.equal(await appForStoredKey(db, `${first.serviceKey}x`), null);
    assert.equal(await appForStoredKey(db, undefined), null);
    const stored = await db.prepare('SELECT key_hash FROM battery_app_keys').all<{ key_hash: string }>();
    assert.ok(!JSON.stringify(stored.results).includes(first.serviceKey), 'only a hash is stored');
    const second = await enableAppBattery(db, 'clock', 'owner-1', NOW + 1);
    assert.notEqual(second.serviceKey, first.serviceKey);
    assert.equal(await appForStoredKey(db, first.serviceKey), null, 'rotation revokes the old key');
    assert.equal(await appForStoredKey(db, second.serviceKey), 'clock');
  });

  test('the handoff tells an already integrated App to only patch the differences', () => {
    const text = buildHandoff(build(clock), 'https://id.starry.phd');
    assert.ok(text.includes('已經串接過') && text.includes('六、已串接 App 的更新檢查清單'));
    for (const word of ['BATTERY_APP_CAP', 'quantum_amount', 'starry-sdk.ts', 'min_version', 'kid']) assert.ok(text.includes(word), word);
    assert.ok(!/sbk_[A-Za-z0-9]{8}/.test(text), 'still no key');
  });

  test('the handoff shows its version, and changing the text requires a new version', () => {
    const text = buildHandoff(build(clock), 'https://id.starry.phd', { battery: true });
    assert.ok(text.startsWith(`【串接指令版本 ${HANDOFF_VERSION}｜更新時間 ${HANDOFF_UPDATED}】`));
    // When this fails you changed the handoff text: bump HANDOFF_VERSION and HANDOFF_UPDATED in src/apps/handoff.ts,
    // then paste the new hash here.
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
    assert.equal(`${HANDOFF_VERSION}:${hash}`, '2026-11-09.1:06687d5e455d30f6');
  });

  test('the handoff mentions Battery only as set up or not yet set up, never with a key', () => {
    const app = build(clock);
    assert.ok(buildHandoff(app, 'https://id.starry.phd', { battery: true }).includes('clock.ai'));
    assert.ok(buildHandoff(app, 'https://id.starry.phd', { battery: true }).includes('STARRY_BATTERY_KEY'));
    assert.ok(buildHandoff(app, 'https://id.starry.phd', { battery: true }).includes('.gitleaks.toml'));
    assert.ok(buildHandoff(app, 'https://id.starry.phd').includes('尚未'));
  });
});
