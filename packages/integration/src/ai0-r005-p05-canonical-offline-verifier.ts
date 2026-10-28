/**
 * AI-0 Wave1 R005: real WebCrypto verification in a strictly OFFLINE
 * canonical-P05 proposal. A cryptographic match is NOT authorization.
 * No signer, issuer, key-management backend, Worker route, DB or Queue here.
 * Production is rejected; consumer-supplied booleans NEVER count as proof.
 */
export const AI0_R005_P05_VERSION =
 'starry.ai0.p05.canonical-hmac.r005.offline-proposal' as const;
export const AI0_R005_P05_LIVE = false as const;

type Scope = Readonly<{brand_id:'starry';app_id:string;
 environment:'development'|'staging'}>;
export type R005P05Event = Readonly<{
 brand_id:'starry';app_id:string;environment:'development'|'staging';
 event_id:string;
 event_type:'notification.delivery.queued'|'identity.session.revoked'|
  'identity.member.deleted'|'privacy.erasure.requested';
 actor_ref:string;idempotency_key:string;
 issuer_kid:string;issuer_epoch:number;issued_at:number;
 nonce:string;payload_sha256:string;
}>;
type Lease=Readonly<{kid:string;epoch:number;key:CryptoKey}>;
type Result=Readonly<{
 contract:typeof AI0_R005_P05_VERSION;
 status:'blocked'|'review_only';
 reason:'DISABLED'|'INVALID_ENVELOPE'|'SCOPE_DENIED'|'STALE_OR_FUTURE'|
  'KEY_UNAVAILABLE'|'KEY_ROTATED'|'SIGNATURE_INVALID'|
  'CRYPTOGRAPHIC_CANDIDATE_ONLY';
 cryptographic_candidate_match:boolean;verified_live:false;
 may_claim_authority:false;may_read_private_session:false;may_send:false;
 may_enqueue:false;may_ack_queue:false;may_write_d1:false;may_grant:false;
 may_publish:false;live:false;
}>;
const FORBIDDEN=Object.freeze({
 verified_live:false,may_claim_authority:false,
 may_read_private_session:false,may_send:false,may_enqueue:false,
 may_ack_queue:false,may_write_d1:false,may_grant:false,
 may_publish:false,live:false
} as const);
const FIELDS=Object.freeze(['brand_id','app_id','environment','event_id',
 'event_type','actor_ref','idempotency_key','issuer_kid','issuer_epoch',
 'issued_at','nonce','payload_sha256'] as const);
const EVENT_TYPES=new Set<string>(['notification.delivery.queued',
 'identity.session.revoked','identity.member.deleted','privacy.erasure.requested']);
const ID=/^[A-Za-z0-9._:-]{8,120}$/;
const APP=/^[A-Za-z0-9._:-]{3,120}$/;
const KID=/^[a-z0-9][a-z0-9._-]{2,63}$/;
const NONCE=/^[A-Za-z0-9_-]{16,64}$/;
const HEX=/^[0-9a-f]{64}$/;
const integer=(v:unknown):v is number=>typeof v==='number'&&
 Number.isSafeInteger(v)&&v>=0;
