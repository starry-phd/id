import { Hono } from 'hono';
import { html } from 'hono/html';
import { appRegistry } from '../apps/registry';
import type { AppBindings } from '../env';
import { WEB_APP_ID } from '../identity/web-sessions';
import { CATEGORY_LABELS, createTicket, isTicketCategory, TICKET_CATEGORIES } from '../support/tickets';
import { page, readForm, sameOrigin, webContext, type WebContext } from './layout';

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

function form(c: WebContext, values: Record<string, string> = {}, message?: string): Response | Promise<Response> {
  const signedIn = c.get('web') !== null;
  const siteKey = c.env.TURNSTILE_SITE_KEY;
  const apps = [...appRegistry.values()].filter((a) => a.app_id !== WEB_APP_ID);
  const scripts = siteKey ? html`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer nonce="${c.get('cspNonce')}"></script>` : '';
  return c.html(
    page(
      c,
      '客服與檢舉',
      html`<h1>客服與檢舉</h1>
<p>遇到問題、要申請個人資料相關權利，或要檢舉內容與會員，請填寫下表，我們會以 Email 回覆。</p>
${message ? html`<div class="banner danger">${message}</div>` : ''}
<form method="post" action="/support" class="card">
  <label for="category">類別</label>
  <select id="category" name="category">${TICKET_CATEGORIES.map((k) => html`<option value="${k}" ${values.category === k ? 'selected' : ''}>${CATEGORY_LABELS[k]}</option>`)}</select>
  <label for="app_id">相關 App</label>
  <select id="app_id" name="app_id"><option value="">Starry 帳號／不限</option>${apps.map((a) => html`<option value="${a.app_id}" ${values.app_id === a.app_id ? 'selected' : ''}>${a.name}</option>`)}</select>
  ${signedIn ? html`<p class="muted">你已登入，我們會回覆到你登入帳號的 Email。</p>` : html`<label for="email">你的 Email（回覆用）</label><input id="email" name="email" type="email" maxlength="254" required value="${values.email ?? ''}">`}
  <label for="message">內容（最多 2000 字）</label>
  <textarea id="message" name="message" rows="8" maxlength="2000" required>${values.message ?? ''}</textarea>
  ${siteKey ? html`<div class="cf-turnstile" data-sitekey="${siteKey}" style="margin-top:12px"></div>` : ''}
  <button type="submit">送出</button>
</form>
<p class="muted">請勿在內容中填寫密碼或付款卡號。</p>`,
      { scripts },
    ),
  );
}

supportApp.get('/', (c) => form(c));

supportApp.post('/', async (c) => {
  const values = await readForm(c);
  if (!(await turnstileOk(c, values['cf-turnstile-response']))) return form(c, values, '驗證未通過，請再試一次。');
  const category = isTicketCategory(values.category) ? values.category : 'other';
  const appId = values.app_id && appRegistry.has(values.app_id) && values.app_id !== WEB_APP_ID ? values.app_id : null;
  const web = c.get('web');
  const result = await createTicket(
    c.env.DB_IDENTITY,
    { userId: web?.userId ?? null, contactEmail: web ? null : (values.email ?? null), category, appId, message: values.message ?? '', clientIp: c.req.header('cf-connecting-ip') ?? null },
    Date.now(),
    c.get('requestId'),
  );
  if (!result.ok) {
    return form(c, values, result.reason === 'rate_limited' ? '送出次數過多，請稍後再試。' : '請確認 Email 格式正確，且內容在 1～2000 字之間。');
  }
  return c.html(
    page(
      c,
      '已收到',
      html`<h1>已收到你的訊息</h1><div class="card"><p>案件編號：<strong>${result.ticketId.slice(-8).toUpperCase()}</strong></p><p>我們會盡快以 Email 回覆。</p></div><p><a href="/account">回到帳號中心</a></p>`,
    ),
  );
});
