/**
 * AI-2 REBUILD R3: verifiable SANDBOX provider boundary.
 *
 * NO credentials, real Store API calls, Apple PKI, Google OIDC JWKS fetch or D1.
 * All trust ports must be bound by the trusted Worker, NEVER by HTTP JSON.
 * Tests use generated keys and a synthetic server certificate/key resolver.
 */
import type {
  AuthoritativeStoreSnapshot, ServerRegistry, StorePort, StoreState,
} from './index.ts';

type RecordValue = Record<string, unknown>;
function fail(message:string):never { throw new Error(message); }
function check(value:unknown, code:string):asserts value { if (!value) fail(code); }
function record(value:unknown):RecordValue {
  check(value!==null && typeof value==='object' && !Array.isArray(value),'STORE_FORMAT_DENIED');
  const obj=value as RecordValue;
  check(Object.getPrototypeOf(value)===Object.prototype,'STORE_FORMAT_DENIED');
  check(Object.keys(obj).length<=60,'STORE_FORMAT_DENIED');
  return obj;
}
function literal(value:unknown,name:string,max=512):string {
  check(typeof value==='string' && value.length>0 && value.length<=max &&
    /^[A-Za-z0-9._:@-]+$/.test(value),name);
  return value;
}
function dateIso(value:unknown):string {
  check(typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value),'STORE_DATE_DENIED');
  const ms=Date.parse(value);check(Number.isFinite(ms),'STORE_DATE_DENIED');
  return new Date(ms).toISOString();
}
function millisIso(value:unknown):string {
  check(typeof value==='number' && Number.isSafeInteger(value) && value>0,'STORE_TIME_DENIED');
  return new Date(value).toISOString();
}
function keyFromString(value:unknown):string {
  return literal(value,'STORE_ID_DENIED',180);
}
function base64url(value:string):Uint8Array {
  check(value.length>0 && value.length<=24576 && /^[A-Za-z0-9_-]+$/.test(value) &&
    value.length%4!==1,'JWS_MALFORMED');
  const padded=value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4);
  const binary=atob(padded);
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
function utf8(value:string):string {return new TextDecoder('utf-8',{fatal:true}).decode(base64url(value));}
function json(value:string):RecordValue {
  check(value.length<=24576,'STORE_FORMAT_DENIED');
  try {return record(JSON.parse(value));}catch {return fail('STORE_FORMAT_DENIED');}
}
function sandbox(registry:ServerRegistry, store:'apple'|'google'):void {
  check(registry.brandId==='starry' && (registry.environment==='development'||registry.environment==='staging')
    && registry.storeEnvironment==='sandbox' && registry.store===store,'STORE_SANDBOX_ONLY');
  keyFromString(registry.appId);keyFromString(registry.storeAppId);
}
function basicKey(key:CryptoKey,alg:'ES256'|'RS256'):void {
  check(key.type==='public'&&key.usages.includes('verify'),'PROVIDER_TRUST_KEY_DENIED');
  check((alg==='ES256' && key.algorithm.name==='ECDSA')||
    (alg==='RS256'&&key.algorithm.name==='RSASSA-PKCS1-v1_5'),'PROVIDER_TRUST_KEY_DENIED');
}
async function checkedJws(
  jws:unknown,algorithm:'ES256'|'RS256',
  trustedKey:(header:Readonly<RecordValue>)=>Promise<CryptoKey>,
):Promise<RecordValue> {
  check(typeof jws==='string' && jws.length<=32768,'JWS_MALFORMED');
  const parts=jws.split('.');
  check(parts.length===3,'JWS_MALFORMED');
  const header=json(utf8(parts[0]));
  check(header.alg===algorithm && header.crit===undefined && header.jwk===undefined &&
    header.jku===undefined && header.x5u===undefined && header.b64===undefined,'JWS_HEADER_DENIED');
  const payload=json(utf8(parts[1]));
  const key=await trustedKey(header);basicKey(key,algorithm);
  const signature=base64url(parts[2]);
  // WebCrypto BufferSource requires ArrayBuffer, not a potentially shared backing store.
  const signatureBuffer=new ArrayBuffer(signature.byteLength);
  new Uint8Array(signatureBuffer).set(signature);
  const verified=await crypto.subtle.verify(
    algorithm==='ES256'?{name:'ECDSA',hash:'SHA-256'}:{name:'RSASSA-PKCS1-v1_5'},
    key,signatureBuffer,new TextEncoder().encode(parts[0]+'.'+parts[1]),
  );
  check(verified,'JWS_SIGNATURE_DENIED');
  return payload;
}

