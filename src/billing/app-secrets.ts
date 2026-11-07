import { open, seal } from '../lib/sealed';
import { perAppSecrets } from './revenuecat';

export interface RcSecrets {
  webhook: Record<string, string>;
  api: Record<string, string>;
}

const ctx = (appId: string, kind: 'webhook' | 'api') => `rc:${appId}:${kind}`;

/** Secrets from the Worker secrets, overridden per App by what the Owner entered in Admin Lite. */
export async function loadRevenueCatSecrets(env: { DB_BILLING: D1Database; DATA_ENCRYPTION_KEY?: string | undefined; REVENUECAT_WEBHOOK_AUTH?: string | undefined; REVENUECAT_API_KEYS?: string | undefined }): Promise<RcSecrets> {
  const result: RcSecrets = { webhook: perAppSecrets(env.REVENUECAT_WEBHOOK_AUTH), api: perAppSecrets(env.REVENUECAT_API_KEYS) };
  const key = env.DATA_ENCRYPTION_KEY;
  if (!key) return result;
  try {
    const rows = await env.DB_BILLING.prepare('SELECT app_id, webhook_secret_sealed, api_key_sealed FROM app_revenuecat').all<{ app_id: string; webhook_secret_sealed: string | null; api_key_sealed: string | null }>();
    for (const r of rows.results) {
      const webhook = r.webhook_secret_sealed ? await open(key, ctx(r.app_id, 'webhook'), r.webhook_secret_sealed) : null;
      const api = r.api_key_sealed ? await open(key, ctx(r.app_id, 'api'), r.api_key_sealed) : null;
      if (webhook) result.webhook[r.app_id] = webhook;
      if (api) result.api[r.app_id] = api;
    }
  } catch {
    // A broken table never blocks the Worker-secret configuration.
  }
  return result;
}

export interface RcStatus {
  webhook: 'admin' | 'worker' | 'none';
  api: 'admin' | 'worker' | 'none';
}

export async function revenueCatStatus(env: Parameters<typeof loadRevenueCatSecrets>[0], appId: string): Promise<RcStatus> {
  const row = await env.DB_BILLING.prepare('SELECT webhook_secret_sealed IS NOT NULL AS w, api_key_sealed IS NOT NULL AS a FROM app_revenuecat WHERE app_id = ?').bind(appId).first<{ w: number; a: number }>();
  const worker = { webhook: perAppSecrets(env.REVENUECAT_WEBHOOK_AUTH)[appId] !== undefined, api: perAppSecrets(env.REVENUECAT_API_KEYS)[appId] !== undefined };
  return { webhook: row?.w ? 'admin' : worker.webhook ? 'worker' : 'none', api: row?.a ? 'admin' : worker.api ? 'worker' : 'none' };
}

/** Saves (or with null clears) one secret of one App. Returns false when sealing is impossible. */
export async function saveRevenueCatSecret(
  env: { DB_BILLING: D1Database; DATA_ENCRYPTION_KEY?: string | undefined },
  input: { appId: string; kind: 'webhook' | 'api'; value: string | null; actorUserId: string },
  now: number,
): Promise<boolean> {
  const column = input.kind === 'webhook' ? 'webhook_secret_sealed' : 'api_key_sealed';
  let sealed: string | null = null;
  if (input.value !== null) {
    if (!env.DATA_ENCRYPTION_KEY) return false;
    sealed = await seal(env.DATA_ENCRYPTION_KEY, ctx(input.appId, input.kind), input.value);
    if (!sealed) return false;
  }
  await env.DB_BILLING
    .prepare(`INSERT INTO app_revenuecat (app_id, ${column}, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (app_id) DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .bind(input.appId, sealed, now, input.actorUserId)
    .run();
  return true;
}
