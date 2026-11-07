import { html } from 'hono/html';
import { appRegistry, getApp } from '../apps/registry';
import { batchCodes, createBatch, displayCode, MAX_BATCH, recentBatches, redeemUrl, setBatchActive, type CodeKind } from '../battery/invites';
import { WEB_APP_ID } from '../identity/web-sessions';
import { auditStatement } from '../lib/audit';
import { formatTime, readForm, type WebContext } from './layout';
import { adminApp, adminPage, requireStepUp, staff } from './admin-lib';
import { COPY_SCRIPT } from './admin-members';
import type { StaffActor } from '../identity/roles';

/**
 * Redeem-code generator (owner decision 2026-11-07): one tool for every App. Codes are free gifts and are never sold
 * (App Store 3.1.1 / Google Play payments policy), and members redeem them on the web account center, not inside an App.
 */

const KIND_LABELS: Record<CodeKind, string> = { battery: '電池（全 App 共用，只加本月額度）', quantum: '量子電池（兌換後只能在一款 App 使用）' };

const apps = () => [...appRegistry.values()].filter((a) => a.app_id !== WEB_APP_ID);

async function generatorPage(c: WebContext, actor: StaffActor, message?: string, values: Record<string, string> = {}, status = 200): Promise<Response> {
  const batches = await recentBatches(c.env.DB_BATTERY);
  const kind = values.kind === 'quantum' ? 'quantum' : 'battery';
  return c.html(
    adminPage(
      c,
      '序號產生器',
      html`<h1>序號產生器</h1>
${message ? html`<div class="banner${status >= 400 ? ' danger' : ''}">${message}</div>` : ''}
<p class="muted">一次產生一批序號，每組都附兌換網址。序號只能<strong>免費發送</strong>（活動、補償、測試、邀請），<strong>不可販售</strong>；會員在網頁帳號中心（或點兌換網址）兌換，App 內不要放兌換入口。</p>
<form method="post" action="/admin/battery/codes" class="card">
<label for="kind">類型</label>
<select id="kind" name="kind">${(['battery', 'quantum'] as CodeKind[]).map((k) => html`<option value="${k}"${kind === k ? ' selected' : ''}>${KIND_LABELS[k]}</option>`)}</select>
<label for="app_id">App（只有量子電池用；不指定＝通用序號，由兌換的人自己選一款 App，入帳後固定在那一款）</label>
<select id="app_id" name="app_id"><option value="">— 不指定（通用，兌換時自選 App）—</option>${apps().map((a) => html`<option value="${a.app_id}"${values.app_id === a.app_id ? ' selected' : ''}>${a.name}（${a.app_id}）</option>`)}</select>
<label for="units">每組序號給幾顆（1～1000）</label><input id="units" name="units" type="number" min="1" max="1000" step="1" value="${values.units ?? '5'}" required>
<label for="count">要產生幾組（1～${MAX_BATCH}）</label><input id="count" name="count" type="number" min="1" max="${MAX_BATCH}" step="1" value="${values.count ?? '10'}" required>
<label for="max_uses">每組可被幾個人兌換（1＝一人一組；每人同一組只能兌換一次）</label><input id="max_uses" name="max_uses" type="number" min="1" max="100000" step="1" value="${values.max_uses ?? '1'}" required>
<label for="expires">到期日（選填，台灣時間當天結束）</label><input id="expires" name="expires" type="date" value="${values.expires ?? ''}">
<label for="note">備註（選填，只有你看得到，最多 100 字）</label><input id="note" name="note" maxlength="100" value="${values.note ?? ''}" placeholder="例如：11 月活動">
<button type="submit">產生序號與兌換網址</button>
<p class="muted">電池序號只加「本月」額度，下個月起恢復為每月標準額度；量子電池不過期。</p>
</form>
<h2 id="recent">已產生的批次</h2>
<div class="card"><div class="tablewrap"><table><thead><tr><th>時間</th><th>類型</th><th>App</th><th>每組</th><th>組數</th><th>已兌換／可兌換</th><th>狀態</th><th></th></tr></thead><tbody>
${batches.map((b) => html`<tr><td>${formatTime(b.created_at)}${b.note ? html`<br><span class="muted">${b.note}</span>` : ''}</td><td>${b.kind === 'battery' ? '電池' : '量子電池'}</td><td>${b.app_id ? html`<code>${b.app_id}</code>` : b.kind === 'battery' ? '全部' : '兌換時自選'}</td><td>${b.units}</td><td>${b.codes}</td><td>${b.used}／${b.max_uses}</td><td>${b.active ? '可兌換' : '已停用'}${b.expires_at ? html`<br><span class="muted">到期 ${formatTime(b.expires_at)}</span>` : ''}</td><td><a href="/admin/battery/codes/${b.batch_id}">查看序號與網址</a></td></tr>`)}
</tbody></table></div>${batches.length === 0 ? html`<p class="muted">還沒有產生過序號。</p>` : ''}</div>`,
      undefined,
      actor,
    ),
    status as 200,
  );
}

