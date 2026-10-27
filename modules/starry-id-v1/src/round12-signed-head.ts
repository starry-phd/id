/**
 * AI-1 R12: separate-key RS256 authentication of the R11 independent Head.
 *
 * Default OFF. This module checks cryptographic origin, scope and 30-second
 * expiration of a HEAD fetched by a trusted server-only port. It does NOT
 * create a real non-rollbackable Head store, trusted clock, signer or KMS.
 * It only supplies R11's existing readIndependentHead callback.
 */
import type {TrustedScope} from './index.ts';
import type {IndependentWitnessHead} from './round11-signed-recovery-witness.ts';

export const LIVE_AUTH_SIGNED_HEAD_ENABLED=false as const;
export type SignedAuthHeadV1=Readonly<{
 version:1;brand_id:'starry';environment:'development'|'staging';
 source:'protected_independent_head';
 sequence:number;witness_ref:string;signature_sha256:string;
 issued_at:number;expires_at:number;key_id:string;signature:string;
}>;

const FIELDS=['version','brand_id','environment','source','sequence','witness_ref',
 'signature_sha256','issued_at','expires_at','key_id','signature'] as const;
const ref=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(s);
const safe=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
function shape(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try {
  if(!x||typeof x!=='object'||Array.isArray(x))return null;
  const proto=Object.getPrototypeOf(x);
  if(proto!==Object.prototype&&proto!==null)return null;
  const own=Reflect.ownKeys(x);
  if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const d=Object.getOwnPropertyDescriptors(x);
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const item=d[k];
   if(!item||!item.enumerable||!('value' in item))return null;
   out[k]=item.value;
  }
  return out;
 }catch{return null;}
}
function decodedSignature(s:unknown):ArrayBuffer|null{
 if(typeof s!=='string'||!/^[A-Za-z0-9_-]{256,1024}$/.test(s))return null;
 try {
  const b64=s.replace(/-/g,'+').replace(/_/g,'/');
  const chars=atob(b64+'='.repeat((4-b64.length%4)%4));
  const canonical=btoa(chars).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if(canonical!==s)return null;
  const buffer=new ArrayBuffer(chars.length);
  const out=new Uint8Array(buffer);
  for(let i=0;i<chars.length;i++)out[i]=chars.charCodeAt(i);
  return buffer;
 }catch{return null;}
}
function parseHead(raw:unknown,scope:TrustedScope,key_id:string,now:number):
 {head:SignedAuthHeadV1;signature:ArrayBuffer}|null{
 const o=shape(raw,FIELDS);
 if(!o||o.version!==1||o.brand_id!=='starry'||o.environment!==scope.environment||
  o.source!=='protected_independent_head'||o.key_id!==key_id||
  !safe(o.sequence)||o.sequence===0||!ref(o.witness_ref)||
  typeof o.signature_sha256!=='string'||!/^[a-f0-9]{64}$/.test(o.signature_sha256)||
  !safe(o.issued_at)||!safe(o.expires_at)||
  o.expires_at<=o.issued_at||o.expires_at-o.issued_at>30||
  now<o.issued_at||now>=o.expires_at)return null;
 const signature=decodedSignature(o.signature);
 if(!signature)return null;
 const head:SignedAuthHeadV1=Object.freeze({
  version:1,brand_id:'starry',environment:scope.environment as 'development'|'staging',
  source:'protected_independent_head',sequence:o.sequence,
  witness_ref:o.witness_ref as string,signature_sha256:o.signature_sha256 as string,
  issued_at:o.issued_at,expires_at:o.expires_at,key_id,
  signature:o.signature as string,
 });
 return {head,signature};
}
/** This exact canonical v1 ordering must be used by the future offline signer. */
export function canonicalSignedAuthHeadV1(h:SignedAuthHeadV1):ArrayBuffer {
 const bytes=new TextEncoder().encode(JSON.stringify({
  version:1,brand_id:h.brand_id,environment:h.environment,
  source:h.source,sequence:h.sequence,witness_ref:h.witness_ref,
  signature_sha256:h.signature_sha256,issued_at:h.issued_at,
  expires_at:h.expires_at,key_id:h.key_id,
 }));
 const data=new ArrayBuffer(bytes.byteLength);
 new Uint8Array(data).set(bytes);
 return data;
}
export function createOfflineSignedAuthHeadAuthority(deps:Readonly<{
 enabled?:boolean;scope:TrustedScope;
 // Pin a DIFFERENT signer from the R11 witness signing authority.
 key_id:string;witnessSignerKeyId:string;verifyKey:CryptoKey;
 // These are trust-bearing backend composition ports, NEVER client JSON.
 readSignedHead:()=>Promise<unknown>;
 readServerTime:()=>number;
}>) {
 const scope=Object.freeze({...deps.scope});
 if(scope.brand_id!=='starry'||!ref(scope.app_id)||
   !['development','staging'].includes(scope.environment))
   throw Error('SIGNED_HEAD_SCOPE_DENIED');
 if(!ref(deps.key_id)||!ref(deps.witnessSignerKeyId)||
   deps.key_id===deps.witnessSignerKeyId)throw Error('SIGNED_HEAD_KEY_SEPARATION_DENIED');
 const key=deps.verifyKey;
 const rsa=key?.algorithm as RsaHashedKeyAlgorithm|undefined;
 if(!key||key.type!=='public'||key.extractable||
   rsa?.name!=='RSASSA-PKCS1-v1_5'||rsa.modulusLength<2048||
   rsa.hash.name!=='SHA-256'||!key.usages.includes('verify'))
   throw Error('SIGNED_HEAD_KEY_DENIED');
 const enabled=deps.enabled===true;
 return Object.freeze({
  async readIndependentHead(environment:'development'|'staging'):
   Promise<IndependentWitnessHead|null>{
   if(!enabled||environment!==scope.environment)return null;
   try{
    const now=deps.readServerTime();
    if(!safe(now))return null;
    const signed=parseHead(await deps.readSignedHead(),scope,deps.key_id,now);
    if(!signed)return null;
    // Exact SHA256 RSASSA-PKCS1-v1_5 verification using the separately pinned
    // head public key; R11 independently checks its distinct witness signature.
    const verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,
      signed.signature,canonicalSignedAuthHeadV1(signed.head));
    if(!verified)return null;
    return Object.freeze({
     sequence:signed.head.sequence,witness_ref:signed.head.witness_ref,
     signature_sha256:signed.head.signature_sha256,
    });
   }catch{return null;}
  },
 });
}
