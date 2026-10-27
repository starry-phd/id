/**
 * AI-4 R22 / 繁星回聲. PRIVATE offline-only typed RN/Expo view model / API
 * boundary; NOT a Worker handler, Expo route, native player or media fetcher.
 * Legacy Echo-Starry Web files were READ ONLY references, never dependencies.
 *
 * Real AI-1/2/3 R21 owner DTOs can be injected via read-only ports. None can
 * prove a real signed-in Session, Store/VIP entitlement, Task settlement or ACK.
 */
import type {R21CandidateAuthUI} from '../../../modules/starry-id-v1/src/round21-candidate-ui-auth-state.ts';
import type {R21Result as R21BillingUI} from '../../../packages/rebuild-billing/src/r21-candidate-ui-billing-state.ts';
import type {R21CandidateUiDTO as R21TaskUI} from '../../../packages/rebuild-ai3/src/r21-candidate-ui-task-battery-status.ts';

export const ECHO_R22_LIVE_API_ENABLED=false as const;
export const ECHO_R22_NATIVE_AUDIO_ENABLED=false as const;
export const ECHO_R22_CACHE_MIGRATION_ENABLED=false as const;
export const ECHO_R22_PUBLIC_BUNDLE_CONFIG_APPROVED=false as const;
export const ECHO_R22_VIEW_CONTRACT='starry.echo.r22.private-offline-view.v0' as const;
export const ECHO_R22_API_OPERATIONS=Object.freeze([
 'catalog.list','catalog.search','player.observe','offline.observe',
 'transcript.observe','qa.observe','share.observe','admin.observe'
] as const);
export type EchoR22Operation=typeof ECHO_R22_API_OPERATIONS[number];
type Scope=Readonly<{brand_id:'starry';environment:'development'|'staging'}>;
type Request=Readonly<{operation:EchoR22Operation;track_ref:string|null;query:string|null}>;
export type EchoR22Ports=Readonly<{
 readLaw:()=>Promise<unknown>;
 /** Internal mock media read. Never carries audio URL, signed blob or token. */
 readMedia:(trackRef:string)=>Promise<unknown>;
 readTranscript:(trackRef:string)=>Promise<unknown>;
 /** Real R21 owner result shapes only; optional until an approved adapter exists. */
 readAuthUI?:()=>Promise<R21CandidateAuthUI|null>;
 readBillingUI?:()=>Promise<R21BillingUI|null>;
 readTaskUI?:()=>Promise<R21TaskUI|null>;
}>;
const POLICY=/^[A-Za-z0-9][A-Za-z0-9._:-]{1,95}$/;
const DEMO=Object.freeze([
 Object.freeze({track_ref:'echo-demo-01',title:'繁星回聲・試聽示範 A',duration_sec:90,visibility:'guest_demo' as const}),
 Object.freeze({track_ref:'echo-demo-02',title:'繁星回聲・試聽示範 B',duration_sec:120,visibility:'guest_demo' as const}),
 Object.freeze({track_ref:'echo-vip-demo',title:'繁星回聲・權益待確認',duration_sec:60,visibility:'restricted_mock' as const})
]);
export const ECHO_R22_DRY_API_CONTRACT=Object.freeze({
 scope:'private-test-only',
 catalog:'catalog.list/catalog.search -> curated demo metadata, NO storage query',
 player:'player.observe -> MOCK media availability, NOT native audio or playback claim',
 offline:'offline.observe -> requires native encrypted-file adapter, NEVER browser CacheStorage',
 transcript:'transcript.observe -> status only; never read legacy transcript/R2',
 ai_qa:'qa.observe -> owner Task/Wallet read-only candidate; NEVER paid AI',
 share:'share.observe -> untrusted preview only, NEVER authentication or permanent VIP unlock',
 admin:'admin.observe -> no admin authority; missing signed Starry session always blocked'
} as const);
const IDS=new Set(DEMO.map(x=>x.track_ref));
const MEDIA_FIELDS=['track_ref','kind','availability'] as const;
const TRANS_FIELDS=['track_ref','kind','state'] as const;
const AUTH_FIELDS=['schema_version','screen','state','reason_code','ui_only','candidate_only',
 'personal_data_included','authenticated','global_deletion_confirmed','may_grant','may_ack_queue',
 'may_publish','may_restore','live'] as const;
