/**
 * AI-2 R13 | OFFLINE independently RS256-signed latest Billing head.
 *
 * A second signing key checks the HEAD digest of R12's signed Witness.
 * Does NOT provide live immutable storage, source authenticity, key rotation,
 * Store billing rights, P05 publishing, Queue ACK or any restore mutation.
 */
import type {BillingScope} from './recovery-outbox-fence.ts';
import type {ProtectedBillingHead,IndependentBillingBackend}
 from './signed-billing-witness.ts';

export const BILLING_SIGNED_HEAD_LIVE_ENABLED=false as const;
export const BILLING_SIGNED_HEAD_RESTORE_ALLOWED=false as const;
export type SignedBillingHeadV1=Readonly<{
 version:1;brand_id:'starry';environment:'development'|'staging';
 source:'protected_independent_head';sequence:number;
 witness_ref:string;signature_sha256:string;
 issued_at_sec:number;expires_at_sec:number;key_id:string;signature:string;
}>;
type HeadsOnly=Pick<IndependentBillingBackend,'readIndependentHead'|'verifyProtectedHead'>;
export type BillingHeadAuthority=Readonly<HeadsOnly>;

const NAMES=['version','brand_id','environment','source','sequence',
 'witness_ref','signature_sha256','issued_at_sec','expires_at_sec',
 'key_id','signature'] as const;
const OUT=['sequence','witness_ref','signature_sha256'] as const;
const REF=/^r_[a-f0-9]{64}$/,HEX=/^[a-f0-9]{64}$/;
const KEY=/^[A-Za-z0-9._:-]{1,96}$/;
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;

function fields(input:unknown,names:readonly string[]):Record<string,unknown>|null{
 try{
  if(!input||typeof input!=='object'||Array.isArray(input))return null;
  const proto=Object.getPrototypeOf(input);
  if(proto!==Object.prototype&&proto!==null)return null;
  const keys=Reflect.ownKeys(input);
  if(keys.length!==names.length||keys.some(k=>typeof k!=='string'||!names.includes(k)))
   return null;
  const d=Object.getOwnPropertyDescriptors(input);
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of names){
   if(!Object.hasOwn(d,key)||!d[key].enumerable||!('value' in d[key]))return null;
   out[key]=d[key].value;
  }
  return out;
 }catch{return null;}
}
function signatureBuffer(input:unknown):ArrayBuffer|null{
 if(typeof input!=='string'||!/^[A-Za-z0-9_-]{256,1024}$/.test(input))return null;
 try{
  const normalized=input.replace(/-/g,'+').replace(/_/g,'/');
  const chars=atob(normalized+'='.repeat((4-normalized.length%4)%4));
  const canonical=btoa(chars).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if(canonical!==input)return null;
  const result=new ArrayBuffer(chars.length),out=new Uint8Array(result);
  for(let i=0;i<chars.length;i++)out[i]=chars.charCodeAt(i);
  return result;
 }catch{return null;}
}
function parse(input:unknown,scope:BillingScope,keyId:string,now:number):
 {head:SignedBillingHeadV1;signature:ArrayBuffer}|null{
 const x=fields(input,NAMES);
 if(!x||x.version!==1||x.brand_id!=='starry'
  ||x.environment!==scope.environment||x.source!=='protected_independent_head'
  ||x.key_id!==keyId||!integer(x.sequence)||x.sequence===0
  ||typeof x.witness_ref!=='string'||!REF.test(x.witness_ref)
  ||typeof x.signature_sha256!=='string'||!HEX.test(x.signature_sha256)
  ||!integer(x.issued_at_sec)||!integer(x.expires_at_sec)
  ||x.expires_at_sec<=x.issued_at_sec
  ||x.expires_at_sec-x.issued_at_sec>30
  ||x.issued_at_sec>now||now>=x.expires_at_sec)return null;
 const signature=signatureBuffer(x.signature);
 if(!signature)return null;
 return {head:Object.freeze({
  version:1,brand_id:'starry',environment:scope.environment,
  source:'protected_independent_head',
  sequence:x.sequence,witness_ref:x.witness_ref,
  signature_sha256:x.signature_sha256,
  issued_at_sec:x.issued_at_sec,expires_at_sec:x.expires_at_sec,
  key_id:keyId,signature:x.signature,
 }) as SignedBillingHeadV1,signature};
}
/** Exact version 1 canonical signer input, excluding the signature itself. */
export function canonicalSignedBillingHeadV1(head:SignedBillingHeadV1):ArrayBuffer{
 const bytes=new TextEncoder().encode(JSON.stringify({
  version:1,brand_id:head.brand_id,environment:head.environment,
  source:head.source,sequence:head.sequence,
  witness_ref:head.witness_ref,signature_sha256:head.signature_sha256,
  issued_at_sec:head.issued_at_sec,expires_at_sec:head.expires_at_sec,
  key_id:head.key_id,
 }));
 const b=new ArrayBuffer(bytes.byteLength);
 new Uint8Array(b).set(bytes);
 return b;
}
function headValues(x:unknown):ProtectedBillingHead|null{
 const h=fields(x,OUT);
 if(!h||!integer(h.sequence)||typeof h.witness_ref!=='string'
  ||!REF.test(h.witness_ref)||typeof h.signature_sha256!=='string'
  ||!HEX.test(h.signature_sha256))return null;
 return Object.freeze({
  sequence:h.sequence,witness_ref:h.witness_ref,
  signature_sha256:h.signature_sha256,
 });
}
/**
 * Two read-and-verify calls from R12 force two independent RS256 checks.
 * This catches a changed signed HEAD between reads, but cannot rule out
 * REPLAY of a still-valid signed HEAD from a compromised/rolled-back store.
 */