export type ApplePkiTrust = Readonly<{
  /** Must validate x5c chain, Apple root, CA usages, app-specific extensions,
   * certificate validity/revocation at signed time. NEVER trust JWS-provided x5c alone.
   * Production implementation belongs to AI-4 trust/Secrets integration Gate.
   */
  trustedAppleLeafKey:(x5c:readonly string[])=>Promise<CryptoKey>;
}>;
export type AppleNotificationV2 = Readonly<{signedPayload:string}>;
async function applePayload(jws:unknown,trust:ApplePkiTrust):Promise<RecordValue> {
  return checkedJws(jws,'ES256',async h=>{
    const chain=h.x5c;
    check(Array.isArray(chain)&&chain.length>=2&&chain.length<=4 &&
      chain.every(x=>typeof x==='string' && x.length>0 && x.length<8192),'APPLE_CERT_CHAIN_DENIED');
    return trust.trustedAppleLeafKey(chain as string[]);
  });
}
function appleTransaction(
  data:RecordValue,registry:ServerRegistry,eventId:string,eventTime:string,state:StoreState,
):AuthoritativeStoreSnapshot {
  check(data.environment==='Sandbox' && data.bundleId===registry.storeAppId,'APPLE_SCOPE_DENIED');
  const sku=keyFromString(data.productId);
  check(registry.catalog[sku]==='subscription' || registry.catalog[sku]==='non_consumable','APPLE_SKU_DENIED');
  const kind=registry.catalog[sku];
  const started=millisIso(data.purchaseDate);
  const expires=data.expiresDate===undefined||data.expiresDate===null?null:millisIso(data.expiresDate);
  if(kind==='subscription')check(expires!==null,'APPLE_EXPIRY_DENIED');
  // An Apple signed transaction with a revocation cannot issue entitlement.
  const revoked=data.revocationDate!==undefined&&data.revocationDate!==null;
  if(revoked)millisIso(data.revocationDate);
  const safeState=revoked?'REVOKED':state;
  return {
    brandId:'starry',appId:registry.appId,store:'apple',storeEnvironment:'sandbox',
    storeAppId:registry.storeAppId,sku,kind,
    originalTransactionId:keyFromString(data.originalTransactionId),
    transactionId:keyFromString(data.transactionId),providerEventId:eventId,
    accountBinding:keyFromString(data.appAccountToken),periodStartedAt:started,
    effectiveAt:eventTime,expiresAt:expires,state:safeState,
  };
}
export async function verifyAppleSandboxSignedTransaction(
  signedTransaction:unknown,registry:ServerRegistry,trust:ApplePkiTrust,
):Promise<AuthoritativeStoreSnapshot> {
  sandbox(registry,'apple');
  const data=await applePayload(signedTransaction,trust);
  const eventId='apple_tx_'+keyFromString(data.transactionId);
  const signedTime=millisIso(data.signedDate);
  return appleTransaction(data,registry,eventId,signedTime,'PAID');
}
export async function verifyAppleSandboxNotificationV2(
  notification:unknown,registry:ServerRegistry,trust:ApplePkiTrust,
):Promise<AuthoritativeStoreSnapshot> {
  sandbox(registry,'apple');
  const outer=record(notification);
  check(Object.keys(outer).length===1 && typeof outer.signedPayload==='string','APPLE_ENVELOPE_DENIED');
  const event=await applePayload(outer.signedPayload,trust);
  check(event.notificationType && typeof event.notificationType==='string','APPLE_NOTIFICATION_DENIED');
  const eventState:Readonly<Record<string,StoreState>>={
    SUBSCRIBED:'PAID',DID_RENEW:'RENEWED',REFUND:'REFUNDED',REVOKE:'REVOKED',
    EXPIRED:'EXPIRED',DID_FAIL_TO_RENEW:'ON_HOLD',
  };
  const state=eventState[event.notificationType as string];
  check(state!==undefined,'APPLE_NOTIFICATION_DENIED'); // unapproved types fail closed.
  const payload=record(event.data);
  check(payload.environment==='Sandbox' && payload.bundleId===registry.storeAppId,'APPLE_SCOPE_DENIED');
  const tx=await applePayload(payload.signedTransactionInfo,trust);
  // Signed transaction must agree with the separately verified signed notification.
  check(tx.environment==='Sandbox' && tx.bundleId===payload.bundleId,'APPLE_SCOPE_DENIED');
  // A signed renewal JWS may be present; always verify it, never silently trust decoded JSON.
  if(payload.signedRenewalInfo!==undefined) {
    const renewal=await applePayload(payload.signedRenewalInfo,trust);
    check(renewal.environment==='Sandbox' && renewal.originalTransactionId===tx.originalTransactionId
      && renewal.autoRenewProductId===tx.productId,'APPLE_RENEWAL_DENIED');
  }
  return appleTransaction(tx,registry,'apple_n_'+keyFromString(event.notificationUUID),
    millisIso(event.signedDate),state);
}
export function createAppleSandboxStorePort(registry:ServerRegistry,trust:ApplePkiTrust):StorePort {
  sandbox(registry,'apple');
  return Object.freeze({verifySandboxEvidence:async(evidence:unknown,store:'apple'|'google')=>{
    check(store==='apple','STORE_SCOPE_DENIED');
    return verifyAppleSandboxSignedTransaction(evidence,registry,trust);
  }});
}

