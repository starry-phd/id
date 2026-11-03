/**
 * Spec S-NTF-02: transactional email only — deletion confirmation, support replies and staff
 * notices; never marketing. Sent through the Cloudflare Email Service `send_email` binding
 * (EMAIL). Without the binding nothing is sent and callers carry on. Messages are plain text,
 * written in Traditional Chinese, and carry no tokens or more personal data than needed.
 */

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface OutgoingEmail {
  to: string;
  from: EmailAddress;
  replyTo?: string;
  subject: string;
  text: string;
}

/** Minimal shape of the Email Service binding used here. */
export interface EmailSender {
  send(message: OutgoingEmail): Promise<{ messageId: string }>;
}

export interface MailSettings {
  sender: EmailSender;
  from: EmailAddress;
  supportAddress: string;
  /** Public origin of the account center, e.g. https://id.starry.phd. */
  baseUrl: string;
}

export type SendOutcome = { ok: true; messageId: string } | { ok: false; error: string };

const ADDRESS = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,63}$/;

export function isEmailAddress(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && ADDRESS.test(value);
}

/** Mail settings from the environment, or null when email is not configured. */
export function mailSettings(env: { EMAIL?: EmailSender; EMAIL_FROM?: string; SUPPORT_EMAIL?: string }, baseUrl: string): MailSettings | null {
  if (!env.EMAIL || !isEmailAddress(env.EMAIL_FROM) || !isEmailAddress(env.SUPPORT_EMAIL)) return null;
  return { sender: env.EMAIL, from: { email: env.EMAIL_FROM, name: 'Starry' }, supportAddress: env.SUPPORT_EMAIL, baseUrl };
}

/** Sends one message; never throws. Errors carry the Email Service code (e.g. E_RECIPIENT_SUPPRESSED). */
export async function sendEmail(settings: MailSettings, message: Omit<OutgoingEmail, 'from'>): Promise<SendOutcome> {
  if (!isEmailAddress(message.to)) return { ok: false, error: 'E_INVALID_RECIPIENT' };
  try {
    const result = await settings.sender.send({ ...message, from: settings.from });
    return { ok: true, messageId: result.messageId };
  } catch (error) {
    const code = typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'E_SEND_FAILED';
    return { ok: false, error: code };
  }
}

/**
 * The address a member can be reached at: their verified main contact email (02.01), otherwise
 * the most recently used sign-in that shared an email.
 */
export async function contactEmailOf(db: D1Database, userId: string): Promise<string | null> {
  const chosen = await db
    .prepare('SELECT contact_email FROM profiles WHERE user_id = ? AND contact_email IS NOT NULL AND contact_email_verified_at IS NOT NULL')
    .bind(userId)
    .first<{ contact_email: string }>();
  if (chosen && isEmailAddress(chosen.contact_email)) return chosen.contact_email;
  const row = await db
    .prepare('SELECT email FROM auth_identities WHERE user_id = ? AND email IS NOT NULL ORDER BY last_login_at DESC LIMIT 1')
    .bind(userId)
    .first<{ email: string }>();
  return row && isEmailAddress(row.email) ? row.email : null;
}

const FOOTER = (s: MailSettings) => `\n\n—\nStarry 帳號中心 ${s.baseUrl}/account\n這是系統通知信，請勿直接回覆；如有問題請寫信到 ${s.supportAddress} 或使用客服表單 ${s.baseUrl}/support。`;

export function formatTaipei(ms: number): string {
  return new Date(ms).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
}

/** Sent right after a deletion request (S-ID-06), so a member who did not ask can stop it. */
export function deletionRequestedEmail(s: MailSettings, to: string, purgeAt: number): Omit<OutgoingEmail, 'from'> {
  return {
    to,
    replyTo: s.supportAddress,
    subject: '已收到刪除 Starry 帳號的申請',
    text: `您好：

我們已收到刪除您 Starry 帳號的申請。帳號已停用，所有繁星 App 與裝置都已登出。

您的帳號與個人資料將於 ${formatTaipei(purgeAt)}（台灣時間）永久刪除，刪除後無法復原。

如果改變心意，請在此之前用同一個 Apple 或 Google 帳號登入 ${s.baseUrl}/account 並撤回申請。
如果這不是您本人的操作，請立即登入撤回，並聯絡客服。

提醒：刪除帳號不會取消 App Store 或 Google Play 的訂閱，請到商店自行取消。${FOOTER(s)}`,
  };
}

