import { base64urlDecode, base64urlEncode, fromUtf8, parseBase64urlJson, toArrayBuffer } from '../lib/encoding';

/**
 * Minimal WebAuthn verification for passkeys: ES256 only, attestation "none", user verification required.
 * The challenge is checked by the caller (it is a single-use server nonce); everything else is checked here.
 */

// ---- A small CBOR reader: only what authenticator data and COSE keys use ----
type Cbor = number | bigint | string | boolean | null | Uint8Array | Cbor[] | Map<Cbor, Cbor>;

function readCbor(bytes: Uint8Array, start: number): { value: Cbor; end: number } {
  let pos = start;
  const initial = bytes[pos++];
  if (initial === undefined) throw new Error('cbor: end');
  const major = initial >> 5;
  const info = initial & 31;
  const length = (): number => {
    if (info < 24) return info;
    const size = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : 0;
    if (size === 0) throw new Error('cbor: unsupported length');
    let n = 0;
    for (let i = 0; i < size; i++) {
      const b = bytes[pos++];
      if (b === undefined) throw new Error('cbor: end');
      n = n * 256 + b;
    }
    return n;
  };
  switch (major) {
    case 0:
      return { value: length(), end: pos };
    case 1:
      return { value: -1 - length(), end: pos };
    case 2:
    case 3: {
      const n = length();
      if (pos + n > bytes.length) throw new Error('cbor: end');
      const slice = bytes.slice(pos, pos + n);
      pos += n;
      return { value: major === 2 ? slice : fromUtf8(slice), end: pos };
    }
    case 4: {
      const n = length();
      if (n > 64) throw new Error('cbor: too long');
      const items: Cbor[] = [];
      for (let i = 0; i < n; i++) {
        const item = readCbor(bytes, pos);
        items.push(item.value);
        pos = item.end;
      }
      return { value: items, end: pos };
    }
    case 5: {
      const n = length();
      if (n > 64) throw new Error('cbor: too long');
      const map = new Map<Cbor, Cbor>();
      for (let i = 0; i < n; i++) {
        const k = readCbor(bytes, pos);
        const v = readCbor(bytes, k.end);
        map.set(k.value, v.value);
        pos = v.end;
      }
      return { value: map, end: pos };
    }
    case 7:
      if (info === 20) return { value: false, end: pos };
      if (info === 21) return { value: true, end: pos };
      if (info === 22 || info === 23) return { value: null, end: pos };
      throw new Error('cbor: unsupported simple value');
    default:
      throw new Error('cbor: unsupported type');
  }
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export interface ExpectedOrigin {
  origin: string;
  /** Further accepted origins: an App's web pages (related origins) and Android apps (android:apk-key-hash:…). */
  extraOrigins?: readonly string[];
  rpId: string;
}

export interface PasskeyKey {
  x: string;
  y: string;
}

export interface ClientData {
  type: string;
  challenge: string;
}

/** Reads clientDataJSON and checks type and origin; the caller consumes the challenge it returns. */
export function readClientData(clientDataJSON: string, expectedType: 'webauthn.create' | 'webauthn.get', expected: ExpectedOrigin): ClientData | null {
  const data = parseBase64urlJson(clientDataJSON);
  if (!data || data.type !== expectedType || typeof data.challenge !== 'string') return null;
  if (data.origin !== expected.origin && !(typeof data.origin === 'string' && expected.extraOrigins?.includes(data.origin))) return null;
  if (data.crossOrigin === true) return null;
  return { type: expectedType, challenge: data.challenge };
}

async function rpIdHashMatches(authData: Uint8Array, rpId: string): Promise<boolean> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId)));
  if (authData.length < 37) return false;
  for (let i = 0; i < 32; i++) if (authData[i] !== hash[i]) return false;
  return true;
}

export interface RegisteredPasskey {
  credentialId: string;
  key: PasskeyKey;
  signCount: number;
}

/** Verifies the attestation object of a new passkey (format "none" or any: only the credential is used). */
export async function verifyRegistration(attestationObject: string, expected: ExpectedOrigin): Promise<RegisteredPasskey | null> {
  try {
    const bytes = base64urlDecode(attestationObject);
    const top = readCbor(bytes, 0).value;
    if (!(top instanceof Map)) return null;
    const authData = top.get('authData');
    if (!(authData instanceof Uint8Array) || authData.length < 55) return null;
    if (!(await rpIdHashMatches(authData, expected.rpId))) return null;
    const flags = authData[32] ?? 0;
    if (!(flags & FLAG_UP) || !(flags & FLAG_UV) || !(flags & FLAG_AT)) return null;
    const signCount = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0);
    const idLength = new DataView(authData.buffer, authData.byteOffset + 53, 2).getUint16(0);
    if (idLength < 16 || idLength > 512 || authData.length < 55 + idLength) return null;
    const credentialId = base64urlEncode(authData.slice(55, 55 + idLength));
    const cose = readCbor(authData, 55 + idLength).value;
    if (!(cose instanceof Map)) return null;
    const x = cose.get(-2);
    const y = cose.get(-3);
    if (cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1 || !(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) return null;
    const key = { x: base64urlEncode(x), y: base64urlEncode(y) };
    // Prove the key is a valid P-256 point.
    await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', ...key }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return { credentialId, key, signCount };
  } catch {
    return null;
  }
}

/** ECDSA signatures in WebAuthn are DER encoded; WebCrypto wants r || s. */
function derToRaw(der: Uint8Array): Uint8Array | null {
  if (der[0] !== 0x30) return null;
  let pos = 2;
  if (((der[1] ?? 0) & 0x80) !== 0) pos = 2 + ((der[1] ?? 0) & 0x7f);
  const out = new Uint8Array(64);
  for (let part = 0; part < 2; part++) {
    if (der[pos++] !== 0x02) return null;
    let len = der[pos++] ?? 0;
    let start = pos;
    pos += len;
    while (len > 32 && der[start] === 0) {
      start++;
      len--;
    }
    if (len > 32) return null;
    out.set(der.slice(start, start + len), part * 32 + (32 - len));
  }
  return out;
}

export type AssertionResult = { ok: true; signCount: number } | { ok: false };

/** Verifies a sign-in assertion against the stored public key. */
export async function verifyAssertion(
  input: { clientDataJSON: string; authenticatorData: string; signature: string },
  key: PasskeyKey,
  storedSignCount: number,
  expected: ExpectedOrigin,
): Promise<AssertionResult> {
  try {
    const authData = base64urlDecode(input.authenticatorData);
    if (!(await rpIdHashMatches(authData, expected.rpId))) return { ok: false };
    const flags = authData[32] ?? 0;
    if (!(flags & FLAG_UP) || !(flags & FLAG_UV)) return { ok: false };
    const signCount = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0);
    // A counter that goes backwards means a cloned authenticator. Many synced passkeys always report 0.
    if ((signCount !== 0 || storedSignCount !== 0) && signCount <= storedSignCount) return { ok: false };
    const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(base64urlDecode(input.clientDataJSON))));
    const signed = new Uint8Array(authData.length + 32);
    signed.set(authData, 0);
    signed.set(clientHash, authData.length);
    const raw = derToRaw(base64urlDecode(input.signature));
    if (!raw) return { ok: false };
    const publicKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: key.x, y: key.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, toArrayBuffer(raw), toArrayBuffer(signed));
    return valid ? { ok: true, signCount } : { ok: false };
  } catch {
    return { ok: false };
  }
}
