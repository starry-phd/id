import { setCookie } from 'hono/cookie';
import { exportMemberData } from '../identity/export';
import { consumeNonce, issueNonce } from '../identity/nonces';
import { base64urlDecode, base64urlEncode, fromUtf8, utf8 } from '../lib/encoding';
import { readClientData, verifyAssertion, verifyRegistration } from '../auth/webauthn';
import { addPasskey, findPasskey, listPasskeys, MAX_PASSKEYS, removePasskey, touchPasskey } from '../identity/passkeys';
import { isRecentLogin } from '../identity/roles';
import { createWebSession, WEB_APP_ID, WEB_SESSION_ABSOLUTE_MS } from '../identity/web-sessions';
import { errorBody } from '../lib/errors';
import { readJsonObject } from '../lib/validate';
import { SESSION_COOKIE, type WebContext } from './layout';
import { accountApp, loadAccount, webDeviceLabel } from './account-lib';

// ---- Passkeys (WebAuthn) for the web account center ----

function relyingParty(c: WebContext): { origin: string; rpId: string } {
  const url = new URL(c.req.url);
  return { origin: url.origin, rpId: url.hostname };
}

/** The challenge sent to the browser is the single-use server nonce; the browser returns it base64url-encoded. */
async function consumeChallenge(c: WebContext, clientDataJSON: unknown, type: 'webauthn.create' | 'webauthn.get', now: number): Promise<boolean> {
  if (typeof clientDataJSON !== 'string' || clientDataJSON.length > 4096) return false;
  const data = readClientData(clientDataJSON, type, relyingParty(c));
  if (!data) return false;
  let nonce: string;
  try {
    nonce = fromUtf8(base64urlDecode(data.challenge));
  } catch {
    return false;
  }
  return consumeNonce(c.env.DB_IDENTITY, nonce, WEB_APP_ID, now);
}

const str = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);

