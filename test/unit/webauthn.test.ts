// A software authenticator (WebCrypto) exercises the passkey verification the way a browser would.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readClientData, verifyAssertion, verifyRegistration } from '../../src/auth/webauthn';

const RP = { origin: 'https://id.starry.phd', rpId: 'id.starry.phd' };
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha = async (b: Uint8Array | string) => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof b === 'string' ? new TextEncoder().encode(b) : b));
const cat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));

const cborInt = (n: number): Uint8Array => (n >= 0 ? (n < 24 ? Uint8Array.of(n) : Uint8Array.of(0x18, n)) : n >= -24 ? Uint8Array.of(0x20 | (-1 - n)) : Uint8Array.of(0x38, -1 - n - 0));
const cborBytes = (b: Uint8Array) => cat(Uint8Array.of(0x58, b.length), b);
const cborText = (t: string) => cat(Uint8Array.of(0x60 | t.length), new TextEncoder().encode(t));

function derOf(raw: Uint8Array): Uint8Array {
  const part = (p: Uint8Array) => {
    let i = 0;
    while (i < p.length - 1 && p[i] === 0) i++;
    let v = p.slice(i);
    if ((v[0] ?? 0) & 0x80) v = cat(Uint8Array.of(0), v);
    return cat(Uint8Array.of(0x02, v.length), v);
  };
  const body = cat(part(raw.slice(0, 32)), part(raw.slice(32)));
  return cat(Uint8Array.of(0x30, body.length), body);
}

async function authenticator() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const credId = crypto.getRandomValues(new Uint8Array(32));
  const clientData = (type: string, challenge: string, origin = RP.origin) => new TextEncoder().encode(JSON.stringify({ type, challenge, origin }));
  const authData = async (flags: number, count: number, withKey: boolean) => {
    const head = cat(await sha(RP.rpId), Uint8Array.of(flags), Uint8Array.of(count >>> 24, (count >>> 16) & 255, (count >>> 8) & 255, count & 255));
    if (!withKey) return head;
    const x = Buffer.from(jwk.x!, 'base64url');
    const y = Buffer.from(jwk.y!, 'base64url');
    const cose = cat(Uint8Array.of(0xa5), cborInt(1), cborInt(2), cborInt(3), cborInt(-7), cborInt(-1), cborInt(1), cborInt(-2), cborBytes(x), cborInt(-3), cborBytes(y));
    return cat(head, new Uint8Array(16), Uint8Array.of(0, credId.length), credId, cose);
  };
  return {
    credId,
    async register(flags = 0x45) {
      const data = await authData(flags, 0, true);
      const att = cat(Uint8Array.of(0xa3), cborText('fmt'), cborText('none'), cborText('attStmt'), Uint8Array.of(0xa0), cborText('authData'), cborBytes(data));
      return b64u(att);
    },
    async assert(challenge: string, flags = 0x05, count = 1, origin = RP.origin) {
      const data = await authData(flags, count, false);
      const cd = clientData('webauthn.get', challenge, origin);
      const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, cat(data, await sha(cd))));
      return { clientDataJSON: b64u(cd), authenticatorData: b64u(data), signature: b64u(derOf(sig)) };
    },
    clientData,
  };
}

test('registration yields the credential and public key; wrong flags or relying party are refused', async () => {
  const a = await authenticator();
  const ok = await verifyRegistration(await a.register(), RP);
  assert.ok(ok);
  assert.equal(ok.credentialId, b64u(a.credId));
  assert.equal(await verifyRegistration(await a.register(0x41), RP), null, 'user verification is required');
  assert.equal(await verifyRegistration(await a.register(), { ...RP, rpId: 'evil.example' }), null);
  assert.equal(await verifyRegistration('AAAA', RP), null);
});

test('sign-in verifies the signature, origin and counter', async () => {
  const a = await authenticator();
  const reg = await verifyRegistration(await a.register(), RP);
  assert.ok(reg);
  const good = await a.assert('abc', 0x05, 5);
  assert.deepEqual(await verifyAssertion(good, reg.key, 4, RP), { ok: true, signCount: 5 });
  assert.deepEqual(await verifyAssertion(good, reg.key, 5, RP), { ok: false }, 'counter must go up');
  assert.deepEqual(await verifyAssertion(await a.assert('abc', 0x05, 0), reg.key, 0, RP), { ok: true, signCount: 0 }, 'synced passkeys report 0');
  assert.deepEqual(await verifyAssertion(await a.assert('abc', 0x01, 6), reg.key, 0, RP), { ok: false }, 'user verification is required');
  assert.deepEqual(await verifyAssertion({ ...good, signature: b64u(Uint8Array.of(0x30, 0x06, 2, 1, 1, 2, 1, 1)) }, reg.key, 0, RP), { ok: false });
  const other = await authenticator();
  assert.deepEqual(await verifyAssertion(await other.assert('abc'), reg.key, 0, RP), { ok: false }, 'another key cannot sign in');
  const clientData = readClientData(good.clientDataJSON, 'webauthn.get', RP);
  assert.equal(clientData?.challenge, 'abc');
  assert.equal(readClientData(good.clientDataJSON, 'webauthn.create', RP), null);
  assert.equal(readClientData((await a.assert('abc', 0x05, 1, 'https://evil.example')).clientDataJSON, 'webauthn.get', RP), null);
});
