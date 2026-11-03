// Unit tests for support ticket attachments (S-WEB-02): type detection, storage and cleanup.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DELETION_GRACE_MS, requestDeletion } from '../../src/identity/lifecycle';
import { runDailyMaintenance } from '../../src/identity/maintenance';
import { findOrCreateMember } from '../../src/identity/members';
import { ATTACHMENT_MAX_BYTES, checkAttachment, detectAttachmentType, getAttachment, listAttachments, saveAttachment, type ObjectStore } from '../../src/support/attachments';
import { createTicket, setTicketStatus } from '../../src/support/tickets';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
type Db = ReturnType<typeof migratedDb>;
const asD1 = (db: Db) => db as unknown as D1Database;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const PDF = new TextEncoder().encode('%PDF-1.7\n');

class MemoryStore implements ObjectStore {
  objects = new Map<string, { body: Uint8Array; contentType: string }>();
  failPut = false;
  async put(key: string, body: Uint8Array, options: { httpMetadata: { contentType: string } }) {
    if (this.failPut) throw new Error('R2 unavailable');
    this.objects.set(key, { body, contentType: options.httpMetadata.contentType });
  }
  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }
}

const count = async (db: Db, sql: string, ...args: unknown[]) => Number(((await db.prepare(sql).bind(...args).first()) as { n: number } | null)?.n ?? 0);

async function ticket(db: Db, userId: string | null = null) {
  const result = await createTicket(asD1(db), { userId, contactEmail: userId ? null : 'visitor@example.com', category: 'question', appId: null, message: '附上截圖', clientIp: `198.51.100.${Math.floor(Math.random() * 200)}` }, NOW);
  assert.ok(result.ok);
  return result.ticketId;
}

describe('attachment type detection', () => {
  test('recognises PNG, JPEG, WebP and PDF by content, not by name', () => {
    assert.equal(detectAttachmentType(PNG), 'image/png');
    assert.equal(detectAttachmentType(JPEG), 'image/jpeg');
    assert.equal(detectAttachmentType(WEBP), 'image/webp');
    assert.equal(detectAttachmentType(PDF), 'application/pdf');
    assert.equal(detectAttachmentType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
    assert.equal(detectAttachmentType(new TextEncoder().encode('<html><script>alert(1)</script>')), null);
    assert.equal(detectAttachmentType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])), null, 'RIFF but not WebP');
  });

  test('rejects empty and oversized files', () => {
    assert.deepEqual(checkAttachment(new Uint8Array()), { ok: false, reason: 'unsupported' });
    const big = new Uint8Array(ATTACHMENT_MAX_BYTES + 1);
    big.set(PNG);
    assert.deepEqual(checkAttachment(big), { ok: false, reason: 'too_large' });
    const max = new Uint8Array(ATTACHMENT_MAX_BYTES);
    max.set(PDF);
    assert.deepEqual(checkAttachment(max), { ok: true, type: 'application/pdf' });
  });
});

describe('storing and removing attachments', () => {
  test('stores the file under the ticket and reads it back only with the right ticket', async () => {
    const db = migratedDb();
    const store = new MemoryStore();
    const ticketId = await ticket(db);
    const row = await saveAttachment(asD1(db), store, { ticketId, bytes: PNG, type: 'image/png' }, NOW);
    assert.match(row.object_key, new RegExp(`^tickets/${ticketId}/[0-9a-f-]+\\.png$`));
    assert.equal(store.objects.get(row.object_key)?.contentType, 'image/png');
    assert.deepEqual((await listAttachments(asD1(db), ticketId)).map((a) => a.attachment_id), [row.attachment_id]);
    assert.equal((await getAttachment(asD1(db), ticketId, row.attachment_id))?.size_bytes, PNG.byteLength);
    const other = await ticket(db);
    assert.equal(await getAttachment(asD1(db), other, row.attachment_id), null, 'an attachment ID is only valid with its own ticket');
  });

  test('a failed upload leaves no row; a failed row leaves no file', async () => {
    const db = migratedDb();
    const store = new MemoryStore();
    store.failPut = true;
    const ticketId = await ticket(db);
    await assert.rejects(saveAttachment(asD1(db), store, { ticketId, bytes: PNG, type: 'image/png' }, NOW));
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM support_attachments'), 0);

    store.failPut = false;
    await assert.rejects(saveAttachment(asD1(db), store, { ticketId: 'missing-ticket', bytes: PNG, type: 'image/png' }, NOW), /FOREIGN KEY/);
    assert.equal(store.objects.size, 0, 'the object is removed when the row cannot be written');
  });

  test('purging a member or an old ticket removes its files from storage', async () => {
    const db = migratedDb();
    const d = asD1(db);
    const store = new MemoryStore();
    const { member } = await findOrCreateMember(d, { provider: 'google', subject: 'g-attach', email: null, isPrivateRelay: false }, { appId: 'account', requestId: null }, NOW);
    const mine = await ticket(db, member.user_id);
    const memberFile = await saveAttachment(d, store, { ticketId: mine, bytes: JPEG, type: 'image/jpeg' }, NOW);
    const visitor = await ticket(db);
    const visitorFile = await saveAttachment(d, store, { ticketId: visitor, bytes: PDF, type: 'application/pdf' }, NOW);
    const keep = await ticket(db);
    const kept = await saveAttachment(d, store, { ticketId: keep, bytes: WEBP, type: 'image/webp' }, NOW);
    assert.equal(store.objects.size, 3);

    await requestDeletion(d, { userId: member.user_id, appId: 'account', requestId: null }, NOW - DELETION_GRACE_MS - 1);
    await setTicketStatus(d, { userId: 'staff', requestId: null }, visitor, 'closed', null, NOW - 366 * DAY);
    const report = await runDailyMaintenance({ db: d, secrets: {}, fetch: async () => new Response(null), supportFiles: store }, NOW);

    assert.equal(report.purgedMembers, 1);
    assert.equal(report.tickets, 1);
    assert.equal(report.supportFiles, 2);
    assert.deepEqual([...store.objects.keys()], [kept.object_key]);
    assert.equal(store.objects.has(memberFile.object_key), false);
    assert.equal(store.objects.has(visitorFile.object_key), false);
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM r2_deletions'), 0, 'the queue is emptied after deleting');
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM support_attachments'), 1);
  });

  test('without the bucket binding the queue waits for the next run', async () => {
    const db = migratedDb();
    const d = asD1(db);
    const store = new MemoryStore();
    const ticketId = await ticket(db);
    await saveAttachment(d, store, { ticketId, bytes: PNG, type: 'image/png' }, NOW);
    await db.prepare('DELETE FROM support_tickets WHERE ticket_id = ?').bind(ticketId).run();
    const report = await runDailyMaintenance({ db: d, secrets: {}, fetch: async () => new Response(null) }, NOW);
    assert.equal(report.supportFiles, 0);
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM r2_deletions'), 1);
  });
});
