// Unit tests for avatar storage and signed avatar URLs (S-ID-08).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { importProviderAvatar, isAvatarKey, isProviderPhotoUrl, MAX_AVATAR_BYTES, removeAvatar, setAvatar, signedAvatarPath, sniffImage, verifyAvatarSignature, type ObjectStore } from '../../src/identity/avatars';
import { findOrCreateMember } from '../../src/identity/members';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);

function memoryStore() {
  const objects = new Map<string, { size: number; type?: string }>();
  const store: ObjectStore = {
    async put(key, value, options) {
      objects.set(key, { size: value.byteLength, type: options?.httpMetadata?.contentType });
      return null;
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
    },
  };
  return { store, objects };
}

describe('avatars (S-ID-08)', () => {
  test('recognises images by magic bytes only', () => {
    assert.equal(sniffImage(PNG), 'image/png');
    assert.equal(sniffImage(JPEG), 'image/jpeg');
    assert.equal(sniffImage(WEBP), 'image/webp');
    assert.equal(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>')), null);
    assert.equal(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38])), null, 'GIF is not accepted');
    assert.equal(sniffImage(new Uint8Array()), null);
  });

  test('upload replaces the previous object and bumps the profile version; removal deletes it', async () => {
    const db = migratedDb();
    const d = db as unknown as D1Database;
    const { member } = await findOrCreateMember(d, { provider: 'google', subject: 'av', email: null, isPrivateRelay: false }, { appId: 'echo', requestId: null }, NOW);
    const { store, objects } = memoryStore();
    const first = await setAvatar(d, store, { userId: member.user_id, bytes: PNG, appId: 'echo', requestId: null }, NOW);
    assert.ok(first.ok);
    assert.equal(first.version, 2);
    assert.ok(isAvatarKey(first.key));
    assert.equal(objects.get(first.key)?.type, 'image/png');
    const second = await setAvatar(d, store, { userId: member.user_id, bytes: WEBP, appId: 'echo', requestId: null }, NOW + 1);
    assert.ok(second.ok);
    assert.match(second.key, /\.webp$/);
    assert.deepEqual([...objects.keys()], [second.key], 'old avatar deleted');
    assert.equal(await removeAvatar(d, store, { userId: member.user_id, appId: 'echo', requestId: null }, NOW + 2), true);
    assert.equal(objects.size, 0);
    assert.equal(await removeAvatar(d, store, { userId: member.user_id, appId: 'echo', requestId: null }, NOW + 3), false);
    assert.equal((await db.prepare('SELECT version FROM profiles WHERE user_id = ?').bind(member.user_id).first())?.version, 4);
  });

  test('rejects oversized, unknown and member-less uploads', async () => {
    const d = migratedDb() as unknown as D1Database;
    const { store, objects } = memoryStore();
    const big = new Uint8Array(MAX_AVATAR_BYTES + 1);
    big.set(PNG);
    assert.deepEqual(await setAvatar(d, store, { userId: 'u', bytes: big, appId: null, requestId: null }, NOW), { ok: false, reason: 'too_large' });
    assert.deepEqual(await setAvatar(d, store, { userId: 'u', bytes: new Uint8Array([1, 2, 3]), appId: null, requestId: null }, NOW), { ok: false, reason: 'unsupported' });
    assert.deepEqual(await setAvatar(d, store, { userId: 'missing', bytes: PNG, appId: null, requestId: null }, NOW), { ok: false, reason: 'not_found' });
    assert.equal(objects.size, 0);
  });

  test('signed URLs expire and cannot be reused for another key', async () => {
    const key = 'avatars/01900000-0000-7000-8000-000000000001/01900000-0000-7000-8000-000000000002.png';
    const path = await signedAvatarPath('secret', key, NOW);
    const url = new URL(`https://x${path}`);
    assert.equal(url.pathname, `/v1/${key.replace('avatars/', 'avatars/')}`);
    const exp = url.searchParams.get('exp') ?? undefined;
    const sig = url.searchParams.get('sig') ?? undefined;
    assert.equal(await verifyAvatarSignature('secret', key, exp, sig, NOW), true);
    assert.equal(await verifyAvatarSignature('secret', key, exp, sig, NOW + 2 * 3600 * 1000), false, 'expired');
    assert.equal(await verifyAvatarSignature('other', key, exp, sig, NOW), false, 'wrong secret');
    assert.equal(await verifyAvatarSignature('secret', key.replace('0002.png', '0003.png'), exp, sig, NOW), false, 'other key');
    assert.equal(await verifyAvatarSignature('secret', '../etc/passwd', exp, sig, NOW), false);
  });
});

