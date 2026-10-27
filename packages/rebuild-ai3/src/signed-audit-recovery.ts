/**
 * AI-3 R12 Q115/Q116: offline signed audit-event recovery witness verifier.
 * No real DB binding, signing key, immutable witness service or restore route.
 * AI-1 owns Auth three-fence signatures; AI-2 owns Billing outbox; this file
 * checks ONLY the Starry audit_events fence with exact append-only rows.
 */
export const LIVE_SIGNED_AUDIT_RECOVERY_ENABLED=false as const;
export const AUDIT_RESTORE_ALLOWED=false as const;
export const AUDIT_CHAIN_SCHEMA='starry.audit.recovery.v1' as const;
const LIMIT=128;
const HEX=/^[a-f0-9]{64}$/;
const EVENT=/^a_[a-f0-9]{64}$/;
const RESOURCE=/^ref_[a-f0-9]{32}$/;
const REF=/^[a-z][A-Za-z0-9._:-]{3,95}$/;
const ZERO='0'.repeat(64);
const EVENTS=new Set(['RECEIVED','REVIEWING','CLOSED','ADMIN_ACTION','ACCESS_DENIED','ACCOUNT_DELETED']);
export type AuditScope=Readonly<{brand_id:'starry';environment:'development'|'staging'}>;
export type AuditRecord=Readonly<{
 seq:number;event_ref:string;classification:'ordinary'|'important_management';
 event_code:string;occurred_ms:number;source_revision:number;
 resource_ref:string;decision_code:string;
}>;
export type SignedAuditWitness=Readonly<{
 schema:1;brand_id:'starry';environment:'development'|'staging';
 source:'independent_append_only';witness_ref:string;
 sequence:number;observed_ms:number;head_digest:string;
 key_id:string;signature:string;
}>;
export type WitnessHead=Readonly<{
 sequence:number;witness_ref:string;signature_sha256:string;
}>;
export type AuditDecision=Readonly<{
 disposition:'blocked'|'review_only';reason:string;audit_events:number|null;
 head_digest:string|null;may_restore:false;
}>;
export type ReadOnlyAuditDB=Readonly<{prepare:(sql:string)=>Readonly<{
 bind:(...params:(string|number)[])=>Readonly<{
  all:()=>Promise<{results:unknown}>;
  first:()=>Promise<unknown>;
 }>;
}>}>;
export type AuditPorts=Readonly<{
 privacyApprovedNow:()=>Promise<boolean>;
 legalHoldNow:()=>Promise<'held'|'clear'|'unknown'>;
 readSignedWitness:()=>Promise<unknown>;
 readIndependentHead:()=>Promise<unknown>;
 recordDurableReview:(witness_ref:string,head_digest:string)=>Promise<boolean>;
}>;
const fields=['seq','event_ref','classification','event_code','occurred_ms',
 'source_revision','resource_ref','decision_code'] as const;
const witnessFields=['schema','brand_id','environment','source','witness_ref','sequence',
 'observed_ms','head_digest','key_id','signature'] as const;
