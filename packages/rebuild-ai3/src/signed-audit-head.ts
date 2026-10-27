/**
 * AI-3 R13 Q115/Q116: second independent RS256 signature + protected floor
 * for the existing R12 signed audit witness. OFFLINE-only; no true
 * monotonic storage, key custody, recovery or live D1/Queue binding.
 */
import {createOfflineSignedAuditRecovery} from './signed-audit-recovery.ts';
import type {AuditScope,ReadOnlyAuditDB,AuditPorts,AuditDecision,WitnessHead} from './signed-audit-recovery.ts';

export const LIVE_DUAL_SIGNED_AUDIT_HEAD_ENABLED=false as const;
export const AUDIT_HEAD_MAY_RESTORE=false as const;
export const SIGNED_AUDIT_HEAD_SCHEMA='starry.audit.protected-head.v1' as const;
export type SignedAuditHead=Readonly<{
 version:1;brand_id:'starry';environment:'development'|'staging';
 source:'protected_independent_audit_head';sequence:number;
 witness_ref:string;signature_sha256:string;epoch:number;
 issued_ms:number;expires_ms:number;key_id:string;signature:string;
}>;
export type ProtectedAuditFloor=Readonly<{
 environment:'development'|'staging';source:'independent_nonrollbackable_floor';
 sequence:number;epoch:number;witness_ref:string;
 head_signature_sha256:string;observed_ms:number;
}>;
export type AuditHeadPorts=Readonly<{
 readSignedHead:()=>Promise<unknown>;
 // A separately trusted, CURRENT monotonic source OUTSIDE the audited D1,
 // PITR, backup and signer infrastructure. No real service exists yet.
 readProtectedFloor:()=>Promise<unknown>;
}>;
const KEYS=['version','brand_id','environment','source','sequence','witness_ref',
 'signature_sha256','epoch','issued_ms','expires_ms','key_id','signature'] as const;
const FLOOR=['environment','source','sequence','epoch','witness_ref',
 'head_signature_sha256','observed_ms'] as const;
const REF=/^[a-z][A-Za-z0-9._:-]{3,95}$/;
const HEX=/^[a-f0-9]{64}$/;
const safe=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
function exact(v:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(v===null||typeof v!=='object'||Array.isArray(v))return null;
  const p=Object.getPrototypeOf(v);
  if(p!==Object.prototype&&p!==null)return null;
  const own=Reflect.ownKeys(v);
  if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(v,k);
   if(!d||!d.enumerable||!('value' in d))return null;
   out[k]=d.value;
  }
  return out;
 }catch{return null;}
}
function signatureBytes(v:unknown):ArrayBuffer|null{
 if(typeof v!=='string'||!/^[A-Za-z0-9_-]{256,1024}$/.test(v))return null;
 try{
  const s=v.replace(/-/g,'+').replace(/_/g,'/');
  const decoded=atob(s+'='.repeat((4-s.length%4)%4));
  const canonical=btoa(decoded).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if(canonical!==v)return null;
  const buf=new ArrayBuffer(decoded.length);
  const out=new Uint8Array(buf);
  for(let i=0;i<decoded.length;i++)out[i]=decoded.charCodeAt(i);
  return buf;
 }catch{return null;}
}
/** This exact byte encoding MUST be shared with the offline head signer. */
export function canonicalSignedAuditHeadV1(h:SignedAuditHead):ArrayBuffer{
 const bytes=new TextEncoder().encode(JSON.stringify([
  SIGNED_AUDIT_HEAD_SCHEMA,h.version,h.brand_id,h.environment,h.source,
  h.sequence,h.witness_ref,h.signature_sha256,h.epoch,h.issued_ms,
  h.expires_ms,h.key_id
 ]));
 const out=new ArrayBuffer(bytes.byteLength);
 new Uint8Array(out).set(bytes);
 return out;
}
function parseHead(v:unknown,s:AuditScope,key_id:string,now:number):
 Readonly<{head:SignedAuditHead;signature:ArrayBuffer}>|null{
 const h=exact(v,KEYS);
 if(!h||h.version!==1||h.brand_id!=='starry'||h.environment!==s.environment||
  h.source!=='protected_independent_audit_head'||!safe(h.sequence)||h.sequence===0||
  !safe(h.epoch)||h.epoch===0||
  typeof h.witness_ref!=='string'||!REF.test(h.witness_ref)||
  typeof h.signature_sha256!=='string'||!HEX.test(h.signature_sha256)||
  h.key_id!==key_id||!safe(h.issued_ms)||!safe(h.expires_ms)||
  h.expires_ms<=h.issued_ms||h.expires_ms-h.issued_ms>30000||
  now<h.issued_ms||now>=h.expires_ms)return null;
 const sig=signatureBytes(h.signature);
 if(!sig)return null;
 return {head:Object.freeze({
  version:1,brand_id:'starry',environment:s.environment,
  source:'protected_independent_audit_head',sequence:h.sequence,
  witness_ref:h.witness_ref,signature_sha256:h.signature_sha256,
  epoch:h.epoch,issued_ms:h.issued_ms,expires_ms:h.expires_ms,
  key_id,signature:h.signature as string
 }) as SignedAuditHead,signature:sig};
}
function validFloor(v:unknown,s:AuditScope,now:number):ProtectedAuditFloor|null{
 const f=exact(v,FLOOR);
 if(!f||f.environment!==s.environment||f.source!=='independent_nonrollbackable_floor'||
  !safe(f.sequence)||f.sequence===0||!safe(f.epoch)||f.epoch===0||
  typeof f.witness_ref!=='string'||!REF.test(f.witness_ref)||
  typeof f.head_signature_sha256!=='string'||!HEX.test(f.head_signature_sha256)||
  !safe(f.observed_ms)||f.observed_ms>now||now-f.observed_ms>30000)return null;
 return Object.freeze(f) as unknown as ProtectedAuditFloor;
}
async function sha(v:ArrayBuffer):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',v);
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export type DualSignedAuditPorts=Readonly<{
 db:ReadOnlyAuditDB;
 audit:AuditPorts;
 head:AuditHeadPorts;
}>;
/**
 * R12 privacy/legal checks FIRST, then existing witness RS256 and event chain;
 * this wrapped independent-Head read authenticates a SECOND signer.
 * Re-check the signed Head + protected floor immediately before durable review,
 * so a head advance during audit review fails closed (never writes a receipt).
 */
