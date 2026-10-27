/**
 * AI-2 R12: OFFLINE ONLY: real RS256 signed Billing outbox witness verifier.
 * Deliberately no signer, network, Store calls, entitlement grant or restore.
 * A protected latest-head authority must NOT come from the D1/PITR being read.
 */
import type {BillingScope,BillingWitness} from './recovery-outbox-fence.ts';
export const BILLING_SIGNED_WITNESS_LIVE_ENABLED=false as const;
export type SignedBillingWitness=Readonly<BillingWitness&{
 version:1;key_id:string;signature:string;
}>;
export type ProtectedBillingHead=Readonly<{
 sequence:number;witness_ref:string;signature_sha256:string;
}>;
export type IndependentBillingBackend=Readonly<{
 readSignedEnvelope:(ref:string)=>Promise<unknown>;
 readIndependentHead:(env:'development'|'staging')=>Promise<unknown>;
 /** Separate real authority, NOT read from restored D1 or unsigned HTTP. */
 verifyProtectedHead:(head:ProtectedBillingHead)=>Promise<boolean>;
}>;
const PAYLOAD_KEYS=['version','brand_id','environment','source','witness_ref',
 'observed_at_sec','sequence','head_digest','key_id','signature'] as const;
const WITNESS_KEYS=['brand_id','environment','source','witness_ref',
 'observed_at_sec','sequence','head_digest'] as const;
const HEAD_KEYS=['sequence','witness_ref','signature_sha256'] as const;
const REF=/^r_[a-f0-9]{64}$/,HEX=/^[a-f0-9]{64}$/;
const KID=/^[A-Za-z0-9._:-]{1,96}$/;
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function values(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(x===null||typeof x!=='object'||Array.isArray(x))return null;
  const proto=Object.getPrototypeOf(x);
  if(proto!==Object.prototype&&proto!==null)return null;
  if(Reflect.ownKeys(x).length!==keys.length)return null;
  const d=Object.getOwnPropertyDescriptors(x);
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   if(!Object.hasOwn(d,k)||!d[k].enumerable||!('value' in d[k]))return null;
   out[k]=d[k].value;
  }
  return out;
 }catch{return null;}
}
function witnessValues(value:unknown,scope:BillingScope):BillingWitness|null{
 const w=values(value,WITNESS_KEYS);
 if(!w||w.brand_id!=='starry'||w.environment!==scope.environment
  ||w.source!=='independent_append_only'||typeof w.witness_ref!=='string'
  ||!REF.test(w.witness_ref)||!integer(w.observed_at_sec)
  ||!integer(w.sequence)||typeof w.head_digest!=='string'
  ||!HEX.test(w.head_digest)
  ||(w.sequence===0&&w.head_digest!=='0'.repeat(64)))return null;
 return Object.freeze({
  brand_id:'starry',environment:scope.environment,
  source:'independent_append_only',witness_ref:w.witness_ref,
  observed_at_sec:w.observed_at_sec,sequence:w.sequence,head_digest:w.head_digest,
 });
}
function decodeCanonicalSignature(v:unknown):ArrayBuffer|null{
 if(typeof v!=='string'||!/^[A-Za-z0-9_-]{256,1024}$/.test(v))return null;
 try{
  const norm=v.replace(/-/g,'+').replace(/_/g,'/');
  const decoded=atob(norm+'='.repeat((4-norm.length%4)%4));
  const recoded=btoa(decoded).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if(recoded!==v)return null;
  const bytes=new Uint8Array(decoded.length);
  for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i);
  return bytes.buffer;
 }catch{return null;}
}
function signedValues(v:unknown,scope:BillingScope,w:BillingWitness,keyId:string){
 const x=values(v,PAYLOAD_KEYS);
 if(!x||x.version!==1||x.brand_id!=='starry'
  ||x.environment!==scope.environment||x.source!=='independent_append_only'
  ||x.witness_ref!==w.witness_ref||x.observed_at_sec!==w.observed_at_sec
  ||x.sequence!==w.sequence||x.head_digest!==w.head_digest||x.key_id!==keyId)
  return null;
 const sig=decodeCanonicalSignature(x.signature);
 if(!sig)return null;
 const envelope=Object.freeze({
  version:1 as const,brand_id:'starry' as const,environment:scope.environment,
  source:'independent_append_only' as const,witness_ref:w.witness_ref,
  observed_at_sec:w.observed_at_sec,sequence:w.sequence,head_digest:w.head_digest,
  key_id:keyId,signature:x.signature as string,
 });
 return {envelope,signature:sig};
}
function validHead(x:unknown):ProtectedBillingHead|null{
 const h=values(x,HEAD_KEYS);
 if(!h||!integer(h.sequence)||typeof h.witness_ref!=='string'
  ||!REF.test(h.witness_ref)||typeof h.signature_sha256!=='string'
  ||!HEX.test(h.signature_sha256))return null;
 return Object.freeze({sequence:h.sequence,witness_ref:h.witness_ref,
  signature_sha256:h.signature_sha256});
}
/** Version-pinned canonical bytes, signer must use the same property order. */
export function canonicalBillingWitnessV1(w:SignedBillingWitness):ArrayBuffer{
 const b=new TextEncoder().encode(JSON.stringify({
  version:1,brand_id:w.brand_id,environment:w.environment,
  source:w.source,witness_ref:w.witness_ref,
  observed_at_sec:w.observed_at_sec,sequence:w.sequence,
  head_digest:w.head_digest,key_id:w.key_id,
 }));
 const result=new ArrayBuffer(b.byteLength);
 new Uint8Array(result).set(b);
 return result;
}
async function digestSignature(buffer:ArrayBuffer):Promise<string>{
 const d=await crypto.subtle.digest('SHA-256',buffer);
 return Array.from(new Uint8Array(d),c=>c.toString(16).padStart(2,'0')).join('');
}
/**
 * Pass verifyIndependentAttestation callback to R11 Billing outbox fence.
 * R11 independently checks privacy/legal status, <=30 sec freshness,
 * every Billing event, complete chain head and durable audit review.
 * This verifies cryptography, not existence of a real immutable remote head.
 */