const BILL_FIELDS=['version','kind','screen','state','reason','product_approved','evidence','battery',
 'store','may_ack_queue','may_grant','may_regrant','may_restore','may_publish','live'] as const;
const TASK_FIELDS=['schema_version','kind','screen','state','message_key','balance_display',
 'rate_display','task_completed','wallet_settled','status_authoritative','can_submit','can_retry',
 'may_settle','may_release','may_regrant','may_restore','may_ack_queue','may_sell_battery','live'] as const;
const LAW_FIELDS=['revision','processing_approved','retention_approved'] as const;
function exact(raw:unknown,fields:readonly string[]):Record<string,unknown>|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const p=Object.getPrototypeOf(raw),names=Reflect.ownKeys(raw);
  if((p!==Object.prototype&&p!==null)||names.length!==fields.length||
    names.some(k=>typeof k!=='string'||!fields.includes(k)))return null;
  const o:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of fields){
   const d=Object.getOwnPropertyDescriptor(raw,key);
   if(!d||!d.enumerable||!('value' in d))return null;
   o[key]=d.value;
  }
  return o;
 }catch{return null;}
}
function validAuth(v:unknown):boolean{
 const a=exact(v,AUTH_FIELDS);
 return !!a&&a.schema_version==='starry.candidate-ui.auth-state.v0-offline'&&
  ['guest','reauth_required','auth_unverified','deletion_pending','access_blocked'].includes(String(a.state))&&
  a.ui_only===true&&a.candidate_only===true&&a.personal_data_included===false&&
  ['authenticated','global_deletion_confirmed','may_grant','may_ack_queue','may_publish',
   'may_restore','live'].every(k=>a[k]===false);
}
function validBilling(v:unknown):boolean{
 const b=exact(v,BILL_FIELDS);
 const battery=b&&exact(b.battery,['permanently_free','purchasable','redeemable_for_paid']);
 const store=b&&exact(b.store,['iap_available','purchase_enabled','subscription_active',
 'verified_purchase','verified_refund','show_sku','show_price']);
 return !!b&&!!battery&&!!store&&b.version===1&&
  b.kind==='starry_offline_candidate_billing_ui'&&b.product_approved===false&&
  ['official_store_unverified','entitlement_unknown','revoked',
   'refund_review_only','iap_not_offered'].includes(String(b.state))&&
  battery.permanently_free===true&&battery.purchasable===false&&
  battery.redeemable_for_paid===false&&
  Object.values(store).every(x=>x===false)&&
  ['may_ack_queue','may_grant','may_regrant','may_restore','may_publish','live']
   .every(k=>b[k]===false);
}
function validTask(v:unknown):boolean{
 const t=exact(v,TASK_FIELDS);
 return !!t&&t.schema_version==='starry.candidate.task-battery-status.v1'&&
  t.kind==='offline_candidate_ui_only'&&
  ['rate_not_approved','balance_unverified','hold_pending','task_unknown',
   'task_failed','receipt_mismatch','blocked','review_only','unconfirmed_balance'].includes(String(t.state))&&
  t.state===t.message_key&&t.balance_display===null&&t.rate_display===null&&
  ['task_completed','wallet_settled','status_authoritative','can_submit','can_retry',
   'may_settle','may_release','may_regrant','may_restore','may_ack_queue',
   'may_sell_battery','live'].every(k=>t[k]===false);
}
function safeRequest(raw:unknown):Request|null{
 const r=exact(raw,['operation','track_ref','query']);
 return r&&ECHO_R22_API_OPERATIONS.includes(r.operation as EchoR22Operation)&&
  (r.track_ref===null||(typeof r.track_ref==='string'&&IDS.has(r.track_ref)))&&
  (r.query===null||(typeof r.query==='string'&&r.query.length<=80))
  ?r as Request:null;
}
export type EchoR22VM=Readonly<{
 contract:typeof ECHO_R22_VIEW_CONTRACT;operation:EchoR22Operation;
 status:'preview_only'|'blocked'|'unavailable'|'reauth_required'|'review_only';
 reason:'DEMO_CATALOG_ONLY'|'EMPTY_SEARCH'|'MOCK_PLAYER_NOT_AUTHORIZED'|
 'MEDIA_UNAVAILABLE'|'OFFLINE_NATIVE_ADAPTER_MISSING'|'TRANSCRIPT_PENDING'|
 'TRANSCRIPT_CANCELLED'|'TRANSCRIPT_UNVERIFIED'|'QA_SOURCE_UNVERIFIED'|
 'TASK_RECEIPT_MISMATCH'|'VIP_ENTITLEMENT_UNKNOWN'|'SHARE_UNTRUSTED'|
 'SIGNIN_NOT_VERIFIED'|'ADMIN_NOT_AUTHORIZED'|'LEGAL_OR_POLICY_MISSING'|
 'MALFORMED_REQUEST'|'OWNER_ADAPTER_MISSING'|'OWNER_READ_FAILED';
 tracks:ReadonlyArray<Readonly<{track_ref:string;title:string;duration_sec:number}>>;
 transcript_state:'none'|'pending'|'cancelled'|'unverified';
 player_state:'none'|'mock_ready'|'unavailable';
 offline_state:'not_verified';share_url:null;transcript_text:null;
 demo_fixture_only:true;source_authoritative:false;personal_data_included:false;
 authenticated:false;is_playing:false;task_completed:false;transcript_ready:false;
 vip_unlocked:false;wallet_balance_verified:false;paid_entitlement_active:false;
 can_play:false;can_share:false;can_download:false;can_submit:false;can_charge:false;
 can_purchase_battery:false;may_ack_queue:false;may_dlq:false;may_release_task:false;
 may_settle_task:false;may_regrant:false;may_restore:false;may_publish:false;
 live:false;publishable:false;
}>;
const EMPTY=Object.freeze([]) as EchoR22VM['tracks'];
function output(operation:EchoR22Operation,status:EchoR22VM['status'],reason:EchoR22VM['reason'],
 tracks:EchoR22VM['tracks']=EMPTY,
 transcript_state:EchoR22VM['transcript_state']='none',
 player_state:EchoR22VM['player_state']='none'):EchoR22VM{
 return Object.freeze({
  contract:ECHO_R22_VIEW_CONTRACT,operation,status,reason,tracks,transcript_state,player_state,
  offline_state:'not_verified',share_url:null,transcript_text:null,demo_fixture_only:true,
  source_authoritative:false,personal_data_included:false,authenticated:false,is_playing:false,
  task_completed:false,transcript_ready:false,vip_unlocked:false,wallet_balance_verified:false,
  paid_entitlement_active:false,can_play:false,can_share:false,can_download:false,
  can_submit:false,can_charge:false,can_purchase_battery:false,
  may_ack_queue:false,may_dlq:false,may_release_task:false,may_settle_task:false,
  may_regrant:false,may_restore:false,may_publish:false,live:false,publishable:false
 });
}
const curated=(q:string|null)=>{
 const phrase=(q||'').trim().toLocaleLowerCase();
 return Object.freeze(DEMO.filter(t=>t.visibility==='guest_demo'&&
  (!phrase||t.title.toLocaleLowerCase().includes(phrase))).map(t=>Object.freeze({
  track_ref:t.track_ref,title:t.title,duration_sec:t.duration_sec
 })));
};
/** Server/private mock only. Caller can never provide a URL, header or credential. */
export function createEchoR22OfflineViewModel(scope:Scope,revision:string,ports:EchoR22Ports){
 const s=exact(scope,['brand_id','environment']);
 if(!s||s.brand_id!=='starry'||!['development','staging'].includes(String(s.environment)))
  throw Error('AI4_ECHO_R22_SCOPE_DENIED');
 if(typeof revision!=='string'||!POLICY.test(revision))
  throw Error('AI4_ECHO_R22_POLICY_REQUIRED');
 if(!ports||typeof ports.readLaw!=='function'||typeof ports.readMedia!=='function'||
  typeof ports.readTranscript!=='function')
  throw Error('AI4_ECHO_R22_PRIVATE_PORTS_REQUIRED');
 const approved=async()=>{
  const p=exact(await ports.readLaw(),LAW_FIELDS);
  return !!p&&p.revision===revision&&p.processing_approved===true&&p.retention_approved===true;
 };
 return Object.freeze({
  async resolve(input:unknown):Promise<EchoR22VM>{
   const r=safeRequest(input);
   if(!r)return output('catalog.list','blocked','MALFORMED_REQUEST');
   const operation=r.operation;
   // Public curated demos must never read member/Store/task/local disk.
   if(operation==='catalog.list'||operation==='catalog.search'){
    const list=curated(operation==='catalog.search'?r.query:null);
    return output(operation,'preview_only',list.length?'DEMO_CATALOG_ONLY':'EMPTY_SEARCH',list);
   }
   try{
    if(!await approved())return output(operation,'blocked','LEGAL_OR_POLICY_MISSING');
    // Never accept a raw legacy URL/audio URL or external media ID.
    if(!r.track_ref||!IDS.has(r.track_ref))
     return output(operation,'blocked','MALFORMED_REQUEST');
    if(operation==='share.observe')
     return output(operation,'review_only','SHARE_UNTRUSTED');
    if(operation==='offline.observe')
     return output(operation,'unavailable','OFFLINE_NATIVE_ADAPTER_MISSING');
    if(operation==='admin.observe'){
     if(!ports.readAuthUI)return output(operation,'blocked','OWNER_ADAPTER_MISSING');
     const a=await ports.readAuthUI();
     if(!validAuth(a)||a?.screen!=='ACCOUNT_SETTINGS')
      return output(operation,'blocked','OWNER_READ_FAILED');
     return output(operation,'reauth_required','ADMIN_NOT_AUTHORIZED');
    }
    if(operation==='player.observe'){
     if(r.track_ref==='echo-vip-demo'){
      if(!ports.readAuthUI||!ports.readBillingUI)
       return output(operation,'blocked','OWNER_ADAPTER_MISSING');
      const [a,b]=await Promise.all([ports.readAuthUI(),ports.readBillingUI()]);
      if(!validAuth(a)||!validBilling(b)||b?.screen!=='HOME')
       return output(operation,'blocked','OWNER_READ_FAILED');
      return output(operation,'reauth_required','VIP_ENTITLEMENT_UNKNOWN');
     }
     const media=exact(await ports.readMedia(r.track_ref),MEDIA_FIELDS);
     if(!media||media.kind!=='mock_media_only'||media.track_ref!==r.track_ref||
      !['mock_local','unavailable','offline_missing'].includes(String(media.availability)))
      return output(operation,'blocked','OWNER_READ_FAILED');
     if(!await approved())return output(operation,'blocked','LEGAL_OR_POLICY_MISSING');
     return media.availability==='mock_local'
      ?output(operation,'preview_only','MOCK_PLAYER_NOT_AUTHORIZED',EMPTY,'none','mock_ready')
      :output(operation,'unavailable','MEDIA_UNAVAILABLE',EMPTY,'none','unavailable');
    }
    if(operation==='transcript.observe'){
     const t=exact(await ports.readTranscript(r.track_ref),TRANS_FIELDS);
     if(!t||t.kind!=='mock_transcript_only'||t.track_ref!==r.track_ref||
      !['pending','cancelled','ready_mock'].includes(String(t.state)))
      return output(operation,'blocked','OWNER_READ_FAILED');
     if(!await approved())return output(operation,'blocked','LEGAL_OR_POLICY_MISSING');
     return t.state==='pending'?
      output(operation,'review_only','TRANSCRIPT_PENDING',EMPTY,'pending'):
      t.state==='cancelled'?
      output(operation,'unavailable','TRANSCRIPT_CANCELLED',EMPTY,'cancelled'):
      output(operation,'review_only','TRANSCRIPT_UNVERIFIED',EMPTY,'unverified');
    }
    if(operation==='qa.observe'){
     if(!ports.readTaskUI)return output(operation,'blocked','OWNER_ADAPTER_MISSING');
     const t=await ports.readTaskUI();
     if(!validTask(t)||t?.screen!=='TASK_STATUS')
      return output(operation,'blocked','OWNER_READ_FAILED');
     if(!await approved())return output(operation,'blocked','LEGAL_OR_POLICY_MISSING');
     return t.state==='receipt_mismatch'
      ?output(operation,'blocked','TASK_RECEIPT_MISMATCH'):
      output(operation,'review_only','QA_SOURCE_UNVERIFIED');
    }
    return output(operation,'blocked','MALFORMED_REQUEST');
   }catch{return output(operation,'blocked','OWNER_READ_FAILED');}
  }
 });
}
