/** AI-2 R22 Echo-Starry offline, read-only entitlement candidate. NEVER a Store SKU.
 * Legacy VIP links, member rank, stickers, AI QA quotas and free Battery are
 * different domains. No legacy cookie/username, payment, Store or Queue authority.
 */
import type {R20Request} from './r20-namespace-mapping-gate.ts';
import type {R21Result,R21Screen} from './r21-candidate-ui-billing-state.ts';
export const R22_ECHO_LIVE=false as const;
export const R22_ECHO_STORE_ENABLED=false as const;
export const R22_ECHO_PURCHASE_ALLOWED=false as const;
export type EchoFeature='vip_private_audio'|'rank_gated_playback'|
 'legacy_sticker_unlock'|'ai_speaker_qa'|'free_battery'|'potential_subscription';
export type EchoDomain='content_playback'|'legacy_virtual_consumption'|
 'free_battery'|'potential_store_subscription';
export type EchoState='unavailable'|'review_only'|'revoked_local_only'|
 'refund_review_only'|'free_not_purchasable'|'blocked';
export type EchoRequest=Readonly<{version:1;feature:EchoFeature;mapping:R20Request}>;
export type EchoEntitlementCandidate=Readonly<{
 schema_version:'starry.echo.entitlement-candidate.v1-offline';
 app:'echo_starry';domain:EchoDomain;feature:EchoFeature;state:EchoState;
 reason:string;source_authority:'none'|'unapproved_local';
 legacy_right_confirmed:false;playback_authorized:false;
 vip_unlocked:false;sticker_unlocked:false;qa_charge_allowed:false;
 official_store_verified:false;subscription_active:false;
 battery_permanently_free:true;can_buy_battery:false;can_sell_stickers:false;
 may_purchase:false;may_grant:false;may_regrant:false;may_restore:false;
 may_ack_queue:false;may_publish:false;live:false;
}>;
type DB=Readonly<{prepare:(sql:string)=>Readonly<{bind:(...args:(string|number)[])=>
 Readonly<{first:<T extends Record<string,unknown>>()=>Promise<T|null>}>}>}>;
type Scope=Readonly<{brand_id:'starry';environment:'development'|'staging';
 app_ref:string;store_app_ref:string}>;
export type R22EchoPorts=Readonly<{
 lawfulProcessingAndRetention:()=>Promise<boolean>;
 /** Only a TEST observation of old product semantics, no passwords/user IDs. */
 readLegacyFeatureCandidate:(feature:EchoFeature)=>Promise<unknown>;
 /** Calls the REAL existing R21 offline Billing UI state projection. */
 projectR21:(screen:R21Screen,mapping:R20Request)=>Promise<R21Result>;
}>;
const REF=/^r_[a-f0-9]{64}$/,MEM=/^m_[a-f0-9]{64}$/;
const LEGACY_ORIGIN='yukidu/Echo-Starry@82cbf4f112af57fcfed12ff2f6cf86010c03560e';
const FEATURES=['vip_private_audio','rank_gated_playback','legacy_sticker_unlock',
 'ai_speaker_qa','free_battery','potential_subscription'] as const;
const REQUEST=['version','feature','mapping'] as const;
const MAP=['mapping_version','auth','auth_version','billing'] as const;
const LEGACY=['origin','kind','feature','brand_id','environment','access_type',
 'member_link_approved','official_store_sku','price_approved'] as const;
const LEGACY_TYPE:Record<EchoFeature,string>={
 vip_private_audio:'legacy_private_vip_share',
 rank_gated_playback:'legacy_rank_permission',
 legacy_sticker_unlock:'legacy_sticker_unlock',
 ai_speaker_qa:'legacy_qa_quota',
 free_battery:'free_battery',
 potential_subscription:'none',
};
const R21=['version','kind','screen','state','reason','product_approved','evidence',
 'battery','store','may_ack_queue','may_grant','may_regrant','may_restore',
 'may_publish','live'] as const;
