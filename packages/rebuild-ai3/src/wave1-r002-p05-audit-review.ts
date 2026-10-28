/** AI-3 Round-002 P05 security/receipt candidate. Pure review: no live provider. */
import {assertEvent,assertScope} from './index.ts';
import type {AuditMetadata,Scope} from './index.ts';
export const AI3_R002_P05_VERSION='starry.ai3.p05-receipt.r002.v1-candidate' as const;
export const AI3_R002_LIVE=false as const;
export type R002Ports=Readonly<{
 verifySignedSource:(scope:Scope,event:AuditMetadata)=>Promise<unknown>;
 readEventAuth:(scope:Scope,event:AuditMetadata)=>Promise<unknown>;
 readDurableReceipt:(scope:Scope,event:AuditMetadata)=>Promise<unknown>;
 readLawfulRetention:(scope:Scope,event:AuditMetadata)=>Promise<unknown>;
}>;
type Reason='DISABLED'|'INVALID_SCOPE_OR_EVENT'|'UNSUPPORTED_EVENT'|
 'UNVERIFIED_ISSUER'|'INVALID_RETENTION'|'INVALID_AUTH'|'AUTH_STATE_DENIED'|
 'INVALID_RECEIPT'|'DUPLICATE_OR_UNKNOWN'|'EVIDENCE_CHANGED'|'PORT_ERROR'|
 'CANDIDATE_NOT_AUTHORIZED';
export type R002Result=Readonly<{
 contract:typeof AI3_R002_P05_VERSION;status:'blocked'|'review_only';reason:Reason;
 may_ack_queue:false;may_send:false;may_enqueue:false;may_retry:false;
 may_grant_battery:false;may_sell_battery:false;may_restore:false;
 may_purge:false;may_publish:false;live:false;
}>;
const HEX=/^[a-f0-9]{64}$/;
const REF=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const TYPES=new Set(['identity.session.revoked','identity.member.deleted',
 'notification.delivery.queued','notification.delivery.rejected',
 'security.access.denied','privacy.erasure.requested']);
const fixed=(v:unknown,keys:string[]):v is Record<string,unknown>=>{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const p=Object.getPrototypeOf(v);
  if(p!==Object.prototype&&p!==null)return false;
  const list=Reflect.ownKeys(v);
  return list.length===keys.length&&list.every(k=>typeof k==='string'&&keys.includes(k))&&
   keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return !!d&&d.enumerable&&'value' in d;});
 }catch{return false;}
};
const bound=(v:Record<string,unknown>,s:Scope,e:AuditMetadata)=>
 v.brand_id==='starry'&&v.app_id===s.app_id&&v.environment===s.environment&&
 v.event_id===e.event_id;
