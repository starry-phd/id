import { deleteCookie } from 'hono/cookie';
import { html } from 'hono/html';
import { cleanupAfterDeletion } from '../identity/erase';
import { deleteMemberNow } from '../identity/lifecycle';
import { claimOwner } from '../identity/roles';
import { WEB_APP_ID } from '../identity/web-sessions';
import { getApp } from '../apps/registry';
import { formatTime, page, readForm, SESSION_COOKIE } from './layout';
import { accountApp } from './account-lib';

accountApp.get('/delete', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account?next=/account/delete', 303);
  if (web.status !== 'active') return c.redirect('/account', 303);
  const subs = await c.env.DB_BILLING.prepare("SELECT app_id, entitlement, expires_at, store FROM entitlements WHERE user_id = ? AND active = 1 AND (environment IS NULL OR environment != 'SANDBOX') ORDER BY app_id").bind(web.userId).all<{ app_id: string; entitlement: string; expires_at: number | null; store: string | null }>();
  const subList = subs.results.filter((s) => s.expires_at === null || s.expires_at > Date.now());
  return c.html(
    page(
      c,
      '刪除帳號',
      html`<h1>刪除 Starry 帳號</h1>
${subList.length > 0 ? html`<div class="banner danger"><strong>你目前還有生效中的訂閱或購買：</strong><ul>${subList.map((s) => html`<li>${getApp(s.app_id)?.name ?? s.app_id}：${s.entitlement}${s.store ? `（${s.store}）` : ''}${s.expires_at ? `，到期 ${formatTime(s.expires_at)}` : ''}</li>`)}</ul>刪除帳號<strong>不會</strong>取消商店的訂閱，請先到 App Store 或 Google Play 取消，否則會繼續扣款。</div>` : ''}
<div class="card">
  <ul>
    <li>按下刪除後，帳號<strong>立即永久刪除</strong>，所有繁星 App 與裝置都會登出。</li>
    <li>個人資料、頭像、登入方式、客服紀錄與 Battery 都會一併刪除，<strong>無法復原</strong>。</li>
    <li>你的會員編號不會再發給任何人。</li>
    <li>刪除帳號不會自動取消 App Store 或 Google Play 的訂閱，請先到商店取消。</li>
  </ul>
  <form method="post" action="/account/delete">
    <label for="confirm">請輸入大寫英文 DELETE 以確認</label><input id="confirm" name="confirm" autocomplete="off" required>
    <button class="danger" type="submit">刪除帳號</button> <a href="/account">取消</a>
  </form>
</div>`,
    ),
  );
});

accountApp.post('/delete', async (c) => {
  const web = c.get('web');
  if (!web || web.status !== 'active') return c.redirect('/account', 303);
  const form = await readForm(c);
  if (form.confirm?.trim() !== 'DELETE') return c.redirect('/account/delete', 303);
  const now = Date.now();
  const result = await deleteMemberNow(c.env.DB_IDENTITY, { userId: web.userId, appId: WEB_APP_ID, requestId: c.get('requestId') }, now);
  deleteCookie(c, SESSION_COOKIE, { prefix: 'host', path: '/', secure: true });
  c.set('web', null);
  if (!result.ok) return c.redirect('/account', 303);
  await cleanupAfterDeletion(c.env, web.userId, result.avatarKey, now);
  return c.html(
    page(
      c,
      '帳號已刪除',
      html`<h1>帳號已刪除</h1>
<div class="card"><p>你的 Starry 帳號與資料已永久刪除，所有裝置都已登出。</p>
<p>如果你有訂閱，請記得到 App Store 或 Google Play 取消。</p></div>`,
    ),
  );
});

/** One-time owner bootstrap (see claimOwner); only visible while OWNER_CLAIM_CODE is set. */
accountApp.get('/claim-owner', (c) => {
  const web = c.get('web');
  if (!c.env.OWNER_CLAIM_CODE) return c.redirect('/account', 303);
  if (!web) return c.redirect('/account?next=/account/claim-owner', 303);
  return c.html(
    page(
      c,
      '設定 Owner',
      html`<h1>設定 Owner</h1><form method="post" action="/account/claim-owner" class="card">
<p>輸入在 Cloudflare 設定的 OWNER_CLAIM_CODE，將目前登入的帳號設為 Starry Owner。完成後請刪除該 Secret。</p>
<label for="code">Owner 密語</label><input id="code" name="code" type="password" autocomplete="off" required>
<button type="submit">確認</button></form>`,
    ),
  );
});

accountApp.post('/claim-owner', async (c) => {
  const web = c.get('web');
  if (!web) return c.redirect('/account', 303);
  const code = (await readForm(c)).code ?? '';
  const result = await claimOwner(c.env.DB_IDENTITY, c.env.OWNER_CLAIM_CODE, web.userId, code, c.get('requestId'), Date.now());
  const text: Record<typeof result, string> = {
    claimed: '已設為 Owner。請到 Cloudflare 刪除 OWNER_CLAIM_CODE。',
    disabled: '目前沒有開放設定 Owner。',
    already_claimed: '已經有 Owner，無法再次設定。',
    wrong_code: '密語不正確。',
    not_active: '帳號目前不能執行這個操作。',
  };
  return c.html(page(c, '設定 Owner', html`<h1>設定 Owner</h1><div class="banner${result === 'claimed' ? '' : ' danger'}">${text[result]}</div><p><a href="${result === 'claimed' ? '/admin' : '/account'}">繼續</a></p>`), result === 'claimed' ? 200 : 403);
});
