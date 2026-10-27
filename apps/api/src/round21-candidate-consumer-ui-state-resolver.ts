/**
 * AI-4 R21 PRIVATE OFFLINE-only candidate Consumer-A UI state resolver.
 * 12 screen IDs and 9 exact failure messages belong to AI-0's candidate
 * #136 spec. It is NOT a consumer App route, API, Session issuer or authority.
 *
 * Existing AI-1/2/3 R20 read-only review results are accepted only as
 * nonauthorizing observations. Future Owner R21 UI DTOs are NOT ASSUMED
 * implemented. Deliberately no success, wallet balance, fee or PII fields.
 */
import type {R20AuthBoundaryResult} from '../../../modules/starry-id-v1/src/round20-auth-identity-boundary.ts';
import type {R20Outcome as R20BillingOutcome} from '../../../packages/rebuild-billing/src/r20-namespace-mapping-gate.ts';
import type {R20Decision as R20TaskWalletOutcome} from '../../../packages/rebuild-ai3/src/r20-task-wallet-source-binding.ts';
import type {R20OwnerReview} from './round20-private-r19-owner-interop.ts';

export const R21_CANDIDATE_UI_ONLY=true as const;
export const R21_LIVE_UI_ROUTE_ENABLED=false as const;
export const R21_OFFICIAL_PRODUCT_SELECTED=false as const;
export const R21_CONTRACT='starry.consumer-a.ui-observation.v0-offline' as const;
export const R21_SCREENS=[
 'DISCOVER','SIGN_IN','HOME','TASK_COMPOSE','TASK_REVIEW','TASK_STATUS',
 'TASK_RESULT','TASK_HISTORY','BATTERY_LEDGER','ACCOUNT_SETTINGS',
 'DELETE_ACCOUNT','HELP_APPEAL'
] as const;
export type CandidateScreen=typeof R21_SCREENS[number];
const PUBLIC=new Set<CandidateScreen>(['DISCOVER','SIGN_IN','HELP_APPEAL']);
export const R21_FAILURE_COPY=Object.freeze({
 NOT_SIGNED_IN:'此功能需要驗證會員身分，請先登入。',
 AUTH_REVOKED:'登入狀態已失效，請重新驗證。',
 PRICE_UNAPPROVED:'本次任務所需的免費電池數量尚未確認，暫時無法開始。',
 POLICY_UNKNOWN:'使用規則或資料權限尚未確認，請稍後再試。',
 TASK_UNKNOWN:'目前無法確認任務是否完成，請查看紀錄，避免重複提交。',
 TASK_FAILED:'任務未完成，請查看紀錄確認免費電池處理狀態。',
 RECEIPT_MISMATCH:'任務與電池紀錄尚未一致，已暫停確認，請聯絡支援。',
 DELETION_PENDING:'刪除要求尚在處理，完成狀態需以正式系統確認為準。',
 ACCOUNT_DELETED:'此帳號已無法使用。若有疑問，請透過申訴管道聯絡。'
} as const);
export type FailureCode=keyof typeof R21_FAILURE_COPY;
type Scope=Readonly<{brand_id:'starry';environment:'development'|'staging'}>;
type Hint=Readonly<{kind:'none'|'timeout'|'duplicate'|'failed'|'pending'|'receipt_mismatch'|'pitr_rollback'}>;
type SessionDenial=Readonly<{kind:'unknown'|'absent'|'revoked'}>;
type Rate=Readonly<{kind:'unapproved'|'unknown'|'mock_published_only'}>;
export type R21CandidatePorts=Readonly<{
 readLaw:()=>Promise<unknown>;
 /** R20 actual AI-1 namespace gate; no live signed-in Session authority. */
 readAuthR20:()=>Promise<R20AuthBoundaryResult|null>;
 /** R20 AI-2 Billing result; never directly expose member/store/digest. */
 readBillingR20:()=>Promise<R20BillingOutcome|null>;
 /** R20 AI-3 Task ↔ Wallet result, not a commit grant. */
 readTaskWalletR20:()=>Promise<R20TaskWalletOutcome|null>;
 /** AI-4 R20 private review, not Queue ACK authority. */
 readSagaR20:()=>Promise<R20OwnerReview|null>;
 /** Optional test-only negative-only UI adapters until Owner R21 DTOs exist. */
 readSessionDenial?:()=>Promise<unknown>;
 readTaskHint?:()=>Promise<unknown>;
 readRateCandidate?:()=>Promise<unknown>;
}>;
export type R21UIProjection=Readonly<{
 contract:typeof R21_CONTRACT;screen_id:CandidateScreen;
 state:'preview_only'|'blocked'|'unknown'|'reauth_required'|'deletion_pending'|'review_only';
 failure_code:FailureCode|null;ui_message:string;
 source:'public_candidate_spec'|'r20_read_only_candidate'|'test_only_negative_port'|'missing_adapter';
 missing_adapter:boolean;private_data_included:false;
 task_completed:false;account_deleted_success:false;authenticated:false;
 wallet_balance_verified:false;paid_entitlement_active:false;
 can_submit:false;can_charge:false;can_purchase_battery:false;
 may_ack_queue:false;may_dlq:false;may_regrant:false;may_restore:false;
 may_release_task:false;may_publish:false;live:false;publishable:false;
}>;
const SCREENS=new Set<string>(R21_SCREENS);
const POLICY=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,95}$/;
function exact(value:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const p=Object.getPrototypeOf(value);
  if(p!==Object.prototype&&p!==null)return null;
  const own=Reflect.ownKeys(value);
  if(own.length!==keys.length||own.some(x=>typeof x!=='string'||!keys.includes(x)))return null;
  const out:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of keys){
   const d=Object.getOwnPropertyDescriptor(value,key);
   if(!d||!d.enumerable||!('value' in d))return null;
   out[key]=d.value;
  }
  return out;
 }catch{return null;}
}
const flags=(o:Record<string,unknown>,keys:readonly string[]):boolean=>
 keys.every(k=>o[k]===false);