function batchPage(c: WebContext, actor: StaffActor, batchId: string, codes: Awaited<ReturnType<typeof batchCodes>>, kind: CodeKind, message?: string): Response | Promise<Response> {
  const origin = new URL(c.req.url).origin;
  const first = codes[0];
  const lines = codes.map((r) => `${displayCode(r.code)}\t${redeemUrl(origin, r.code)}`).join('\n');
  const active = codes.some((r) => r.active === 1);
  return c.html(
    adminPage(
      c,
      '序號批次',
      html`<h1>序號批次</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
${first ? html`<p>${kind === 'battery' ? '電池' : first.app_id ? html`量子電池（<code>${first.app_id}</code>）` : '量子電池（通用，兌換時自選 App）'}｜每組 <strong>${first.units}</strong> 顆｜每組可兌換 ${first.max_uses} 人｜${first.expires_at ? `到期 ${formatTime(first.expires_at)}` : '不會到期'}${first.note ? `｜${first.note}` : ''}</p>` : ''}
<div class="actions"><button type="button" data-copy-text="${lines}">複製全部（序號＋網址）</button><a class="button secondary" href="/admin/battery/codes">回序號產生器</a>
<form method="post" action="/admin/battery/codes/${batchId}/${active ? 'disable' : 'enable'}" class="inline"><button type="submit" class="secondary">${active ? '停用整批' : '重新啟用整批'}</button></form></div>
<p class="muted">每一行是「序號」加上「兌換網址」。把網址傳給對方即可：對方點開、登入後按「兌換」就會入帳。序號請只免費發送，不要販售。</p>
<div class="card"><div class="tablewrap"><table><thead><tr><th>序號</th><th>兌換網址</th><th>已兌換</th><th></th></tr></thead><tbody>
${codes.map((r) => html`<tr><td><code>${displayCode(r.code)}</code></td><td><code>${redeemUrl(origin, r.code)}</code></td><td>${r.used}／${r.max_uses}${r.active ? '' : '（已停用）'}</td><td><button type="button" class="secondary" data-copy-text="${redeemUrl(origin, r.code)}">複製網址</button></td></tr>`)}
</tbody></table></div></div>`,
      COPY_SCRIPT(c.get('cspNonce')),
      actor,
    ),
  );
}

adminApp.get('/battery/codes', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  return generatorPage(c, actor);
});

adminApp.post('/battery/codes', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const stepUp = await requireStepUp(c, actor);
  if (stepUp) return stepUp;
  const form = await readForm(c);
  const kind: CodeKind = form.kind === 'quantum' ? 'quantum' : 'battery';
  const app = form.app_id ? getApp(form.app_id) : null;
  if (form.app_id && (!app || app.app_id === WEB_APP_ID)) return generatorPage(c, actor, '找不到這款 App。', form, 400);
  const now = Date.now();
  const expiresAt = form.expires ? Date.parse(`${form.expires}T23:59:59+08:00`) : null;
  if (expiresAt !== null && Number.isNaN(expiresAt)) return generatorPage(c, actor, '到期日格式不正確。', form, 400);
  const made = await createBatch(
    c.env.DB_BATTERY,
    { kind, appId: kind === 'quantum' ? (app?.app_id ?? null) : null, units: Number(form.units), count: Number(form.count), maxUsesPerCode: Number(form.max_uses), expiresAt, note: form.note ?? '', actorUserId: actor.userId },
    now,
  );
  if (!made) return generatorPage(c, actor, `產生失敗：每組顆數 1～1000、組數 1～${MAX_BATCH}、可兌換人數 1～100000，到期日必須在未來。`, form, 400);
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.redeem_codes_created', targetType: 'code_batch', targetId: made.batchId, appId: kind === 'quantum' ? (app?.app_id ?? null) : null, result: 'success', requestId: actor.requestId, retention: 'security' }, now).run();
  return batchPage(c, actor, made.batchId, await batchCodes(c.env.DB_BATTERY, made.batchId), kind, `已產生 ${made.codes.length} 組序號。這頁隨時可以從「已產生的批次」再打開。`);
});

adminApp.get('/battery/codes/:batch', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const batchId = c.req.param('batch');
  const codes = /^[0-9a-f-]{36}$/.test(batchId) ? await batchCodes(c.env.DB_BATTERY, batchId) : [];
  if (codes.length === 0) return generatorPage(c, actor, '找不到這個批次。', {}, 404);
  return batchPage(c, actor, batchId, codes, codes[0]?.kind ?? 'battery');
});

for (const action of ['disable', 'enable'] as const) {
  adminApp.post(`/battery/codes/:batch/${action}`, async (c) => {
    const actor = await staff(c, 'owner');
    if (actor instanceof Response) return actor;
    const batchId = c.req.param('batch');
    if (!/^[0-9a-f-]{36}$/.test(batchId)) return generatorPage(c, actor, '找不到這個批次。', {}, 404);
    await setBatchActive(c.env.DB_BATTERY, batchId, action === 'enable');
    await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: action === 'enable' ? 'admin.redeem_codes_enabled' : 'admin.redeem_codes_disabled', targetType: 'code_batch', targetId: batchId, result: 'success', requestId: actor.requestId, retention: 'security' }, Date.now()).run();
    const codes = await batchCodes(c.env.DB_BATTERY, batchId);
    return batchPage(c, actor, batchId, codes, codes[0]?.kind ?? 'battery', action === 'enable' ? '已重新啟用。' : '已停用，這批序號不能再兌換。');
  });
}
