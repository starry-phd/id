import { html, raw } from 'hono/html';
import { type StaffActor } from '../identity/roles';
import { auditStatement } from '../lib/audit';
import { mailSettings } from '../notify/email';
import { ATTACHMENT_EXTENSIONS, getAttachment, listAttachments } from '../support/attachments';
import { listReplies, replyRecipient, replyToTicket } from '../support/replies';
import { CATEGORY_LABELS, getTicket, listTickets, setTicketStatus } from '../support/tickets';
import { formatTime, readForm, type WebContext } from './layout';
import { adminApp, adminPage, staff } from './admin-lib';

adminApp.get('/tickets', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  const status = c.req.query('status') === 'closed' ? 'closed' : 'open';
  const result = await listTickets(c.env.DB_IDENTITY, { status, cursor: c.req.query('cursor') });
  return c.html(
    adminPage(
      c,
      '客服單',
      html`<h1>客服單</h1>
<p>${status === 'open' ? html`<strong>未結</strong>&emsp;<a href="/admin/tickets?status=closed">已結</a>` : html`<a href="/admin/tickets">未結</a>&emsp;<strong>已結</strong>`}</p>
<table><thead><tr><th>時間</th><th>類別</th><th>內容</th></tr></thead><tbody>
${result.tickets.map(
  (t) => html`<tr><td><a href="/admin/tickets/${t.ticket_id}">${formatTime(t.created_at)}</a></td><td>${CATEGORY_LABELS[t.category]}${t.app_id ? html`<br><span class="muted">${t.app_id}</span>` : ''}</td><td>${t.message.length > 80 ? `${t.message.slice(0, 80)}…` : t.message}</td></tr>`,
)}
</tbody></table>
${result.tickets.length === 0 ? html`<p class="muted">沒有客服單。</p>` : ''}
${result.nextCursor ? html`<p class="pager"><a href="/admin/tickets?status=${status}&cursor=${result.nextCursor}">下一頁</a></p>` : ''}`,
    ),
  );
});

/** Canned replies for common tickets; the staff member edits the text before sending. */
export const REPLY_TEMPLATES: readonly { label: string; text: string }[] = [
  { label: '已收到，正在處理', text: '您好，我們已收到您的來信，正在確認處理中，有進一步消息會再通知您。謝謝您的耐心等候。' },
  { label: '需要更多資訊', text: '您好，為了協助您，請回覆以下資訊：使用的 App 與版本、手機型號與系統版本、問題發生的時間與畫面描述（有截圖更好）。謝謝您。' },
  { label: '問題已解決', text: '您好，您回報的問題已經處理完成，請重新開啟 App 再試一次。如果仍有狀況，歡迎直接回覆這封信。' },
  { label: '訂閱與退款說明', text: '您好，App 內的訂閱與購買由 Apple 或 Google 處理。請至 App Store 或 Google Play 的「訂閱／購買紀錄」取消訂閱或申請退款；退款成功後，我們的系統會自動更新您的權益。' },
  { label: '帳號刪除說明', text: '您好，您可以在網頁版帳號中心（id.starry.phd/account）的「刪除帳號」立即刪除帳號。刪除後資料無法復原；刪除不會自動取消商店訂閱，請先到商店取消。' },
];

