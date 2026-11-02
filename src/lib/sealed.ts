import { base64urlDecode, base64urlEncode, fromUtf8, toArrayBuffer, utf8 } from './encoding';
import { randomBytes } from './crypto';

/**
 * AES-256-GCM sealing for the few secrets the platform must keep (e.g. Apple refresh
 * tokens). The key is the DATA_ENCRYPTION_KEY secret: 32 random bytes, base64url.
 * `context` is bound as additional data so a value sealed for one purpose cannot be
 * opened as another.
 */
const PREFIX = 'v1';

async function importKey(keyB64url: string): Promise<CryptoKey | null> {
  try {
    const raw = base64urlDecode(keyB64url);
    if (raw.length !== 32) return null;
    return await crypto.subtle.importKey('raw', toArrayBuffer(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

export async function seal(keyB64url: string, context: string, plaintext: string): Promise<string | null> {
  const key = await importKey(keyB64url);
  if (!key) return null;
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(utf8(context)) },
    key,
    toArrayBuffer(utf8(plaintext)),
  );
  return `${PREFIX}.${base64urlEncode(iv)}.${base64urlEncode(new Uint8Array(ciphertext))}`;
}

export async function open(keyB64url: string, context: string, sealed: string): Promise<string | null> {
  const key = await importKey(keyB64url);
  const parts = sealed.split('.');
  if (!key || parts.length !== 3 || parts[0] !== PREFIX) return null;
  try {
    const iv = base64urlDecode(parts[1] as string);
    const ciphertext = base64urlDecode(parts[2] as string);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(utf8(context)) },
      key,
      toArrayBuffer(ciphertext),
    );
    return fromUtf8(new Uint8Array(plaintext));
  } catch {
    return null;
  }
}