export function ticketReference(ticketId: string): string {
  return ticketId.slice(-8).toUpperCase();
}

/** Confirms a member's main contact email (02.01) before system email uses it. */
export function contactEmailVerificationEmail(s: MailSettings, to: string, link: string): Omit<OutgoingEmail, 'from'> {
  return {
    to,
    replyTo: s.supportAddress,
    subject: '請確認您的 Starry 聯絡信箱',
    text: `您好：

您在 Starry 帳號中心把這個信箱設為主要聯絡信箱。請在 24 小時內打開下面的連結完成確認：

${link}

確認之前，系統通知仍會寄到您登入用的信箱。如果這不是您本人的操作，請忽略這封信，信箱不會被使用。${FOOTER(s)}`,
  };
}

/** Staff reply to a support ticket (S-WEB-02); replies go to the support mailbox. */
export function ticketReplyEmail(s: MailSettings, to: string, ticket: { ticketId: string; message: string }, reply: string): Omit<OutgoingEmail, 'from'> {
  const quoted = ticket.message
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return {
    to,
    replyTo: s.supportAddress,
    subject: `Starry 客服回覆（案件 ${ticketReference(ticket.ticketId)}）`,
    text: `您好：

${reply}

如需補充，請直接回覆這封信（會寄到 ${s.supportAddress}），並保留案件編號 ${ticketReference(ticket.ticketId)}。

您的原始訊息：
${quoted}

—
Starry 客服 ${s.baseUrl}/support`,
  };
}

/** Tells staff a new ticket arrived; only a link, the content stays in Admin Lite. */
export function newTicketNoticeEmail(s: MailSettings, ticket: { ticketId: string; categoryLabel: string; appName: string | null; hasAttachment: boolean }): Omit<OutgoingEmail, 'from'> {
  return {
    to: s.supportAddress,
    subject: `[Starry 客服單] ${ticket.categoryLabel}（${ticketReference(ticket.ticketId)}）`,
    text: `有一張新的客服單。

類別：${ticket.categoryLabel}
相關 App：${ticket.appName ?? 'Starry 帳號／不限'}
附件：${ticket.hasAttachment ? '有' : '無'}

請到 Admin Lite 查看與回覆（需登入）：
${s.baseUrl}/admin/tickets/${ticket.ticketId}`,
  };
}

/**
 * S-NTF-02: Starry staff changed something on the member's account. The message names the
 * field only and never shows old or new values.
 */
export function staffChangeEmail(s: MailSettings, to: string, field: string): Omit<OutgoingEmail, 'from'> {
  return {
    to,
    replyTo: s.supportAddress,
    subject: 'Starry 客服人員已調整您的帳號',
    text: `您好：

Starry 客服人員已調整您帳號的「${field}」。

這是依規定寄出的通知，您不需要做任何事。如有疑問，請回覆這封信或使用客服表單。${FOOTER(s)}`,
  };
}

export async function notifyStaffChange(db: D1Database, mail: MailSettings | null, userId: string, field: string): Promise<SendOutcome | null> {
  if (!mail) return null;
  const to = await contactEmailOf(db, userId);
  if (!to) return null;
  return sendEmail(mail, staffChangeEmail(mail, to, field));
}

/** Deletion confirmation for the member's contact address; null when email is off or there is no address. */
export async function notifyDeletionRequested(db: D1Database, mail: MailSettings | null, userId: string, purgeAt: number): Promise<SendOutcome | null> {
  if (!mail) return null;
  const to = await contactEmailOf(db, userId);
  if (!to) return null;
  return sendEmail(mail, deletionRequestedEmail(mail, to, purgeAt));
}
