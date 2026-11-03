import { avatarChangedStatement } from './profile';
import { auditStatement } from '../lib/audit';
import { constantTimeEqual, uuidv7 } from '../lib/crypto';
import { base64urlEncode, toArrayBuffer, utf8 } from '../lib/encoding';

/**
 * Spec S-ID-08 avatars. The App crops and compresses before upload (square, ≤ 512 px);
 * the server only accepts small WebP/JPEG/PNG files recognised by their magic bytes and
 * stores them in a private R2 bucket. Reads go through short-lived signed URLs.
 */
export const MAX_AVATAR_BYTES = 256 * 1024;
export const AVATAR_URL_TTL_SEC = 60 * 60;

export type AvatarType = 'image/webp' | 'image/jpeg' | 'image/png';
const EXTENSIONS: Record<AvatarType, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** Minimal R2 surface used here, so the logic can be tested without Cloudflare. */
export interface ObjectStore {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

/** Adapts an R2 bucket binding to ObjectStore. */
export function r2Store(bucket: R2Bucket): ObjectStore {
  return {
    put: (key, value, options) => bucket.put(key, value, options),
    delete: (keys) => bucket.delete(keys),
  };
}

/** Detects the image type from its first bytes; the declared content type is not trusted. */
export function sniffImage(bytes: Uint8Array): AvatarType | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 && b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a) return 'image/png';
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'image/webp';
  return null;
}

const KEY = /^avatars\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpg|png)$/;

export function isAvatarKey(key: string): boolean {
  return KEY.test(key);
}

export type SetAvatarResult = { ok: true; key: string; version: number } | { ok: false; reason: 'too_large' | 'unsupported' | 'not_found' };

export async function setAvatar(
  db: D1Database,
  store: ObjectStore,
  input: { userId: string; bytes: Uint8Array; appId: string | null; requestId: string | null },
  now: number,
): Promise<SetAvatarResult> {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_AVATAR_BYTES) return { ok: false, reason: 'too_large' };
  const type = sniffImage(input.bytes);
  if (!type) return { ok: false, reason: 'unsupported' };
  const previous = await db.prepare('SELECT avatar_key FROM profiles WHERE user_id = ?').bind(input.userId).first<{ avatar_key: string | null }>();
  if (!previous) return { ok: false, reason: 'not_found' };
  const key = `avatars/${input.userId}/${uuidv7(now)}.${EXTENSIONS[type]}`;
  await store.put(key, toArrayBuffer(input.bytes), { httpMetadata: { contentType: type, cacheControl: 'private, max-age=3600' } });
  await db.batch([
    db.prepare('UPDATE profiles SET avatar_key = ?, version = version + 1, updated_at = ? WHERE user_id = ?').bind(key, now, input.userId),
    avatarChangedStatement(db, input.userId, now),
    auditStatement(db, { actorType: 'user', actorUserId: input.userId, action: 'profile.avatar_set', targetType: 'user', targetId: input.userId, appId: input.appId, result: 'success', requestId: input.requestId, retention: 'general' }, now),
  ]);
  if (previous.avatar_key) await store.delete(previous.avatar_key);
  const version = await db.prepare('SELECT version FROM profiles WHERE user_id = ?').bind(input.userId).first<{ version: number }>();
  return { ok: true, key, version: version?.version ?? 0 };
}

export async function removeAvatar(db: D1Database, store: ObjectStore, input: { userId: string; appId: string | null; requestId: string | null }, now: number): Promise<boolean> {
  const row = await db.prepare('SELECT avatar_key FROM profiles WHERE user_id = ?').bind(input.userId).first<{ avatar_key: string | null }>();
  if (!row?.avatar_key) return false;
  await db.batch([
    db.prepare('UPDATE profiles SET avatar_key = NULL, version = version + 1, updated_at = ? WHERE user_id = ?').bind(now, input.userId),
    avatarChangedStatement(db, input.userId, now),
    auditStatement(db, { actorType: 'user', actorUserId: input.userId, action: 'profile.avatar_removed', targetType: 'user', targetId: input.userId, appId: input.appId, result: 'success', requestId: input.requestId, retention: 'general' }, now),
  ]);
  await store.delete(row.avatar_key);
  return true;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(utf8(`avatar-url:${secret}`)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', key, toArrayBuffer(utf8(message)))));
}

/** Path + query of a signed avatar URL valid for AVATAR_URL_TTL_SEC. */
export async function signedAvatarPath(secret: string, key: string, nowMs: number): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + AVATAR_URL_TTL_SEC;
  return `/v1/avatars/${key.slice('avatars/'.length)}?exp=${exp}&sig=${await hmac(secret, `${key}:${exp}`)}`;
}

export async function verifyAvatarSignature(secret: string, key: string, exp: string | undefined, sig: string | undefined, nowMs: number): Promise<boolean> {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp) || Number(exp) < Math.floor(nowMs / 1000) || !isAvatarKey(key)) return false;
  return constantTimeEqual(await hmac(secret, `${key}:${exp}`), sig);
}
