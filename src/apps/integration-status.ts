import { perAppSecrets } from '../billing/revenuecat';
import type { Env } from '../env';
import { listAppStages, type AppStage } from './status';
import type { AppEntry } from './registry';
import { effectiveTeamId } from './team-id';

/** Shown for an Android App whose signing certificate is not registered yet; native Passkeys cannot work until it is. */
export const ANDROID_PENDING_TEXT = 'Android 正式簽章尚未設定，原生 Passkey 關聯尚待完成。';
export const APPLE_PENDING_TEXT = 'Apple Team ID 尚未設定，iOS 原生 Passkey 關聯尚待完成。';

export interface StatusInputs {
  batteryKey: boolean;
  products: number;
  revenuecat: { webhook: 'admin' | 'worker' | 'none'; api: 'admin' | 'worker' | 'none' };
  stage: AppStage;
}

export interface Check {
  key: 'apple' | 'android' | 'web' | 'battery' | 'products' | 'revenuecat';
  label: string;
  state: 'ok' | 'todo' | 'na';
  text: string;
}

/** One App's integration checklist. `todo` means the Owner still has something to do; `na` means it does not apply. */
export function appChecks(app: AppEntry, input: StatusInputs, env: Pick<Env, 'STARRY_APPLE_TEAM_ID'>): Check[] {
  const team = effectiveTeamId(app, env);
  const checks: Check[] = [];
  checks.push(
    !app.ios_bundle_id
      ? { key: 'apple', label: 'iOS Passkey', state: 'na', text: '沒有 iOS 版' }
      : team
        ? { key: 'apple', label: 'iOS Passkey', state: 'ok', text: `Team ID ${team}（中央共用）＋ ${app.ios_bundle_id}` }
        : { key: 'apple', label: 'iOS Passkey', state: 'todo', text: APPLE_PENDING_TEXT },
  );
  checks.push(
    !app.android_package
      ? { key: 'android', label: 'Android Passkey', state: 'na', text: '沒有 Android 版' }
      : app.android_cert_sha256.length > 0
        ? { key: 'android', label: 'Android Passkey', state: 'ok', text: `已登記 ${app.android_cert_sha256.length} 組簽章指紋（${app.android_package}）` }
        : { key: 'android', label: 'Android Passkey', state: 'todo', text: ANDROID_PENDING_TEXT },
  );
  checks.push(
    app.web_origins.length > 0
      ? { key: 'web', label: '網頁版', state: 'ok', text: `${app.web_origins.length} 個來源` }
      : { key: 'web', label: '網頁版', state: 'todo', text: '尚未登記網頁版來源（網頁版登入與 Passkey 需要）。' },
  );
  checks.push(input.batteryKey ? { key: 'battery', label: 'Battery', state: 'ok', text: '服務金鑰已開通' } : { key: 'battery', label: 'Battery', state: 'todo', text: '尚未開通 Battery 服務金鑰。' });
  checks.push(input.products > 0 ? { key: 'products', label: '商品目錄', state: 'ok', text: `${input.products} 項商品` } : { key: 'products', label: '商品目錄', state: 'na', text: '沒有登記商品（不販售就不需要）' });
  checks.push(
    input.products === 0
      ? { key: 'revenuecat', label: 'RevenueCat', state: 'na', text: '沒有商品，不需要' }
      : input.revenuecat.webhook === 'none'
        ? { key: 'revenuecat', label: 'RevenueCat', state: 'todo', text: '有登記商品，但 Webhook 驗證碼尚未設定。' }
        : input.revenuecat.api === 'none'
          ? { key: 'revenuecat', label: 'RevenueCat', state: 'todo', text: 'Webhook 已設定，但 Secret API 金鑰尚未設定（刪帳清除與每日對帳需要）。' }
          : { key: 'revenuecat', label: 'RevenueCat', state: 'ok', text: 'Webhook 與 API 金鑰都已設定' },
  );
  return checks;
}

export function pendingItems(checks: readonly Check[]): string[] {
  return checks.filter((c) => c.state === 'todo').map((c) => c.text);
}

/** Everything the checklists need, read with one query per source (not per App). */
export async function gatherStatus(env: Env, apps: readonly AppEntry[]): Promise<Map<string, StatusInputs>> {
  const [batteryRows, productRows, rcRows, stages] = await Promise.all([
    env.DB_BATTERY.prepare('SELECT app_id FROM battery_app_keys').all<{ app_id: string }>().catch(() => ({ results: [] as { app_id: string }[] })),
    env.DB_IDENTITY.prepare('SELECT app_id, COUNT(*) AS n FROM app_products GROUP BY app_id').all<{ app_id: string; n: number }>().catch(() => ({ results: [] as { app_id: string; n: number }[] })),
    env.DB_BILLING.prepare('SELECT app_id, webhook_secret_sealed IS NOT NULL AS w, api_key_sealed IS NOT NULL AS a FROM app_revenuecat').all<{ app_id: string; w: number; a: number }>().catch(() => ({ results: [] as { app_id: string; w: number; a: number }[] })),
    listAppStages(env.DB_IDENTITY),
  ]);
  const workerBattery = perAppSecrets(env.BATTERY_SERVICE_KEYS);
  const workerWebhook = perAppSecrets(env.REVENUECAT_WEBHOOK_AUTH);
  const workerApi = perAppSecrets(env.REVENUECAT_API_KEYS);
  const batteryKeys = new Set([...batteryRows.results.map((r) => r.app_id), ...Object.keys(workerBattery)]);
  const products = new Map(productRows.results.map((r) => [r.app_id, r.n]));
  const rc = new Map(rcRows.results.map((r) => [r.app_id, r]));
  return new Map(
    apps.map((app) => {
      const row = rc.get(app.app_id);
      return [
        app.app_id,
        {
          batteryKey: batteryKeys.has(app.app_id),
          products: products.get(app.app_id) ?? 0,
          revenuecat: {
            webhook: row?.w ? 'admin' : workerWebhook[app.app_id] !== undefined ? 'worker' : 'none',
            api: row?.a ? 'admin' : workerApi[app.app_id] !== undefined ? 'worker' : 'none',
          },
          stage: stages.get(app.app_id) ?? 'dev',
        } satisfies StatusInputs,
      ] as const;
    }),
  );
}
