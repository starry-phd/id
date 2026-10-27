/**
 * AI-4 R13, INTERNAL/OFFLINE-ONLY. A second RSA key authenticates the
 * independent latest Task Head, then checks it before AND after the R12
 * signed committed-task proof. NOT a real external monotone/head service.
 */
import {createOfflineSignedTaskVerifier} from './round12-signed-task-proof.ts';
import type {TaskEvidence} from './task-evidence.ts';
export const DUAL_SIGNED_TASK_HEAD_LIVE=false as const;
export const SIGNED_TASK_HEAD_VERSION=1 as const;
export const TASK_HEAD_MAX_VALIDITY_MS=30_000 as const;
export type SignedTaskHead=Readonly<{
 version:1;brand_id:'starry';environment:'development'|'staging';
 source:'independent_protected_head';
 task_ref:string;member_ref:string;sequence:number;proof_revision:number;
 signature_sha256:string;issued_ms:number;expires_ms:number;
 key_id:string;signature:string;
}>;
export type HeadBackend=Readonly<{
 readSignedTask:(taskRef:string)=>Promise<unknown>;
 /** Outside Task D1/PITR, independently authenticated and monotone in production. */
 readSignedHead:(taskRef:string)=>Promise<unknown>;
 readServerTime:()=>number;
}>;
const FIELDS=['version','brand_id','environment','source','task_ref','member_ref',
 'sequence','proof_revision','signature_sha256','issued_ms','expires_ms',
 'key_id','signature'] as const;
const PORTS=['readSignedTask','readSignedHead','readServerTime'] as const;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const int=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const ident=(v:unknown):v is string=>typeof v==='string'&&ID.test(v);
function own(v:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)return null;
  const names=Reflect.ownKeys(v);
  if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)))
   return null;
  const result:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const p=Object.getOwnPropertyDescriptor(v,k);
   if(!p||p.enumerable!==true||!('value' in p))return null;
   result[k]=p.value;
  }
  return result;
 }catch{return null;}
}
function decode(s:unknown):ArrayBuffer|null{
 if(typeof s!=='string'||!/^[A-Za-z0-9_-]{256,1024}$/.test(s))return null;
 try{
  const x=s.replace(/-/g,'+').replace(/_/g,'/');
  const chars=atob(x+'='.repeat((4-x.length%4)%4));
  const canonical=btoa(chars).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if(canonical!==s)return null;
  const buffer=new ArrayBuffer(chars.length);const bytes=new Uint8Array(buffer);
  for(let i=0;i<chars.length;i++)bytes[i]=chars.charCodeAt(i);
  return buffer;
 }catch{return null;}
}
function parsed(v:unknown,env:'development'|'staging',keyId:string,ref:string,
 now:number):SignedTaskHead|null{
 const h=own(v,FIELDS);
 if(!h||h.version!==1||h.brand_id!=='starry'||h.environment!==env||
  h.source!=='independent_protected_head'||h.key_id!==keyId||
  h.task_ref!==ref||!ident(h.member_ref)||!int(h.sequence,1)||
  !int(h.proof_revision,1)||typeof h.signature_sha256!=='string'||
  !/^[a-f0-9]{64}$/.test(h.signature_sha256)||
  !int(h.issued_ms)||!int(h.expires_ms)||
  h.expires_ms<=h.issued_ms||
  h.expires_ms-h.issued_ms>TASK_HEAD_MAX_VALIDITY_MS||
  now<h.issued_ms||now>=h.expires_ms||!decode(h.signature))return null;
 return Object.freeze({
  version:1,brand_id:'starry',environment:env,source:'independent_protected_head',
  task_ref:ref,member_ref:h.member_ref as string,sequence:h.sequence as number,
  proof_revision:h.proof_revision as number,
  signature_sha256:h.signature_sha256 as string,issued_ms:h.issued_ms as number,
  expires_ms:h.expires_ms as number,key_id:keyId,signature:h.signature as string
 });
}
/** Fixed JSON canonical signing contract, independent from Task body signature. */
export function canonicalSignedTaskHeadV1(h:SignedTaskHead):ArrayBuffer{
 const bytes=new TextEncoder().encode(JSON.stringify({
  version:1,brand_id:h.brand_id,environment:h.environment,
  source:h.source,task_ref:h.task_ref,member_ref:h.member_ref,
  sequence:h.sequence,proof_revision:h.proof_revision,
  signature_sha256:h.signature_sha256,issued_ms:h.issued_ms,
  expires_ms:h.expires_ms,key_id:h.key_id
 }));
 const b=new ArrayBuffer(bytes.byteLength);new Uint8Array(b).set(bytes);return b;
}
const keyOk=(key:CryptoKey):boolean=>{
 const a=key?.algorithm as RsaHashedKeyAlgorithm|undefined;
 return !!key&&key.type==='public'&&!key.extractable&&
  a?.name==='RSASSA-PKCS1-v1_5'&&a.modulusLength>=2048&&
  a.hash.name==='SHA-256'&&key.usages.includes('verify');
};
/**
 * Produces a trusted candidate ONLY after R12 Task signature and independently
 * signed Head both pass. Re-reads Head afterward to reject a changed sequence,
 * signature, signer or expiration before consumption. Still NOT serializable
 * with a separate AI-1/Auth or AI-3/Wallet DB commit.
 */
