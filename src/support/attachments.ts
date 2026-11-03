import { uuidv7 } from '../lib/crypto';

/**
 * Spec S-WEB-02: one optional attachment per support ticket (screenshot or PDF), kept in a
 * private R2 bucket and only readable by staff through Admin Lite. The type is decided by the
 * file's own bytes, never by its name or the browser's claim.
 */
export const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;

export type AttachmentType = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';

export const ATTACHMENT_EXTENSIONS: Record<AttachmentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) => signature.every((b, i) => bytes[offset + i] === b);

/** Recognises PNG, JPEG, WebP and PDF by their magic bytes; anything else is null. */
export function detectAttachmentType(bytes: Uint8Array): AttachmentType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

export type AttachmentCheck = { ok: true; type: AttachmentType } | { ok: false; reason: 'too_large' | 'unsupported' };

export function checkAttachment(bytes: Uint8Array): AttachmentCheck {
  if (bytes.byteLength === 0) return { ok: false, reason: 'unsupported' };
  if (bytes.byteLength > ATTACHMENT_MAX_BYTES) return { ok: false, reason: 'too_large' };
  const type = detectAttachmentType(bytes);
  return type ? { ok: true, type } : { ok: false, reason: 'unsupported' };
}

export interface AttachmentRow {
  attachment_id: string;
  ticket_id: string;
  object_key: string;
  content_type: AttachmentType;
  size_bytes: number;
  created_at: number;
}

export interface ObjectStore {
  put(key: string, body: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

/**
 * Stores the file first, then the row. If the row cannot be written the object is removed
 * again, so storage never holds a file that no ticket points to.
 */
export async function saveAttachment(
  db: D1Database,
  store: ObjectStore,
  input: { ticketId: string; bytes: Uint8Array; type: AttachmentType },
  now: number,
): Promise<AttachmentRow> {
  const attachmentId = uuidv7(now);
  const row: AttachmentRow = {
    attachment_id: attachmentId,
    ticket_id: input.ticketId,
    object_key: `tickets/${input.ticketId}/${attachmentId}.${ATTACHMENT_EXTENSIONS[input.type]}`,
    content_type: input.type,
    size_bytes: input.bytes.byteLength,
    created_at: now,
  };
  await store.put(row.object_key, input.bytes, { httpMetadata: { contentType: row.content_type } });
  try {
    await db
      .prepare('INSERT INTO support_attachments (attachment_id, ticket_id, object_key, content_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(row.attachment_id, row.ticket_id, row.object_key, row.content_type, row.size_bytes, row.created_at)
      .run();
  } catch (error) {
    await store.delete(row.object_key);
    throw error;
  }
  return row;
}

const COLUMNS = 'attachment_id, ticket_id, object_key, content_type, size_bytes, created_at';

export async function listAttachments(db: D1Database, ticketId: string): Promise<AttachmentRow[]> {
  const rows = await db.prepare(`SELECT ${COLUMNS} FROM support_attachments WHERE ticket_id = ? ORDER BY attachment_id`).bind(ticketId).all<AttachmentRow>();
  return rows.results ?? [];
}

/** The attachment only when it belongs to the given ticket. */
export function getAttachment(db: D1Database, ticketId: string, attachmentId: string): Promise<AttachmentRow | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM support_attachments WHERE ticket_id = ? AND attachment_id = ?`).bind(ticketId, attachmentId).first<AttachmentRow>();
}

/** Deletes R2 objects queued by the support_attachments trigger; bounded per run. */
export async function processQueuedObjectDeletions(db: D1Database, store: Pick<ObjectStore, 'delete'>, limit = 500): Promise<number> {
  const queued = await db.prepare("SELECT object_key FROM r2_deletions WHERE bucket = 'support' ORDER BY queued_at LIMIT ?").bind(limit).all<{ object_key: string }>();
  const keys = (queued.results ?? []).map((r) => r.object_key);
  if (keys.length === 0) return 0;
  await store.delete(keys);
  await db.batch(keys.map((key) => db.prepare('DELETE FROM r2_deletions WHERE object_key = ?').bind(key)));
  return keys.length;
}