const headFields=['sequence','witness_ref','signature_sha256'] as const;
const safe=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
function exact(x:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(x===null||typeof x!=='object'||Array.isArray(x))return null;
  const p=Object.getPrototypeOf(x);
  if(p!==Object.prototype&&p!==null)return null;
  const own=Reflect.ownKeys(x);
  if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const o:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(x,k);
   if(!d||!d.enumerable||!('value' in d))return null;
   o[k]=d.value;
  }
  return o;
 }catch{return null;}
}
function scopeOk(x:unknown):x is AuditScope{
 const v=exact(x,['brand_id','environment']);
 return !!v&&v.brand_id==='starry'&&(v.environment==='development'||v.environment==='staging');
}
function record(v:unknown,seq:number,previousTime:number,now:number):AuditRecord|null{
 const r=exact(v,fields);
 if(!r||!safe(r.seq)||r.seq!==seq||typeof r.event_ref!=='string'||!EVENT.test(r.event_ref)||
  !['ordinary','important_management'].includes(String(r.classification))||
  typeof r.event_code!=='string'||!EVENTS.has(r.event_code)||
  !safe(r.occurred_ms)||r.occurred_ms<previousTime||r.occurred_ms>now||
  !safe(r.source_revision)||r.source_revision===0||
  typeof r.resource_ref!=='string'||!RESOURCE.test(r.resource_ref)||
  typeof r.decision_code!=='string'||!/^[A-Z][A-Z0-9_]{2,63}$/.test(r.decision_code))
  return null;
 return {
  seq:r.seq,event_ref:r.event_ref,classification:r.classification as AuditRecord['classification'],
  event_code:r.event_code,occurred_ms:r.occurred_ms,
  source_revision:r.source_revision,resource_ref:r.resource_ref,decision_code:r.decision_code
 };
}
async function sha(data:string|ArrayBuffer):Promise<string>{
 const bytes=typeof data==='string'?new TextEncoder().encode(data):data;
 const d=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,'0')).join('');
}
/** Stable source / scope / revision / previous digest chained canonical bytes. */
export async function computeAuditChain(
 scope:AuditScope,rows:readonly AuditRecord[],now:number,
):Promise<Readonly<{sequence:number;head_digest:string}>>{
 if(!scopeOk(scope)||!safe(now)||rows.length===0||rows.length>LIMIT)
  throw Error('AI3_AUDIT_CHAIN_DENIED');
 let previous=ZERO,lastTime=0;
 const refs=new Set<string>();
 for(let i=0;i<rows.length;i++){
  const r=record(rows[i],i+1,lastTime,now);
  if(!r||refs.has(r.event_ref))throw Error('AI3_AUDIT_CHAIN_INVALID_EVENT');
  refs.add(r.event_ref);lastTime=r.occurred_ms;
  previous=await sha(JSON.stringify([
   AUDIT_CHAIN_SCHEMA,scope.brand_id,scope.environment,previous,
   r.seq,r.event_ref,r.classification,r.event_code,r.occurred_ms,
   r.source_revision,r.resource_ref,r.decision_code
  ]));
 }
 return Object.freeze({sequence:rows.length,head_digest:previous});
}
/** Return byte-identical canonical payload excluding the signature. */
export function canonicalAuditWitnessBytes(v:SignedAuditWitness):ArrayBuffer{
 const bytes=new TextEncoder().encode(JSON.stringify([
  AUDIT_CHAIN_SCHEMA,v.schema,v.brand_id,v.environment,v.source,v.witness_ref,
  v.sequence,v.observed_ms,v.head_digest,v.key_id
 ]));
 const buf=new ArrayBuffer(bytes.byteLength);
 new Uint8Array(buf).set(bytes);
 return buf;
}
function envelope(raw:unknown,scope:AuditScope,kid:string,now:number):
 Readonly<{w:SignedAuditWitness;signature:ArrayBuffer}>|null{
 const a=exact(raw,witnessFields);
 if(!a||a.schema!==1||a.brand_id!=='starry'||a.environment!==scope.environment||
  a.source!=='independent_append_only'||typeof a.witness_ref!=='string'||
  !REF.test(a.witness_ref)||!safe(a.sequence)||a.sequence===0||a.sequence>LIMIT||
  !safe(a.observed_ms)||a.observed_ms>now||now-a.observed_ms>30000||
  typeof a.head_digest!=='string'||!HEX.test(a.head_digest)||
  a.key_id!==kid||typeof a.signature!=='string'||
  !/^[A-Za-z0-9_-]{256,1024}$/.test(a.signature))return null;
 try{
  const base64=a.signature.replace(/-/g,'+').replace(/_/g,'/');
  const decoded=atob(base64+'='.repeat((4-base64.length%4)%4));
  const normalized=btoa(decoded).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if(normalized!==a.signature)return null;
  const sig=new ArrayBuffer(decoded.length);
  const bytes=new Uint8Array(sig);
  for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i);
  return {w:a as unknown as SignedAuditWitness,signature:sig};
 }catch{return null;}
}
const block=(reason:string):AuditDecision=>Object.freeze({
 disposition:'blocked',reason,audit_events:null,head_digest:null,may_restore:false,
});
export const AUDIT_RECOVERY_SQL=Object.freeze({
 count:"SELECT COUNT(*) AS total FROM ai3_r12_audit_events WHERE brand_id='starry' AND environment=?",
 events:"SELECT seq,event_ref,classification,event_code,occurred_ms,source_revision,resource_ref,decision_code FROM ai3_r12_audit_events WHERE brand_id='starry' AND environment=? ORDER BY seq ASC LIMIT ?",
});
/** Signed monotone audit witness is NOT a substitute for the Q116 seven fences. */
export function createOfflineSignedAuditRecovery(config:Readonly<{
 enabled?:boolean;scope:AuditScope;key_id:string;verifyKey:Parameters<typeof crypto.subtle.verify>[1];
 db:ReadOnlyAuditDB;ports:AuditPorts;
}>){
 if(!scopeOk(config?.scope)||typeof config.key_id!=='string'||!REF.test(config.key_id)||
  !config.db||typeof config.db.prepare!=='function'||!config.ports||
  (['privacyApprovedNow','legalHoldNow','readSignedWitness','readIndependentHead',
   'recordDurableReview'] as const).some(k=>typeof config.ports[k]!=='function'))
  throw Error('AI3_AUDIT_CONFIG_DENIED');
 const key=config.verifyKey;
 const alg=key?.algorithm as {name:string;modulusLength:number;hash:{name:string}}|undefined;
 if(!key||key.type!=='public'||key.extractable||alg?.name!=='RSASSA-PKCS1-v1_5'||
  alg.modulusLength<2048||alg.hash.name!=='SHA-256'||!key.usages.includes('verify'))
  throw Error('AI3_AUDIT_PINNED_KEY_DENIED');
 const scope=Object.freeze({...config.scope});
 const enabled=config.enabled===true;
 return Object.freeze({
  async review(now:number):Promise<AuditDecision>{
   if(!enabled)return block('DISABLED');
   if(!safe(now)||now===0)return block('INVALID_CLOCK');
   try{
    // Nothing leaves the audit service before the current privacy/legal Gate.
    if(await config.ports.privacyApprovedNow()!==true)return block('PRIVACY_DENIED');
    if(await config.ports.legalHoldNow()!=='clear')return block('LEGAL_HOLD_OR_UNKNOWN');
    const signed=envelope(await config.ports.readSignedWitness(),scope,config.key_id,now);
    if(!signed)return block('SIGNED_WITNESS_UNAVAILABLE');
    if(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,signed.signature,
      canonicalAuditWitnessBytes(signed.w))!==true)return block('INVALID_RS256_SIGNATURE');
    const readCount=async():Promise<number|null>=>{
     const r=exact(await config.db.prepare(AUDIT_RECOVERY_SQL.count).bind(scope.environment).first(),['total']);
     return r&&safe(r.total)?r.total:null;
    };
    const pre=await readCount();
    if(pre===null||pre===0||pre!==signed.w.sequence)return block('AUDIT_COUNT_DRIFT_OR_EMPTY');
    const reply=exact(await config.db.prepare(AUDIT_RECOVERY_SQL.events)
      .bind(scope.environment,LIMIT+1).all(),['results']);
    const raw=reply?.results;
    if(!Array.isArray(raw)||raw.length!==pre||Reflect.ownKeys(raw).length!==raw.length+1)
     return block('INCOMPLETE_AUDIT_PAGE');
    const rows:AuditRecord[]=[];
    let lastTime=0;const seen=new Set<string>();
    for(let i=0;i<raw.length;i++){
     const d=Object.getOwnPropertyDescriptor(raw,String(i));
     const r=d&&'value' in d?record(d.value,i+1,lastTime,now):null;
     if(!r||seen.has(r.event_ref))return block('AUDIT_EVENT_INVALID_OR_DUPLICATE');
     rows.push(r);seen.add(r.event_ref);lastTime=r.occurred_ms;
    }
    const calculated=await computeAuditChain(scope,rows,now);
    if(calculated.head_digest!==signed.w.head_digest)
     return block('SIGNED_AUDIT_CHAIN_DRIFT');
    const head=exact(await config.ports.readIndependentHead(),headFields);
    if(!head||!safe(head.sequence)||head.sequence!==signed.w.sequence||
     head.witness_ref!==signed.w.witness_ref||typeof head.signature_sha256!=='string'||
     !HEX.test(head.signature_sha256)||
     await sha(signed.signature)!==head.signature_sha256)return block('MONOTONE_HEAD_REPLAY');
    if(await readCount()!==pre)return block('AUDIT_APPEND_RACE');
    if(await config.ports.recordDurableReview(signed.w.witness_ref,calculated.head_digest)!==true)
     return block('REVIEW_EVIDENCE_NOT_DURABLE');
    return Object.freeze({disposition:'review_only' as const,reason:'AUDIT_REVIEW_ONLY',
     audit_events:calculated.sequence,head_digest:calculated.head_digest,may_restore:false as const});
   }catch{return block('AUTHORITY_UNAVAILABLE');}
  },
 });
}