export function createOfflineSignedBillingHeadAuthority(deps:Readonly<{
 enabled?:boolean;scope:BillingScope;key_id:string;
 witnessSignerKeyId:string;verifyKey:CryptoKey;
 readSignedHead:()=>Promise<unknown>;readServerTime:()=>number;
}>):BillingHeadAuthority {
 if(!deps||!fields(deps.scope,['brand_id','environment'])
  ||deps.scope.brand_id!=='starry'
  ||(deps.scope.environment!=='development'&&deps.scope.environment!=='staging')
  ||typeof deps.key_id!=='string'||!KEY.test(deps.key_id)
  ||typeof deps.witnessSignerKeyId!=='string'
  ||!KEY.test(deps.witnessSignerKeyId)
  ||deps.key_id===deps.witnessSignerKeyId
  ||typeof deps.readSignedHead!=='function'
  ||typeof deps.readServerTime!=='function')throw Error('BILLING_HEAD_CONFIG_DENIED');
 const key=deps.verifyKey,algorithm=key?.algorithm as RsaHashedKeyAlgorithm|undefined;
 if(!key||key.type!=='public'||key.extractable
  ||algorithm?.name!=='RSASSA-PKCS1-v1_5'
  ||algorithm.modulusLength<2048||algorithm.hash?.name!=='SHA-256'
  ||!key.usages.includes('verify'))throw Error('BILLING_HEAD_KEY_DENIED');
 const scope=Object.freeze({...deps.scope});
 async function readVerified():Promise<ProtectedBillingHead|null>{
  if(deps.enabled!==true)return null;
  try{
   const now=deps.readServerTime();
   if(!integer(now)||now<=0)return null;
   const parsed=parse(await deps.readSignedHead(),scope,deps.key_id,now);
   if(!parsed||await crypto.subtle.verify('RSASSA-PKCS1-v1_5',
    key,parsed.signature,canonicalSignedBillingHeadV1(parsed.head))!==true)return null;
   return Object.freeze({
    sequence:parsed.head.sequence,witness_ref:parsed.head.witness_ref,
    signature_sha256:parsed.head.signature_sha256,
   });
  }catch{return null;}
 }
 return Object.freeze({
  async readIndependentHead(environment:'development'|'staging'){
   if(environment!==scope.environment)return null;
   return readVerified();
  },
  async verifyProtectedHead(input:ProtectedBillingHead){
   // Fresh independent read on EVERY R12 verify callback: no signed head cache.
   const supplied=headValues(input);
   if(!supplied)return false;
   const latest=await readVerified();
   return latest!==null&&latest.sequence===supplied.sequence
    &&latest.witness_ref===supplied.witness_ref
    &&latest.signature_sha256===supplied.signature_sha256;
  },
 });
}
