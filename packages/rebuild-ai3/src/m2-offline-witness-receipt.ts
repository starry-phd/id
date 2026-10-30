/**
 * AI-3 M2/M4 local-only detached witness receipt verifier.
 * Adds a missing cryptographic freshness/snapshot binding to #274's
 * synthetic PITR risk review. HMAC authenticity does NOT demonstrate
 * physical independence, lawful retention, monotonic truth or live recovery.
 * Never grants restore, API access, Queue ACK or Battery.
 */
import {reviewOfflinePitrCandidate} from './m2-offline-pitr-reconciliation.ts';

export const M2_WITNESS_RECEIPT_LIVE_ENABLED = false as const;
export type WitnessReceiptReview = Readonly<{
  status: 'quarantined_review_required';
  receipt: 'offline_authenticated'|'rejected';
  reason: 'MATCHED_SYNTHETIC_RECEIPT'|'UNTRUSTED_OR_STALE_EVIDENCE';
  source_risks: readonly string[];
  may_restore: false;
  may_open_api: false;
  may_grant_battery: false;
  may_ack_queue: false;
  independently_verified: false;
  live_enabled: false;
}>;

/** The authoritative nonce, freshness floor, KID and key MUST be supplied by
 * a separately approved security authority, never from request/body/DB.
 * No official authority or key is provisioned by this module.
 */
export type OfflineWitnessTrust = Readonly<{
  expected_nonce: string;
  minimum_witness_generation: number;
  expected_key_id: string;
  now_seconds: number;
  verification_key: CryptoKey;
}>;
const receiptFields=['schema_version','brand_id','app_id','environment',
  'nonce','snapshot_generation','witness_generation','issued_at',
  'snapshot_sha256','witness_sha256','key_id','mac'];
const trustFields=['expected_nonce','minimum_witness_generation',
  'expected_key_id','now_seconds','verification_key'];
const validNonce=(v:unknown):v is string=>
  typeof v==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(v);
const validKeyId=(v:unknown):v is string=>
  typeof v==='string'&&/^[A-Za-z0-9._:-]{1,80}$/.test(v);
const validGeneration=(v:unknown):v is number=>
  typeof v==='number'&&Number.isSafeInteger(v)&&v>=1;
const validSeconds=(v:unknown):v is number=>
  typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const validHex=(v:unknown):v is string=>
  typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const validMac=(v:unknown):v is string=>
  typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
function isPlainRecord(value:unknown,fields:readonly string[]):value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  try{
    if(Object.getPrototypeOf(value)!==Object.prototype)return false;
    const own=Reflect.ownKeys(value);
    return own.length===fields.length&&own.every(k=>
      typeof k==='string'&&fields.includes(k)&&
      !!Object.getOwnPropertyDescriptor(value,k)&&
      Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)!, 'value'));
  }catch{return false;}
}
function bytesToHex(bytes:Uint8Array):string{
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
function fromBase64Url(v:string):Uint8Array{
  const bytes=Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')+'='),c=>c.charCodeAt(0));
  if(bytes.length!==32)return new Uint8Array();
  // Reject equivalent non-canonical encodings of the same 32-byte MAC.
  const canonical=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if(canonical!==v)return new Uint8Array();
  return bytes;
}
async function digest(text:string):Promise<string>{
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))));
}
type Member=Readonly<{member_ref:string;status:string;auth_version:number;
  profile_present:boolean;sessions:ReadonlyArray<Readonly<{
    session_ref:string;auth_version:number;revoked_at:number|null;
  }>>}>;
type WitnessEntry=Readonly<{member_ref:string;minimum_auth_version:number;deleted:boolean}>;
type Candidate=Readonly<{brand_id:string;app_id:string;environment:string;
  snapshot_generation:number;members:readonly Member[]}>;
type Witness=Readonly<{brand_id:string;app_id:string;environment:string;
  observed_generation:number;records:readonly WitnessEntry[]}>;
/**
 * Pin ONE validated-risk/hash input before any await. The old verifier first
 * analyzed caller-owned arrays, then traversed those arrays again to hash.
 * A mutable/proxied array could serve different members on the two reads:
 * authenticated unsafe snapshot with clean (stale) source_risks.
 *
 * Copy only own DATA descriptors once. Nested getter/accessor records are
 * rejected without invocation; copy lists with bounded lengths. The existing
 * strict reconciliation parser then validates the detached primitive tree.
 * This is still synthetic input, NOT external independent witness custody.
 */
