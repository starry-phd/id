/**
 * AI-4 R12: OFFLINE-only verifier for actually signed committed AI task facts.
 * No real Task issuer, independent nonrollbackable anchor, Cloudflare Secrets,
 * Auth Session or live Worker route is connected. Signing keys stay server-only.
 */
import {TASK_EVIDENCE_SCHEMA} from './task-evidence.ts';
import type {TaskEvidence} from './task-evidence.ts';
export const SIGNED_TASK_PROOF_LIVE=false as const;
export const SIGNED_TASK_VERSION=1 as const;
export const SIGNED_TASK_MAX_AGE_MS=30_000 as const;
export type SignedTaskEnvelope=Readonly<{
 version:1;brand_id:'starry';environment:'development'|'staging';
 task:TaskEvidence;sequence:number;issued_ms:number;key_id:string;signature:string;
}>;
export type TaskProofAnchor=Readonly<{
 task_ref:string;member_ref:string;sequence:number;
 proof_revision:number;signature_sha256:string;
}>;
export type SignedTaskBackend=Readonly<{
 readSignedTask:(ref:string)=>Promise<unknown>;
 /** Must be independently authenticated and protected outside Task D1/PITR. */
 readIndependentHead:(ref:string)=>Promise<unknown>;
}>;
const TASK=['schema_version','brand_id','member_ref','task_ref','app_id',
 'task_type','policy_version','rate_version','price','request_state',
 'proof_state','proof_source','proof_revision','completed_at'] as const;
const ENVELOPE=['version','brand_id','environment','task','sequence',
 'issued_ms','key_id','signature'] as const;
