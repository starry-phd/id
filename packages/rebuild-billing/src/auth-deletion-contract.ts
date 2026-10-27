/**
 * AI-2 R15 Q88 | OFFLINE trusted Auth deletion -> Billing candidate contract.
 * Auth R13 emits ONLY event_id, s_user_id, occurred_at, event_type.
 * R14 Billing requires derived member_ref/event_ref/digest/auth_version/scope.
 * NEVER treat these derived fields as original Auth schema or P05 approval.
 */
import {createOfflineBillingAccountDeletionFence} from './account-deletion-fence.ts';
import type {AuthDeletionEvent,CommittedAuthDeletion,DeleteScope,
 OfflineDeleteDb,DeletionOutcome} from './account-deletion-fence.ts';
export const LIVE_AUTH_BILLING_DELETE_BRIDGE_ENABLED=false as const;
export const BILLING_DELETE_CONTRACT_PUBLISHABLE=false as const;
export const BILLING_DELETE_CONTRACT_VERSION='starry.billing.account_deleted.candidate.v1' as const;
export type AuthRawOutbox=Readonly<{
 event_id:string;s_user_id:string;occurred_at:number;event_type:'account_deleted';
}>;
export type AuthCurrentMember=Readonly<{
 s_user_id:string;status:'deleted';auth_version:number;updated_at:number;
}>;
/** These MUST originate together from a backend Auth D1 committed snapshot.
 * A raw client/Queue payload is NEVER a valid source for this type of read.
 */
export type AuthCommittedSnapshot=Readonly<{
 outbox:AuthRawOutbox;member:AuthCurrentMember;
}>;
export type AuthSourceAuthority=Readonly<{
 readCommittedSnapshot:(event_id:string)=>Promise<AuthCommittedSnapshot|null>;
 /** Independent backend proof of committed-row origin and snapshot integrity.
  * Offline fixture callback is NOT a deployed PKI or actual Auth verifier.
  */
 verifyCommittedSnapshot:(s:AuthCommittedSnapshot)=>Promise<boolean>;
}>;
export type BridgeResult=DeletionOutcome&Readonly<{contract_version:typeof BILLING_DELETE_CONTRACT_VERSION}>;
const eventKeys=['event_id','s_user_id','occurred_at','event_type'];
const memberKeys=['s_user_id','status','auth_version','updated_at'];
const snapshotKeys=['outbox','member'];
const EVENT_ID=/^[A-Za-z0-9._:-]{20,180}$/;
const USER_ID=/^[A-Za-z0-9._:-]{1,180}$/;
const integer=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
function snapshotData(x:unknown,keys:readonly string[]):x is Record<string,unknown>{
 try{
  if(x===null||typeof x!=='object'||Array.isArray(x))return false;
  const p=Object.getPrototypeOf(x);
  if(p!==Object.prototype&&p!==null)return false;
  const props=Reflect.ownKeys(x);
  if(props.length!==keys.length||props.some(k=>typeof k!=='string'||!keys.includes(k)))return false;
  const desc=Object.getOwnPropertyDescriptors(x);
  return keys.every(k=>Object.hasOwn(desc,k)&&desc[k].enumerable&&'value' in desc[k]);
 }catch{return false;}
}
function validSnapshot(x:unknown,eventId:string,now:number):x is AuthCommittedSnapshot{
 if(!snapshotData(x,snapshotKeys)||!snapshotData(x.outbox,eventKeys)
  ||!snapshotData(x.member,memberKeys))return false;
 const o=x.outbox,m=x.member;
 return o.event_id===eventId&&o.event_type==='account_deleted'
  &&typeof o.s_user_id==='string'&&USER_ID.test(o.s_user_id)
  &&o.s_user_id===m.s_user_id&&m.status==='deleted'
  &&integer(o.occurred_at)&&o.occurred_at>0&&o.occurred_at<=now
  &&now-o.occurred_at<=604800
  &&integer(m.auth_version)&&m.auth_version>=2
  &&integer(m.updated_at)&&m.updated_at===o.occurred_at;
}
function sameSnapshot(a:AuthCommittedSnapshot,b:AuthCommittedSnapshot):boolean{
 return a.outbox.event_id===b.outbox.event_id
  &&a.outbox.s_user_id===b.outbox.s_user_id
  &&a.outbox.occurred_at===b.outbox.occurred_at
  &&a.outbox.event_type===b.outbox.event_type
  &&a.member.s_user_id===b.member.s_user_id
  &&a.member.status===b.member.status
  &&a.member.auth_version===b.member.auth_version
  &&a.member.updated_at===b.member.updated_at;
}
const hex=(buffer:ArrayBuffer):string=>Array.from(new Uint8Array(buffer),
 n=>n.toString(16).padStart(2,'0')).join('');
