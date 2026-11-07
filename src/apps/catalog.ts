/**
 * Product catalog per App: which store products an App sells and which entitlement each one unlocks. It is the source of
 * the product list in the handoff text. It changes no billing behaviour (RevenueCat stays the only purchase authority).
 */
export const PRODUCT_KINDS = ['subscription', 'one_time', 'quantum'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export const PRODUCT_KIND_LABELS: Record<ProductKind, string> = { subscription: '訂閱', one_time: '一次性買斷', quantum: '量子電池加量包' };

export interface CatalogProduct {
  app_id: string;
  sku: string;
  kind: ProductKind;
  ios_product_id: string | null;
  android_product_id: string | null;
  entitlement: string | null;
  note: string | null;
}

export interface CatalogInput {
  appId: string;
  sku: string;
  kind: string;
  iosProductId?: string;
  androidProductId?: string;
  entitlement?: string;
  note?: string;
  actorUserId: string;
}

const SKU = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const STORE_ID = /^[A-Za-z0-9._:-]{1,200}$/;
const ENTITLEMENT = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
export const MAX_PRODUCTS_PER_APP = 50;

export type CatalogResult = { ok: true } | { ok: false; error: string };

function emptyToNull(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  return v === '' ? null : v;
}

export async function listCatalog(db: D1Database, appId: string): Promise<CatalogProduct[]> {
  const rows = await db
    .prepare('SELECT app_id, sku, kind, ios_product_id, android_product_id, entitlement, note FROM app_products WHERE app_id = ? ORDER BY sku')
    .bind(appId)
    .all<CatalogProduct>();
  return rows.results;
}

export async function saveCatalogProduct(db: D1Database, input: CatalogInput, now: number): Promise<CatalogResult> {
  const sku = input.sku.trim();
  if (!SKU.test(sku)) return { ok: false, error: '代號只能用小寫英文、數字、底線與連字號（最多 64 字），例如 pro-monthly。' };
  if (!(PRODUCT_KINDS as readonly string[]).includes(input.kind)) return { ok: false, error: '請選擇商品類型。' };
  const ios = emptyToNull(input.iosProductId);
  const android = emptyToNull(input.androidProductId);
  const entitlement = emptyToNull(input.entitlement);
  const note = emptyToNull(input.note);
  if (!ios && !android) return { ok: false, error: 'iOS 與 Android 商品 ID 至少要填一個。' };
  for (const id of [ios, android]) if (id && !STORE_ID.test(id)) return { ok: false, error: '商店商品 ID 只能用英數與 . _ : -（最多 200 字）。' };
  if (entitlement && !ENTITLEMENT.test(entitlement)) return { ok: false, error: '權益名稱只能用小寫英文、數字、底線、點與連字號（最多 64 字）。' };
  if (input.kind !== 'quantum' && !entitlement) return { ok: false, error: '訂閱與買斷商品要填權益名稱（RevenueCat 的 entitlement）。' };
  if (note && note.length > 200) return { ok: false, error: '備註最多 200 字。' };
  const existing = await db.prepare('SELECT COUNT(*) AS n FROM app_products WHERE app_id = ? AND sku <> ?').bind(input.appId, sku).first<{ n: number }>();
  if ((existing?.n ?? 0) >= MAX_PRODUCTS_PER_APP) return { ok: false, error: `每款 App 最多 ${MAX_PRODUCTS_PER_APP} 個商品。` };
  await db
    .prepare(
      `INSERT INTO app_products (app_id, sku, kind, ios_product_id, android_product_id, entitlement, note, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (app_id, sku) DO UPDATE SET kind = excluded.kind, ios_product_id = excluded.ios_product_id, android_product_id = excluded.android_product_id,
         entitlement = excluded.entitlement, note = excluded.note, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(input.appId, sku, input.kind, ios, android, entitlement, note, now, input.actorUserId)
    .run();
  return { ok: true };
}

export async function removeCatalogProduct(db: D1Database, appId: string, sku: string): Promise<void> {
  await db.prepare('DELETE FROM app_products WHERE app_id = ? AND sku = ?').bind(appId, sku).run();
}

/** The handoff lines for an App's catalog (empty catalog: say so, so the AI does not invent products). */
export function catalogHandoffLines(products: readonly CatalogProduct[]): string[] {
  if (products.length === 0) return ['- 這款 App 目前沒有登記任何商店商品；需要販售時，請業主先在 Admin Lite 的「商品目錄」登記，不要自己決定商品 ID。'];
  return products.map((p) => {
    const parts = [`${p.sku}（${PRODUCT_KIND_LABELS[p.kind]}）`];
    if (p.ios_product_id) parts.push(`iOS：${p.ios_product_id}`);
    if (p.android_product_id) parts.push(`Android：${p.android_product_id}`);
    if (p.entitlement) parts.push(`權益：${p.entitlement}`);
    if (p.note) parts.push(`備註：${p.note}`);
    return `- ${parts.join('｜')}`;
  });
}
