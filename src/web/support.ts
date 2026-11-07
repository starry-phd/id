import { Hono } from 'hono';
import { html } from 'hono/html';
import { appRegistry, getApp } from '../apps/registry';
import type { AppBindings } from '../env';
import { background } from '../auth/routes';
import { WEB_APP_ID } from '../identity/web-sessions';
import { mailSettings, newTicketNoticeEmail, sendEmail } from '../notify/email';
import { ATTACHMENT_MAX_BYTES, checkAttachment, saveAttachment, type AttachmentType } from '../support/attachments';
import { CATEGORY_LABELS, createTicket, isTicketCategory, TICKET_CATEGORIES } from '../support/tickets';
import { page, sameOrigin, webContext, type WebContext } from './layout';

/** Spec S-WEB-02: support and report form, open to members and visitors. */
export const supportApp = new Hono<AppBindings>();
supportApp.use('*', webContext, sameOrigin);

const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function turnstileOk(c: WebContext, token: string | undefined): Promise<boolean> {
  const secret = c.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    const ip = c.req.header('cf-connecting-ip');
    if (ip) body.set('remoteip', ip);
    const res = await fetch(TURNSTILE_VERIFY, { method: 'POST', body });
    const outcome: unknown = await res.json();
    return typeof outcome === 'object' && outcome !== null && (outcome as { success?: unknown }).success === true;
  } catch {
    return false;
  }
}

const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';
const ATTACHMENT_ERRORS = {
  too_large: '附件超過 2 MB，請縮小後再送出。',
  unsupported: '附件只接受 PNG、JPEG、WebP 圖片或 PDF。',
} as const;

/** Text fields plus the optional file of a urlencoded or multipart form; never throws. */
async function readSupportForm(c: WebContext): Promise<{ values: Record<string, string>; file: File | null }> {
  try {
    const body = await c.req.parseBody();
    const values: Record<string, string> = {};
    let file: File | null = null;
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'string') values[key] = value;
      else if (key === 'attachment' && value instanceof File) file = value;
    }
    return { values, file };
  } catch {
    return { values: {}, file: null };
  }
}

function form(c: WebContext, values: Record<string, string> = {}, message?: string): Response | Promise<Response> {
  const signedIn = c.get('web') !== null;
  const uploads = Boolean(c.env.SUPPORT_FILES);
  const siteKey = c.env.TURNSTILE_SITE_KEY;
  const apps = [...appRegistry.values()].filter((a) => a.app_id !== WEB_APP_ID);
  const scripts = siteKey ? html`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer nonce="${c.get('cspNonce')}"></script>` : undefined;
  return c.html(
    page(
      c,
      '客服與檢舉',
      html`<h1>客服與檢舉</h1>
<p>遇到問題、要申請個人資料相關權利，或要檢舉內容與會員，請填寫下表，我們會以 Email 回覆。</p>
${message ? html`<div class="banner danger">${message}</div>` : ''}
<form method="post" action="/support" class="card"${uploads ? html` enctype="multipart/form-data"` : ''}>
  <label for="category">類別</label>
  <select id="category" name="category">${TICKET_CATEGORIES.map((k) => html`<option value="${k}" ${values.category === k ? 'selected' : ''}>${CATEGORY_LABELS[k]}</option>`)}</select>
  <label for="app_id">相關 App</label>
  <select id="app_id" name="app_id"><option value="">Starry 帳號／不限</option>${apps.map((a) => html`<option value="${a.app_id}" ${values.app_id === a.app_id ? 'selected' : ''}>${a.name}</option>`)}</select>
  ${signedIn ? html`<p class="muted">你已登入，我們會回覆到你登入帳號的 Email。</p>` : html`<label for="email">你的 Email（回覆用）</label><input id="email" name="email" type="email" maxlength="254" required value="${values.email ?? ''}">`}
  ${values.app_version ? html`<input type="hidden" name="app_version" value="${values.app_version}">` : ''}${values.device ? html`<input type="hidden" name="device" value="${values.device}">` : ''}
  ${values.app_version || values.device ? html`<p class="muted">已附上 App 版本與裝置資訊：${[values.app_version, values.device].filter(Boolean).join('｜')}</p>` : ''}
  <label for="message">內容（最多 2000 字）</label>
  <textarea id="message" name="message" rows="8" maxlength="2000" required>${values.message ?? ''}</textarea>
  ${uploads ? html`<label for="attachment">附件（選填：截圖或 PDF，最多 2 MB）</label><input id="attachment" name="attachment" type="file" accept="${ATTACHMENT_ACCEPT}">` : ''}
  ${siteKey ? html`<div class="cf-turnstile" data-sitekey="${siteKey}" style="margin-top:12px"></div>` : ''}
  <button type="submit">送出</button>
</form>
<p class="muted">請勿在內容中填寫密碼或付款卡號。</p>`,
      { scripts },
    ),
  );
}

