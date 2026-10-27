/**
 * R11 AI-3: deep offline free-Battery anti-resurrection review.
 * Compare CURRENT, PITR and independent backup at per-wallet/hold/journal level.
 * SHA-256 equality is NOT provenance; independently protected and authenticated
 * anchor + AI-3 Q116 seven-fence/legal/step-up Gate are separately mandatory.
 * No storage mutation / public Worker route / Cloudflare binding.
 */
import {assessIsolatedRestore} from './recovery-guard.ts';
import type {TrustedRecoveryPorts} from './recovery-guard.ts';

export const LIVE_BATTERY_DEEP_RESTORE_ENABLED=false as const;
export const BATTERY_RECOVERY_SCHEMA='starry.battery-recovery.v0-draft' as const;
export const MAX_REVIEW_WALLETS=64 as const;
export const MAX_REVIEW_ENTRIES=256 as const;
export type ReviewScope=Readonly<{brand_id:'starry';environment:'isolated-test';dataset:'battery'}>;
export type LedgerEvent=Readonly<{revision:number;kind:string;event_ref:string;delta:number;
 balance_after:number;reason_code:string;policy_version:number;at_ms:number}>;
export type HoldRow=Readonly<{task_ref:string;app_id:string;task_type:string;price:number;
 rate_version:number;policy_version:number;created_ms:number;expires_ms:number;
 status:'held'|'committed'|'released'|'expired'|'revoked'}>;
export type WalletRow=Readonly<{member_ref:string;balance:number;version:number;
 overdraft_used:number;registration_granted:boolean;first_task_granted:boolean;
 revoked:boolean;holds:readonly HoldRow[];journal:readonly LedgerEvent[]}>;
export type RecoveryReview=Readonly<{disposition:'blocked'|'review_only';reason:string;
 may_restore:false;digest_sha256:string|null}>;
export type BatteryRecoveryPorts=Readonly<{
 readCurrent:(s:ReviewScope)=>Promise<unknown>;
 readPitr:(s:ReviewScope)=>Promise<unknown>;
 readIndependent:(s:ReviewScope)=>Promise<unknown>;
 /** Strictly EXTERNAL signed monotonic anchor, NOT a row from backed-up D1. */
 verifyProtectedAnchor:(s:ReviewScope,digest_sha256:string,count:number)=>Promise<boolean>;
}>;
const WALLET=['member_ref','balance','version','overdraft_used','registration_granted',
 'first_task_granted','revoked','holds','journal'] as const;
const HOLD=['task_ref','app_id','task_type','price','rate_version','policy_version',
 'created_ms','expires_ms','status'] as const;
const EVENT=['revision','kind','event_ref','delta','balance_after','reason_code',
 'policy_version','at_ms'] as const;
const SCOPE=['brand_id','environment','dataset'] as const;
const PORT=['readCurrent','readPitr','readIndependent','verifyProtectedAnchor'] as const;
const KINDS=new Set(['registration_grant','first_task_grant','reserve','commit',
 'release','expire','admin_correction','revoke']);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const REASON=/^[A-Z][A-Z0-9_]{2,63}$/;
const n=(v:unknown,min=0):v is number=>typeof v==='number'&&
 Number.isSafeInteger(v)&&v>=min;