function ownData(value:unknown,fields:readonly string[]):Record<string,unknown>{
  if(!isPlainRecord(value,fields))throw Error('AI3_WITNESS_SNAPSHOT_DENIED');
  const out:Record<string,unknown>={};
  for(const field of fields){
    const descriptor=Object.getOwnPropertyDescriptor(value,field);
    if(!descriptor||!Object.hasOwn(descriptor,'value'))
      throw Error('AI3_WITNESS_SNAPSHOT_DENIED');
    out[field]=descriptor.value as unknown;
  }
  return Object.freeze(out);
}
function ownList<T>(value:unknown,maximum:number,copy:(item:unknown)=>T):readonly T[]{
  if(!Array.isArray(value)||value.length>maximum)
    throw Error('AI3_WITNESS_SNAPSHOT_DENIED');
  const size=value.length;
  const out:T[]=[];
  for(let i=0;i<size;i++){
    const descriptor=Object.getOwnPropertyDescriptor(value,String(i));
    if(!descriptor||!Object.hasOwn(descriptor,'value'))
      throw Error('AI3_WITNESS_SNAPSHOT_DENIED');
    out.push(copy(descriptor.value));
  }
  return Object.freeze(out);
}
function stableCandidate(value:unknown):Candidate{
  const c=ownData(value,['brand_id','app_id','environment',
    'snapshot_generation','members']);
  const members=ownList(c.members,500,entry=>{
    const m=ownData(entry,['member_ref','status','auth_version',
      'profile_present','sessions']);
    return Object.freeze({
      ...m,
      sessions:ownList(m.sessions,50,s=>ownData(s,
        ['session_ref','auth_version','revoked_at'])),
    });
  });
  return Object.freeze({...c,members}) as unknown as Candidate;
}
function stableWitness(value:unknown):Witness{
  const w=ownData(value,['brand_id','app_id','environment',
    'observed_generation','records']);
  const records=ownList(w.records,500,r=>ownData(r,
    ['member_ref','minimum_auth_version','deleted']));
  return Object.freeze({...w,records}) as unknown as Witness;
}
function canonicalCandidate(value:Candidate):string{
  return JSON.stringify({
    brand_id:value.brand_id,app_id:value.app_id,environment:value.environment,
    snapshot_generation:value.snapshot_generation,
    members:value.members.map(m=>({
      member_ref:m.member_ref,status:m.status,auth_version:m.auth_version,
      profile_present:m.profile_present,
      sessions:m.sessions.map(s=>({
        session_ref:s.session_ref,auth_version:s.auth_version,revoked_at:s.revoked_at,
      })).sort((a,b)=>a.session_ref.localeCompare(b.session_ref)),
    })).sort((a,b)=>a.member_ref.localeCompare(b.member_ref)),
  });
}
function canonicalWitness(value:Witness):string{
  return JSON.stringify({
    brand_id:value.brand_id,app_id:value.app_id,environment:value.environment,
    observed_generation:value.observed_generation,
    records:value.records.map(r=>({
      member_ref:r.member_ref,minimum_auth_version:r.minimum_auth_version,deleted:r.deleted,
    })).sort((a,b)=>a.member_ref.localeCompare(b.member_ref)),
  });
}
function envelope(r:Record<string,unknown>):string{
  // Exact ordered and domain-separated representation; no signature over raw JSON order.
  return JSON.stringify([
    'starry.ai3.m2.offline-witness-receipt.v1',
    r.brand_id,r.app_id,r.environment,r.nonce,
    r.snapshot_generation,r.witness_generation,r.issued_at,
    r.snapshot_sha256,r.witness_sha256,r.key_id,
  ]);
}
const deny=(source_risks:readonly string[]):WitnessReceiptReview=>Object.freeze({
  status:'quarantined_review_required' as const,
  receipt:'rejected' as const,reason:'UNTRUSTED_OR_STALE_EVIDENCE' as const,
  source_risks:Object.freeze([...source_risks]),
  may_restore:false as const,may_open_api:false as const,
  may_grant_battery:false as const,may_ack_queue:false as const,
  independently_verified:false as const,live_enabled:M2_WITNESS_RECEIPT_LIVE_ENABLED,
});

/** For local synthetic fixtures only; never call from production restore admission.
 * Runtime inputs must not be callbacks, DB ports or authorization objects.
 */
