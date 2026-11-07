import { base64urlEncode } from '../lib/encoding';
import type { AppEntry } from './registry';

/**
 * Origins whose Passkey requests one App may send to Starry ID, besides Starry ID's own origin:
 * the App's web pages (WebAuthn Related Origin Requests, listed in /.well-known/webauthn) and its Android signing
 * certificates (android:apk-key-hash:…, the origin Android's Credential Manager reports). iOS apps report
 * Starry ID's own https origin.
 */
export function passkeyExtraOrigins(app: AppEntry): string[] {
  const android = app.android_package ? app.android_cert_sha256.map((fp) => `android:apk-key-hash:${base64urlEncode(Uint8Array.from(fp.split(':').map((h) => parseInt(h, 16))))}`) : [];
  return [...app.web_origins, ...android];
}