/** An App opens /support?app_id=…&app_version=…&device=… so the ticket arrives with its context. */
supportApp.get('/', (c) => {
  const q = c.req.query();
  return form(c, { ...(q.app_id ? { app_id: q.app_id } : {}), ...(q.app_version ? { app_version: q.app_version } : {}), ...(q.device ? { device: q.device } : {}) });
});

supportApp.post('/', async (c) => {
  // Refuse oversized uploads before reading them; the form itself plus 2 MB fits well below this.
  if (Number(c.req.header('content-length') ?? '0') > ATTACHMENT_MAX_BYTES + 64 * 1024) return form(c, {}, ATTACHMENT_ERRORS.too_large);
  const { values, file } = await readSupportForm(c);
  if (!(await turnstileOk(c, values['cf-turnstile-response']))) return form(c, values, '驗證未通過，請再試一次。');
  let attachment: { bytes: Uint8Array; type: AttachmentType } | null = null;
  const store = c.env.SUPPORT_FILES;
  if (store && file && file.size > 0) {
    if (file.size > ATTACHMENT_MAX_BYTES) return form(c, values, ATTACHMENT_ERRORS.too_large);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkAttachment(bytes);
    if (!check.ok) return form(c, values, ATTACHMENT_ERRORS[check.reason]);
    attachment = { bytes, type: check.type };
  }
  const category = isTicketCategory(values.category) ? values.category : 'other';
  const appId = values.app_id && appRegistry.has(values.app_id) && values.app_id !== WEB_APP_ID ? values.app_id : null;
  const web = c.get('web');
  const now = Date.now();
  const result = await createTicket(
    c.env.DB_IDENTITY,
    { userId: web?.userId ?? null, contactEmail: web ? null : (values.email ?? null), category, appId, message: values.message ?? '', clientIp: c.req.header('cf-connecting-ip') ?? null, appVersion: values.app_version ?? null, device: values.device ?? null },
    now,
    c.get('requestId'),
  );
  if (!result.ok) {
    return form(c, values, result.reason === 'rate_limited' ? '送出次數過多，請稍後再試。' : '請確認 Email 格式正確，且內容在 1～2000 字之間。');
  }
  let attachmentSaved = attachment === null;
  if (attachment && store) {
    try {
      await saveAttachment(c.env.DB_IDENTITY, store, { ticketId: result.ticketId, ...attachment }, now);
      attachmentSaved = true;
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', request_id: c.get('requestId'), message: 'support attachment upload failed', error: error instanceof Error ? error.message : 'unknown' }));
    }
  }
  const mail = mailSettings(c.env, new URL(c.req.url).origin);
  if (mail) {
    const notice = newTicketNoticeEmail(mail, { ticketId: result.ticketId, categoryLabel: CATEGORY_LABELS[category], appName: appId ? (getApp(appId)?.name ?? appId) : null, hasAttachment: attachment !== null && attachmentSaved });
    const pending = background(
      c,
      sendEmail(mail, notice).then((outcome) => {
        if (!outcome.ok) console.error(JSON.stringify({ level: 'error', request_id: c.get('requestId'), message: 'ticket notice email failed', error: outcome.error }));
      }),
    );
    if (pending) await pending;
  }
  return c.html(
    page(
      c,
      '已收到',
      html`<h1>已收到你的訊息</h1><div class="card"><p>案件編號：<strong>${result.ticketId.slice(-8).toUpperCase()}</strong></p><p>我們會盡快以 Email 回覆。</p>
${attachmentSaved ? '' : html`<p class="danger">附件沒有上傳成功，訊息已送出。如需提供附件，請在我們回覆時附上。</p>`}</div><p><a href="/account">回到帳號中心</a></p>`,
    ),
  );
});
