import { Hono } from 'hono';
import type { AppBindings } from '../env';
import { appRegistry } from './registry';
import { WEB_APP_ID } from '../identity/web-sessions';
import { effectiveTeamId } from './team-id';

/**
 * Files Apple, Google and browsers fetch from Starry ID's own host to let Apps use Starry Passkeys:
 * - apple-app-site-association: iOS Apps allowed to use this host's Passkeys (webcredentials)
 * - assetlinks.json: Android Apps (package + signing certificate) allowed to use them (get_login_creds)
 * - webauthn: App web origins that may use them (WebAuthn Related Origin Requests)
 * All three are generated from the App registry, so registering an App in Admin Lite is enough.
 */
export const wellKnown = new Hono<AppBindings>();

const apps = () => appRegistry.values().filter((a) => a.app_id !== WEB_APP_ID);

wellKnown.use('*', async (c, next) => {
  await next();
  c.header('cache-control', 'public, max-age=300');
});

wellKnown.get('/apple-app-site-association', (c) => {
  // Team ID: the one central D1 setting for every App (the Worker variable is only an emergency fallback).
  const ids = apps().flatMap((a) => {
    const team = effectiveTeamId(a, c.env);
    return team && a.ios_bundle_id ? [`${team}.${a.ios_bundle_id}`] : [];
  });
  return c.json({ webcredentials: { apps: [...new Set(ids)] } });
});

wellKnown.get('/assetlinks.json', (c) =>
  c.json(
    apps().flatMap((a) =>
      a.android_package && a.android_cert_sha256.length > 0
        ? [{ relation: ['delegate_permission/common.get_login_creds'], target: { namespace: 'android_app', package_name: a.android_package, sha256_cert_fingerprints: [...a.android_cert_sha256] } }]
        : [],
    ),
  ),
);

wellKnown.get('/webauthn', (c) => c.json({ origins: [...new Set(apps().flatMap((a) => [...a.web_origins]))] }));
