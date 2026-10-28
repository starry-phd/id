/**
 * AI-2 R23+ verified-cryptography Google Pub/Sub transport boundary.
 * VERIFIES a JWT against a caller-provided offline RSA public key only;
 * it does NOT establish that the key came from Google's live JWKS.
 * No actual Google Play Developer API lookup, purchasing, ACK or rights.
 * No network, credentials, signed fixtures or payment tokens are persisted.
 *
 * Google RTDN is a change notification, not a purchase authorization.
 */
export const R23_GOOGLE_RTDN_LIVE=false as const;
export const R23_GOOGLE_RTDN_CONTRACT='starry.billing.google-rtdn-transport.v0-offline' as const;
export type R23GooglePushOutcome=Readonly<{
 contract:typeof R23_GOOGLE_RTDN_CONTRACT;
 state:'blocked'|'signature_checked_offline_only';
 reason:string;
 notification_kind:'none'|'subscription'|'one_time'|'voided'|'test';
 local_signature_valid:boolean;
 google_jwks_live_verified:false;
 google_play_purchase_verified:false;
 member_binding_approved:false;
 durable_dedupe_committed:false;
 store_entitlement_active:false;
 can_ack_pubsub:false;
 can_grant:false;
 can_restore:false;
 can_remove_ads:false;
 may_publish:false;
 live:false;
}>;
type Config=Readonly<{
 enabled?:boolean;
 scope:Readonly<{
  brand_id:'starry';environment:'development'|'staging';
  app_id:string;package_name:string;pubsub_subscription:string;
 }>;
 audience:string;service_account_email:string;
 /** Must be validated against Google's independently trusted live key set
  * by an authorized production adapter. Tests only supply ephemeral fixture. */
 offlinePublicKeyPem:string;
 kid:string;
 nowSeconds:number;
}>;
type Request=Readonly<{authorization:string;pushJsonText:string}>;
const KINDS=['subscriptionNotification','oneTimeProductNotification',
 'voidedPurchaseNotification','testNotification'] as const;
const PACKAGE=/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*){1,15}$/;
const SERVICE=/^[a-zA-Z0-9._-]+@[a-zA-Z0-9-]+\.iam\.gserviceaccount\.com$/;
const B64URL=/^[A-Za-z0-9_-]+$/;
const reason=(state:R23GooglePushOutcome['state'],why:string,
 kind:R23GooglePushOutcome['notification_kind']='none'):R23GooglePushOutcome=>
 Object.freeze({
 contract:R23_GOOGLE_RTDN_CONTRACT,
 state,reason:why,notification_kind:kind,
 local_signature_valid:state==='signature_checked_offline_only',
 google_jwks_live_verified:false,google_play_purchase_verified:false,
 member_binding_approved:false,durable_dedupe_committed:false,
 store_entitlement_active:false,can_ack_pubsub:false,can_grant:false,
 can_restore:false,can_remove_ads:false,may_publish:false,live:false
 });
const dict=(raw:unknown):raw is Record<string,unknown>=>
 raw!==null&&typeof raw==='object'&&!Array.isArray(raw)&&
 (Object.getPrototypeOf(raw)===Object.prototype||
  Object.getPrototypeOf(raw)===null);
