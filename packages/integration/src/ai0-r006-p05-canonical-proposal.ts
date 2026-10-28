/**
 * AI-0 Wave1 Round-006: one strictly OFFLINE vNext canonical P05 envelope.
 * Source of protocol syntax only. NOT a signer, issuer, key custody, Auth
 * session authority, D1/Queue ledger, or permission to send/ACK/release.
 */
export const AI0_R006_P05_VERSION =
 'starry.p05.canonical.vnext.offline-candidate' as const;
export const AI0_R006_P05_PURPOSE = 'p05_delivery_review_only' as const;
export const AI0_R006_HMAC_DOMAIN =
 'starry.ai0.p05.canonical.vnext.offline:hmac-sha256:v1' as const;
export const AI0_R006_LIVE=false as const;
export const AI0_R006_FIELDS=Object.freeze([
 'version','purpose','brand_id','app_id','environment','event_id','event_type',
 'actor_ref','auth_version','session_version','idempotency_key','issuer_kid',
 'issuer_epoch','issued_at','expires_at','nonce','payload_sha256'
] as const);
type Env='development'|'staging';
type Scope=Readonly<{brand_id:'starry';app_id:string;environment:Env}>;
type EventType='notification.delivery.queued'|'identity.session.revoked'|
 'identity.member.deleted'|'privacy.erasure.requested';
export type CandidateEnvelope=Readonly<{
 version:typeof AI0_R006_P05_VERSION;purpose:typeof AI0_R006_P05_PURPOSE;
 brand_id:'starry';app_id:string;environment:Env;
 event_id:string;event_type:EventType;actor_ref:string;
 auth_version:number;session_version:number;idempotency_key:string;
 issuer_kid:string;issuer_epoch:number;issued_at:number;expires_at:number;
 nonce:string;payload_sha256:string;
}>;
type Lease=Readonly<{kid:string;epoch:number;key:CryptoKey}>;
type Reason='DISABLED'|'INVALID_WRAPPER'|'INVALID_ENVELOPE'|'SCOPE_DENIED'|
 'TIME_WINDOW_DENIED'|'REPLAY_OR_CAPACITY_DENIED'|'KEY_UNAVAILABLE'|
 'SIGNATURE_DENIED'|'KEY_CHANGED'|'CRYPTO_ONLY_NOT_AUTHORITY';
export type Review=Readonly<{
 contract:typeof AI0_R006_P05_VERSION;status:'blocked'|'review_only';
 reason:Reason;cryptographic_candidate_match:boolean;
 verified_live:false;may_authorize_actor:false;may_grant:false;
 may_read_d1:false;may_write_d1:false;may_send:false;may_enqueue:false;
 may_ack_queue:false;may_create_notification:false;may_publish:false;
 may_charge:false;may_request_ads:false;live:false;
}>;
const SAFE=Object.freeze({verified_live:false,may_authorize_actor:false,
 may_grant:false,may_read_d1:false,may_write_d1:false,may_send:false,
 may_enqueue:false,may_ack_queue:false,may_create_notification:false,
 may_publish:false,may_charge:false,may_request_ads:false,live:false
} as const);
const eventTypes=new Set<string>(['notification.delivery.queued',
 'identity.session.revoked','identity.member.deleted','privacy.erasure.requested']);
const IDENT=/^[A-Za-z0-9._:-]{8,128}$/;
const APP=/^[A-Za-z0-9._:-]{3,100}$/;
const KID=/^[a-z0-9][a-z0-9._-]{2,63}$/;
const NONCE=/^[A-Za-z0-9_-]{16,64}$/;
const HEX=/^[a-f0-9]{64}$/;
const int=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
function exact(x:unknown,fields:readonly string[]):Record<string,unknown>|null{
 try{
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const proto=Object.getPrototypeOf(x);
  if(proto!==Object.prototype&&proto!==null)return null;
  const keys=Reflect.ownKeys(x);
  if(keys.length!==fields.length||
     keys.some(k=>typeof k!=='string'||!fields.includes(k)))return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const f of fields){
   const d=Object.getOwnPropertyDescriptor(x,f);
   if(!d?.enumerable||!('value' in d))return null;
   out[f]=d.value;
  }
  return out;
 }catch{return null;}
}
function response(reason:Reason,status:Review['status']='blocked',
 match=false):Review{
 return Object.freeze({contract:AI0_R006_P05_VERSION,status,reason,
  cryptographic_candidate_match:match,...SAFE});
}
function validEnvelope(e:Record<string,unknown>,s:Scope):e is CandidateEnvelope&Record<string,unknown>{
 return e.version===AI0_R006_P05_VERSION&&e.purpose===AI0_R006_P05_PURPOSE&&
 e.brand_id==='starry'&&e.app_id===s.app_id&&e.environment===s.environment&&
 typeof e.event_id==='string'&&IDENT.test(e.event_id)&&
 typeof e.event_type==='string'&&eventTypes.has(e.event_type)&&
 typeof e.actor_ref==='string'&&IDENT.test(e.actor_ref)&&
 int(e.auth_version)&&e.auth_version>0&&
 int(e.session_version)&&e.session_version>=0&&
 typeof e.idempotency_key==='string'&&IDENT.test(e.idempotency_key)&&
 typeof e.issuer_kid==='string'&&KID.test(e.issuer_kid)&&
 int(e.issuer_epoch)&&e.issuer_epoch>0&&
 int(e.issued_at)&&e.issued_at>0&&int(e.expires_at)&&
 e.expires_at>e.issued_at&&e.expires_at-e.issued_at<=120&&
 typeof e.nonce==='string'&&NONCE.test(e.nonce)&&
 typeof e.payload_sha256==='string'&&HEX.test(e.payload_sha256);
}
/** Returns only deterministic bytes for independent fake-fixture tests.
 * Never signs or constructs a trusted identity/event proof.
 */
