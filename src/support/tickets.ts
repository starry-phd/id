import { auditStatement } from '../lib/audit';
import { sha256Hex, uuidv7 } from '../lib/crypto';

export const TICKET_CATEGORIES = ['question', 'account', 'purchase', 'report', 'other'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  question: '使用問題',
  account: '帳號與登入',
  purchase: '購買與退款',
  report: '檢舉內容或會員',
  other: '其他',
};

/** Anonymous senders: 5 tickets per IP per hour. Members: 10 per day. */
const ANON_LIMIT = { count: 5, windowMs: 60 * 60 * 1000 };
const MEMBER_LIMIT = { count: 10, windowMs: 24 * 60 * 60 * 1000 };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

export interface NewTicket {
  userId: string | null;
  contactEmail: string | null;
  category: TicketCategory;
  appId: string | null;
  message: string;
  clientIp: string | null;
}

export type CreateTicketResult = { ok: true; ticketId: string } | { ok: false; reason: 'invalid' | 'rate_limited' };

export function isTicketCategory(value: unknown): value is TicketCategory {
  return typeof value === 'string' && (TICKET_CATEGORIES as readonly string[]).includes(value);
}

/** Spec S-WEB-02: signed-in or anonymous; anonymous senders must leave an email to receive the reply. */
export async function createTicket(db: D1Database, input: NewTicket, now: number, requestId: string | null = null): Promise<CreateTicketResult> {
  const message = input.message.trim();
  const email = input.contactEmail?.trim().toLowerCase() || null;
  if (message.length < 1 || message.length > 2000) return { ok: false, reason: 'invalid' };
  if (email !== null && (email.length > 254 || !EMAIL.test(email))) return { ok: false, reason: 'invalid' };
  if (input.userId === null && email === null) return { ok: false, reason: 'invalid' };
  const ipHash = input.clientIp ? await sha256Hex(`ticket-ip:${input.clientIp}`) : null;
  const recent = input.userId
    ? await db.prepare('SELECT COUNT(*) AS n FROM support_tickets WHERE user_id = ? AND created_at > ?').bind(input.userId, now - MEMBER_LIMIT.windowMs).first<{ n: number }>()
    : await db.prepare('SELECT COUNT(*) AS n FROM support_tickets WHERE ip_hash = ? AND created_at > ?').bind(ipHash ?? 'none', now - ANON_LIMIT.windowMs).first<{ n: number }>();
  if ((recent?.n ?? 0) >= (input.userId ? MEMBER_LIMIT.count : ANON_LIMIT.count)) return { ok: false, reason: 'rate_limited' };
  const ticketId = uuidv7(now);
  await db.batch([
    db
      .prepare(
        `INSERT INTO support_tickets (ticket_id, created_at, user_id, contact_email, category, app_id, message, ip_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(ticketId, now, input.userId, email, input.category, input.appId, message, ipHash, now),
    auditStatement(db, { actorType: 'user', actorUserId: input.userId, action: `support.ticket_created.${input.category}`, targetType: 'ticket', targetId: ticketId, appId: input.appId, result: 'success', requestId, retention: 'general' }, now),
  ]);
  return { ok: true, ticketId };
}

export interface TicketRow {
  ticket_id: string;
  created_at: number;
  user_id: string | null;
  contact_email: string | null;
  category: TicketCategory;
  app_id: string | null;
  message: string;
  status: 'open' | 'closed';
  staff_note: string | null;
  closed_at: number | null;
}

const TICKET_COLUMNS = 'ticket_id, created_at, user_id, contact_email, category, app_id, message, status, staff_note, closed_at';

/** Newest first, cursor = last ticket_id of the previous page. */
export async function listTickets(
  db: D1Database,
  options: { status: 'open' | 'closed'; cursor?: string | undefined; limit?: number | undefined },
): Promise<{ tickets: TicketRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const cursor = options.cursor ?? 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const rows = await db
    .prepare(`SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE status = ? AND ticket_id < ? ORDER BY ticket_id DESC LIMIT ?`)
    .bind(options.status, cursor, limit + 1)
    .all<TicketRow>();
  const tickets = rows.results.slice(0, limit);
  return { tickets, nextCursor: rows.results.length > limit ? (tickets[tickets.length - 1]?.ticket_id ?? null) : null };
}

export function getTicket(db: D1Database, ticketId: string): Promise<TicketRow | null> {
  return db.prepare(`SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE ticket_id = ?`).bind(ticketId).first<TicketRow>();
}

/** Staff close or reopen a ticket, optionally with an internal note. */
export async function setTicketStatus(
  db: D1Database,
  actor: { userId: string; requestId: string | null },
  ticketId: string,
  status: 'open' | 'closed',
  note: string | null,
  now: number,
): Promise<boolean> {
  const update = await db
    .prepare('UPDATE support_tickets SET status = ?, staff_note = COALESCE(?, staff_note), closed_at = ?, updated_at = ? WHERE ticket_id = ?')
    .bind(status, note, status === 'closed' ? now : null, now, ticketId)
    .run();
  if (update.meta.changes !== 1) return false;
  await auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: `admin.ticket_${status === 'closed' ? 'closed' : 'reopened'}`, targetType: 'ticket', targetId: ticketId, result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  return true;
}

/** Retention: closed tickets are removed one year after closing. */
export async function purgeOldTickets(db: D1Database, now: number): Promise<number> {
  const result = await db.prepare("DELETE FROM support_tickets WHERE status = 'closed' AND closed_at < ?").bind(now - 365 * 24 * 60 * 60 * 1000).run();
  return result.meta.changes;
}
