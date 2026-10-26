/**
 * AI-4 Round5: OFFLINE-ONLY end-to-end contract composition.
 * This module is deliberately under test-support and NEVER imported by
 * apps/api/src/index.ts. Candidate P05 acceptance is test-only, NOT Gate approval.
 * All owner modules are reused as-is. There are no cloud bindings in this file.
 */
import {createServerIdentityResolver} from '../../../modules/starry-id-v1/src/index.ts';
import type {TrustedScope} from '../../../modules/starry-id-v1/src/index.ts';
import {createVerifiedSignedSession} from '../../../modules/starry-id-v1/src/session-crypto.ts';
import {createStarryD1Port} from '../../../modules/starry-id-v1/src/d1-ports.ts';
import type {D1Database} from '../../../modules/starry-id-v1/src/d1-ports.ts';
import {planSandboxPurchase} from '../../../packages/rebuild-billing/src/index.ts';
import type {ServerRegistry,StorePort,DomainLedgerRead} from '../../../packages/rebuild-billing/src/index.ts';
import {createSandboxBillingD1Writer} from '../../../packages/rebuild-billing/src/billing-d1.ts';
import type {D1Shape} from '../../../packages/rebuild-billing/src/billing-d1.ts';
import {createAi3AuditD1Store} from '../../../packages/rebuild-ai3/src/d1-audit-adapter.ts';
import type {D1DatabasePort} from '../../../packages/rebuild-ai3/src/d1-audit-adapter.ts';
import {createRound4BillingAuditConsumer} from '../../../packages/rebuild-ai3/src/queue-consumer.ts';
import {dispatchQueueMessage} from '../../../packages/rebuild-ai3/src/queue-transport.ts';
import type {QueueMessagePort,DeadLetterPort} from '../../../packages/rebuild-ai3/src/queue-transport.ts';
import {isCandidate,VERSION} from '../../../packages/ai0-contracts/src/p05-candidate.mjs';
import {createOfflineRound4MemberWorker} from './round4-member-worker.ts';

export type OfflineRound5Ports=Readonly<{
 offline_fixture_only:true;
 scope:TrustedScope;registry:ServerRegistry;
 identityDb:D1Database;billingDb:D1Shape;auditDb:D1DatabasePort;
 nowSeconds:()=>number;
 resolveSessionKey:(kid:string)=>Promise<CryptoKey|null>;
 billingHmacKey:CryptoKey;
 serverActorFor:(userId:string)=>Promise<string|null>;
 verifiedSandboxStore:StorePort;
 ledger:DomainLedgerRead;
 serverOrder:Readonly<{afterCommitOrder:(scope:TrustedScope,key:string)=>
  Promise<'current'|'superseded'|'unknown'>}>;
 dlq:DeadLetterPort;
}>;

/**
 * No HTTP billing route: tests call purchaseOffline explicitly with an opaque
 * signed request and an injected simulated provider snapshot. Never production.
 */
export function createOfflineRound5Vertical(deps:OfflineRound5Ports){
 const s=Object.freeze({...deps.scope}),r=Object.freeze({...deps.registry});
 if(deps.offline_fixture_only!==true||s.brand_id!=='starry'||s.app_id!=='starry-id'
  ||(s.environment!=='staging'&&s.environment!=='development')
  ||r.brandId!=='starry'||r.appId!==s.app_id||r.environment!==s.environment
  ||r.storeEnvironment!=='sandbox'||(r.store!=='apple'&&r.store!=='google'))
  throw new Error('R5_OFFLINE_SCOPE_REQUIRED');
 const owner=createStarryD1Port(deps.identityDb,s);
 const verify=createVerifiedSignedSession({scope:s,getKey:deps.resolveSessionKey});
 const resolver=createServerIdentityResolver({trusted_scope:s,
  verify_oidc_or_session:async unknownRequest=>{
   if(!(unknownRequest instanceof Request))return null;
   const bearer=unknownRequest.headers.get('authorization');
   if(!bearer?.startsWith('Bearer '))return null;
   return verify(bearer.slice(7),deps.nowSeconds());
  },
  read_member:owner.readMember,read_session:owner.readSession,
  identity_matches:owner.identityMatches,
 });
 const member=createOfflineRound4MemberWorker({
  scope:s,db:deps.identityDb,nowSeconds:deps.nowSeconds,
  resolveServerSessionKey:deps.resolveSessionKey,
 });
 const billing=createSandboxBillingD1Writer({db:deps.billingDb,scope:r,
  hmacKey:deps.billingHmacKey});
 const audit=createAi3AuditD1Store(deps.auditDb,s);
 // The ONLY P05 gate here is an explicit OFFLINE fixture approval. This
 // must NEVER be used as a production policy/authority.
 const candidateAuthority=Object.freeze({schemaVersion:VERSION,
  accepts:async (scope:TrustedScope,event:unknown):Promise<boolean> =>
   isCandidate(event,scope) && deps.offline_fixture_only===true});
 const consumer=createRound4BillingAuditConsumer(s,candidateAuthority,
  {readAfterCommit:billing.readAfterCommit},audit,deps.serverOrder);
 return Object.freeze({
  member,
  async purchaseOffline(request:Request,evidence:string,serverTime:string){
   if(!(request instanceof Request)||request.method!=='POST'||
      new URL(request.url).pathname!=='/__offline/billing/commit'||
      request.headers.has('cookie')||request.headers.has('x-admin-verified')||
      request.headers.has('x-user-id')||new URL(request.url).search)
    throw new Error('R5_BILLING_REQUEST_DENIED');
   const now=deps.nowSeconds();
   if(!Number.isSafeInteger(now)||Date.parse(serverTime)!==now*1000)
    throw new Error('R5_CLOCK_DENIED');
   const principal=await resolver(request,now);
   if(!principal)throw new Error('R5_AUTH_DENIED');
   const plan=await planSandboxPurchase({store:r.store,evidence},{
    registry:r,store:deps.verifiedSandboxStore,ledger:deps.ledger,
    auth:{
     resolveTrustedPrincipal:async()=>principal,
     accountBindingFor:async(userId,registry)=>{
      if(userId!==principal.s_user_id||registry.appId!==s.app_id)return null;
      const binding=await owner.readStoreBinding({
       s_user_id:userId,app_id:s.app_id,environment:s.environment,
       store:r.store,store_app_id:r.storeAppId,store_environment:'sandbox'});
      if(!binding||binding.revoked_at!==null||
        (binding.expires_at!==null&&binding.expires_at<=now))return null;
      return binding.account_binding;
     },
     opaqueActorRefFor:async(userId,registry)=>{
      if(userId!==principal.s_user_id||registry.appId!==s.app_id)return null;
      return deps.serverActorFor(userId);
     },
    }
   },serverTime);
   if(plan.disposition!=='new')throw new Error('R5_DUPLICATE_REQUIRES_RECEIPT_LOOKUP');
   const receipt=await billing.commit(plan,serverTime);
   // Deliberately never return raw session, provider payload, or entitlement to HTTP.
   return Object.freeze({disposition:receipt.disposition,eventRef:receipt.eventRef});
  },
  async dispatchOffline(message:QueueMessagePort){
   return dispatchQueueMessage(message,consumer,deps.dlq);
  },
 });
}