const aFlags=['identity_mapping_approved','may_publish','may_ack_queue',
 'may_restore','may_regrant','may_release_task','live'] as const;
const bFlags=['may_ack_queue','may_regrant','may_restore','may_publish','may_grant','live'] as const;
const tFlags=['may_settle','may_release_task','may_ack_queue','may_regrant',
 'may_restore','may_publish','may_sell_battery','live'] as const;
const sFlags=['may_ack_queue','may_dlq','may_release_task','may_settle_task',
 'may_regrant','may_restore','may_publish','may_sell_battery','publishable','live'] as const;
const fieldsA=['status','reason','schema_version','identity_mapping_approved',
 'may_publish','may_ack_queue','may_restore','may_regrant','may_release_task','live'];
const fieldsB=['status','reason','candidate',...bFlags];
const fieldsT=['status','reason','candidate',...tFlags];
const fieldsS=['status','reason','owner_observation','missing_authorities',...sFlags];
function authStatus(raw:unknown):'blocked'|'review_only'|null{
 // AI-1 R20 allows a source field on review_only only.
 const value=exact(raw,fieldsA)??exact(raw,['source',...fieldsA]);
 if(!value||value.schema_version!=='starry.auth.identity-boundary.v0-offline'||
  !['blocked','review_only'].includes(String(value.status))||
  typeof value.reason!=='string'||!flags(value,aFlags))return null;
 if(value.status==='review_only'){
  const source=exact(value.source,['namespace','event_id','auth_version','policy_revision']);
  if(!source||source.namespace!=='auth.account_deleted'||typeof source.event_id!=='string')
   return null;
 }
 return value.status as 'blocked'|'review_only';
}
function billingStatus(raw:unknown):'blocked'|'retry'|'review_only'|null{
 const x=exact(raw,fieldsB);
 if(!x||!['blocked','retry','review_only','disabled'].includes(String(x.status))||
  typeof x.reason!=='string'||!flags(x,bFlags))return null;
 if(x.status==='review_only'){
  const c=exact(x.candidate,['kind','mapping_version','auth_event_id','auth_member_ref',
   'billing_member_digest','billing_source_event_id','store','store_app_ref',
   'store_transaction_ref','store_refund_event_ref','store_source_version',
   'hmac_binding_approved','store_signature_verified',
   'external_pitr_witness_verified','publishable']);
  if(!c||c.kind!=='r20_unapproved_namespace_mapping_candidate'||
   !flags(c,['hmac_binding_approved','store_signature_verified',
    'external_pitr_witness_verified','publishable']))return null;
 }else if(x.candidate!==null)return null;
 return x.status==='disabled'?'blocked':x.status as 'blocked'|'retry'|'review_only';
}
function taskStatus(raw:unknown):'blocked'|'review_only'|null{
 const x=exact(raw,fieldsT);
 if(!x||!['blocked','review_only'].includes(String(x.status))||
  typeof x.reason!=='string'||!flags(x,tFlags))return null;
 if(x.status==='review_only'){
  const c=exact(x.candidate,['kind','brand_id','environment','member_ref',
   'task_ref','source_event_ref','task_attempt','policy_version',
   'wallet_revision','signed_source_approved','member_mapping_approved','independent_floor_approved']);
  if(!c||c.kind!=='OFFLINE_UNVERIFIED_TASK_WALLET_MAPPING'||
   !flags(c,['signed_source_approved','member_mapping_approved',
    'independent_floor_approved']))return null;
 }else if(x.candidate!==null)return null;
 return x.status as 'blocked'|'review_only';
}
function sagaStatus(raw:unknown):'blocked'|'review_only'|null{
 const s=exact(raw,fieldsS);
 if(!s||!['blocked','review_only'].includes(String(s.status))||
  typeof s.reason!=='string'||!flags(s,sFlags))return null;
 const o=exact(s.owner_observation,['auth','billing','battery','saga']);
 if(!o||!Array.isArray(s.missing_authorities)||s.missing_authorities.length<1||
  !s.missing_authorities.every(x=>typeof x==='string'))return null;
 return s.status as 'blocked'|'review_only';
}
function negativeHint(raw:unknown):Hint['kind']|null{
 const v=exact(raw,['kind']);
 return v&&['none','timeout','duplicate','failed','pending',
  'receipt_mismatch','pitr_rollback'].includes(String(v.kind))?v.kind as Hint['kind']:null;
}
function sessionHint(raw:unknown):SessionDenial['kind']|null{
 const v=exact(raw,['kind']);
 return v&&['unknown','absent','revoked'].includes(String(v.kind))?v.kind as SessionDenial['kind']:null;
}
function rateHint(raw:unknown):Rate['kind']|null{
 const v=exact(raw,['kind']);
 return v&&['unapproved','unknown','mock_published_only'].includes(String(v.kind))?v.kind as Rate['kind']:null;
}
const projection=(screen:CandidateScreen,code:FailureCode|null,
 state:R21UIProjection['state'],source:R21UIProjection['source'],
 missing_adapter:boolean):R21UIProjection=>Object.freeze({
 contract:R21_CONTRACT,screen_id:screen,state,failure_code:code,
 ui_message:code===null?'僅提供候選功能預覽，尚未開放正式服務。':R21_FAILURE_COPY[code],
 source,missing_adapter,private_data_included:false,
 task_completed:false,account_deleted_success:false,authenticated:false,
 wallet_balance_verified:false,paid_entitlement_active:false,
 can_submit:false,can_charge:false,can_purchase_battery:false,
 may_ack_queue:false,may_dlq:false,may_regrant:false,may_restore:false,
 may_release_task:false,may_publish:false,live:false,publishable:false
});
function deny(screen:CandidateScreen,code:FailureCode,source:R21UIProjection['source'],
 missing=false):R21UIProjection{
 return projection(screen,code,
  code==='AUTH_REVOKED'?'reauth_required':
  code==='DELETION_PENDING'?'deletion_pending':
  code==='TASK_UNKNOWN'?'unknown':'blocked',
  source,missing);
}
export function createR21CandidateConsumerUIResolver(scope:Scope,ports:R21CandidatePorts){
 const s=exact(scope,['brand_id','environment']);
 if(!s||s.brand_id!=='starry'||(s.environment!=='development'&&s.environment!=='staging'))
  throw Error('AI4_R21_SCOPE_DENIED');
 if(!ports||typeof ports.readLaw!=='function'||
  typeof ports.readAuthR20!=='function'||typeof ports.readBillingR20!=='function'||
  typeof ports.readTaskWalletR20!=='function'||typeof ports.readSagaR20!=='function')
  throw Error('AI4_R21_READ_ONLY_OWNER_PORTS_REQUIRED');
 const privateReview=async(screen:CandidateScreen):Promise<R21UIProjection>=>{
  try{
   const law=exact(await ports.readLaw(),['revision','processing_approved','retention_approved']);
   if(!law||typeof law.revision!=='string'||!POLICY.test(law.revision)||
    law.processing_approved!==true||law.retention_approved!==true)
    return deny(screen,'POLICY_UNKNOWN','r20_read_only_candidate');
   // This hook is NEGATIVE-ONLY: never turns a candidate into a real session.
   if(ports.readSessionDenial){
    const denied=sessionHint(await ports.readSessionDenial());
    if(denied==='revoked')return deny(screen,'AUTH_REVOKED','test_only_negative_port');
    if(denied===null)return deny(screen,'POLICY_UNKNOWN','missing_adapter',true);
   }
   const auth=authStatus(await ports.readAuthR20());
   if(auth===null)return deny(screen,'NOT_SIGNED_IN','missing_adapter',true);
   if(auth==='blocked')return deny(screen,'NOT_SIGNED_IN','r20_read_only_candidate');
   // Auth R20 review_only is for the DELETE event, not login or final deletion.
   if(screen==='DELETE_ACCOUNT'||screen==='ACCOUNT_SETTINGS')
    return deny(screen,'DELETION_PENDING','r20_read_only_candidate');
   if(!law||law.revision===undefined)return deny(screen,'POLICY_UNKNOWN','missing_adapter',true);
   if(screen==='HOME'||screen==='TASK_COMPOSE'||screen==='TASK_HISTORY')
    return deny(screen,'NOT_SIGNED_IN','missing_adapter',true); // no signed live Session.
   if(screen==='TASK_REVIEW'){
    const hint=ports.readRateCandidate?rateHint(await ports.readRateCandidate()):null;
    // Even mock_published_only is NOT an authorized free-Battery rate.
    return deny(screen,'PRICE_UNAPPROVED',hint===null?'missing_adapter':
     'test_only_negative_port',hint===null);
   }
   if(screen==='TASK_STATUS'&&ports.readTaskHint){
    const hint=negativeHint(await ports.readTaskHint());
    if(hint==='failed')return deny(screen,'TASK_FAILED','test_only_negative_port');
    if(hint==='receipt_mismatch'||hint==='pitr_rollback')
     return deny(screen,'RECEIPT_MISMATCH','test_only_negative_port');
    // Timeout/retry/duplicate/pending are not completed receipts.
    if(hint===null)return deny(screen,'TASK_UNKNOWN','missing_adapter',true);
   }
   const [billing,task]=await Promise.all([
    ports.readBillingR20(),ports.readTaskWalletR20()
   ]);
   const billingResult=billingStatus(billing),taskResult=taskStatus(task);
   if(billingResult===null||taskResult===null)
    return deny(screen,'POLICY_UNKNOWN','missing_adapter',true);
   if(taskResult==='blocked'&&screen!=='TASK_STATUS'&&screen!=='BATTERY_LEDGER')
    return deny(screen,'RECEIPT_MISMATCH','r20_read_only_candidate');
   if(screen==='BATTERY_LEDGER')
    return deny(screen,'RECEIPT_MISMATCH','r20_read_only_candidate');
   const saga=sagaStatus(await ports.readSagaR20());
   if(saga===null)return deny(screen,'TASK_UNKNOWN','missing_adapter',true);
   // Even all candidate local "review_only" results are not a D1/Queue commit.
   return deny(screen,screen==='TASK_RESULT'?'RECEIPT_MISMATCH':'TASK_UNKNOWN',
    'r20_read_only_candidate');
  }catch{return deny(screen,'POLICY_UNKNOWN','missing_adapter',true);}
 };
 return Object.freeze({
  async resolve(screen:unknown):Promise<R21UIProjection>{
   if(typeof screen!=='string'||!SCREENS.has(screen))
    throw Error('AI4_R21_UNKNOWN_SCREEN_DENIED');
   const id=screen as CandidateScreen;
   // Public UI never touches member/Store/Task/Auth/Session/Policy DB.
   if(PUBLIC.has(id)){
    if(id==='SIGN_IN')return deny(id,'NOT_SIGNED_IN','public_candidate_spec');
    return projection(id,null,'preview_only','public_candidate_spec',false);
   }
   return privateReview(id);
  }
 });
}