function fromUrlBase64(s:string):Uint8Array|null{
 if(!s||!B64URL.test(s)||s.length>8192||s.length%4===1)return null;
 try{
  const base=s.replace(/-/g,'+').replace(/_/g,'/');
  const binary=atob(base+'='.repeat((4-base.length%4)%4));
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  const canonical=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-')
   .replace(/\//g,'_').replace(/=+$/g,'');
  return canonical===s?bytes:null;
 }catch{return null;}
}
function jsonPart(s:string):Record<string,unknown>|null{
 const b=fromUrlBase64(s);
 if(!b||b.length>8192)return null;
 try{
  const d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b)) as unknown;
  return dict(d)?d:null;
 }catch{return null;}
}
function readPush(raw:string,scope:Config['scope']){
 if(typeof raw!=='string'||raw.length>50000)return null;
 try{
  const body=JSON.parse(raw) as unknown;
  if(!dict(body)||body.subscription!==scope.pubsub_subscription
   ||!dict(body.message))return null;
  const msg=body.message;
  const id=msg.messageId??msg.message_id;
  if(typeof id!=='string'||!/^[0-9]{1,64}$/.test(id))return null;
  const encoded=msg.data;
  if(typeof encoded!=='string'||encoded.length<4||encoded.length>32000
   ||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
   return null;
  const buffer=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  if(btoa(String.fromCharCode(...buffer))!==encoded)return null;
  const rt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer)) as unknown;
  if(!dict(rt)||rt.version!=='1.0'||rt.packageName!==scope.package_name
   ||typeof rt.eventTimeMillis!=='string'
   ||!/^\d{12,14}$/.test(rt.eventTimeMillis))return null;
  const keys=KINDS.filter(k=>Object.hasOwn(rt,k));
  if(keys.length!==1||!dict(rt[keys[0]]))return null;
  const kind=keys[0];
  const note=rt[kind] as Record<string,unknown>;
  if(kind==='testNotification'){
   if(note.version!=='1.0')return null;
   return 'test' as const;
  }
  if(typeof note.purchaseToken!=='string'
   ||note.purchaseToken.length<2||note.purchaseToken.length>4096)return null;
  if(kind==='subscriptionNotification'){
   if(note.version!=='1.0'||typeof note.notificationType!=='number'
    ||!Number.isSafeInteger(note.notificationType)
    ||note.notificationType<1||note.notificationType>100)return null;
   return 'subscription' as const;
  }
  if(kind==='oneTimeProductNotification'){
   if(note.version!=='1.0'||![1,2].includes(note.notificationType as number)
    ||typeof note.sku!=='string'||note.sku.length<2||note.sku.length>180
    ||/battery|電池|sticker|貼紙|top.?up/i.test(note.sku))return null;
   return 'one_time' as const;
  }
  if(kind==='voidedPurchaseNotification'){
   if(![1,2].includes(note.productType as number)
    ||(note.refundType!==undefined&&![1,2].includes(note.refundType as number)))
    return null;
   return 'voided' as const;
  }
  return null;
 }catch{return null;}
}
export function createOfflineGoogleRtdnTransportCheck(config:Config){
 const s=config?.scope;
 if(!dict(s)||s.brand_id!=='starry'
  ||!['development','staging'].includes(s.environment as string)
  ||typeof s.app_id!=='string'||!/^starry\.[a-z0-9_.-]{2,64}$/.test(s.app_id)
  ||typeof s.package_name!=='string'||!PACKAGE.test(s.package_name)
  ||typeof s.pubsub_subscription!=='string'
  ||!/^projects\/[a-z][a-z0-9-]{3,62}\/subscriptions\/[A-Za-z0-9_-]{1,200}$/.test(s.pubsub_subscription)
  ||typeof config.audience!=='string'
  ||!/^https:\/\/[a-z0-9.-]+(?:\/[a-zA-Z0-9_/-]*)?$/.test(config.audience)
  ||typeof config.service_account_email!=='string'
  ||!SERVICE.test(config.service_account_email)
  ||typeof config.kid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(config.kid)
  ||typeof config.offlinePublicKeyPem!=='string'
  ||config.offlinePublicKeyPem.length<64
  ||config.offlinePublicKeyPem.length>8192
  ||!Number.isSafeInteger(config.nowSeconds)||config.nowSeconds<=0)
  throw Error('R23_RTDN_UNSAFE_CONFIG');
 const fixed=Object.freeze({...s});
 const expected=Object.freeze({audience:config.audience,
  email:config.service_account_email,kid:config.kid});
 let spki:Uint8Array;
 try{
  const parts=config.offlinePublicKeyPem.match(
   /^-----BEGIN PUBLIC KEY-----\s*([A-Za-z0-9+/=\s]+)\s*-----END PUBLIC KEY-----\s*$/);
  if(!parts)throw Error('SPKI_PEM_REQUIRED');
  const b64=parts[1].replace(/\s/g,'');
  spki=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
  if(spki.length<128||spki.length>4096)throw Error('SPKI_LENGTH_INVALID');
 }catch{throw Error('R23_RTDN_INVALID_OFFLINE_PUBLIC_KEY');}
 return Object.freeze({async inspect(request:unknown):Promise<R23GooglePushOutcome>{
  if(config.enabled!==true)return reason('blocked','DISABLED_UNTIL_AUTHORIZED_SANDBOX');
  try{
   if(!dict(request))return reason('blocked','INVALID_REQUEST');
   const auth=request.authorization,push=request.pushJsonText;
   if(typeof auth!=='string'||auth.length>12000
    ||!auth.startsWith('Bearer ')||auth.includes('\n')
    ||auth.includes('\r'))return reason('blocked','BEARER_MISSING_OR_INVALID');
   const token=auth.slice(7),parts=token.split('.');
   if(parts.length!==3||!parts.every(x=>typeof x==='string'&&x.length>0))
    return reason('blocked','JWT_COMPACT_FORMAT_INVALID');
   const h=jsonPart(parts[0]),c=jsonPart(parts[1]);
   const sig=fromUrlBase64(parts[2]);
   if(!h||!c||!sig||sig.length<128
    ||h.alg!=='RS256'||h.kid!==expected.kid
    ||(h.typ!==undefined&&h.typ!=='JWT')
    ||Object.keys(h).some(k=>!['alg','kid','typ'].includes(k)))
    return reason('blocked','JWT_ALGORITHM_OR_KEY_NOT_TRUSTED');
   // TS 5.9 DOM BufferSource requires ArrayBuffer-backed views.
   // Make defensive copies so SharedArrayBuffer inputs cannot reach WebCrypto.
   const trustedSpki=new Uint8Array(new ArrayBuffer(spki.byteLength));
   trustedSpki.set(spki);
   const signature=new Uint8Array(new ArrayBuffer(sig.byteLength));
   signature.set(sig);
   const key=await crypto.subtle.importKey('spki',trustedSpki,
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
   const signatureMatched=await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',key,signature,
    new TextEncoder().encode(parts[0]+'.'+parts[1]));
   if(!signatureMatched)return reason('blocked','JWT_SIGNATURE_INVALID');
   if(!['https://accounts.google.com','accounts.google.com'].includes(c.iss as string)
    ||c.aud!==expected.audience
    ||c.email!==expected.email||c.email_verified!==true
    ||typeof c.sub!=='string'||!/^[0-9]{3,64}$/.test(c.sub)
    ||typeof c.iat!=='number'||!Number.isSafeInteger(c.iat)
    ||typeof c.exp!=='number'||!Number.isSafeInteger(c.exp)
    ||c.iat>config.nowSeconds+60
    ||c.exp<=config.nowSeconds
    ||c.exp<=c.iat||c.exp-c.iat>3600)
    return reason('blocked','OIDC_CLAIMS_WRONG_OR_EXPIRED');
   const kind=readPush(push as string,fixed as Config['scope']);
   if(!kind)return reason('blocked','RTDN_PACKAGE_ENVELOPE_INVALID');
   // A valid RS256 signature against a fixture/public key does NOT prove
   // the key is actually Google-trusted or that the transaction is owned.
   // NEVER ACK Pub/Sub until an independently approved durable D1 commit.
   return reason('signature_checked_offline_only',
    'GOOGLE_JWKS_PLAY_API_AND_DURABLE_REPLAY_STILL_REQUIRED',kind);
  }catch{return reason('blocked','CRYPTO_OR_SOURCE_UNAVAILABLE');}
 }});
}