describe('importing the Google photo at sign-up', () => {
  const URL_OK = 'https://lh3.googleusercontent.com/a/abc123=s96-c';
  async function setup() {
    const db = migratedDb();
    const d = db as unknown as D1Database;
    const { member } = await findOrCreateMember(d, { provider: 'google', subject: 'g-photo', email: 'p@example.com', isPrivateRelay: false }, { appId: 'echo', requestId: null }, NOW);
    return { d, userId: member.user_id, ...memoryStore() };
  }
  const input = (userId: string, url = URL_OK) => ({ userId, url, appId: 'echo', requestId: null });

  test('only Google photo URLs are accepted', () => {
    assert.equal(isProviderPhotoUrl(URL_OK), true);
    assert.equal(isProviderPhotoUrl('http://lh3.googleusercontent.com/a/x'), false);
    assert.equal(isProviderPhotoUrl('https://evil.example.com/a.png'), false);
    assert.equal(isProviderPhotoUrl('https://lh3.googleusercontent.com.evil.com/a'), false);
  });

  test('the photo becomes the avatar, requested at 256 pixels', async () => {
    const { d, userId, store, objects } = await setup();
    let asked = '';
    const ok = await importProviderAvatar(d, store, async (url) => { asked = url; return new Response(JPEG); }, input(userId), NOW);
    assert.equal(ok, true);
    assert.equal(asked, 'https://lh3.googleusercontent.com/a/abc123=s256-c');
    assert.equal(objects.size, 1);
    assert.ok((await d.prepare('SELECT avatar_key FROM profiles WHERE user_id = ?').bind(userId).first<{ avatar_key: string }>())?.avatar_key);
  });

  test('an existing avatar, bad responses and oversized photos change nothing', async () => {
    const { d, userId, store, objects } = await setup();
    assert.equal(await importProviderAvatar(d, store, async () => new Response('nope', { status: 404 }), input(userId), NOW), false);
    assert.equal(await importProviderAvatar(d, store, async () => new Response('not an image'), input(userId), NOW), false);
    assert.equal(await importProviderAvatar(d, store, async () => new Response(new Uint8Array(MAX_AVATAR_BYTES + 1)), input(userId), NOW), false);
    assert.equal(await importProviderAvatar(d, store, async () => { throw new Error('offline'); }, input(userId), NOW), false);
    assert.equal(objects.size, 0);
    assert.equal(await importProviderAvatar(d, store, async () => new Response(PNG), input(userId), NOW), true);
    assert.equal(await importProviderAvatar(d, store, async () => new Response(JPEG), input(userId), NOW), false, 'never replaces an existing avatar');
    assert.equal(objects.size, 1);
  });
});

describe('Google photo import reports why it failed', () => {
  test('a reason code is returned and a redirect to Google is followed', async () => {
    const { importProviderAvatarDetailed } = await import('../../src/identity/avatars');
    const d = migratedDb() as unknown as D1Database;
    const { member } = await (await import('../../src/identity/members')).findOrCreateMember(d, { provider: 'google', subject: 'rs', email: 'rs@example.com', isPrivateRelay: false }, { appId: 'web', requestId: null }, 1);
    const { store } = memoryStore();
    const input = { userId: member.user_id, url: 'https://lh3.googleusercontent.com/a/abc=s96-c', appId: null, requestId: null };
    assert.equal(await importProviderAvatarDetailed(d, store, async () => new Response('x', { status: 403 }), input, 1), 'http_403');
    assert.equal(await importProviderAvatarDetailed(d, store, async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } }), input, 1), 'redirect_host');
    assert.equal(await importProviderAvatarDetailed(d, store, async () => { throw new TypeError('boom'); }, input, 1), 'error_TypeError');
    assert.equal(await importProviderAvatarDetailed(d, store, async () => new Response('x'), { ...input, url: 'https://example.com/x' }, 1), 'bad_url');
    let calls = 0;
    const redirected = await importProviderAvatarDetailed(
      d,
      store,
      async () => (++calls === 1 ? new Response(null, { status: 302, headers: { location: 'https://lh4.googleusercontent.com/a/def=s256-c' } }) : new Response(PNG)),
      input,
      1,
    );
    assert.equal(redirected, null);
    assert.equal(calls, 2);
  });
});