const pos=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>0;
function signed(v:unknown,s:Scope,e:AuditMetadata):v is Record<string,unknown>{
 return fixed(v,['brand_id','app_id','environment','event_id','idempotency_key',
  'actor_ref','event_digest','issuer_key_ref','issuer_version','signature_verified'])&&
  bound(v,s,e)&&v.idempotency_key===e.idempotency_key&&v.actor_ref===e.actor_ref&&
  v.signature_verified===true&&typeof v.event_digest==='string'&&HEX.test(v.event_digest)&&
  typeof v.issuer_key_ref==='string'&&REF.test(v.issuer_key_ref)&&pos(v.issuer_version);
}
function legal(v:unknown,s:Scope,e:AuditMetadata):v is Record<string,unknown>{
 return fixed(v,['brand_id','app_id','environment','event_id','policy_version',
  'lawful_now','erasure_hold'])&&bound(v,s,e)&&pos(v.policy_version)&&
  v.lawful_now===true&&['none','active'].includes(String(v.erasure_hold));
}
function auth(v:unknown,s:Scope,e:AuditMetadata):v is Record<string,unknown>{
 return fixed(v,['brand_id','app_id','environment','event_id','actor_ref',
  'auth_version','session_version','state'])&&bound(v,s,e)&&
  v.actor_ref===e.actor_ref&&pos(v.auth_version)&&
  Number.isSafeInteger(v.session_version)&&Number(v.session_version)>=0&&
  ['active','revoked','deleted','unknown'].includes(String(v.state));
}
function receipt(v:unknown,s:Scope,e:AuditMetadata,digest:unknown):v is Record<string,unknown>{
 return fixed(v,['brand_id','app_id','environment','event_id','idempotency_key',
  'event_digest','receipt_version','state'])&&bound(v,s,e)&&
  v.idempotency_key===e.idempotency_key&&v.event_digest===digest&&
  Number.isSafeInteger(v.receipt_version)&&Number(v.receipt_version)>=0&&
  ['missing','committed','conflict','unknown'].includes(String(v.state));
}
function output(status:R002Result['status'],reason:Reason):R002Result{
 return Object.freeze({contract:AI3_R002_P05_VERSION,status,reason,
  may_ack_queue:false,may_send:false,may_enqueue:false,may_retry:false,
  may_grant_battery:false,may_sell_battery:false,may_restore:false,
  may_purge:false,may_publish:false,live:false});
}
export function createR002P05AuditReview(config:Readonly<{
 enabled?:boolean;scope:Scope;ports:R002Ports;
}>){
 const s=config?.scope,p=config?.ports;
 if(!p||!['verifySignedSource','readEventAuth','readDurableReceipt',
  'readLawfulRetention'].every(k=>typeof p[k as keyof R002Ports]==='function'))
  throw Error('AI3_R002_PORTS_REQUIRED');
 if(!s||s.environment==='production')throw Error('AI3_R002_SCOPE_DENIED');
 try{assertScope(s,s);}catch{throw Error('AI3_R002_SCOPE_DENIED');}
 const scope:Scope=Object.freeze({brand_id:'starry',app_id:s.app_id,environment:s.environment});
 return Object.freeze({
  async review(raw:unknown):Promise<R002Result>{
   if(config.enabled!==true)return output('blocked','DISABLED');
   try{assertEvent(scope,raw);}catch{return output('blocked','INVALID_SCOPE_OR_EVENT');}
   const e=raw as AuditMetadata;
   if(!TYPES.has(e.event_type))return output('blocked','UNSUPPORTED_EVENT');
   try{
    // AI-0/4 signed source check must run before ANY private Auth/DB read.
    const a=await p.verifySignedSource(scope,e);
    if(!signed(a,scope,e))return output('blocked','UNVERIFIED_ISSUER');
    const l=await p.readLawfulRetention(scope,e);
    if(!legal(l,scope,e))return output('blocked','INVALID_RETENTION');
    if(e.event_type==='identity.member.deleted'&&l.erasure_hold!=='active')
     return output('blocked','INVALID_RETENTION');
    const b=await p.readEventAuth(scope,e);
    if(!auth(b,scope,e))return output('blocked','INVALID_AUTH');
    const targetState=e.event_type==='identity.member.deleted'?'deleted':
     e.event_type==='identity.session.revoked'?'revoked':'active';
    if(b.state!==targetState)return output('blocked','AUTH_STATE_DENIED');
    const c=await p.readDurableReceipt(scope,e);
    if(!receipt(c,scope,e,a.event_digest))return output('blocked','INVALID_RECEIPT');
    if(c.state!=='missing')return output('blocked','DUPLICATE_OR_UNKNOWN');
    // These reads cannot establish atomicity or a true anti-PITR floor.
    const a2=await p.verifySignedSource(scope,e);
    const l2=await p.readLawfulRetention(scope,e);
    const b2=await p.readEventAuth(scope,e);
    const c2=await p.readDurableReceipt(scope,e);
    const same=(v:unknown,w:unknown)=>JSON.stringify(v)===JSON.stringify(w);
    if(!signed(a2,scope,e)||!legal(l2,scope,e)||
       !auth(b2,scope,e)||!receipt(c2,scope,e,a.event_digest)||
       !same(a,a2)||!same(l,l2)||!same(b,b2)||!same(c,c2))
     return output('blocked','EVIDENCE_CHANGED');
    return output('review_only','CANDIDATE_NOT_AUTHORIZED');
   }catch{return output('blocked','PORT_ERROR');}
  }
 });
}
