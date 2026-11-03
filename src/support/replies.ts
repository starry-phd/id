import { auditStatement } from '../lib/audit';
import { uuidv7 } from '../lib/crypto';
import { contactEmailOf, sendEmail, ticketReplyEmail, type MailSettings } from '../notify/email';
import type { TicketRow } from './tickets';

/** Spec S-WEB-02: staff answer a ticket by email from Admin Lite; every reply is kept with the ticket. */
export interface ReplyRow {
  reply_id: string;
  ticket_id: string;
  staff_user_id: string | null;
  body: string;
  delivery: 'sent' | 'failed';
  message_id: string | null;
  error_code: string | null;
  created_at: number;
}

export type ReplyResult = { ok: true; reply: ReplyRow } | { ok: false; reason: 'invalid' | 'no_recipient' };

/** Visitors left an email on the form; members are reached at their sign-in email. */
export async function replyRecipient(db: D1Database, ticket: Pick<TicketRow, 'contact_email' | 'user_id'>): Promise<string | null> {
  if (ticket.contact_email) return ticket.contact_email;
  return ticket.user_id ? contactEmailOf(db, ticket.user_id) : null;
}

export async function replyToTicket(
  db: D1Database,
  mail: MailSettings,
  actor: { userId: string; requestId: string | null },
  ticket: TicketRow,
  body: string,
  now: number,
): Promise<ReplyResult> {
  const text = body.trim();
  if (text.length < 1 || text.length > 2000) return { ok: false, reason: 'invalid' };
  const to = await replyRecipient(db, ticket);
  if (!to) return { ok: false, reason: 'no_recipient' };
  const outcome = await sendEmail(mail, ticketReplyEmail(mail, to, { ticketId: ticket.ticket_id, message: ticket.message }, text));
  const reply: ReplyRow = {
    reply_id: uuidv7(now),
    ticket_id: ticket.ticket_id,
    staff_user_id: actor.userId,
    body: text,
    delivery: outcome.ok ? 'sent' : 'failed',
    message_id: outcome.ok ? outcome.messageId : null,
    error_code: outcome.ok ? null : outcome.error.slice(0, 64),
    created_at: now,
  };
  await db.batch([
    db
      .prepare('INSERT INTO support_ticket_replies (reply_id, ticket_id, staff_user_id, body, delivery, message_id, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(reply.reply_id, reply.ticket_id, reply.staff_user_id, reply.body, reply.delivery, reply.message_id, reply.error_code, reply.created_at),
    db.prepare('UPDATE support_tickets SET updated_at = ? WHERE ticket_id = ?').bind(now, ticket.ticket_id),
    auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.ticket_replied', targetType: 'ticket', targetId: ticket.ticket_id, result: outcome.ok ? 'success' : 'error', requestId: actor.requestId, retention: 'security' }, now),
  ]);
  return { ok: true, reply };
}

export async function listReplies(db: D1Database, ticketId: string): Promise<ReplyRow[]> {
  const rows = await db
    .prepare('SELECT reply_id, ticket_id, staff_user_id, body, delivery, message_id, error_code, created_at FROM support_ticket_replies WHERE ticket_id = ? ORDER BY reply_id')
    .bind(ticketId)
    .all<ReplyRow>();
  return rows.results ?? [];
}