const R21_BATTERY=['permanently_free','purchasable','redeemable_for_paid'] as const;
const R21_STORE=['iap_available','purchase_enabled','subscription_active',
 'verified_purchase','verified_refund','show_sku','show_price'] as const;
const LOCAL=['deleted_count','tombstone_count','active_count',
 'battery_paid_count','refund_count','refund_floor_version'] as const;
const eq=(x:unknown,y:unknown)=>x===y;
const nonneg=(x:unknown)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
function exact(raw:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const p=Object.getPrototypeOf(raw);
  if(p!==Object.prototype&&p!==null)return null;
  const d=Object.getOwnPropertyDescriptors(raw);
  if(Reflect.ownKeys(raw).length!==keys.length)return null;
  const o:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const k of keys){
   if(!Object.hasOwn(d,k)||d[k].enumerable!==true||!('value' in d[k]))
    return null;
   o[k]=d[k].value;
  }return o;
 }catch{return null;}
}
function domain(f:EchoFeature):EchoDomain{
 if(f==='free_battery')return 'free_battery';
 if(f==='potential_subscription')return 'potential_store_subscription';
 if(f==='legacy_sticker_unlock'||f==='ai_speaker_qa')
  return 'legacy_virtual_consumption';
 return 'content_playback';
}
const result=(feature:EchoFeature,state:EchoState,reason:string,
 source_authority:'none'|'unapproved_local'='none'):EchoEntitlementCandidate=>
 Object.freeze({schema_version:'starry.echo.entitlement-candidate.v1-offline',
 app:'echo_starry',domain:domain(feature),feature,state,reason,
 source_authority,legacy_right_confirmed:false,playback_authorized:false,
 vip_unlocked:false,sticker_unlocked:false,qa_charge_allowed:false,
 official_store_verified:false,subscription_active:false,
 battery_permanently_free:true,can_buy_battery:false,
 can_sell_stickers:false,may_purchase:false,may_grant:false,
 may_regrant:false,may_restore:false,may_ack_queue:false,
 may_publish:false,live:false});
