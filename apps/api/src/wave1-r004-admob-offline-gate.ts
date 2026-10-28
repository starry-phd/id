/** AI-4 R004 Q4=A Google AdMob Mediation: offline review only.
 * Not imported by Worker, Expo, native SDK or any runtime adapter.
 * Provider selection is approved; activation, SDK and network are NOT.
 */
export const R004_VERSION = 'starry.ai4.r004.admob-ads-off.v1-candidate' as const;
export const R004_ADS_DEFAULTS = Object.freeze({
  adsProviderSelection: 'google-admob-mediation',
  providerSelectionApproved: true,
  adsEnabled: false, adsSdkInitialized: false, adRequestsEnabled: false,
  admobAccountAuthorized: false, adUnitAuthorized: false,
  paidResourcesAuthorized: false, activationGateAuthorized: false
} as const);

/** Intentionally type-only: there is no source of the never gate token. */
export type FutureAdsCorePort = Readonly<{
  readAppScopedRemoveAdsEntitlement: (opaqueApp: unknown) => Promise<unknown>;
  readAppScopedConsentPolicy: (opaqueApp: unknown) => Promise<unknown>;
}>;
export type FutureAdMobMediationPort = Readonly<{
  initialize: (gate: never) => Promise<never>;
  requestAd: (gate: never) => Promise<never>;
}>;

export type R004Reason =
  'INVALID_CANDIDATE' | 'SCOPE_DENIED' | 'PRODUCTION_BLOCKED' |
  'PROVIDER_MISMATCH' | 'CROSS_APP_ENTITLEMENT_DENIED' |
  'ACTIVATION_NOT_AUTHORIZED' | 'OWNER_GATE_REQUIRED';
export type R004Review = Readonly<{
  version: typeof R004_VERSION; status: 'blocked'; reason: R004Reason;
  evidence: 'untrusted_offline_only';
  may_initialize_sdk: false; may_request_ad: false;
  may_create_ad_unit: false; may_create_account: false;
  may_pay: false; may_remove_ads: false; may_deploy: false;
  may_store_submit: false; publishable: false;
}>;
const flags = Object.freeze({
  evidence: 'untrusted_offline_only',
  may_initialize_sdk: false, may_request_ad: false,
  may_create_ad_unit: false, may_create_account: false,
  may_pay: false, may_remove_ads: false, may_deploy: false,
  may_store_submit: false, publishable: false
} as const);
function deny(reason: R004Reason): R004Review {
  return Object.freeze({ version: R004_VERSION, status: 'blocked', reason, ...flags });
}
/** Data descriptors only. Never execute untrusted getters or callbacks. */
function ownData(raw: unknown): Record<string, unknown> | null {
  const expected = [
    'brand_id', 'app_id', 'entitlement_app_id', 'environment',
    'adsProviderSelection', 'adsEnabled', 'adsSdkInitialized',
    'adRequestsEnabled', 'admobAppId', 'adUnitId', 'paidResourcesEnabled'
  ];
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const p = Object.getPrototypeOf(raw);
    if (p !== Object.prototype && p !== null) return null;
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== expected.length ||
      keys.some(k => typeof k !== 'string' || !expected.includes(k))) return null;
    const x: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const name of expected) {
      const d = Object.getOwnPropertyDescriptor(raw, name);
      if (!d || !d.enumerable || !('value' in d)) return null;
      x[name] = d.value;
    }
    return x;
  } catch { return null; }
}
/** Pure diagnostics. Every outcome stays blocked; even correct-looking
 * consent, entitlement, ad IDs and owner approval assertions carry NO authority.
 */
export function reviewR004AdMobActivation(raw: unknown): R004Review {
  const x = ownData(raw);
  if (!x || typeof x.brand_id !== 'string' ||
    typeof x.app_id !== 'string' || typeof x.entitlement_app_id !== 'string' ||
    typeof x.environment !== 'string' ||
    typeof x.adsProviderSelection !== 'string' ||
    typeof x.adsEnabled !== 'boolean' ||
    typeof x.adsSdkInitialized !== 'boolean' ||
    typeof x.adRequestsEnabled !== 'boolean' ||
    typeof x.paidResourcesEnabled !== 'boolean' ||
    !(x.admobAppId === null || typeof x.admobAppId === 'string') ||
    !(x.adUnitId === null || typeof x.adUnitId === 'string'))
    return deny('INVALID_CANDIDATE');
  if (x.environment === 'production') return deny('PRODUCTION_BLOCKED');
  if (x.brand_id !== 'starry' ||
    !/^starry-[a-z0-9-]{2,60}$/.test(x.app_id) ||
    (x.environment !== 'development' && x.environment !== 'staging'))
    return deny('SCOPE_DENIED');
  if (x.adsProviderSelection !== R004_ADS_DEFAULTS.adsProviderSelection)
    return deny('PROVIDER_MISMATCH');
  if (x.app_id !== x.entitlement_app_id)
    return deny('CROSS_APP_ENTITLEMENT_DENIED');
  if (x.adsEnabled || x.adsSdkInitialized || x.adRequestsEnabled ||
    x.paidResourcesEnabled || x.admobAppId !== null || x.adUnitId !== null)
    return deny('ACTIVATION_NOT_AUTHORIZED');
  return deny('OWNER_GATE_REQUIRED');
}
