import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { passkeyExtraOrigins } from '../../src/apps/passkey-origins';
import { parseApp, setDynamicApps } from '../../src/apps/registry';
import { app } from '../../src/app';

const FP = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
const def = (extra: Record<string, unknown> = {}) => ({
  app_id: 'clock',
  name: 'Clock',
  ios_bundle_id: 'phd.starry.clock',
  android_package: 'phd.starry.clock',
  status: 'active',
  scopes: ['profile:read'],
  min_version: '0.0.0',
  config: {},
  auth: { apple_audiences: [], google_audiences: [] },
  web_origins: ['https://clock.starry.phd'],
  return_urls: [],
  ...extra,
});

describe('Passkey support for Apps', () => {
  test('the registry validates the Team ID and certificate fingerprints', () => {
    assert.equal(parseApp(def()).ios_team_id, null);
    assert.deepEqual(parseApp(def()).android_cert_sha256, []);
    assert.equal(parseApp(def({ ios_team_id: 'ABCDE12345' })).ios_team_id, 'ABCDE12345');
    assert.throws(() => parseApp(def({ ios_team_id: 'abc' })), /Team ID/);
    assert.throws(() => parseApp(def({ android_cert_sha256: ['not-a-fingerprint'] })), /android_cert_sha256/);
  });

  test('Android origins are the base64url of the certificate hash; web origins are included', () => {
    const origins = passkeyExtraOrigins(parseApp(def({ android_cert_sha256: [FP] })));
    assert.equal(origins[0], 'https://clock.starry.phd');
    assert.equal(origins[1], `android:apk-key-hash:${Buffer.from(FP.split(':').map((h) => parseInt(h, 16))).toString('base64url')}`);
    assert.deepEqual(passkeyExtraOrigins(parseApp(def({ android_package: null, android_cert_sha256: [FP] }))), ['https://clock.starry.phd'], 'no package, no Android origin');
  });

  test('every App follows the central Team ID; one stored on the App wins; with neither the App is left out', async () => {
    setDynamicApps(new Map([
      ['clock', parseApp(def())],
      ['notes', parseApp(def({ app_id: 'notes', ios_bundle_id: 'phd.starry.notes', android_package: 'phd.starry.notes', ios_team_id: 'ZZZZZ99999' }))],
    ]));
    try {
      const ids = async (env: Record<string, string>) => {
        const res = await app.fetch(new Request('https://id.starry.phd/.well-known/apple-app-site-association'), env as never);
        return ((await res.json()) as { webcredentials: { apps: string[] } }).webcredentials.apps;
      };
      const central = await ids({ STARRY_APPLE_TEAM_ID: '4W7QRTXN5Y' });
      assert.ok(central.includes('4W7QRTXN5Y.phd.starry.clock') && central.includes('4W7QRTXN5Y.phd.starry.echo') && central.includes('4W7QRTXN5Y.phd.starry.recordnote'));
      assert.ok(central.includes('ZZZZZ99999.phd.starry.notes') && !central.includes('4W7QRTXN5Y.phd.starry.notes'));
      assert.deepEqual((await ids({})).filter((x) => x.includes('phd.starry.clock')), [], 'no central value, no entry');
      assert.deepEqual((await ids({ STARRY_APPLE_TEAM_ID: 'bad' })).filter((x) => x.includes('phd.starry.clock')), [], 'an invalid central value counts as unset');
    } finally {
      setDynamicApps(new Map());
    }
  });

  test('the files Apple, Google and browsers fetch are generated from the registry', async () => {
    setDynamicApps(new Map([['clock', parseApp(def({ ios_team_id: 'ABCDE12345', android_cert_sha256: [FP] }))]]));
    try {
      const get = async (path: string) => app.fetch(new Request(`https://id.starry.phd${path}`), {} as never);
      const aasa = await get('/.well-known/apple-app-site-association');
      assert.equal(aasa.status, 200);
      assert.match(aasa.headers.get('content-type') ?? '', /application\/json/);
      assert.ok(((await aasa.json()) as { webcredentials: { apps: string[] } }).webcredentials.apps.includes('ABCDE12345.phd.starry.clock'));
      const links = (await (await get('/.well-known/assetlinks.json')).json()) as { relation: string[]; target: { package_name: string; sha256_cert_fingerprints: string[] } }[];
      const mine = links.find((l) => l.target.package_name === 'phd.starry.clock');
      assert.deepEqual(mine?.relation, ['delegate_permission/common.get_login_creds']);
      assert.deepEqual(mine?.target.sha256_cert_fingerprints, [FP]);
      const ror = (await (await get('/.well-known/webauthn')).json()) as { origins: string[] };
      assert.ok(ror.origins.includes('https://clock.starry.phd'));
      assert.ok(ror.origins.includes('https://echo.starry.phd'));
    } finally {
      setDynamicApps(new Map());
    }
  });
});