export async function reviewOfflinePitrWitnessReceipt(
  candidate:unknown,witness:unknown,receipt:unknown,trust:OfflineWitnessTrust,
):Promise<WitnessReceiptReview>{
  let sourceRisks:readonly string[]=[];
  try{
    // Synchronously detach the candidate and witness ONCE so the source
    // risk review, generation checks and HMAC digests see identical bytes.
    const c=stableCandidate(candidate),w=stableWitness(witness);
    const baseline=reviewOfflinePitrCandidate(c,w);
    sourceRisks=baseline.risks;
    // No getters, unexpected fields or mutable aliases across digest/verify awaits.
    // This local snapshot is NOT a source of authority: caller must provide trust.
    if(!isPlainRecord(receipt,receiptFields)||!isPlainRecord(trust,trustFields))
      return deny(sourceRisks);
    const r:Record<string,unknown>=Object.freeze(Object.fromEntries(
      receiptFields.map(field=>[field,receipt[field]])));
    const trusted:OfflineWitnessTrust=Object.freeze({
      expected_nonce:trust.expected_nonce,
      minimum_witness_generation:trust.minimum_witness_generation,
      expected_key_id:trust.expected_key_id,
      now_seconds:trust.now_seconds,
      verification_key:trust.verification_key,
    });
    if(!validNonce(trusted.expected_nonce)||!validKeyId(trusted.expected_key_id)||
      !validGeneration(trusted.minimum_witness_generation)||!validSeconds(trusted.now_seconds)||
      !(trusted.verification_key instanceof CryptoKey)||
      trusted.verification_key.extractable!==false||
      trusted.verification_key.algorithm.name!=='HMAC'||
      (trusted.verification_key.algorithm as HmacKeyAlgorithm).hash.name!=='SHA-256'||
      !trusted.verification_key.usages.includes('verify'))return deny(sourceRisks);
    if(r.schema_version!=='starry.ai3.m2.offline-witness-receipt.v1'||
      r.brand_id!=='starry'||r.app_id!=='starry-id'||
      (r.environment!=='development'&&r.environment!=='staging')||
      !validNonce(r.nonce)||r.nonce!==trusted.expected_nonce||
      !validKeyId(r.key_id)||r.key_id!==trusted.expected_key_id||
      !validGeneration(r.snapshot_generation)||!validGeneration(r.witness_generation)||
      !validSeconds(r.issued_at)||!validHex(r.snapshot_sha256)||!validHex(r.witness_sha256)||
      !validMac(r.mac))return deny(sourceRisks);
    if(r.environment!==c.environment||r.environment!==w.environment||
      r.snapshot_generation!==c.snapshot_generation||
      r.witness_generation!==w.observed_generation||
      r.witness_generation<trusted.minimum_witness_generation||
      r.witness_generation<r.snapshot_generation||
      r.issued_at>trusted.now_seconds+30||
      trusted.now_seconds-r.issued_at>120)return deny(sourceRisks);
    // Freeze the primitive snapshot strings synchronously before any await.
    const candidateBytes=canonicalCandidate(c),witnessBytes=canonicalWitness(w);
    const [candidateHash,witnessHash]=await Promise.all([
      digest(candidateBytes),digest(witnessBytes),
    ]);
    if(r.snapshot_sha256!==candidateHash||r.witness_sha256!==witnessHash)return deny(sourceRisks);
    const mac=fromBase64Url(r.mac as string);
    if(mac.length!==32)return deny(sourceRisks);
    // Own a non-shared ArrayBuffer: WebCrypto BufferSource types exclude
    // generic ArrayBufferLike/SharedArrayBuffer views in strict TS.
    const ownedMac=new Uint8Array(new ArrayBuffer(mac.byteLength));
    ownedMac.set(mac);
    const ok=await crypto.subtle.verify('HMAC',trusted.verification_key,
      ownedMac,new TextEncoder().encode(envelope(r)));
    if(!ok)return deny(sourceRisks);
    return Object.freeze({
      status:'quarantined_review_required' as const,
      receipt:'offline_authenticated' as const,
      reason:'MATCHED_SYNTHETIC_RECEIPT' as const,
      source_risks:Object.freeze([...sourceRisks]),
      may_restore:false as const,may_open_api:false as const,
      may_grant_battery:false as const,may_ack_queue:false as const,
      independently_verified:false as const,live_enabled:M2_WITNESS_RECEIPT_LIVE_ENABLED,
    });
  }catch{return deny(sourceRisks);}
}