function safeHmacKey(k:CryptoKey):boolean{
 try {
  const alg=k?.algorithm as HmacKeyAlgorithm|undefined;
  return !!k&&k.type==='secret'&&k.extractable===false
   &&alg?.name==='HMAC'&&alg.hash?.name==='SHA-256'
   &&alg.length>=256&&k.usages.includes('sign');
 }catch{return false;}
}
async function hmac(key:CryptoKey,tag:string,scope:DeleteScope,parts:readonly (string|number)[]){
 const raw=JSON.stringify([BILLING_DELETE_CONTRACT_VERSION,tag,
  scope.brand_id,scope.environment,...parts]);
 return hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw)));
}
function refused(reason:string):BridgeResult{
 return Object.freeze({status:'blocked',reason,may_grant:false,may_ack:false,
  contract_version:BILLING_DELETE_CONTRACT_VERSION});
}
export function createOfflineBillingDeletionContractBridge(deps:Readonly<{
 enabled?:boolean;scope:DeleteScope;
 key:CryptoKey;auth:AuthSourceAuthority;db:OfflineDeleteDb;
 lawfulMinimalRetentionApproved:()=>Promise<boolean>;
}>){
 const s=deps?.scope;
 if(!snapshotData(s,['brand_id','environment'])||s.brand_id!=='starry'
  ||(s.environment!=='development'&&s.environment!=='staging')
  ||!safeHmacKey(deps.key)||typeof deps.auth?.readCommittedSnapshot!=='function'
  ||typeof deps.auth.verifyCommittedSnapshot!=='function'
  ||typeof deps.lawfulMinimalRetentionApproved!=='function'
  ||typeof deps.db?.prepare!=='function')
  throw Error('BILLING_DELETION_BRIDGE_CONFIG_DENIED');
 const scope=Object.freeze({...s});
 const enabled=deps.enabled===true;
 return Object.freeze({
  async consumeCommittedAuthEvent(event_id:string,now:number):Promise<BridgeResult>{
   if(!enabled)return Object.freeze({status:'disabled',reason:'DISABLED',
    may_grant:false,may_ack:false,contract_version:BILLING_DELETE_CONTRACT_VERSION});
   if(typeof event_id!=='string'||!EVENT_ID.test(event_id)
    ||!integer(now)||now===0)return refused('INVALID_AUTH_SOURCE_REF');
   try {
    // Q104/Q119: never read raw Auth user_id unless the purpose is approved.
    if(await deps.lawfulMinimalRetentionApproved()!==true)
     return refused('LAWFUL_RETENTION_REQUIRED');
    const a=await deps.auth.readCommittedSnapshot(event_id);
    if(!validSnapshot(a,event_id,now)
     ||await deps.auth.verifyCommittedSnapshot(a)!==true)
     return refused('AUTH_COMMIT_PROOF_DENIED');
    // These are DERIVED HMAC candidate fields, NOT Auth-owned event columns.
    // Domain separation + scope binding excludes raw user_id from Billing DB.
    const member_ref='m_'+await hmac(deps.key,'member.v1',scope,[a.outbox.s_user_id]);
    const event_ref='r_'+await hmac(deps.key,'outbox-ref.v1',scope,
     [a.outbox.event_id,a.outbox.s_user_id,a.outbox.occurred_at]);
    const event_digest=await hmac(deps.key,'outbox-digest.v1',scope,
     [a.outbox.event_id,a.outbox.s_user_id,a.outbox.occurred_at,
      a.outbox.event_type,a.member.auth_version]);
    const mapped:AuthDeletionEvent=Object.freeze({
     brand_id:'starry',environment:scope.environment,event_type:'account_deleted',
     member_ref,event_ref,event_digest,auth_version:a.member.auth_version,
     occurred_at_sec:a.outbox.occurred_at,
    });
    const readAgain=async():Promise<AuthCommittedSnapshot|null>=>{
     const fresh=await deps.auth.readCommittedSnapshot(event_id);
     if(!validSnapshot(fresh,event_id,now)||!sameSnapshot(a,fresh)
      ||await deps.auth.verifyCommittedSnapshot(fresh)!==true)return null;
     return fresh;
    };
    // Reuse the R14 one-statement Billing tombstone+revoke atomics unchanged.
    // R14 itself repeats the lawful gate before its authority reads.
    const consumer=createOfflineBillingAccountDeletionFence({
     enabled:true,scope,db:deps.db,ports:{
      lawfulMinimalRetentionApproved:deps.lawfulMinimalRetentionApproved,
      verifyCommittedAuthOutbox:async e=>{
       if(e!==mapped)return false;
       return await readAgain()!==null;
      },
      readCurrentAuthDeletion:async member=>{
       if(member!==member_ref||await readAgain()===null)return null;
       const verified:CommittedAuthDeletion={
        brand_id:'starry',environment:scope.environment,status:'deleted',
        member_ref,auth_version:a.member.auth_version,
        event_ref,event_digest,deleted_at_sec:a.outbox.occurred_at,
       };
       return Object.freeze(verified);
      },
     },
    });
    const outcome=await consumer.consume(mapped,now);
    return Object.freeze({...outcome,contract_version:BILLING_DELETE_CONTRACT_VERSION});
   }catch{return refused('AUTH_OR_BILLING_AUTHORITY_UNAVAILABLE');}
  },
 });
}
