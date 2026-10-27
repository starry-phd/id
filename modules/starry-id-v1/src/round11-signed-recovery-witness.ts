/**
 * AI-1 R11: real offline RS256 verification of an independent Auth PITR witness.
 * This verifier never signs evidence and cannot perform a restore. The external
 * anchor must be authenticated, non-rollbackable and stored OUTSIDE Auth D1;
 * this candidate does not implement or attest that infrastructure.
 */
import type {IndependentAuthCheckpoint,AuthFenceCounters} from './round10-recovery-fences.ts';
import type {TrustedScope} from './index.ts';
export const LIVE_SIGNED_RECOVERY_WITNESS_ENABLED=false as const;
export type SignedAuthWitness=Readonly<{
 version:1;brand_id:'starry';environment:'development'|'staging';
 source:'independent_append_only';witness_ref:string;observed_at:number;
 counters:AuthFenceCounters;sequence:number;key_id:string;signature:string;
}>;
export type IndependentWitnessHead=Readonly<{
 sequence:number;witness_ref:string;signature_sha256:string;
}>;
type WitnessBackend=Readonly<{
 readSignedEnvelope:(ref:string)=>Promise<unknown>;
 // A DIFFERENT protected append-only storage + independently verified head.
 // Never read this from Auth D1 or from the backup under inspection.
 readIndependentHead:(environment:'development'|'staging')=>Promise<unknown>;
}>;
const KEY_FIELDS=['version','brand_id','environment','source','witness_ref',
 'observed_at','counters','sequence','key_id','signature'] as const;
const COUNT_FIELDS=['deleted_members','revoked_sessions','claimed_registration_gifts'] as const;
const HEAD_FIELDS=['sequence','witness_ref','signature_sha256'] as const;
const safeInt=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const refOk=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(x);
/** Protects against getters, exotic prototypes, extra keys and revoked Proxies. */
function plain(x:unknown,fields:readonly string[]):Record<string,unknown>|null{
 try{
  if(x===null||typeof x!=='object'||Array.isArray(x))return null;
  const proto=Object.getPrototypeOf(x);
  if(proto!==Object.prototype&&proto!==null)return null;
  const keys=Reflect.ownKeys(x);
  if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)))return null;
  const desc=Object.getOwnPropertyDescriptors(x);
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const field of fields){
   const d=desc[field];
   if(!d||!d.enumerable||!('value' in d))return null;
   out[field]=d.value;
  }
  return out;
 }catch{return null;}
}
function safeCounts(value:unknown):AuthFenceCounters|null{
 const v=plain(value,COUNT_FIELDS);
 if(!v||!COUNT_FIELDS.every(k=>safeInt(v[k])))return null;
 return Object.freeze({
  deleted_members:v.deleted_members as number,revoked_sessions:v.revoked_sessions as number,
  claimed_registration_gifts:v.claimed_registration_gifts as number,
 });
}
function parsedEnvelope(v:unknown,scope:TrustedScope,w:IndependentAuthCheckpoint,kid:string):
 (Readonly<{payload:SignedAuthWitness;signatureBytes:Uint8Array}>)|null {
 const p=plain(v,KEY_FIELDS);
 if(!p||p.version!==1||p.brand_id!=='starry'||p.environment!==scope.environment||
   p.source!=='independent_append_only'||p.witness_ref!==w.witness_ref||
   p.observed_at!==w.observed_at||p.key_id!==kid||
   !safeInt(p.sequence)||p.sequence===0)return null;
 const a=safeCounts(p.counters);
 if(!a||!COUNT_FIELDS.every(k=>a[k]===w.counters[k]))return null;
 if(typeof p.signature!=='string'||!/^[A-Za-z0-9_-]{256,1024}$/.test(p.signature))return null;
 // A non-canonical base64url string must not identify the same signed bytes.
 const sig=Uint8Array.from(Buffer.from(p.signature,'base64url'));
 if(Buffer.from(sig).toString('base64url')!==p.signature)return null;
 const payload:Object=Object.freeze({
  version:1,brand_id:'starry',environment:scope.environment,
  source:'independent_append_only',witness_ref:w.witness_ref,
  observed_at:w.observed_at,counters:a,sequence:p.sequence,
  key_id:kid,signature:p.signature,
 });
 return {payload:payload as SignedAuthWitness,signatureBytes:sig};
}
/** Stable, versioned canonical bytes; signer uses this EXACT field ordering. */
export function canonicalAuthWitnessV1(w:SignedAuthWitness):Uint8Array {
 return new TextEncoder().encode(JSON.stringify({
  version:1,brand_id:w.brand_id,environment:w.environment,
  source:w.source,witness_ref:w.witness_ref,observed_at:w.observed_at,
  counters:{
   deleted_members:w.counters.deleted_members,
   revoked_sessions:w.counters.revoked_sessions,
   claimed_registration_gifts:w.counters.claimed_registration_gifts,
  },
  sequence:w.sequence,key_id:w.key_id,
 }));
}
/**
 * Pass result as R10's verifyIndependentAttestation callback. R10 additionally
 * checks current lawful purpose, freshness (<31s), local Auth D1 counter match.
 * A positive signature alone is NOT evidence of monotonic durability or an
 * authorization to restore; the independent head port remains a release blocker.
 */
