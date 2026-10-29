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
 * Injection seam deliberately has no client input, global network, live store
 * configuration, write capability or payment/entitlement side effects.
 */
export function createOfflineStoreNamespaceBuilder(
  serverConfig: ServerStoreConfig, officialVerification: OfflineVerifiedStorePort,
) {
  validConfig(serverConfig);
  if (!officialVerification || typeof officialVerification.readOfficialVerifiedScope !== 'function')
    fail('STORE_NAMESPACE_PORT_DENIED');
  return Object.freeze({
    async build(receiptTransactionRef: string, originalTransactionRef: string, providerEventRef: string):
      Promise<StoreNamespaceKeys> {
      for (const value of [receiptTransactionRef, originalTransactionRef, providerEventRef])
        if (!validText(value)) fail('STORE_NAMESPACE_REFERENCE_DENIED');
      const official = await officialVerification.readOfficialVerifiedScope();
      validOfficial(official);
      if (official.provider !== serverConfig.provider
        || official.officialStoreApp !== serverConfig.officialStoreApp
        || official.storeVerificationEnvironment !== serverConfig.storeVerificationEnvironment
        || official.providerAuthority !== serverConfig.providerAuthority)
        fail('STORE_NAMESPACE_SCOPE_MISMATCH');
      // Six versioned dimensions: brand/app/Starry env/official Store app/
      // Store verification env/provider authority. Provider is a distinct key axis.
      const namespace = encode('scope', [
        serverConfig.brandId, serverConfig.appId, serverConfig.starryEnvironment,
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
