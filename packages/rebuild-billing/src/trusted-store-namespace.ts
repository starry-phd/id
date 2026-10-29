/**
 * D87 W3 offline-only namespace keys. Not an Apple/Google verifier, receipt
 * acceptance, entitlement grant, Store adapter, database writer or live port.
 * Both inputs are server-owned; NEVER pass request/header/receipt claims here.
 */
export type StarryEnvironment = 'development' | 'staging';
export type StoreVerificationEnvironment = 'sandbox';
export type Provider = 'apple' | 'google';
export interface ServerStoreConfig {
  readonly brandId: 'starry';
  readonly appId: string;
  readonly starryEnvironment: StarryEnvironment;
  readonly provider: Provider;
  readonly officialStoreApp: string;
  readonly storeVerificationEnvironment: StoreVerificationEnvironment;
  readonly providerAuthority: string;
}
export interface OfficialVerificationScope {
  readonly provider: Provider;
  readonly officialStoreApp: string;
  readonly storeVerificationEnvironment: StoreVerificationEnvironment;
  readonly providerAuthority: string;
}
export interface OfflineVerifiedStorePort {
  /** Test-only trusted adapter output. Not constructed from untrusted request data. */
  readOfficialVerifiedScope(): OfficialVerificationScope | Promise<OfficialVerificationScope>;
}
export interface StoreNamespaceKeys {
  readonly version: 'starry-store-ns-v1';
  readonly provider: Provider;
  readonly namespace: string;
  readonly receiptIdentity: string;
  readonly originalLineageIdentity: string;
  readonly providerEventIdentity: string;
}
function fail(code: string): never { throw new Error(code); }
function validText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && value === value.trim() && value === value.normalize('NFC')
    && new TextDecoder('utf-8', {fatal: true}).decode(new TextEncoder().encode(value)) === value
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
function identifier(value: unknown): value is string {
  return validText(value) && /^[a-zA-Z0-9._:-]{1,180}$/u.test(value);
}
/** UTF-8 byte-length prefix, domain and explicit version; never delimiter join. */
function encode(domain: string, parts: readonly string[]): string {
  const segment = (s: string) => {
    const bytes = new TextEncoder().encode(s);
    return `${bytes.length}:${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
  };
  return ['starry-store-ns-v1', domain, ...parts].map(segment).join('');
}
function validConfig(config: ServerStoreConfig): void {
  if (config.brandId !== 'starry' || !identifier(config.appId)
    || !['development', 'staging'].includes(config.starryEnvironment)
    || !['apple', 'google'].includes(config.provider)
    || config.storeVerificationEnvironment !== 'sandbox'
    || !validText(config.officialStoreApp)
    || !validText(config.providerAuthority)) fail('STORE_NAMESPACE_CONFIG_DENIED');
}
function validOfficial(scope: OfficialVerificationScope): void {
  if (!scope || !['apple', 'google'].includes(scope.provider)
    || scope.storeVerificationEnvironment !== 'sandbox'
    || !validText(scope.officialStoreApp)
    || !validText(scope.providerAuthority)) fail('STORE_NAMESPACE_VERIFICATION_DENIED');
}
/**
 * Snapshot only own primitive data properties. No getters, inherited values,
 * proxies with synthetic accessors, or mutable references cross the trust seam.
 */
function primitiveSnapshot<T extends object>(value: T, fields: readonly string[], error: string): T {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(error);
  let descriptors: PropertyDescriptorMap;
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { return fail(error); }
  if (prototype !== Object.prototype && prototype !== null) fail(error);
  if (Reflect.ownKeys(descriptors).length !== fields.length) fail(error);
  const snapshot: Record<string, string> = Object.create(null);
  for (const field of fields) {
    const d = descriptors[field];
    if (!d || !Object.hasOwn(d, 'value') || typeof d.value !== 'string') fail(error);
    snapshot[field] = d.value;
  }
  return Object.freeze(snapshot) as T;
}
const CONFIG_FIELDS = Object.freeze(['brandId', 'appId', 'starryEnvironment', 'provider',
  'officialStoreApp', 'storeVerificationEnvironment', 'providerAuthority']);
const OFFICIAL_FIELDS = Object.freeze(['provider', 'officialStoreApp',
  'storeVerificationEnvironment', 'providerAuthority']);

/**
 * Injection seam deliberately has no client input, global network, live store
 * configuration, write capability or payment/entitlement side effects.
 */
export function createOfflineStoreNamespaceBuilder(
  serverConfig: ServerStoreConfig, officialVerification: OfflineVerifiedStorePort,
) {
  const trustedConfig = primitiveSnapshot(serverConfig, CONFIG_FIELDS, 'STORE_NAMESPACE_CONFIG_DENIED');
  validConfig(trustedConfig);
  if (!officialVerification || typeof officialVerification.readOfficialVerifiedScope !== 'function')
    fail('STORE_NAMESPACE_PORT_DENIED');
  return Object.freeze({
    async build(receiptTransactionRef: string, originalTransactionRef: string, providerEventRef: string):
      Promise<StoreNamespaceKeys> {
      for (const value of [receiptTransactionRef, originalTransactionRef, providerEventRef])
        if (!validText(value)) fail('STORE_NAMESPACE_REFERENCE_DENIED');
      const official = primitiveSnapshot(await officialVerification.readOfficialVerifiedScope(),
        OFFICIAL_FIELDS, 'STORE_NAMESPACE_VERIFICATION_DENIED');
      validOfficial(official);
      if (official.provider !== trustedConfig.provider
        || official.officialStoreApp !== trustedConfig.officialStoreApp
        || official.storeVerificationEnvironment !== trustedConfig.storeVerificationEnvironment
        || official.providerAuthority !== trustedConfig.providerAuthority)
        fail('STORE_NAMESPACE_SCOPE_MISMATCH');
      // Six versioned dimensions: brand/app/Starry env/official Store app/
      // Store verification env/provider authority. Provider is a distinct key axis.
      const namespace = encode('scope', [
        trustedConfig.brandId, trustedConfig.appId, trustedConfig.starryEnvironment,
        official.officialStoreApp, official.storeVerificationEnvironment, official.providerAuthority,
      ]);
      const provider = official.provider;
      const receiptIdentity = encode('receipt', [provider, namespace, receiptTransactionRef]);
      // First claim is GLOBAL within the trusted scope, NEVER member/session scoped.
      const originalLineageIdentity = encode('first-claim', [provider, namespace, originalTransactionRef]);
      // Multiple refund/renewal events of the same receipt must not deduplicate.
      const providerEventIdentity = encode('event', [provider, namespace, providerEventRef]);
      return Object.freeze({version: 'starry-store-ns-v1', provider,
        namespace, receiptIdentity, originalLineageIdentity, providerEventIdentity});
    },
  });
}