/** Google Pub/Sub identity MUST be checked server-side against Google's OIDC issuer,
 * JWKS key, audience, expected subscription service account, iat and exp.
 * The trusted Google JWKS fetch/cache (no token-provided network URL) is AI-4 owned.
 */
export type GooglePubsubTrust = Readonly<{
  expectedAudience:string;
  expectedServiceAccount:string;
  expectedSubscription:string;
  resolveGoogleOidcKey:(kid:string)=>Promise<CryptoKey>;
  /** MUST invoke authenticated Play Developer API subscriptionsv2.get with this
   * server-controlled packageName and RTDN purchaseToken. NEVER use RTDN itself as proof.
   */
  querySubscriptionV2:(packageName:string,purchaseToken:string)=>Promise<unknown>;
  /** Server-owned HMAC/opaque stable identifier; never store raw purchase token in D1. */
  opaquePurchaseTokenRef:(purchaseToken:string)=>Promise<string>;
}>;
export type GooglePubsubDelivery=Readonly<{authorization:string;body:unknown}>;
export async function verifyGoogleSandboxRtdn(
  delivery:GooglePubsubDelivery,registry:ServerRegistry,trust:GooglePubsubTrust,nowSeconds:number,
):Promise<AuthoritativeStoreSnapshot> {
  sandbox(registry,'google');
  check(Number.isSafeInteger(nowSeconds)&&nowSeconds>0,'GOOGLE_TIME_DENIED');
  check(typeof delivery.authorization==='string' && delivery.authorization.startsWith('Bearer '),
    'GOOGLE_OIDC_REQUIRED');
  const jwt=delivery.authorization.slice(7);
  const auth=await checkedJws(jwt,'RS256',async header=>{
    check(typeof header.kid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(header.kid),'GOOGLE_KID_DENIED');
    return trust.resolveGoogleOidcKey(header.kid);
  });
  check(
    (auth.iss==='https://accounts.google.com'||auth.iss==='accounts.google.com') &&
    auth.aud===trust.expectedAudience &&
    auth.email===trust.expectedServiceAccount && auth.email_verified===true &&
    typeof auth.exp==='number' && Number.isSafeInteger(auth.exp) && auth.exp>nowSeconds &&
    typeof auth.iat==='number' && Number.isSafeInteger(auth.iat) &&
    auth.iat<=nowSeconds+60 && nowSeconds-auth.iat<=3600,
    'GOOGLE_OIDC_DENIED',
  );
  const body=record(delivery.body);
  check(body.subscription===trust.expectedSubscription,'GOOGLE_PUBSUB_SCOPE_DENIED');
  const message=record(body.message);
  check(typeof message.data==='string' && typeof message.messageId==='string'
    && typeof message.publishTime==='string','GOOGLE_PUBSUB_DENIED');
  const rawMessage=message.data as string;
  check(rawMessage.length>0 && rawMessage.length<=24576 && /^[A-Za-z0-9+/]+={0,2}$/.test(rawMessage),
    'GOOGLE_PUBSUB_DENIED');
  const decoded=new TextDecoder('utf-8',{fatal:true}).decode(
    Uint8Array.from(atob(rawMessage),c=>c.charCodeAt(0)));
  const rtdn=json(decoded);
  check(rtdn.packageName===registry.storeAppId && rtdn.testNotification===undefined
    && rtdn.oneTimeProductNotification===undefined,'GOOGLE_PACKAGE_DENIED');
  const notification=record(rtdn.subscriptionNotification);
  const purchaseToken=notification.purchaseToken;
  check(typeof purchaseToken==='string'&&purchaseToken.length>0&&purchaseToken.length<=4096,
    'GOOGLE_PURCHASE_TOKEN_DENIED');
  const type=notification.notificationType;
  check(notification.version==='1.0' && typeof type==='number' && Number.isSafeInteger(type)
    && type>=1 && type<=22,'GOOGLE_RTDN_TYPE_DENIED');
  // Current RTDN SubscriptionNotification does NOT carry subscriptionId. Product authority
  // comes from authenticated subscriptionsv2.get lineItems, not the RTDN body.
  const response=record(await trust.querySubscriptionV2(registry.storeAppId,purchaseToken));
  check(response.packageName===registry.storeAppId &&
    response.testPurchase!==undefined && response.testPurchase!==null &&
    typeof response.testPurchase==='object','GOOGLE_SANDBOX_ONLY');
  const lineItems=response.lineItems;
  check(Array.isArray(lineItems)&&lineItems.length===1,'GOOGLE_LINE_ITEM_DENIED');
  const item=record(lineItems[0]);
  const product=keyFromString(item.productId);
  check(registry.catalog[product]==='subscription','GOOGLE_SKU_DENIED');
  const binding=record(response.externalAccountIdentifiers);
  const accountBinding=keyFromString(binding.obfuscatedExternalAccountId);
  const stateMap:Record<string,StoreState>={
    SUBSCRIPTION_STATE_ACTIVE:'PAID',SUBSCRIPTION_STATE_IN_GRACE_PERIOD:'GRACE_PERIOD',
    SUBSCRIPTION_STATE_ON_HOLD:'ON_HOLD',SUBSCRIPTION_STATE_EXPIRED:'EXPIRED',
    SUBSCRIPTION_STATE_CANCELED:'EXPIRED',SUBSCRIPTION_STATE_PAUSED:'ON_HOLD',
  };
  const state=stateMap[String(response.subscriptionState)];
  check(state!==undefined,'GOOGLE_SUBSCRIPTION_STATE_DENIED');
  const expires=dateIso(item.expiryTime);
  const started=dateIso(response.startTime);
  // The current authoritative Play state, not the RTDN notification type, controls access.
  const opaqueRef=keyFromString(await trust.opaquePurchaseTokenRef(purchaseToken));
  check(opaqueRef!==purchaseToken,'GOOGLE_OPAQUE_REF_DENIED');
  return {
    brandId:'starry',appId:registry.appId,store:'google',storeEnvironment:'sandbox',
    storeAppId:registry.storeAppId,sku:product,kind:'subscription',
    originalTransactionId:opaqueRef,transactionId:keyFromString(item.latestSuccessfulOrderId),
    providerEventId:'google_m_'+keyFromString(message.messageId),
    accountBinding,periodStartedAt:started,effectiveAt:dateIso(message.publishTime),
    expiresAt:expires,state,
  };
}
export function createGoogleSandboxRtdnStorePort(
  registry:ServerRegistry,trust:GooglePubsubTrust,delivery:GooglePubsubDelivery,nowSeconds:number,
):StorePort {
  sandbox(registry,'google');
  return Object.freeze({verifySandboxEvidence:async(evidence:unknown,store:'apple'|'google')=>{
    // RTDN must arrive on protected backend route; HTTP caller cannot attach its own
    // verification artifact to a purchase request. Evidence is only correlation to this delivery.
    check(store==='google'&&evidence==='backend-rtdn','GOOGLE_RTDN_ROUTE_DENIED');
    return verifyGoogleSandboxRtdn(delivery,registry,trust,nowSeconds);
  }});
}