const HEAD=['task_ref','member_ref','sequence','proof_revision','signature_sha256'] as const;
const BACKEND=['readSignedTask','readIndependentHead'] as const;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const safe=(x:unknown,min=0):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=min;
const ident=(x:unknown):x is string=>typeof x==='string'&&ID.test(x);
function exact(v:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)return null;
  const all=Reflect.ownKeys(v);
  if(all.length!==keys.length||all.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const p=Object.getOwnPropertyDescriptor(v,k);
   if(!p||p.enumerable!==true||!Object.prototype.hasOwnProperty.call(p,'value'))return null;
   out[k]=p.value;
  }
  return out;
 }catch{return null;}
}
function normalizeTask(v:unknown):TaskEvidence|null{
 const t=exact(v,TASK);
 if(!t||t.schema_version!==TASK_EVIDENCE_SCHEMA||t.brand_id!=='starry'||
  !ident(t.member_ref)||!ident(t.task_ref)||!ident(t.app_id)||!ident(t.task_type)||
  !safe(t.policy_version,1)||!safe(t.rate_version,1)||!safe(t.price,1)||
  !safe(t.proof_revision,1)||!safe(t.completed_at)||
  t.proof_state!=='committed'||t.proof_source!=='server_task_engine'||
  !['succeeded','failed'].includes(String(t.request_state)))return null;
 return Object.freeze({...t}) as TaskEvidence;
}
function decodeSignature(v:unknown):Uint8Array|null{
 if(typeof v!=='string'||!/^[A-Za-z0-9_-]{256,1024}$/.test(v))return null;
 try{
  const b64=v.replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(b64+'='.repeat((4-b64.length%4)%4));
  if(btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')!==v)
   return null;
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
 }catch{return null;}
}
/** Stable versioned bytes, NO signature inside the signed body. */
export function canonicalTaskProofV1(e:SignedTaskEnvelope):ArrayBuffer{
 const t=e.task;
 const bytes=new TextEncoder().encode(JSON.stringify({
  version:1,brand_id:'starry',environment:e.environment,
  task:{
   schema_version:TASK_EVIDENCE_SCHEMA,brand_id:'starry',member_ref:t.member_ref,
   task_ref:t.task_ref,app_id:t.app_id,task_type:t.task_type,
   policy_version:t.policy_version,rate_version:t.rate_version,price:t.price,
   request_state:t.request_state,proof_state:'committed',
   proof_source:'server_task_engine',proof_revision:t.proof_revision,
   completed_at:t.completed_at
  },
  sequence:e.sequence,issued_ms:e.issued_ms,key_id:e.key_id
 }));
 const buffer=new ArrayBuffer(bytes.byteLength);new Uint8Array(buffer).set(bytes);
 return buffer;
}
function parsed(v:unknown,scope:'development'|'staging',ref:string,
 keyId:string,now:number):Readonly<{envelope:SignedTaskEnvelope;signature:Uint8Array}>|null {
 const e=exact(v,ENVELOPE);
 if(!e||e.version!==1||e.brand_id!=='starry'||e.environment!==scope||
  !safe(e.sequence,1)||!safe(e.issued_ms)||e.issued_ms>now||
  now-e.issued_ms>SIGNED_TASK_MAX_AGE_MS||e.key_id!==keyId)return null;
 const task=normalizeTask(e.task);
 const sig=decodeSignature(e.signature);
 if(!task||task.task_ref!==ref||!sig)return null;
 return {envelope:Object.freeze({
  version:1,brand_id:'starry',environment:scope,task,
  sequence:e.sequence as number,issued_ms:e.issued_ms as number,
  key_id:keyId,signature:e.signature as string
 }),signature:sig};
}
/**
 * Only server-side verification against official Task issuer and independently
 * protected latest signed-head is meaningful. The injected backend remains
 * MOCK-ONLY for R12, so this MUST NOT be used for a live Battery grant/Queue ACK.
 */
export function createOfflineSignedTaskVerifier(deps:Readonly<{
 environment:'development'|'staging';key_id:string;verifyKey:CryptoKey;
 backend:SignedTaskBackend;enabled?:boolean;
}>){
 if(!['development','staging'].includes(deps.environment)||!ident(deps.key_id))
  throw Error('AI4_SIGNED_TASK_SCOPE_DENIED');
 const k=deps.verifyKey;
 const alg=k?.algorithm as RsaHashedKeyAlgorithm|undefined;
 if(!k||k.type!=='public'||k.extractable||alg?.name!=='RSASSA-PKCS1-v1_5'||
  alg.modulusLength<2048||alg.hash.name!=='SHA-256'||!k.usages.includes('verify'))
  throw Error('AI4_SIGNED_TASK_PINNED_KEY_REQUIRED');
 const b=exact(deps.backend,BACKEND);
 if(!b||BACKEND.some(field=>typeof b[field]!=='function'))
  throw Error('AI4_SIGNED_TASK_BACKEND_REQUIRED');
 const enabled=deps.enabled===true;
 return Object.freeze({
  async verifyCommitted(taskRef:unknown,memberRef:unknown,now:unknown):
   Promise<TaskEvidence|null>{
   if(!enabled||!ident(taskRef)||!ident(memberRef)||!safe(now))return null;
   try{
    const p=parsed(await deps.backend.readSignedTask(taskRef),
     deps.environment,taskRef,deps.key_id,now);
    if(!p||p.envelope.task.member_ref!==memberRef)return null;
    const sig=new ArrayBuffer(p.signature.byteLength);
    new Uint8Array(sig).set(p.signature);
    const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',
     k,sig,canonicalTaskProofV1(p.envelope));
    if(!valid)return null;
    // A signed OLD task revision is not current if the external head advanced.
    const h=exact(await deps.backend.readIndependentHead(taskRef),HEAD);
    if(!h||h.task_ref!==taskRef||h.member_ref!==memberRef||
     !safe(h.sequence,1)||h.sequence!==p.envelope.sequence||
     !safe(h.proof_revision,1)||
     h.proof_revision!==p.envelope.task.proof_revision||
     typeof h.signature_sha256!=='string'||!/^[a-f0-9]{64}$/.test(h.signature_sha256))
     return null;
    const hashed=await crypto.subtle.digest('SHA-256',sig);
    const hex=Array.from(new Uint8Array(hashed),
     x=>x.toString(16).padStart(2,'0')).join('');
    return hex===h.signature_sha256?p.envelope.task:null;
   }catch{return null;}
  }
 });
}
