// Unit tests for avatar storage and signed avatar URLs (S-ID-08).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isAvatarKey, MAX_AVATAR_BYTES, removeAvatar, setAvatar, signedAvatarPath, sniffImage, verifyAvatarSignature, type ObjectStore } from '../../src/identity/avatars';
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