export function createOfflineSignedBillingWitnessVerifier(deps:Readonly<{
 enabled?:boolean;scope:BillingScope;key_id:string;verifyKey:CryptoKey;
 backend:IndependentBillingBackend;
}>){
 if(!deps||!values(deps.scope,['brand_id','environment'])
  ||deps.scope.brand_id!=='starry'
  ||(deps.scope.environment!=='development'&&deps.scope.environment!=='staging')
  ||typeof deps.key_id!=='string'||!KID.test(deps.key_id)
  ||typeof deps.backend?.readSignedEnvelope!=='function'
  ||typeof deps.backend.readIndependentHead!=='function'
  ||typeof deps.backend.verifyProtectedHead!=='function')
  throw Error('BILLING_SIGNED_CONFIG_DENIED');
 const key=deps.verifyKey;
 const alg=key?.algorithm as RsaHashedKeyAlgorithm|undefined;
 if(!key||key.type!=='public'||key.extractable
  ||alg?.name!=='RSASSA-PKCS1-v1_5'||alg.modulusLength<2048
  ||alg.hash?.name!=='SHA-256'||!key.usages.includes('verify'))
  throw Error('BILLING_SIGNED_KEY_DENIED');
 const scope=Object.freeze({...deps.scope});
 const keyId=deps.key_id;
 return Object.freeze({
  async verifyIndependentAttestation(witness:BillingWitness):Promise<boolean>{
   if(deps.enabled!==true)return false;
   try{
    const safe=witnessValues(witness,scope);
    if(!safe)return false;
    const x=signedValues(await deps.backend.readSignedEnvelope(safe.witness_ref),
     scope,safe,keyId);
    if(!x||await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,x.signature,
     canonicalBillingWitnessV1(x.envelope))!==true)return false;
    const signatureDigest=await digestSignature(x.signature);
    // Read the protected head TWICE. Reject concurrent head advances while
    // verification is running; the head authority remains backend injected.
    const readHead=async()=>{
     const h=validHead(await deps.backend.readIndependentHead(scope.environment));
     if(!h||h.sequence!==safe.sequence||h.witness_ref!==safe.witness_ref
      ||h.signature_sha256!==signatureDigest)return null;
     if(await deps.backend.verifyProtectedHead(h)!==true)return null;
     return h;
    };
    if(await readHead()===null)return false;
    return await readHead()!==null;
   }catch{return false;}
  },
 });
}