export function createOfflineSignedAuthWitnessVerifier(deps:Readonly<{
 enabled?:boolean;scope:TrustedScope;key_id:string;verifyKey:CryptoKey;
 backend:WitnessBackend;
}>) {
 const scope=Object.freeze({...deps.scope});
 if(scope.brand_id!=='starry'||!refOk(scope.app_id)||
   !['development','staging'].includes(scope.environment))
   throw Error('SIGNED_WITNESS_SCOPE_DENIED');
 if(!refOk(deps.key_id))throw Error('SIGNED_WITNESS_KEY_ID_DENIED');
 const key=deps.verifyKey;
 const alg=key?.algorithm as RsaHashedKeyAlgorithm|undefined;
 if(!key||key.type!=='public'||key.extractable||
   alg?.name!=='RSASSA-PKCS1-v1_5'||alg.modulusLength<2048||
   alg.hash.name!=='SHA-256'||!key.usages.includes('verify'))
   throw Error('SIGNED_WITNESS_PINNED_KEY_DENIED');
 const enabled=deps.enabled===true;
 return Object.freeze({
  async verifyIndependentAttestation(witness:IndependentAuthCheckpoint):Promise<boolean>{
   if(!enabled)return false;
   try {
    if(!refOk(witness.witness_ref)||witness.brand_id!=='starry'||
      witness.environment!==scope.environment||
      witness.source!=='independent_append_only'||!safeInt(witness.observed_at)||
      !safeCounts(witness.counters))return false;
    const body=await deps.backend.readSignedEnvelope(witness.witness_ref);
    const signed=parsedEnvelope(body,scope,witness,deps.key_id);
    if(!signed)return false;
    const verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',
      key,signed.signatureBytes,canonicalAuthWitnessV1(signed.payload));
    if(!verified)return false;
    // Verify against the latest externally authenticated monotonic head,
    // not a checkpoint supplied by client JSON or the restored D1 snapshot.
    const h=plain(await deps.backend.readIndependentHead(
      scope.environment as 'development'|'staging'),HEAD_FIELDS);
    if(!h||!safeInt(h.sequence)||h.sequence!==signed.payload.sequence||
      h.witness_ref!==signed.payload.witness_ref||typeof h.signature_sha256!=='string'||
      !/^[a-f0-9]{64}$/.test(h.signature_sha256))return false;
    const digest=await crypto.subtle.digest('SHA-256',signed.signatureBytes);
    const hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    return hex===h.signature_sha256;
   }catch{return false;}
  },
 });
}