const signed=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
function exact(v:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(v===null||typeof v!=='object'||Array.isArray(v))return null;
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)return null;
  const found=Reflect.ownKeys(v);
  if(found.length!==keys.length||found.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const result:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   const d=Object.getOwnPropertyDescriptor(v,k);
   if(!d||d.enumerable!==true||!('value' in d))return null;
   result[k]=d.value;
  }
  return result;
 }catch{return null;}
}
function array(v:unknown,max:number):unknown[]|null{
 try{
  if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||
   v.length>max||Reflect.ownKeys(v).length!==v.length+1)return null;
  const result:unknown[]=[];
  for(let i=0;i<v.length;i++){
   const d=Object.getOwnPropertyDescriptor(v,String(i));
   if(!d||!d.enumerable||!('value' in d))return null;
   result.push(d.value);
  }
  return result;
 }catch{return null;}
}
function parseEvent(v:unknown):LedgerEvent|null{
 const x=exact(v,EVENT);
 if(!x||!n(x.revision,1)||!KINDS.has(String(x.kind))||
  typeof x.event_ref!=='string'||!ID.test(x.event_ref)||
  !signed(x.delta)||!signed(x.balance_after)||
  typeof x.reason_code!=='string'||!REASON.test(x.reason_code)||
  !n(x.policy_version,1)||!n(x.at_ms))return null;
 return {revision:x.revision,kind:x.kind as string,event_ref:x.event_ref,
  delta:x.delta,balance_after:x.balance_after,reason_code:x.reason_code,
  policy_version:x.policy_version,at_ms:x.at_ms};
}
function parseHold(v:unknown):HoldRow|null{
 const x=exact(v,HOLD);
 if(!x||!['task_ref','app_id','task_type'].every(k=>typeof x[k]==='string'&&
   ID.test(x[k] as string))||
  !n(x.price,1)||!n(x.rate_version,1)||!n(x.policy_version,1)||
  !n(x.created_ms)||!n(x.expires_ms)||
  !Number.isSafeInteger(x.created_ms+180000)||
  x.expires_ms!==x.created_ms+180000||
  !['held','committed','released','expired','revoked'].includes(String(x.status)))
  return null;
 return {task_ref:x.task_ref as string,app_id:x.app_id as string,
  task_type:x.task_type as string,price:x.price,rate_version:x.rate_version,
  policy_version:x.policy_version,created_ms:x.created_ms,expires_ms:x.expires_ms,
  status:x.status as HoldRow['status']};
}
function parseWallet(v:unknown):WalletRow|null{
 const x=exact(v,WALLET);
 if(!x||typeof x.member_ref!=='string'||!ID.test(x.member_ref)||
  !signed(x.balance)||!n(x.version)||!n(x.overdraft_used)||
  x.overdraft_used>2||typeof x.registration_granted!=='boolean'||
  typeof x.first_task_granted!=='boolean'||typeof x.revoked!=='boolean')
  return null;
 const rawHolds=array(x.holds,MAX_REVIEW_ENTRIES);
 const rawJournal=array(x.journal,MAX_REVIEW_ENTRIES);
 if(!rawHolds||!rawJournal)return null;
 const holds=rawHolds.map(parseHold);
 const journal=rawJournal.map(parseEvent);
 if(holds.some(h=>h===null)||journal.some(j=>j===null))return null;
 const normalized:WalletRow={
  member_ref:x.member_ref,balance:x.balance,version:x.version,overdraft_used:x.overdraft_used,
  registration_granted:x.registration_granted,first_task_granted:x.first_task_granted,
  revoked:x.revoked,holds:holds as HoldRow[],journal:journal as LedgerEvent[]
 };
 if(!ledgerValid(normalized))return null;
 return normalized;
}
function ledgerValid(w:WalletRow):boolean{
 if(w.journal.length!==w.version||(w.revoked&&w.balance!==0)||
  (w.balance>=0&&w.overdraft_used!==0)||
  (w.first_task_granted&&!w.registration_granted))return false;
 const ordered=[...w.journal].sort((a,b)=>a.revision-b.revision);
 const events=new Set<string>(),reservations=new Map<string,LedgerEvent>();
 const settles=new Map<string,LedgerEvent>();
 let running=0,registrations=0,firsts=0,revocations=0;
 for(let i=0;i<ordered.length;i++){
  const e=ordered[i];
  if(e.revision!==i+1)return false;
  const unique=e.kind+'|'+e.event_ref;
  if(events.has(unique))return false;
  events.add(unique);
  if(!Number.isSafeInteger(running+e.delta))return false;
  running+=e.delta;
  if(running!==e.balance_after)return false;
  if(e.kind==='registration_grant'){registrations++;if(e.event_ref!=='initial_registration')return false;}
  if(e.kind==='first_task_grant')firsts++;
  if(e.kind==='revoke'){revocations++;if(i!==ordered.length-1||e.balance_after!==0)return false;}
  if(e.kind==='reserve')reservations.set(e.event_ref,e);
  if(['commit','release','expire'].includes(e.kind)){
   if(settles.has(e.event_ref))return false;
   settles.set(e.event_ref,e);
  }
 }
 if(running!==w.balance||registrations!==Number(w.registration_granted)||
  firsts!==Number(w.first_task_granted)||revocations!==Number(w.revoked))return false;
 const refs=new Set<string>();
 for(const hold of w.holds){
  if(refs.has(hold.task_ref))return false;
  refs.add(hold.task_ref);
  const r=reservations.get(hold.task_ref),settle=settles.get(hold.task_ref);
  if(!r||r.delta!==-hold.price||r.at_ms!==hold.created_ms||
   r.policy_version!==hold.policy_version)return false;
  if(w.revoked&&hold.status==='held')return false;
  if(hold.status==='held'&&!w.revoked&&settle)return false;
  if(hold.status==='revoked'&&(!w.revoked||settle))return false;
  if(['committed','released','expired'].includes(hold.status)){
   if(!settle||settle.kind!==(hold.status==='committed'?'commit':
    hold.status==='released'?'release':'expire')||
    settle.revision<=r.revision||
    settle.delta!==(hold.status==='committed'?0:hold.price))return false;
   if(hold.status==='expired'&&settle.at_ms<hold.expires_ms)return false;
   if(hold.status!=='expired'&&settle.at_ms>=hold.expires_ms)return false;
  }
 }
 if(reservations.size!==refs.size||settles.size>
   w.holds.filter(h=>['committed','released','expired'].includes(h.status)).length)return false;
 return true;
}
function normalize(input:unknown):WalletRow[]|null{
 const raw=array(input,MAX_REVIEW_WALLETS);
 if(!raw)return null;
 const output:WalletRow[]=[],refs=new Set<string>();
 for(const item of raw){
  const wallet=parseWallet(item);
  if(!wallet||refs.has(wallet.member_ref))return null;
  refs.add(wallet.member_ref);
  output.push({...wallet,
   holds:[...wallet.holds].sort((a,b)=>a.task_ref.localeCompare(b.task_ref,'en')),
   journal:[...wallet.journal].sort((a,b)=>a.revision-b.revision)});
 }
 output.sort((a,b)=>a.member_ref<b.member_ref?-1:a.member_ref>b.member_ref?1:0);
 return output;
}
const deny=(reason:string):RecoveryReview=>Object.freeze({disposition:'blocked',
 reason,may_restore:false,digest_sha256:null});