function validMapping(raw:unknown,s:Scope):raw is R20Request{
 const m=exact(raw,MAP);if(!m||m.mapping_version!==1)return false;
 const b=exact(m.billing,['brand_id','environment','app_ref','store_app_ref',
  'member_ref','source_event_id','source_commit_ref','event_ref',
  'event_digest','auth_version','occurred_at_sec','store',
  'transaction_ref','refund_event_ref','refund_source_version','refund_kind']);
 return b!==null&&b.brand_id==='starry'&&b.environment===s.environment
  &&b.app_ref===s.app_ref&&b.store_app_ref===s.store_app_ref
  &&typeof b.member_ref==='string'&&MEM.test(b.member_ref)
  &&typeof b.source_event_id==='string'
  &&typeof b.refund_event_ref==='string'
  &&typeof b.transaction_ref==='string'
  &&(b.store==='apple'||b.store==='google')
  &&typeof b.auth_version==='number'&&Number.isSafeInteger(b.auth_version)
  &&b.auth_version>=2&&b.auth_version===m.auth_version
  &&typeof b.refund_source_version==='number'
  &&Number.isSafeInteger(b.refund_source_version)
  &&b.refund_source_version>0;
}
function legacy(raw:unknown,f:EchoFeature,s:Scope){
 const a=exact(raw,LEGACY);
 return a!==null&&a.origin===LEGACY_ORIGIN
  &&a.kind==='unapproved_legacy_semantic_observation'
  &&a.feature===f&&a.brand_id==='starry'&&a.environment===s.environment
  &&a.access_type===LEGACY_TYPE[f]
  &&a.member_link_approved===false
  &&a.official_store_sku===false&&a.price_approved===false;
}
function r21(raw:unknown,s:R21Screen):'refund_review_only'|'revoked'|'unverified'|null{
 const a=exact(raw,R21);
 if(!a||a.version!==1||a.kind!=='starry_offline_candidate_billing_ui'
  ||a.screen!==s||a.product_approved!==false
  ||a.may_ack_queue!==false||a.may_grant!==false
  ||a.may_regrant!==false||a.may_restore!==false
  ||a.may_publish!==false||a.live!==false)return null;
 const b=exact(a.battery,R21_BATTERY),st=exact(a.store,R21_STORE);
 if(!b||b.permanently_free!==true||b.purchasable!==false
  ||b.redeemable_for_paid!==false||!st
  ||R21_STORE.some(k=>st[k]!==false))return null;
 if(a.state==='refund_review_only'&&a.evidence==='local_only')
  return 'refund_review_only';
 if(a.state==='revoked'&&a.evidence==='local_only')return 'revoked';
 if((a.state==='entitlement_unknown'||a.state==='official_store_unverified'
  ||a.state==='iap_not_offered')&&a.evidence==='none')return 'unverified';
 return null;
}
/** Only existing owner Billing R14, R16, R18 source tables. No SQL writes. */
export const R22_ECHO_BILLING_SELECT=[
 'WITH v AS (SELECT ? AS environment,? AS member_ref,? AS source_event_id,',
 '? AS auth_version,? AS store,? AS store_app_ref,? AS transaction_ref,',
 '? AS refund_event_ref) SELECT',
 '(SELECT COUNT(*) FROM billing_delete_inbox_R16_DRAFT i WHERE i.environment=v.environment AND i.member_ref=v.member_ref AND i.source_event_id=v.source_event_id AND i.auth_version=v.auth_version) AS deleted_count,',
 '(SELECT COUNT(*) FROM billing_deletion_fence_DRAFT f WHERE f.environment=v.environment AND f.member_ref=v.member_ref AND f.deleted_version=v.auth_version) AS tombstone_count,',
 "(SELECT COUNT(*) FROM billing_entitlement_candidate_DRAFT c WHERE c.environment=v.environment AND c.member_ref=v.member_ref AND c.candidate_state='candidate_active') AS active_count,",
 "(SELECT COUNT(*) FROM billing_entitlement_candidate_DRAFT c WHERE c.environment=v.environment AND c.member_ref=v.member_ref AND lower(c.offer_id) LIKE '%battery%') AS battery_paid_count,",
 '(SELECT COUNT(*) FROM billing_r18_refund_inbox_DRAFT i WHERE i.environment=v.environment AND i.member_ref=v.member_ref AND i.store=v.store AND i.store_app_ref=v.store_app_ref AND i.transaction_ref=v.transaction_ref AND i.event_ref=v.refund_event_ref) AS refund_count,',
 '(SELECT MAX(source_version) FROM billing_r18_refund_floor_DRAFT f WHERE f.environment=v.environment AND f.store=v.store AND f.store_app_ref=v.store_app_ref AND f.transaction_ref=v.transaction_ref AND f.member_ref=v.member_ref) AS refund_floor_version FROM v'
].join(' ');
function billing(row:unknown,m:R20Request){
 const a=exact(row,LOCAL);
 if(!a||LOCAL.some(k=>a[k]!==null&&!nonneg(a[k])))return false;
 return a.deleted_count===1&&a.tombstone_count===1
  &&a.active_count===0&&a.battery_paid_count===0&&a.refund_count===1
  &&eq(a.refund_floor_version,m.billing.refund_source_version);
}
function screen(f:EchoFeature):R21Screen{
 if(f==='ai_speaker_qa')return 'TASK_REVIEW';
 if(f==='potential_subscription'||f==='legacy_sticker_unlock')
  return 'ACCOUNT_SETTINGS';
 return 'HOME';
}
export function createOfflineEchoEntitlementCandidate(d:Readonly<{
 enabled?:boolean;scope:Scope;billingDb:DB;ports:R22EchoPorts;
}>){
 const s=exact(d?.scope,['brand_id','environment','app_ref','store_app_ref']);
 if(!s||s.brand_id!=='starry'
  ||(s.environment!=='development'&&s.environment!=='staging')
  ||typeof s.app_ref!=='string'||!REF.test(s.app_ref)
  ||typeof s.store_app_ref!=='string'||!REF.test(s.store_app_ref)
  ||typeof d.billingDb?.prepare!=='function'
  ||typeof d.ports?.lawfulProcessingAndRetention!=='function'
  ||typeof d.ports?.readLegacyFeatureCandidate!=='function'
  ||typeof d.ports?.projectR21!=='function')
  throw Error('R22_ECHO_BILLING_CONFIG_DENIED');
 const scope=Object.freeze({...s}) as Scope;
 return Object.freeze({async inspect(input:unknown):Promise<EchoEntitlementCandidate>{
  const o=exact(input,REQUEST);
  const feature:EchoFeature=o&&FEATURES.includes(o.feature as EchoFeature)
   ?o.feature as EchoFeature:'potential_subscription';
  if(d.enabled!==true)return result(feature,'unavailable','R22_ECHO_OFF');
  if(!o||o.version!==1||!FEATURES.includes(o.feature as EchoFeature))
   return result(feature,'blocked','UNSUPPORTED_ECHO_FEATURE');
  if(feature==='free_battery')
   return result(feature,'free_not_purchasable','PERMANENTLY_FREE_BATTERY');
  if(!validMapping(o.mapping,scope))
   return result(feature,'blocked','FOREIGN_APP_OR_MEMBER_NAMESPACE');
  const m=o.mapping as R20Request;
  try{
   if(await d.ports.lawfulProcessingAndRetention()!==true)
    return result(feature,'blocked','LAWFUL_PROCESSING_OR_RETENTION_MISSING');
   const old=await d.ports.readLegacyFeatureCandidate(feature);
   if(!legacy(old,feature,scope))
    return result(feature,'blocked','LEGACY_ACCESS_NOT_AUTHORITATIVE');
   const sc=screen(feature);
   const first=r21(await d.ports.projectR21(sc,m),sc);
   if(!first)return result(feature,'blocked','R21_STORE_OR_SCOPE_CONFLICT');
   if(first==='unverified')
    return result(feature,'unavailable','OFFICIAL_STORE_AND_IDENTITY_UNVERIFIED');
   const q=()=>d.billingDb.prepare(R22_ECHO_BILLING_SELECT)
    .bind(m.billing.environment,m.billing.member_ref,
     m.billing.source_event_id,m.billing.auth_version,
     m.billing.store,m.billing.store_app_ref,m.billing.transaction_ref,
     m.billing.refund_event_ref).first<Record<string,unknown>>();
   if(!billing(await q(),m))
    return result(feature,'blocked','LOCAL_BILLING_DELETE_REFUND_OR_PITR_MISMATCH');
   if(await d.ports.lawfulProcessingAndRetention()!==true)
    return result(feature,'blocked','LAW_CHANGED_AFTER_READ');
   if(!legacy(await d.ports.readLegacyFeatureCandidate(feature),feature,scope))
    return result(feature,'blocked','LEGACY_EVIDENCE_CHANGED');
   if(r21(await d.ports.projectR21(sc,m),sc)!==first)
    return result(feature,'blocked','R21_EVIDENCE_CHANGED');
   if(!billing(await q(),m))
    return result(feature,'blocked','BILLING_EVIDENCE_CHANGED');
   if(first==='revoked')
    return result(feature,'revoked_local_only','LOCAL_REFUND_AND_REVOCATION_ONLY','unapproved_local');
   if(feature==='potential_subscription')
    return result(feature,'refund_review_only','NO_APPROVED_ECHO_IAP_SKU','unapproved_local');
   return result(feature,'review_only','LEGACY_SEMANTICS_ONLY_NO_MEMBER_OR_STORE_GRANT','unapproved_local');
  }catch{return result(feature,'blocked','PRIVATE_SOURCE_OR_DB_FAILURE');}
 }});
}
