// A software passkey authenticator for tests (WebCrypto), producing what a browser would send.
import { createHash, webcrypto } from 'node:crypto';

const cat = (...p) => Uint8Array.from(p.flatMap((x) => [...x]));
const b64u = (b) => Buffer.from(b).toString('base64url');
const sha = (b) => createHash('sha256').update(b).digest();
const cint = (n) => (n >= 0 ? (n < 24 ? Uint8Array.of(n) : Uint8Array.of(0x18, n)) : Uint8Array.of(0x20 | (-1 - n)));
const cbytes = (b) => cat(Uint8Array.of(0x58, b.length), b);
const ctext = (t) => cat(Uint8Array.of(0x60 | t.length), Buffer.from(t));

function der(raw) {
  const part = (p) => {
    let i = 0;
    while (i < p.length - 1 && p[i] === 0) i++;
    let v = p.slice(i);
    if (v[0] & 0x80) v = cat(Uint8Array.of(0), v);
    return cat(Uint8Array.of(0x02, v.length), v);
  };
  const body = cat(part(raw.slice(0, 32)), part(raw.slice(32)));
  return cat(Uint8Array.of(0x30, body.length), body);
}

export async function softPasskey(origin, rpId) {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const credId = webcrypto.getRandomValues(new Uint8Array(32));
  const rpHash = sha(rpId);
  let counter = 0;
  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin }));
  return {
    id: b64u(credId),
    register(challenge) {
      const cose = cat(Uint8Array.of(0xa5), cint(1), cint(2), cint(3), cint(-7), cint(-1), cint(1), cint(-2), cbytes(Buffer.from(jwk.x, 'base64url')), cint(-3), cbytes(Buffer.from(jwk.y, 'base64url')));
      const authData = cat(rpHash, Uint8Array.of(0x45, 0, 0, 0, 0), new Uint8Array(16), Uint8Array.of(0, credId.length), credId, cose);
      const att = cat(Uint8Array.of(0xa3), ctext('fmt'), ctext('none'), ctext('attStmt'), Uint8Array.of(0xa0), ctext('authData'), cbytes(authData));
      return { clientDataJSON: b64u(clientData('webauthn.create', challenge)), attestationObject: b64u(att) };
    },
    async sign(challenge) {
      counter += 1;
      const authData = cat(rpHash, Uint8Array.of(0x05, 0, 0, 0, counter));
      const cd = clientData('webauthn.get', challenge);
      const sig = new Uint8Array(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, cat(authData, sha(cd))));
      return { id: b64u(credId), clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(der(sig)) };
    },
  };
}
