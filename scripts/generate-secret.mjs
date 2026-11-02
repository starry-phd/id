// Prints a freshly generated secret to stdout for piping into `wrangler secret put`.
//   node scripts/generate-secret.mjs access-jwk   -> ES256 private JWK with kid (ACCESS_TOKEN_PRIVATE_JWK)
//   node scripts/generate-secret.mjs data-key     -> 32 random bytes, base64url (DATA_ENCRYPTION_KEY)
// Never run this where the output is logged.
import { randomBytes, webcrypto } from 'node:crypto';

const kind = process.argv[2];
if (kind === 'access-jwk') {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const kid = `starry-${new Date().toISOString().slice(0, 10)}-${randomBytes(4).toString('hex')}`;
  process.stdout.write(JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, kid }));
} else if (kind === 'data-key') {
  process.stdout.write(randomBytes(32).toString('base64url'));
} else {
  console.error('usage: generate-secret.mjs access-jwk|data-key');
  process.exit(2);
}