export function createOfflineDualSignedAuditReview(deps:Readonly<{
 enabled?:boolean;scope:AuditScope;witness_key_id:string;head_key_id:string;
 witnessVerifyKey:Parameters<typeof crypto.subtle.verify>[1];
 headVerifyKey:Parameters<typeof crypto.subtle.verify>[1];
 ports:DualSignedAuditPorts;
}>){
 const scope=exact(deps?.scope,['brand_id','environment']);
 if(!scope||scope.brand_id!=='starry'||
  (scope.environment!=='development'&&scope.environment!=='staging'))
  throw Error('AI3_DUAL_AUDIT_SCOPE_DENIED');
 if(typeof deps.witness_key_id!=='string'||!REF.test(deps.witness_key_id)||
  typeof deps.head_key_id!=='string'||!REF.test(deps.head_key_id)||
  deps.witness_key_id===deps.head_key_id||
  deps.witnessVerifyKey===deps.headVerifyKey)
  throw Error('AI3_DUAL_AUDIT_SEPARATE_KEYS_REQUIRED');
 const key=deps.headVerifyKey;
 const alg=key?.algorithm as {name:string;modulusLength:number;hash:{name:string}}|undefined;
 if(!key||key.type!=='public'||key.extractable||
  alg?.name!=='RSASSA-PKCS1-v1_5'||alg.modulusLength<2048||
  alg.hash.name!=='SHA-256'||!key.usages.includes('verify'))
  throw Error('AI3_DUAL_AUDIT_HEAD_KEY_DENIED');
 const p=deps.ports;
 if(!p||typeof p.head?.readSignedHead!=='function'||
  typeof p.head.readProtectedFloor!=='function'||
  typeof p.audit?.recordDurableReview!=='function')
  throw Error('AI3_DUAL_AUDIT_PORTS_DENIED');
 const s:AuditScope=Object.freeze({
  brand_id:'starry',environment:scope.environment as AuditScope['environment']
 });
 return Object.freeze({
  async review(now:number):Promise<AuditDecision>{
   // Keep each review's first head proof local, even if concurrent calls occur.
   let first:Readonly<{head:WitnessHead;epoch:number;signature:string}>|null=null;
   const checkHead=async()=>{
    const v=parseHead(await p.head.readSignedHead(),s,deps.head_key_id,now);
    if(!v||await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,v.signature,
      canonicalSignedAuditHeadV1(v.head))!==true)return null;
    const floor=validFloor(await p.head.readProtectedFloor(),s,now);
    if(!floor||floor.sequence!==v.head.sequence||floor.epoch!==v.head.epoch||
     floor.witness_ref!==v.head.witness_ref||
     floor.head_signature_sha256!==await sha(v.signature))return null;
    return Object.freeze({
     head:Object.freeze({sequence:v.head.sequence,witness_ref:v.head.witness_ref,
      signature_sha256:v.head.signature_sha256}),epoch:v.head.epoch,
     signature:floor.head_signature_sha256
    });
   };
   try{
    const auditPorts:AuditPorts={
     ...p.audit,
     readIndependentHead:async()=>{
      first=await checkHead();
      return first?.head??null;
     },
     recordDurableReview:async(ref,digest)=>{
      if(!first)return false;
      const latest=await checkHead();
      if(!latest||latest.epoch!==first.epoch||latest.signature!==first.signature||
       latest.head.sequence!==first.head.sequence||
       latest.head.witness_ref!==first.head.witness_ref||
       latest.head.signature_sha256!==first.head.signature_sha256)return false;
      return p.audit.recordDurableReview(ref,digest);
     }
    };
    const r12=createOfflineSignedAuditRecovery({
     enabled:deps.enabled===true,scope:s,
     key_id:deps.witness_key_id,verifyKey:deps.witnessVerifyKey,
     db:p.db,ports:auditPorts
    });
    return await r12.review(now);
   }catch{
    return Object.freeze({disposition:'blocked',reason:'DUAL_AUDIT_HEAD_AUTHORITY_UNAVAILABLE',
     audit_events:null,head_digest:null,may_restore:false});
   }
  }
 });
}
