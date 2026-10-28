/**
 * AI-2 Wave1 Round-002: actual AI-1 signed Session + SQL identity
 * composed with existing AI-2 per-App RevenueCat candidate reviewer.
 * Dev/staging offline only; HMAC member digests are synthetic, not approved
 * lawful member binding or Store authority. No transaction/write/ACK path.
 */
import {createOfflineStarryPurchaseEntryGate} from
 '../../../modules/starry-id-v1/src/wave1-purchase-entry-auth-gate.ts';
import type {PurchaseServerIdentity,PurchaseFlowIntent} from
 '../../../modules/starry-id-v1/src/wave1-purchase-entry-auth-gate.ts';
import type {D1Database} from '../../../modules/starry-id-v1/src/d1-ports.ts';
import {createOfflineWave1BillingPolicy} from './wave1-billing-revenuecat-review.ts';
import type {CandidateProduct,BillingReview} from './wave1-billing-revenuecat-review.ts';

export const WAVE1_R002_BILLING_BRIDGE='starry.billing.wave1.r002.signed-identity-bridge.v1-offline' as const;
export const WAVE1_R002_BILLING_LIVE=false as const;
type Scope=Readonly<{brand_id:'starry';app_id:string;environment:'development'|'staging'}>;
type Port=Readonly<{
 readCandidateEvents:()=>Promise<unknown>;
 /** Must be an actual AI-1 Auth/D1 read adapter; never accept UI member. */
 authDb:D1Database;
 getVerificationKey:(kid:string)=>Promise<CryptoKey|null>;
 /** Only a generated disposable fixture HMAC key is approved in this round. */
 offlineDigestKey:CryptoKey;
}>;
export type Round2BillingReview=Readonly<{
 contract:typeof WAVE1_R002_BILLING_BRIDGE;
 state:'blocked'|'review_only';reason:string;
 app_id:string;product_key:string;
 auth_source:'ai1_signed_session_sql_offline'|'none';
 signed_session_revalidated_offline:boolean;
 candidate:BillingReview|null;
 official_revenuecat_verified:false;
 official_store_verified:false;
 live_auth_approved:false;
 live_member_binding_approved:false;
 cross_store_transaction_transfer:false;
 can_start_purchase:false;can_restore:false;can_grant:false;
 can_remove_ads:false;can_ack_webhook:false;can_publish:false;live:false;
}>;
const APP=/^[a-z][a-z0-9._-]{2,70}$/;
const reply=(scope:Scope,product:string,state:Round2BillingReview['state'],
 reason:string,candidate:BillingReview|null=null,
 verified=false):Round2BillingReview=>Object.freeze({
 contract:WAVE1_R002_BILLING_BRIDGE,state,reason,
 app_id:scope.app_id,product_key:product,
 auth_source:verified?'ai1_signed_session_sql_offline':'none',
 signed_session_revalidated_offline:verified,candidate,
 official_revenuecat_verified:false,official_store_verified:false,
 live_auth_approved:false,live_member_binding_approved:false,
 cross_store_transaction_transfer:false,
 can_start_purchase:false,can_restore:false,can_grant:false,
 can_remove_ads:false,can_ack_webhook:false,can_publish:false,live:false
});
function identical(a:PurchaseServerIdentity,b:PurchaseServerIdentity){
 return a.brand_id===b.brand_id&&a.app_id===b.app_id
  &&a.environment===b.environment&&a.starryUserId===b.starryUserId
  &&a.session_id===b.session_id&&a.auth_version===b.auth_version
  &&a.scope==='purchase_identity_only'&&b.scope==='purchase_identity_only';
}
const hex=(value:Uint8Array)=>[...value].map(x=>x.toString(16).padStart(2,'0')).join('');
export function createOfflineWave1SignedBillingBridge(d:Readonly<{
 scope:Scope;expectedOrigin:string;products:readonly CandidateProduct[];
 ports:Port;enabled?:boolean;
}>){
 const s=d?.scope;
 if(!s||s.brand_id!=='starry'||!APP.test(s.app_id)
  ||(s.environment!=='development'&&s.environment!=='staging')
  ||!d.ports||typeof d.ports.readCandidateEvents!=='function'
  ||!d.ports.authDb||typeof d.ports.authDb.prepare!=='function'
  ||typeof d.ports.getVerificationKey!=='function'
  ||!d.ports.offlineDigestKey
  ||d.ports.offlineDigestKey.algorithm?.name!=='HMAC'
  ||!d.ports.offlineDigestKey.usages.includes('sign'))
  throw Error('W1_R002_INVALID_SAFE_CONFIG');
 const scope=Object.freeze({...s});
 const auth=createOfflineStarryPurchaseEntryGate({
  enabled:d.enabled===true,serverScope:scope,
  expectedOrigin:d.expectedOrigin,
  authDb:d.ports.authDb,getVerificationKey:d.ports.getVerificationKey
 });
 return Object.freeze({
  contract:WAVE1_R002_BILLING_BRIDGE,
  async inspect(request:unknown,intent:unknown,productKey:unknown,
   now:unknown):Promise<Round2BillingReview>{
   const key=typeof productKey==='string'?productKey:'invalid_product';
   if(d.enabled!==true)return reply(scope,key,'blocked','DISABLED');
   if(typeof productKey!=='string'||!APP.test(productKey)
    ||!Number.isSafeInteger(now)||(now as number)<1)
    return reply(scope,key,'blocked','INVALID_PRODUCT_OR_TIME');
   try{
    // AI-1 owns verification. Never accept a client-supplied principal,
    // bare starryUserId, mobile loggedIn flag or a serialized WeakMap view.
    const first=await auth.beforeStore(request,intent,now);
    if(first.status!=='identity_verified_only')
     return reply(scope,key,'blocked','SIGNED_SESSION_REQUIRED');
    const a=auth.readServerIdentity(first,intent,now);
    if(!a)return reply(scope,key,'blocked','SERVER_IDENTITY_PROVENANCE_REQUIRED');
    const second=await auth.beforeStore(request,intent,now);
    const b=auth.readServerIdentity(second,intent,now);
    if(!b||!identical(a,b)
     ||!auth.sameVerifiedMember(first,second,intent,now))
     return reply(scope,key,'blocked','AUTH_CHANGED_BEFORE_BILLING');
    // Distinct App and environment HMAC namespace: no arbitrary member_digest
    // from UI. A production key ring/legal basis has NOT been approved.
    const input=new TextEncoder().encode(
     'starry-billing-r002\0'+scope.app_id+'\0'+scope.environment+
     '\0'+a.starryUserId);
    const hashed=await crypto.subtle.sign('HMAC',d.ports.offlineDigestKey,input);
    const digest='m_'+hex(new Uint8Array(hashed));
    const billing=createOfflineWave1BillingPolicy({
     enabled:true,scope,products:d.products,nowSeconds:now as number,
     ports:{
      readIdentity:async()=>({
       kind:'offline_auth_fixture_only',brand_id:'starry',
       app_id:scope.app_id,member_digest:digest,
       auth_version:a.auth_version,session_state:'active'
      }),
      readCandidateEvents:d.ports.readCandidateEvents
     }
    });
    const candidate=await billing.inspect(productKey);
    // A local Store candidate read can race Session revoke/account switch.
    // Revalidate the actual signed Session and Auth SQL AFTER the read.
    const third=await auth.beforeStore(request,intent,now);
    const c=auth.readServerIdentity(third,intent,now);
    if(!c||!identical(a,c)
     ||!auth.sameVerifiedMember(first,third,intent,now))
     return reply(scope,key,'blocked','AUTH_CHANGED_AFTER_BILLING');
    if(candidate.status!=='review_only')
     return reply(scope,key,'blocked','BILLING_CANDIDATE_REJECTED');
    return reply(scope,key,'review_only',
     'SIGNED_AUTH_RECHECKED_OFFLINE_STORE_AND_REVENUECAT_UNVERIFIED',
     candidate,true);
   }catch{return reply(scope,key,'blocked','AUTH_STORE_OR_DIGEST_PORT_UNAVAILABLE');}
  }
 });
}