const review=(hash:string):RecoveryReview=>Object.freeze({disposition:'review_only',
 reason:'BATTERY_DEEP_REVIEW_NO_RESTORE',may_restore:false,digest_sha256:hash});
function normalizeScope(raw:unknown):ReviewScope|null{
 const s=exact(raw,SCOPE);
 return s?.brand_id==='starry'&&s.environment==='isolated-test'&&s.dataset==='battery'?
  Object.freeze({brand_id:'starry',environment:'isolated-test',dataset:'battery'}):null;
}
async function digest(scope:ReviewScope,rows:readonly WalletRow[]):Promise<string>{
 const text=JSON.stringify([BATTERY_RECOVERY_SCHEMA,scope.brand_id,scope.environment,
  scope.dataset,rows]);
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export function createOfflineBatteryRecoveryReview(ports:BatteryRecoveryPorts){
 const p=exact(ports,PORT);
 if(!p||PORT.some(key=>typeof p[key]!=='function'))
  throw Error('AI3_BATTERY_DEEP_TRUSTED_PORT_DENIED');
 return Object.freeze({
  async review(rawScope:unknown):Promise<RecoveryReview>{
   const scope=normalizeScope(rawScope);
   if(!scope)return deny('INVALID_SCOPE');
   try{
    const current=normalize(await ports.readCurrent(scope));
    const pitr=normalize(await ports.readPitr(scope));
    const independent=normalize(await ports.readIndependent(scope));
    if(!current||!pitr||!independent)return deny('INVALID_LEDGER_OR_SOURCE');
    const hash=await digest(scope,current);
    if(hash!==await digest(scope,pitr)||hash!==await digest(scope,independent))
     return deny('WALLET_HOLD_JOURNAL_DRIFT_OR_REPLAY');
    if(await ports.verifyProtectedAnchor(scope,hash,current.length)!==true)
     return deny('INDEPENDENT_WITNESS_MISSING');
    return review(hash);
   }catch{return deny('SOURCE_OR_WITNESS_UNAVAILABLE');}
  }
 });
}
/** Runs deep Battery check BEFORE original Q116 legal/7-fence/step-up review. */
export function createOfflineBatteryBoundRestore(
 deepPorts:BatteryRecoveryPorts,restorePorts:TrustedRecoveryPorts
){
 const deep=createOfflineBatteryRecoveryReview(deepPorts);
 return Object.freeze({
  async review(bundle:unknown,now:unknown):Promise<RecoveryReview>{
   const b=exact(bundle,['scope','artifacts','request_ref','requested_ms']);
   if(!b||!n(now))return deny('INVALID_RECOVERY_BUNDLE');
   const result=await deep.review(b.scope);
   if(result.disposition!=='review_only')return result;
   try{
    const q116=await assessIsolatedRestore(bundle,restorePorts,now);
    if(q116.disposition!=='review_only'||q116.may_restore!==false)
     return deny('Q116_LEGAL_SEVEN_FENCE_GATE_BLOCKED');
    return result;
   }catch{return deny('Q116_AUTHORITY_UNAVAILABLE');}
  }
 });
}