function owned(raw:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const proto=Object.getPrototypeOf(raw);
  if(proto!==Object.prototype&&proto!==null)return null;
  const own=Reflect.ownKeys(raw);
  if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))
   return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(raw,k);
   if(!d||!d.enumerable||!('value' in d))return null;
   out[k]=d.value;
  }
  return out;
 }catch{return null;}
}
function response(reason:Result['reason'],
 status:Result['status']='blocked',valid=false):Result{
 return Object.freeze({contract:AI0_R005_P05_VERSION,status,reason,
  cryptographic_candidate_match:valid,...FORBIDDEN});
}
function eventOf(raw:unknown,scope:Scope):R005P05Event|null{
 const e=owned(raw,FIELDS);
 if(!e||e.brand_id!=='starry'||e.app_id!==scope.app_id||
  e.environment!==scope.environment||
  typeof e.event_id!=='string'||!ID.test(e.event_id)||
  typeof e.actor_ref!=='string'||!ID.test(e.actor_ref)||
  typeof e.idempotency_key!=='string'||!ID.test(e.idempotency_key)||
  typeof e.event_type!=='string'||!EVENT_TYPES.has(e.event_type)||
  typeof e.issuer_kid!=='string'||!KID.test(e.issuer_kid)||
  !integer(e.issuer_epoch)||e.issuer_epoch===0||
  !integer(e.issued_at)||
  typeof e.nonce!=='string'||!NONCE.test(e.nonce)||
  typeof e.payload_sha256!=='string'||!HEX.test(e.payload_sha256))return null;
 return Object.freeze(e) as unknown as R005P05Event;
}
function active(lease:Lease|null,e:R005P05Event):lease is Lease{
 if(!lease||lease.kid!==e.issuer_kid||lease.epoch!==e.issuer_epoch)
  return false;
 const key=lease.key;
 return !!key&&key.type==='secret'&&!key.extractable&&
  key.algorithm.name==='HMAC'&&
  (key.algorithm as HmacKeyAlgorithm).hash.name==='SHA-256'&&
  key.usages.includes('verify');
}
/** Canonical JSON array and explicit domain separation, not object key order. */
function canonical(e:R005P05Event):ArrayBuffer{
 const bytes=new TextEncoder().encode(JSON.stringify([
  AI0_R005_P05_VERSION,
  e.brand_id,e.app_id,e.environment,e.event_id,e.event_type,
  e.actor_ref,e.idempotency_key,e.issuer_kid,e.issuer_epoch,
  e.issued_at,e.nonce,e.payload_sha256
 ]));
 const buffer=new ArrayBuffer(bytes.length);
 new Uint8Array(buffer).set(bytes);
 return buffer;
}
export function createOfflineR005P05CanonicalVerifier(deps:Readonly<{
 enabled?:boolean;scope:Scope;
 nowSeconds:()=>number;
 /** Only an injected isolated server-side non-exportable HMAC key lease. */
 readVerificationKey:(kid:string)=>Promise<Lease|null>;
}>){
 const s=deps?.scope;
 if(!s||s.brand_id!=='starry'||typeof s.app_id!=='string'||
  !APP.test(s.app_id)||
  (s.environment!=='development'&&s.environment!=='staging')||
  typeof deps.nowSeconds!=='function'||
  typeof deps.readVerificationKey!=='function')
  throw Error('R005_ONLY_STARRY_NON_PRODUCTION_OFFLINE_SCOPE');
 const scope:Object=Object.freeze({...s});
 return Object.freeze({
  contract:AI0_R005_P05_VERSION,
  async review(raw:unknown):Promise<Result>{
   if(deps.enabled!==true)return response('DISABLED');
   const r=owned(raw,['event','signature_hex']);
   if(!r||typeof r.signature_hex!=='string'||!HEX.test(r.signature_hex))
    return response('INVALID_ENVELOPE');
   const e=eventOf(r.event,scope as Scope);
   if(!e)return response('SCOPE_DENIED');
   const now=deps.nowSeconds();
   if(!integer(now)||e.issued_at>now+5||now-e.issued_at>120)
    return response('STALE_OR_FUTURE');
   try{
    const lease=await deps.readVerificationKey(e.issuer_kid);
    if(!active(lease,e))return response('KEY_UNAVAILABLE');
    const bytes=new Uint8Array(new ArrayBuffer(32));
    for(let i=0;i<32;i++)bytes[i]=Number.parseInt(r.signature_hex.slice(i*2,i*2+2),16);
    const valid=await crypto.subtle.verify('HMAC',lease.key,bytes.buffer,canonical(e));
    if(!valid)return response('SIGNATURE_INVALID');
    const again=await deps.readVerificationKey(e.issuer_kid);
    if(!active(again,e)||again.key!==lease.key)
     return response('KEY_ROTATED');
    // Valid synthetic signature is only review evidence, never a trust grant.
    return response('CRYPTOGRAPHIC_CANDIDATE_ONLY','review_only',true);
   }catch{return response('KEY_UNAVAILABLE');}
  }
 });
}