accountApp.post('/passkey/register-options', async (c) => {
  const web = c.get('web');
  const requestId = c.get('requestId');
  if (!web || web.status !== 'active') return c.json(errorBody('UNAUTHORIZED', 'Sign in first', requestId), 401);
  const now = Date.now();
  if (!isRecentLogin(web.createdAt, now)) return c.json(errorBody('REAUTH_REQUIRED', 'Sign in again before adding a passkey', requestId), 403);
  const db = c.env.DB_IDENTITY;
  const [existing, account] = await Promise.all([listPasskeys(db, web.userId), loadAccount(db, web.userId)]);
  const nonce = await issueNonce(db, WEB_APP_ID, now);
  const label = account?.profile.display_name ?? '繁星會員';
  return c.json({
    publicKey: {
      rp: { name: 'Starry', id: relyingParty(c).rpId },
      user: { id: base64urlEncode(utf8(web.userId)), name: label, displayName: label },
      challenge: base64urlEncode(utf8(nonce)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      attestation: 'none',
      timeout: 120000,
      excludeCredentials: existing.map((p) => ({ type: 'public-key', id: p.credential_id })),
    },
  });
});

accountApp.post('/passkey/register', async (c) => {
  const web = c.get('web');
  const requestId = c.get('requestId');
  if (!web || web.status !== 'active') return c.json(errorBody('UNAUTHORIZED', 'Sign in first', requestId), 401);
  const now = Date.now();
  if (!isRecentLogin(web.createdAt, now)) return c.json(errorBody('REAUTH_REQUIRED', 'Sign in again before adding a passkey', requestId), 403);
  const body = await readJsonObject(c);
  const attestation = str(body?.attestationObject, 8192);
  if (!body || !attestation || !(await consumeChallenge(c, body.clientDataJSON, 'webauthn.create', now))) return c.json(errorBody('BAD_REQUEST', 'This passkey request is invalid or expired', requestId), 400);
  const registered = await verifyRegistration(attestation, relyingParty(c));
  if (!registered) return c.json(errorBody('BAD_REQUEST', 'This passkey cannot be used', requestId), 400);
  const added = await addPasskey(c.env.DB_IDENTITY, { userId: web.userId, credentialId: registered.credentialId, key: registered.key, signCount: registered.signCount, name: typeof body.name === 'string' ? body.name : '', requestId }, now);
  if (added === 'limit') return c.json(errorBody('CONFLICT', `At most ${MAX_PASSKEYS} passkeys`, requestId), 409);
  if (added === 'duplicate') return c.json(errorBody('CONFLICT', 'This passkey is already registered', requestId), 409);
  return c.json({ ok: true });
});

accountApp.post('/passkey/login-options', async (c) => {
  const nonce = await issueNonce(c.env.DB_IDENTITY, WEB_APP_ID, Date.now());
  return c.json({ publicKey: { challenge: base64urlEncode(utf8(nonce)), rpId: relyingParty(c).rpId, userVerification: 'required', timeout: 120000, allowCredentials: [] } });
});

accountApp.post('/passkey/login', async (c) => {
  const requestId = c.get('requestId');
  const body = await readJsonObject(c);
  const id = str(body?.id, 1024);
  const authenticatorData = str(body?.authenticatorData, 2048);
  const signature = str(body?.signature, 1024);
  const clientDataJSON = str(body?.clientDataJSON, 4096);
  const refuse = () => c.json(errorBody('UNAUTHORIZED', 'Passkey sign-in failed', requestId), 401);
  if (!body || !id || !authenticatorData || !signature || !clientDataJSON) return c.json(errorBody('BAD_REQUEST', 'id, clientDataJSON, authenticatorData and signature are required', requestId), 400);
  const now = Date.now();
  if (!(await consumeChallenge(c, clientDataJSON, 'webauthn.get', now))) return refuse();
  const db = c.env.DB_IDENTITY;
  const stored = await findPasskey(db, id);
  if (!stored) return refuse();
  const result = await verifyAssertion({ clientDataJSON, authenticatorData, signature }, stored.key, stored.sign_count, relyingParty(c));
  if (!result.ok || !(await touchPasskey(db, id, stored.sign_count, result.signCount, now))) return refuse();
  const member = await db.prepare('SELECT status, session_version FROM users WHERE user_id = ?').bind(stored.user_id).first<{ status: string; session_version: number }>();
  if (!member) return refuse();
  if (member.status === 'suspended') return c.json(errorBody('ACCOUNT_SUSPENDED', 'Account suspended', requestId), 403);
  const session = await createWebSession(db, { userId: stored.user_id, sessionVersion: member.session_version, provider: 'passkey', deviceLabel: webDeviceLabel(c), requestId }, now);
  setCookie(c, SESSION_COOKIE, session.cookieValue, { prefix: 'host', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', maxAge: Math.floor(WEB_SESSION_ABSOLUTE_MS / 1000) });
  return c.json({ ok: true });
});

/** Staff step-up: the signed-in member proves they hold one of their own passkeys; high-risk Admin Lite actions then run for 5 minutes. */
accountApp.post('/passkey/stepup-options', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.json(errorBody('UNAUTHORIZED', 'Sign in first', c.get('requestId')), 401);
  const nonce = await issueNonce(c.env.DB_IDENTITY, WEB_APP_ID, Date.now());
  return c.json({ publicKey: { challenge: base64urlEncode(utf8(nonce)), rpId: relyingParty(c).rpId, userVerification: 'required', timeout: 120000, allowCredentials: [] } });
});

export const STEPUP_MS = 5 * 60 * 1000;

accountApp.post('/passkey/stepup', async (c) => {
  const requestId = c.get('requestId');
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.json(errorBody('UNAUTHORIZED', 'Sign in first', requestId), 401);
  const body = await readJsonObject(c);
  const id = str(body?.id, 1024);
  const authenticatorData = str(body?.authenticatorData, 2048);
  const signature = str(body?.signature, 1024);
  const clientDataJSON = str(body?.clientDataJSON, 4096);
  const refuse = () => c.json(errorBody('UNAUTHORIZED', 'Passkey confirmation failed', requestId), 401);
  if (!body || !id || !authenticatorData || !signature || !clientDataJSON) return c.json(errorBody('BAD_REQUEST', 'id, clientDataJSON, authenticatorData and signature are required', requestId), 400);
  const now = Date.now();
  if (!(await consumeChallenge(c, clientDataJSON, 'webauthn.get', now))) return refuse();
  const db = c.env.DB_IDENTITY;
  const stored = await findPasskey(db, id);
  if (!stored || stored.user_id !== web.userId) return refuse();
  const result = await verifyAssertion({ clientDataJSON, authenticatorData, signature }, stored.key, stored.sign_count, relyingParty(c));
  if (!result.ok || !(await touchPasskey(db, id, stored.sign_count, result.signCount, now))) return refuse();
  await db.batch([
    db.prepare('DELETE FROM staff_stepups WHERE expires_at <= ?').bind(now),
    db.prepare('INSERT INTO staff_stepups (session_id, user_id, expires_at) VALUES (?, ?, ?) ON CONFLICT (session_id) DO UPDATE SET expires_at = excluded.expires_at').bind(web.sessionId, web.userId, now + STEPUP_MS),
  ]);
  return c.json({ ok: true });
});

accountApp.post('/passkey/:id/remove', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  await removePasskey(c.env.DB_IDENTITY, web.userId, c.req.param('id'), c.get('requestId'), Date.now());
  return c.redirect('/account?notice=passkey_removed', 303);
});

/** GET /account/export — the member downloads a JSON copy of their own data. */
accountApp.get('/export', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  const now = Date.now();
  const data = await exportMemberData(c.env, web.userId, now);
  if (!data) return c.redirect('/account', 303);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="starry-my-data.json"', 'cache-control': 'no-store' },
  });
});