export function r006CanonicalBytes(raw:unknown):ArrayBuffer|null{
 const e=exact(raw,AI0_R006_FIELDS);
 if(!e||e.version!==AI0_R006_P05_VERSION||
  e.purpose!==AI0_R006_P05_PURPOSE)return null;
 for(const f of AI0_R006_FIELDS)
  if(!['string','number'].includes(typeof e[f]))return null;
 const bytes=new TextEncoder().encode(JSON.stringify([
  AI0_R006_HMAC_DOMAIN,...AI0_R006_FIELDS.map(f=>e[f])
 ]));
 const a=new Uint8Array(new ArrayBuffer(bytes.byteLength));a.set(bytes);
 return a.buffer;
}
function leaseOk(x:Lease|null,e:CandidateEnvelope):x is Lease{
 try{
  return !!x&&x.kid===e.issuer_kid&&x.epoch===e.issuer_epoch&&
   x.key?.type==='secret'&&x.key.extractable===false&&
   x.key.algorithm?.name==='HMAC'&&
   (x.key.algorithm as HmacKeyAlgorithm).hash.name==='SHA-256'&&
   x.key.usages.includes('verify');
 }catch{return false;}
}
function fromHex(hex:string):ArrayBuffer{
 const b=new Uint8Array(new ArrayBuffer(32));
 for(let i=0;i<32;i++)b[i]=Number.parseInt(hex.slice(i*2,i*2+2),16);
 return b.buffer;
}
export function createOfflineR006P05Verifier(deps:Readonly<{
 enabled?:boolean;scope:Scope;nowSeconds:()=>number;
 readCurrentVerificationKey:(kid:string)=>Promise<Lease|null>;
}>){
 const s=deps?.scope;
 if(!s||s.brand_id!=='starry'||!APP.test(s.app_id)||
  (s.environment!=='development'&&s.environment!=='staging')||
  typeof deps.nowSeconds!=='function'||
  typeof deps.readCurrentVerificationKey!=='function')
  throw Error('R006_ONLY_OFFLINE_STARRY_SCOPE');
 const scope=Object.freeze({...s});
 const consumed=new Set<string>(); // in-process test-only; NOT durable replay ledger.
 const inFlight=new Set<string>(); // ephemeral per-instance reservations; NOT cross-Worker/D1.
 return Object.freeze({
  contract:AI0_R006_P05_VERSION,
  async review(raw:unknown):Promise<Review>{
   if(deps.enabled!==true)return response('DISABLED');
   const wrap=exact(raw,['envelope','mac_hex']);
   if(!wrap||typeof wrap.mac_hex!=='string'||!HEX.test(wrap.mac_hex))
    return response('INVALID_WRAPPER');
   const e=exact(wrap.envelope,AI0_R006_FIELDS);
   if(!e)return response('INVALID_ENVELOPE');
   if(!validEnvelope(e,scope))return response('SCOPE_DENIED');
   const now=deps.nowSeconds();
   if(!int(now)||e.issued_at>now+5||e.expires_at<=now||
    now-e.issued_at>120)return response('TIME_WINDOW_DENIED');
   const replayKey=[scope.app_id,scope.environment,e.event_id,
    e.idempotency_key,e.nonce].join('\u0000');
   // Reserve synchronously BEFORE any async key/crypto boundary. In-memory only.
   if(consumed.has(replayKey)||inFlight.has(replayKey)||
      consumed.size+inFlight.size>=128)
    return response('REPLAY_OR_CAPACITY_DENIED');
   inFlight.add(replayKey);
   try{
    const key1=await deps.readCurrentVerificationKey(e.issuer_kid);
    if(!leaseOk(key1,e))return response('KEY_UNAVAILABLE');
    const bytes=r006CanonicalBytes(e);
    if(!bytes)return response('INVALID_ENVELOPE');
    const good=await crypto.subtle.verify('HMAC',key1.key,
     fromHex(wrap.mac_hex),bytes);
    if(!good)return response('SIGNATURE_DENIED');
    const key2=await deps.readCurrentVerificationKey(e.issuer_kid);
    if(!leaseOk(key2,e)||key1.key!==key2.key)
     return response('KEY_CHANGED');
    // This mark is only local. NEVER use as durable idempotent/Queue evidence.
    consumed.add(replayKey);
    return response('CRYPTO_ONLY_NOT_AUTHORITY','review_only',true);
   }catch{return response('KEY_UNAVAILABLE');}
   finally{inFlight.delete(replayKey);}
  }
 });
}
