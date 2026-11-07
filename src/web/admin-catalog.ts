import { html } from 'hono/html';
import { getApp, type AppEntry } from '../apps/registry';
import { listCatalog, PRODUCT_KIND_LABELS, PRODUCT_KINDS, removeCatalogProduct, saveCatalogProduct } from '../apps/catalog';
import { WEB_APP_ID } from '../identity/web-sessions';
import { type StaffActor } from '../identity/roles';
import { auditStatement } from '../lib/audit';
import { readForm, type WebContext } from './layout';
import { adminApp, adminPage, appAccess, staff } from './admin-lib';
import { appsPage } from './admin-apps';

async function catalogPage(c: WebContext, actor: StaffActor, app: AppEntry, message?: string): Promise<Response> {
  const owner = actor.role === 'owner';
  const products = await listCatalog(c.env.DB_IDENTITY, app.app_id);
  return c.html(
    adminPage(
      c,
      '商品目錄',
      html`<h1>${app.name} 的商品目錄</h1>
${message ? html`<div class="banner">${message}</div>` : ''}
<p class="muted">登記這款 App 在 App Store 與 Google Play 販售的商品，以及每個商品解鎖的權益名稱（RevenueCat 的 entitlement）。這份清單會自動寫進給 AI 的串接指令，開發的 AI 不能自己新增或改名。這裡只是登記，不會改變購買或入帳的行為。</p>
<div class="card"><table><thead><tr><th>代號</th><th>類型</th><th>iOS 商品 ID</th><th>Android 商品 ID</th><th>權益</th><th></th></tr></thead><tbody>
${products.map((p) => html`<tr><td><code>${p.sku}</code>${p.note ? html`<br><span class="muted">${p.note}</span>` : ''}</td><td>${PRODUCT_KIND_LABELS[p.kind]}</td><td>${p.ios_product_id ?? '—'}</td><td>${p.android_product_id ?? '—'}</td><td>${p.entitlement ?? '—'}</td><td>${owner ? html`<form method="post" action="/admin/apps/${app.app_id}/products/remove" class="inline"><input type="hidden" name="sku" value="${p.sku}"><button type="submit">移除</button></form>` : ''}</td></tr>`)}
</tbody></table>${products.length === 0 ? html`<p class="muted">尚未登記任何商品，這款 App 目前不販售。</p>` : ''}</div>
${owner
  ? html`<h2>新增或修改</h2><div class="card"><form method="post" action="/admin/apps/${app.app_id}/products">
<label for="sku">代號（小寫英文，例如 pro-monthly）</label><input id="sku" name="sku" maxlength="64" required>
<label for="kind">類型</label><select id="kind" name="kind">${PRODUCT_KINDS.map((k) => html`<option value="${k}">${PRODUCT_KIND_LABELS[k]}</option>`)}</select>
<label for="ios_product_id">iOS 商品 ID（App Store Connect）</label><input id="ios_product_id" name="ios_product_id" maxlength="200">
<label for="android_product_id">Android 商品 ID（Google Play）</label><input id="android_product_id" name="android_product_id" maxlength="200">
<label for="entitlement">權益名稱（訂閱與買斷必填；量子電池可留空）</label><input id="entitlement" name="entitlement" maxlength="64">
<label for="note">備註（選填）</label><input id="note" name="note" maxlength="200">
<button type="submit">儲存</button></form></div>
<p class="muted">量子電池加量包的「商品代碼 → 顆數」仍在<a href="/admin/apps/${app.app_id}/quantum">量子電池設定</a>；這裡登記同一個商品是為了讓串接指令列出完整清單。</p>`
  : html`<p class="muted">只有 Owner 可以修改。</p>`}
<p><a href="/admin/apps/${app.app_id}/handoff">回到串接指令</a></p>`,
    ),
  );
}

adminApp.get('/apps/:id/products', async (c) => {
  const actor = await appAccess(c, c.req.param('id'));
  if (actor instanceof Response) return actor;
  const app = getApp(c.req.param('id'));
  if (!app || app.app_id === WEB_APP_ID) return appsPage(c, '找不到此 App。');
  return catalogPage(c, actor, app);
});

adminApp.post('/apps/:id/products', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const app = getApp(c.req.param('id'));
  if (!app || app.app_id === WEB_APP_ID) return appsPage(c, '找不到此 App。');
  const form = await readForm(c);
  const sku = (form.sku ?? '').trim();
  const result = await saveCatalogProduct(
    c.env.DB_IDENTITY,
    { appId: app.app_id, sku, kind: form.kind ?? '', iosProductId: form.ios_product_id, androidProductId: form.android_product_id, entitlement: form.entitlement, note: form.note, actorUserId: actor.userId },
    Date.now(),
  );
  if (!result.ok) return catalogPage(c, actor, app, result.error);
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.catalog_product_saved', targetType: 'catalog_product', targetId: sku.slice(0, 64), appId: app.app_id, result: 'success', requestId: actor.requestId, retention: 'general' }, Date.now()).run();
  return catalogPage(c, actor, app, '已儲存。');
});

adminApp.post('/apps/:id/products/remove', async (c) => {
  const actor = await staff(c, 'owner');
  if (actor instanceof Response) return actor;
  const app = getApp(c.req.param('id'));
  if (!app || app.app_id === WEB_APP_ID) return appsPage(c, '找不到此 App。');
  const form = await readForm(c);
  const sku = (form.sku ?? '').trim().slice(0, 64);
  await removeCatalogProduct(c.env.DB_IDENTITY, app.app_id, sku);
  await auditStatement(c.env.DB_IDENTITY, { actorType: 'admin', actorUserId: actor.userId, action: 'admin.catalog_product_removed', targetType: 'catalog_product', targetId: sku, appId: app.app_id, result: 'success', requestId: actor.requestId, retention: 'general' }, Date.now()).run();
  return catalogPage(c, actor, app, '已移除。');
});