async function ticketPage(c: WebContext, actor: StaffActor, ticketId: string, message?: string): Promise<Response> {
  const db = c.env.DB_IDENTITY;
  const t = await getTicket(db, ticketId);
  if (!t) return c.html(adminPage(c, '找不到客服單', html`<h1>找不到客服單</h1>`), 404);
  await auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.ticket_viewed', targetType: 'ticket', targetId: t.ticket_id, result: 'success', requestId: actor.requestId, retention: 'general' }, Date.now()).run();
  const attachments = await listAttachments(db, t.ticket_id);
  const replies = await listReplies(db, t.ticket_id);
  const canEmail = mailSettings(c.env, new URL(c.req.url).origin) !== null;
  const recipient = await replyRecipient(db, t);
  return c.html(
    adminPage(
      c,
      '客服單',
      html`<h1>客服單</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<div class="card">
<p class="muted">${formatTime(t.created_at)}｜${CATEGORY_LABELS[t.category]}${t.app_id ? `｜${t.app_id}` : ''}｜${t.status === 'open' ? '未結' : `已結（${formatTime(t.closed_at)}）`}</p>
<p style="white-space:pre-wrap">${t.message}</p>
<p><strong>回覆對象：</strong>${t.contact_email ?? '（會員，請以會員登入 Email 回覆）'}${t.user_id ? html`<br><a href="/admin/members/${t.user_id}">查看會員</a>` : ''}</p>
${t.staff_note ? html`<p><strong>內部備註：</strong>${t.staff_note}</p>` : ''}
${attachments.map(
  (a) => html`<p><strong>附件：</strong><a href="/admin/tickets/${t.ticket_id}/attachments/${a.attachment_id}">下載 ${ATTACHMENT_EXTENSIONS[a.content_type].toUpperCase()}（${Math.max(1, Math.round(a.size_bytes / 1024))} KB）</a><br><span class="muted">使用者上傳的檔案，請勿在登入中的電腦上直接開啟可疑檔案。</span></p>`,
)}
</div>
${replies.length > 0
  ? html`<h2>回覆紀錄</h2>${replies.map(
      (r) => html`<div class="card"><p class="muted">${formatTime(r.created_at)}｜${r.delivery === 'sent' ? '已寄出' : html`<span class="danger">寄送失敗（${r.error_code ?? '未知'}）</span>`}</p><p style="white-space:pre-wrap">${r.body}</p></div>`,
    )}`
  : ''}
<h2>以 Email 回覆</h2>
${!canEmail
  ? html`<p class="muted">系統 Email 尚未啟用（需業主完成 Email Service 設定），請暫時用客服信箱直接回覆。</p>`
  : !recipient
    ? html`<p class="muted">找不到可回覆的 Email（會員的登入方式沒有提供 Email）。</p>`
    : html`<form method="post" action="/admin/tickets/${t.ticket_id}/reply" class="card">
<p class="muted">寄給：${recipient}（信中會附上原始訊息，回信會寄到客服信箱）</p>
<label for="tpl">快速範本（選了會填入下方，可再修改）</label><select id="tpl"><option value="">不使用範本</option>${REPLY_TEMPLATES.map((t, i) => html`<option value="${i}">${t.label}</option>`)}</select>
<label for="reply">回覆內容（最多 2000 字）</label><textarea id="reply" name="reply" maxlength="2000" rows="6" required></textarea>
${t.status === 'open' ? html`<label><input type="checkbox" name="close" value="yes" style="width:auto" checked> 寄出後結案</label>` : ''}
<button type="submit">寄出回覆</button>
</form>`}
<h2>狀態與內部備註</h2>
<form method="post" action="/admin/tickets/${t.ticket_id}/status" class="card">
<label for="note">內部備註（選填，最多 1000 字）</label><textarea id="note" name="note" maxlength="1000" rows="3"></textarea>
<input type="hidden" name="status" value="${t.status === 'open' ? 'closed' : 'open'}">
<button type="submit">${t.status === 'open' ? '結案' : '重新開啟'}</button>
</form>`,
      html`<script nonce="${c.get('cspNonce')}">
var TEMPLATES = ${raw(JSON.stringify(REPLY_TEMPLATES.map((t) => t.text)).split('<').join('\\u003c'))};
var tpl = document.getElementById('tpl');
if (tpl) tpl.addEventListener('change', function () {
  var area = document.getElementById('reply');
  if (tpl.value !== '' && area) area.value = TEMPLATES[Number(tpl.value)];
});
</script>`,
    ),
  );
}

adminApp.get('/tickets/:id', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  return ticketPage(c, actor, c.req.param('id'));
});

/** Streams a ticket attachment as a download; never rendered inline (S-WEB-02). */
adminApp.get('/tickets/:id/attachments/:attachmentId', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  const db = c.env.DB_IDENTITY;
  const attachment = await getAttachment(db, c.req.param('id'), c.req.param('attachmentId'));
  const object = attachment ? await c.env.SUPPORT_FILES?.get(attachment.object_key) : null;
  if (!attachment || !object) return c.html(adminPage(c, '找不到附件', html`<h1>找不到附件</h1>`), 404);
  await auditStatement(db, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.ticket_attachment_viewed', targetType: 'ticket', targetId: attachment.ticket_id, result: 'success', requestId: actor.requestId, retention: 'general' }, Date.now()).run();
  const filename = `ticket-${attachment.ticket_id.slice(-8)}.${ATTACHMENT_EXTENSIONS[attachment.content_type]}`;
  return new Response(object.body, {
    headers: {
      'content-type': attachment.content_type,
      'content-length': String(attachment.size_bytes),
      'content-disposition': `attachment; filename="${filename}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
});

/** POST /admin/tickets/:id/reply — emails the reply to the sender and keeps it with the ticket (S-NTF-02). */
adminApp.post('/tickets/:id/reply', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  const db = c.env.DB_IDENTITY;
  const ticketId = c.req.param('id');
  const ticket = await getTicket(db, ticketId);
  if (!ticket) return ticketPage(c, actor, ticketId, '找不到客服單。');
  const mail = mailSettings(c.env, new URL(c.req.url).origin);
  if (!mail) return ticketPage(c, actor, ticketId, '系統 Email 尚未啟用。');
  const form = await readForm(c);
  const now = Date.now();
  const result = await replyToTicket(db, mail, actor, ticket, form.reply ?? '', now);
  if (!result.ok) return ticketPage(c, actor, ticketId, result.reason === 'invalid' ? '回覆內容需為 1～2000 字。' : '找不到可回覆的 Email。');
  if (result.reply.delivery === 'failed') return ticketPage(c, actor, ticketId, `寄送失敗（${result.reply.error_code ?? '未知'}），回覆已保存，請稍後再試或改用客服信箱。`);
  if (form.close === 'yes' && ticket.status === 'open') await setTicketStatus(db, actor, ticketId, 'closed', null, now);
  return ticketPage(c, actor, ticketId, form.close === 'yes' && ticket.status === 'open' ? '已寄出回覆並結案。' : '已寄出回覆。');
});

adminApp.post('/tickets/:id/status', async (c) => {
  const actor = await staff(c, 'support');
  if (actor instanceof Response) return actor;
  const form = await readForm(c);
  const status = form.status === 'closed' ? 'closed' : 'open';
  const note = (form.note ?? '').trim().slice(0, 1000) || null;
  const ok = await setTicketStatus(c.env.DB_IDENTITY, actor, c.req.param('id'), status, note, Date.now());
  return ticketPage(c, actor, c.req.param('id'), ok ? (status === 'closed' ? '已結案。' : '已重新開啟。') : '找不到客服單。');
});