export function createOfflineDualSignedTaskAuthority(deps:Readonly<{
 enabled?:boolean;environment:'development'|'staging';
 taskKeyId:string;headKeyId:string;
 taskVerifyKey:CryptoKey;headVerifyKey:CryptoKey;
 backend:HeadBackend;
}>){
 if(!['development','staging'].includes(deps.environment)||
  !ident(deps.taskKeyId)||!ident(deps.headKeyId)||
  deps.taskKeyId===deps.headKeyId||
  deps.taskVerifyKey===deps.headVerifyKey)
  throw Error('AI4_R13_KEY_SCOPE_OR_SEPARATION_DENIED');
 if(!keyOk(deps.headVerifyKey)||!keyOk(deps.taskVerifyKey))
  throw Error('AI4_R13_PINNED_KEYS_REQUIRED');
 const ports=own(deps.backend,PORTS);
 if(!ports||PORTS.some(k=>typeof ports[k]!=='function'))
  throw Error('AI4_R13_SERVER_PORTS_REQUIRED');
 const enabled=deps.enabled===true;
 // Each call is only an OFFLINE verification of injected snapshots.
 const readHead=async(ref:string):Promise<SignedTaskHead|null>=>{
  const now=deps.backend.readServerTime();
  if(!int(now))return null;
  const h=parsed(await deps.backend.readSignedHead(ref),
   deps.environment,deps.headKeyId,ref,now);
  if(!h)return null;
  const signature=decode(h.signature);
  if(!signature)return null;
  if(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',
   deps.headVerifyKey,signature,canonicalSignedTaskHeadV1(h))!==true)return null;
  return h;
 };
 return Object.freeze({
  async verifyCommitted(taskRef:unknown,memberRef:unknown,now:unknown):
   Promise<TaskEvidence|null>{
   if(!enabled||!ident(taskRef)||!ident(memberRef)||!int(now))return null;
   // A per-call closure keeps parallel deliveries isolated.
   let localFirst:SignedTaskHead|null=null;
   try{
    // Fresh instance per request: avoids shared state across concurrent calls.
    const perCall=createOfflineSignedTaskVerifier({
     enabled:true,environment:deps.environment,key_id:deps.taskKeyId,
     verifyKey:deps.taskVerifyKey,
     backend:{
      readSignedTask:deps.backend.readSignedTask,
      readIndependentHead:async(ref)=>{
       const h=await readHead(ref);
       localFirst=h;
       return h?{
        task_ref:h.task_ref,member_ref:h.member_ref,sequence:h.sequence,
        proof_revision:h.proof_revision,signature_sha256:h.signature_sha256
       }:null;
      }
     }
    });
    const verified=await perCall.verifyCommitted(taskRef,memberRef,now);
    if(!verified||!localFirst)return null;
    const second=await readHead(taskRef);
    if(!second||FIELDS.some(k=>second[k]!==localFirst?.[k]))return null;
    return verified;
   }catch{return null;}
  }
 });
}
