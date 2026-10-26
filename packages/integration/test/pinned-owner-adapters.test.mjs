/** Gate 2 real cross-owner import tests. All identity/provider evidence is explicitly mocked.
 * No network, crypto verification, queue, DB or deployed route is created.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTrustedPrincipalResolver, isTrustedStarryPrincipal,
  billingIdentityAdapter, billingRefundReviewAdapter, auditReadActorAdapter,
} from '../../../modules/starry-auth/src/principal.ts';
import {createSandboxBillingAdapter} from '../../billing-contracts/src/trusted-adapter.ts';
import {assertStarryEventForScope, isStarryEventEnvelope} from '../../contracts/src/index.ts';
import {bindAi3BillingAudit,bindAi3TrustedOperations} from '../../ai3/src/index.ts';

const NOW = Date.parse('2026-10-26T08:00:00Z')/1000;
const scope=Object.freeze({brand_id:'starry',app_id:'starry.demo',environment:'staging'});
const verified={brand_id:'starry',app_id:'starry.demo',environment:'staging',
  s_user_id:'u1',session_id:'s1',auth_version:3,expires_at:NOW+400};
const member={s_user_id:'u1',status:'active',auth_version:3};
const session={s_user_id:'u1',session_id:'s1',app_id:'starry.demo',environment:'staging',
  auth_version:3,expires_at:NOW+400,revoked_at:null,
  step_up_at:NOW-45,step_up_until:NOW+220};
const grant=(permission,resource,action)=>({
  s_user_id:'u1',brand_id:'starry',app_id:'starry.demo',environment:'staging',
  permission,resource,action,expires_at:NOW+400,revoked_at:null});
const grants=[
  grant('billing:refund:review','billing','refund'),
  grant('audit:read','audit','read'),
];
async function issuePrincipal(overrides={},evidence='server-auth-verifier-mock'){
  const x={verified,member,session,grants,scope,...overrides};
  const resolve=createTrustedPrincipalResolver({
    trustedScope:x.scope,
    auth:{verifyAfterOidcOrSession:async input => input==='server-auth-verifier-mock'?x.verified:null},
    records:{
      loadMember:async()=>x.member,
      loadSession:async()=>x.session,
      loadGrants:async()=>x.grants,
    },
  });
  return resolve(evidence,NOW);
}
const catalog=[{appId:'starry.demo',store:'apple',storeAppId:'phd.starry.demo',
  productId:'monthly.test',kind:'subscription',entitlementKey:'test.pro'}];
const registry={brand_id:'starry',app_id:'starry.demo',environment:'staging',
  store_environment:'sandbox',store:'apple',store_app_id:'phd.starry.demo',catalog};
const providerEvent={verifiedBy:'apple-app-store-server-api',store:'apple',storeEnvironment:'sandbox',
  appId:'starry.demo',storeAppId:'phd.starry.demo',productId:'monthly.test',
  transactionId:'txn1',originalTransactionId:'original1',eventId:'evt1',
  occurredAt:'2026-10-26T07:00:00+00:00',expiresAt:'2026-11-26T07:00:00Z',
  lifecycle:'PURCHASED',accountBinding:'backend-u1'};
function makeBilling(principal,extras={}){
  const state={seen:false,approved:true,owner:'u1',providerEvent,...extras};
  const ports={
    registry:{...registry},
    auth:{
      resolveTrustedPrincipal:()=>principal,
      billingIdentity:(p,c,n)=>billingIdentityAdapter(p,
        {brand_id:c.brand_id,app_id:c.app_id,environment:c.environment},n,c.store_environment),
      resolveRefundPermission:(p,c,n)=>state.approved?
        billingRefundReviewAdapter(p,{brand_id:c.brand_id,app_id:c.app_id,environment:c.environment},
          n,c.store_environment):null,
      accountBindingFor:()=> 'backend-u1',
    },
    verifier:{verifySandboxEvidence:()=>state.providerEvent},
    read:{
      previouslyProcessedEvent:()=>state.seen,
      resolveTransactionOwner:()=>state.owner,
    },
    correlationId:()=> 'corr1',
  };
  return createSandboxBillingAdapter(ports);
}
const purchase={store:'apple',evidence:'opaque-sandbox-test'};
const nowISO=new Date(NOW*1000).toISOString();
const refund={transaction_ref:'txn1',reason:'manual review',approval_id:'review1'};

test('AI-1 genuine module-issued principal to AI-2 real adapter and canonical AI-0 event',async()=>{
 const p=await issuePrincipal();
 assert.equal(isTrustedStarryPrincipal(p),true);
 const b=makeBilling(p),r=b.evaluatePurchase(purchase,null,nowISO);
 assert.equal(r.application.projection.environment,'staging');
 assert.equal(r.application.projection.storeEnvironment,'sandbox');
 assert.equal(r.application.projection.userId,'u1');
 assert.doesNotThrow(()=>assertStarryEventForScope(scope,r.event));
 assert.equal(isStarryEventEnvelope(r.event),true);
 assert.deepEqual(b.checkRefundReview(refund,nowISO),{transactionRef:'txn1',ownerUserId:'u1'});
});
test('AI-1 WeakSet provenance and scope rejects forged client or stale request',async()=>{
 const p=await issuePrincipal();
 for(const bad of [{...p},JSON.parse(JSON.stringify(p)),{adminVerified:true,s_user_id:'u1'}])
   assert.throws(()=>makeBilling(bad).evaluatePurchase(purchase,null,nowISO),/AUTH_PRINCIPAL_DENIED/);
 assert.throws(()=>makeBilling(p).evaluatePurchase({...purchase,verifiedBy:'apple-app-store-server-api'},
   null,nowISO),/CLIENT_CLAIMS_DENIED/);
 assert.throws(()=>makeBilling(p).checkRefundReview({...refund,adminVerified:true},nowISO),
   /CLIENT_CLAIMS_DENIED/);
 assert.equal(await issuePrincipal({}, {adminVerified:true}),null);
});
test('AI-1 genuine session suspension/revocation/grant/step-up checks across AI-2',async()=>{
 for(const override of [
   {member:{...member,status:'suspended'}},{member:{...member,status:'deleted'}},
   {session:{...session,revoked_at:NOW-1}},
   {session:{...session,auth_version:2}},
 ]){
   assert.equal(await issuePrincipal(override),null);
   assert.throws(()=>makeBilling(null).evaluatePurchase(purchase,null,nowISO),/AUTH_REQUIRED/);
 }
 for(const override of [
   {grants:[]},{grants:[grant('audit:read','audit','read')]},
   {session:{...session,step_up_at:NOW-400}},
 ]){
   const p=await issuePrincipal(override);
   assert.throws(()=>makeBilling(p).checkRefundReview(refund,nowISO),/ADMIN_SCOPE_DENIED/);
 }
});
test('AI-1 real audit actor permission feeds AI-3 server trust gateway',async()=>{
 const p=await issuePrincipal();
 const audit=bindAi3TrustedOperations(scope,{
   authorizeAdmin:async(_,operation)=>{
     try{
       if(operation.resource!=='system'||operation.action!=='read')return {allowed:false};
       auditReadActorAdapter(p,scope,NOW);
       return {allowed:true};
     }catch{return {allowed:false}}
   },
   authorizeSession:async()=>({allowed:isTrustedStarryPrincipal(p)}),
   resolveNotificationDelivery:async()=>null,
 });
 await audit.assertAuditRead(scope);
 // AI-3's public scope guard ignores extraneous flags; the trusted backend grant
 // remains the only authority and client-provided flags cannot elevate denied sessions.
 await audit.assertAuditRead({...scope,adminVerified:true});
 const denied=await issuePrincipal({grants:[grant('billing:refund:review','billing','refund')]});
 const noAudit=bindAi3TrustedOperations(scope,{
   authorizeAdmin:async()=>{try{auditReadActorAdapter(denied,scope,NOW);return{allowed:true}}catch{return{allowed:false}}},
   authorizeSession:async()=>({allowed:true}),
   resolveNotificationDelivery:async()=>null,
 });
 await assert.rejects(noAudit.assertAuditRead(scope),/AUDIT_ACCESS_DENIED/);
 await assert.rejects(noAudit.assertAuditRead({...scope,adminVerified:true}),/AUDIT_ACCESS_DENIED/);
});
test('AI-2 canonical verified outbox to AI-3 duplicate/stale and unauthorized refund quarantine',async()=>{
 const p=await issuePrincipal();
 const r=makeBilling(p).evaluatePurchase(purchase,null,nowISO);
 const envelope={...r.event,idempotency_key:r.event.event_id};
 assertStarryEventForScope(scope,envelope);
 let audited=false,last=null,providerRefund=false;
 let entry={envelope,store:'apple',store_environment:'sandbox',
   provider_event_id:r.event.event_id,transaction_ref:providerEvent.originalTransactionId};
 const g=bindAi3BillingAudit(scope,{
   readVerifiedOutbox:async()=>entry,
   alreadyAudited:async()=>audited,
   latestAuditedAt:async()=>last,
   refundIsProviderVerified:async()=>providerRefund,
 });
 assert.equal((await g.plan('outbox1')).disposition,'ready');
 audited=true;
 assert.equal((await g.plan('outbox1')).disposition,'duplicate');
 audited=false;last='2026-10-26T07:00:01Z';
 assert.equal((await g.plan('outbox1')).disposition,'stale_audit_only');
 last=null;
 entry={...entry,envelope:{...envelope,event_type:'billing.refund_recorded'}};
 assert.equal((await g.plan('outbox1')).disposition,'quarantine');
 providerRefund=true;
 assert.equal((await g.plan('outbox1')).disposition,'ready');
 entry={...entry,envelope:{...envelope,brand_id:'hglobal'}};
 assert.equal((await g.plan('outbox1')).disposition,'quarantine');
});
