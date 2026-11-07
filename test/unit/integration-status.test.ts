// Per-App integration checklist (Admin Lite "整合狀態總覽"): what is done, what the Owner still has to do.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ANDROID_PENDING_TEXT, APPLE_PENDING_TEXT, appChecks, pendingItems, type StatusInputs } from '../../src/apps/integration-status';
import { parseApp } from '../../src/apps/registry';
import { centralTeamId, effectiveTeamId } from '../../src/apps/team-id';

const FP = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
const def = (extra: Record<string, unknown> = {}) => ({
  app_id: 'clock', name: 'Clock', ios_bundle_id: 'phd.starry.clock', android_package: 'phd.starry.clock', status: 'active', scopes: ['profile:read'], min_version: '0.0.0', config: {},
  auth: { apple_audiences: [], google_audiences: [] }, web_origins: ['https://clock.starry.phd'], return_urls: [], ...extra,
});
const ready: StatusInputs = { batteryKey: true, products: 0, revenuecat: { webhook: 'none', api: 'none' }, stage: 'dev' };
const state = (checks: ReturnType<typeof appChecks>, key: string) => checks.find((c) => c.key === key)?.state;

describe('central Team ID', () => {
  test('only a valid 10-character value counts; a value stored on the App wins', () => {
    assert.equal(centralTeamId({ STARRY_APPLE_TEAM_ID: '4W7QRTXN5Y' }), '4W7QRTXN5Y');
    assert.equal(centralTeamId({ STARRY_APPLE_TEAM_ID: ' 4w7qrtxn5y ' }), '4W7QRTXN5Y');
    assert.equal(centralTeamId({ STARRY_APPLE_TEAM_ID: 'short' }), null);
    assert.equal(centralTeamId({}), null);
    assert.equal(effectiveTeamId(parseApp(def()), { STARRY_APPLE_TEAM_ID: '4W7QRTXN5Y' }), '4W7QRTXN5Y');
    assert.equal(effectiveTeamId(parseApp(def({ ios_team_id: 'ZZZZZ99999' })), { STARRY_APPLE_TEAM_ID: '4W7QRTXN5Y' }), 'ZZZZZ99999');
  });
});

describe('integration checklist', () => {
  test('an Android App without a fingerprint is pending and says so; it is never reported as ready', () => {
    const checks = appChecks(parseApp(def()), ready, { STARRY_APPLE_TEAM_ID: '4W7QRTXN5Y' });
    assert.equal(state(checks, 'android'), 'todo');
    assert.deepEqual(pendingItems(checks), [ANDROID_PENDING_TEXT]);
    assert.equal(ANDROID_PENDING_TEXT, 'Android 正式簽章尚未設定，原生 Passkey 關聯尚待完成。');
  });

  test('a fingerprint and the central Team ID make both platforms ready', () => {
    const checks = appChecks(parseApp(def({ android_cert_sha256: [FP] })), ready, { STARRY_APPLE_TEAM_ID: '4W7QRTXN5Y' });
    assert.equal(state(checks, 'apple'), 'ok');
    assert.equal(state(checks, 'android'), 'ok');
    assert.deepEqual(pendingItems(checks), []);
  });

  test('without a central Team ID the iOS side is pending; a platform the App does not have does not apply', () => {
    const checks = appChecks(parseApp(def({ android_package: null })), ready, {});
    assert.equal(state(checks, 'apple'), 'todo');
    assert.ok(pendingItems(checks).includes(APPLE_PENDING_TEXT));
    assert.equal(state(checks, 'android'), 'na');
    assert.equal(state(appChecks(parseApp(def({ ios_bundle_id: null })), ready, {}), 'apple'), 'na');
  });

  test('Battery, web origin and RevenueCat are checked; RevenueCat only matters once products are registered', () => {
    const app = parseApp(def({ web_origins: [], android_cert_sha256: [FP] }));
    const env = { STARRY_APPLE_TEAM_ID: '4W7QRTXN5Y' };
    const bare = appChecks(app, { ...ready, batteryKey: false }, env);
    assert.equal(state(bare, 'battery'), 'todo');
    assert.equal(state(bare, 'web'), 'todo');
    assert.equal(state(bare, 'revenuecat'), 'na');
    assert.equal(state(appChecks(app, { ...ready, products: 2 }, env), 'revenuecat'), 'todo');
    assert.equal(state(appChecks(app, { ...ready, products: 2, revenuecat: { webhook: 'admin', api: 'none' } }, env), 'revenuecat'), 'todo');
    assert.equal(state(appChecks(app, { ...ready, products: 2, revenuecat: { webhook: 'admin', api: 'worker' } }, env), 'revenuecat'), 'ok');
  });
});
