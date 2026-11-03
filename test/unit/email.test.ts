// Unit tests for system email (S-NTF-02): settings, sending, message content and ticket replies.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DELETION_GRACE_MS } from '../../src/identity/lifecycle';
import { findOrCreateMember } from '../../src/identity/members';
import {
  contactEmailOf,
  deletionRequestedEmail,
  mailSettings,
  newTicketNoticeEmail,
  notifyDeletionRequested,
  sendEmail,
  type EmailSender,
  type MailSettings,
  type OutgoingEmail,
} from '../../src/notify/email';
import { listReplies, replyToTicket } from '../../src/support/replies';
import { createTicket, getTicket } from '../../src/support/tickets';
import { migratedDb } from '../support/sqlite-d1.mjs';

const NOW = Date.UTC(2026, 10, 3, 4, 0, 0);
type Db = ReturnType<typeof migratedDb>;
const asD1 = (db: Db) => db as unknown as D1Database;

class FakeSender implements EmailSender {
  sent: OutgoingEmail[] = [];
  failWith: string | null = null;
  async send(message: OutgoingEmail) {
    if (this.failWith) throw Object.assign(new Error('send failed'), { code: this.failWith });
    this.sent.push(message);
    return { messageId: `msg-${this.sent.length}` };
  }
}

function settings(sender = new FakeSender()): { mail: MailSettings; sender: FakeSender } {
  const mail = mailSettings({ EMAIL: sender, EMAIL_FROM: 'noreply@starry.phd', SUPPORT_EMAIL: 'support@starry.phd' }, 'https://id.starry.phd');
  assert.ok(mail);
  return { mail, sender };
}

const count = async (db: Db, sql: string, ...args: unknown[]) => Number(((await db.prepare(sql).bind(...args).first()) as { n: number } | null)?.n ?? 0);

describe('mail settings and sending', () => {
  test('email is off without the binding or valid addresses', () => {
    assert.equal(mailSettings({}, 'https://id.starry.phd'), null);
    assert.equal(mailSettings({ EMAIL: new FakeSender(), EMAIL_FROM: 'noreply@starry.phd' }, 'https://id.starry.phd'), null);
    assert.equal(mailSettings({ EMAIL: new FakeSender(), EMAIL_FROM: 'not an address', SUPPORT_EMAIL: 'support@starry.phd' }, 'https://id.starry.phd'), null);
    const { mail } = settings();
    assert.deepEqual(mail.from, { email: 'noreply@starry.phd', name: 'Starry' });
  });

  test('sendEmail adds the sender, reports Email Service error codes and never throws', async () => {
    const { mail, sender } = settings();
    assert.deepEqual(await sendEmail(mail, { to: 'member@example.com', subject: 's', text: 't' }), { ok: true, messageId: 'msg-1' });
    assert.deepEqual(sender.sent[0]?.from, { email: 'noreply@starry.phd', name: 'Starry' });
    assert.deepEqual(await sendEmail(mail, { to: 'bad address', subject: 's', text: 't' }), { ok: false, error: 'E_INVALID_RECIPIENT' });
    sender.failWith = 'E_RECIPIENT_SUPPRESSED';
    assert.deepEqual(await sendEmail(mail, { to: 'member@example.com', subject: 's', text: 't' }), { ok: false, error: 'E_RECIPIENT_SUPPRESSED' });
    assert.equal(sender.sent.length, 1);
  });

  test('the contact address is the most recently used sign-in that shared one', async () => {
    const db = migratedDb();
    const d = asD1(db);
    const { member } = await findOrCreateMember(d, { provider: 'google', subject: 'g-mail', email: 'old@example.com', isPrivateRelay: false }, { appId: 'account', requestId: null }, NOW - 1000);
    assert.equal(await contactEmailOf(d, member.user_id), 'old@example.com');
    await db
      .prepare("INSERT INTO auth_identities (provider, subject, user_id, email, email_is_private_relay, created_at, last_login_at) VALUES ('apple', 'a-mail', ?, 'x1y2@privaterelay.appleid.com', 1, ?, ?)")
      .bind(member.user_id, NOW, NOW)
      .run();
    assert.equal(await contactEmailOf(d, member.user_id), 'x1y2@privaterelay.appleid.com');
    const { member: silent } = await findOrCreateMember(d, { provider: 'apple', subject: 'a-none', email: null, isPrivateRelay: false }, { appId: 'account', requestId: null }, NOW);
    assert.equal(await contactEmailOf(d, silent.user_id), null);
  });
});

describe('message content', () => {
  test('deletion confirmation names the purge time, how to cancel, and the subscription caveat', () => {
    const { mail } = settings();
    const email = deletionRequestedEmail(mail, 'member@example.com', NOW + DELETION_GRACE_MS);
    assert.equal(email.subject, '已收到刪除 Starry 帳號的申請');
    assert.equal(email.replyTo, 'support@starry.phd');
    assert.match(email.text, /2026\/11\/10/);
    assert.match(email.text, /https:\/\/id\.starry\.phd\/account/);
    assert.match(email.text, /不會取消 App Store 或 Google Play 的訂閱/);
  });

  test('staff notices link to Admin Lite without the ticket text', () => {
    const { mail } = settings();
    const notice = newTicketNoticeEmail(mail, { ticketId: '01900000-0000-7000-8000-00000000abcd', categoryLabel: '帳號與登入', appName: null, hasAttachment: true });
    assert.equal(notice.to, 'support@starry.phd');
    assert.match(notice.subject, /0000ABCD/);
    assert.match(notice.text, /https:\/\/id\.starry\.phd\/admin\/tickets\/01900000-0000-7000-8000-00000000abcd/);
    assert.match(notice.text, /附件：有/);
  });

  test('deletion notices are skipped when email is off or the member shared no address', async () => {
    const db = migratedDb();
    const d = asD1(db);
    const { member } = await findOrCreateMember(d, { provider: 'google', subject: 'g-del', email: 'del@example.com', isPrivateRelay: false }, { appId: 'account', requestId: null }, NOW);
    assert.equal(await notifyDeletionRequested(d, null, member.user_id, NOW), null);
    const { mail, sender } = settings();
    assert.deepEqual(await notifyDeletionRequested(d, mail, member.user_id, NOW), { ok: true, messageId: 'msg-1' });
    assert.equal(sender.sent[0]?.to, 'del@example.com');
    const { member: silent } = await findOrCreateMember(d, { provider: 'apple', subject: 'a-del', email: null, isPrivateRelay: false }, { appId: 'account', requestId: null }, NOW);
    assert.equal(await notifyDeletionRequested(d, mail, silent.user_id, NOW), null);
  });
});

describe('ticket replies (S-WEB-02)', () => {
  async function setup() {
    const db = migratedDb();
    const d = asD1(db);
    const { member: staffMember } = await findOrCreateMember(d, { provider: 'google', subject: 'g-staff', email: 'staff@example.com', isPrivateRelay: false }, { appId: 'account', requestId: null }, NOW);
    const visitor = await createTicket(d, { userId: null, contactEmail: 'Visitor@Example.com', category: 'question', appId: null, message: '第一行\n第二行', clientIp: '198.51.100.1' }, NOW);
    assert.ok(visitor.ok);
    return { db, d, staff: { userId: staffMember.user_id, requestId: 'req-1' }, ticket: (await getTicket(d, visitor.ticketId))! };
  }

  test('a reply is emailed to the sender, quotes the message and is kept with the ticket', async () => {
    const { db, d, staff, ticket } = await setup();
    const { mail, sender } = settings();
    const result = await replyToTicket(d, mail, staff, ticket, '  已為您處理。  ', NOW);
    assert.ok(result.ok);
    assert.equal(result.reply.delivery, 'sent');
    const sent = sender.sent[0]!;
    assert.equal(sent.to, 'visitor@example.com');
    assert.equal(sent.replyTo, 'support@starry.phd');
    assert.match(sent.subject, /案件/);
    assert.match(sent.text, /已為您處理。/);
    assert.match(sent.text, /> 第一行\n> 第二行/);
    const replies = await listReplies(d, ticket.ticket_id);
    assert.deepEqual(replies.map((r) => [r.body, r.delivery, r.message_id]), [['已為您處理。', 'sent', 'msg-1']]);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'admin.ticket_replied' AND result = 'success'"), 1);
  });

  test('failed deliveries are kept with the error code; empty or missing recipients are refused', async () => {
    const { db, d, staff, ticket } = await setup();
    const { mail, sender } = settings();
    assert.deepEqual(await replyToTicket(d, mail, staff, ticket, '   ', NOW), { ok: false, reason: 'invalid' });
    sender.failWith = 'E_DAILY_LIMIT_EXCEEDED';
    const failed = await replyToTicket(d, mail, staff, ticket, '請稍候', NOW);
    assert.ok(failed.ok);
    assert.deepEqual([failed.reply.delivery, failed.reply.error_code], ['failed', 'E_DAILY_LIMIT_EXCEEDED']);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'admin.ticket_replied' AND result = 'error'"), 1);

    const { member: silent } = await findOrCreateMember(d, { provider: 'apple', subject: 'a-silent', email: null, isPrivateRelay: false }, { appId: 'account', requestId: null }, NOW);
    const memberTicket = await createTicket(d, { userId: silent.user_id, contactEmail: null, category: 'account', appId: null, message: '沒有 Email', clientIp: null }, NOW);
    assert.ok(memberTicket.ok);
    assert.deepEqual(await replyToTicket(d, mail, staff, (await getTicket(d, memberTicket.ticketId))!, '你好', NOW), { ok: false, reason: 'no_recipient' });
  });

  test('replies go away with their ticket', async () => {
    const { db, d, staff, ticket } = await setup();
    const { mail } = settings();
    await replyToTicket(d, mail, staff, ticket, '收到', NOW);
    await db.prepare('DELETE FROM support_tickets WHERE ticket_id = ?').bind(ticket.ticket_id).run();
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM support_ticket_replies'), 0);
  });
});
