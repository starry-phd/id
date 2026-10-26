/**
 * AI-0 second-round integration gate. ALL imported modules are the current
 * in-branch AI-1/AI-2/AI-3 implementations. Uses offline signed-session +
 * fake committed Billing row; not a real OAuth/Store/D1/Queue test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServerIdentityResolver,isTrustedPrincipal} from '../../../modules/starry-id-v1/src/index.ts';
import {createEphemeralTestKey,signTestSession,createTestHmacVerifier} from '../../../apps/api/test-support/session-hmac.ts';
import {planSandboxPurchase} from '../../rebuild-billing/src/index.ts';
import {bindBillingAuditBridge,isAuditMetadata} from '../../rebuild-ai3/src/index.ts';

const time='2026-10-26T09:00:00Z', epoch=Math.floor(Date.parse(time)/1000);
const scope=Object.freeze({brand_id:'starry',app_id:'starry-id',environment:'staging'});
const identity=Object.freeze({...scope,provider:'google',provider_subject:'g_uid_1',
 s_user_id:'s_001',session_id:'session_1',auth_version:2,expires_at:epoch+3600});
const member=Object.freeze({s_user_id:'s_001',status:'active',auth_version:2,profile_revision:1,
 display_name:'Private Name',directory_opt_in:false,display_name_public:false});
const session=Object.freeze({session_id:'session_1',s_user_id:'s_001',auth_version:2,
 app_id:'starry-id',environment:'staging',expires_at:epoch+3600,revoked_at:null,
 step_up_method:null,step_up_verified_at:null,step_up_expires_at:null});
const registry=Object.freeze({brandId:'starry',appId:'starry-id',environment:'staging',
 storeEnvironment:'sandbox',store:'apple',storeAppId:'starry.id.sandbox',
 catalog:{'test.monthly':'subscription'}});
const snapshot=Object.freeze({brandId:'starry',appId:'starry-id',store:'apple',
 storeEnvironment:'sandbox',storeAppId:'starry.id.sandbox',sku:'test.monthly',
 kind:'subscription',originalTransactionId:'orig_1',transactionId:'trx_1',
 providerEventId:'provider_1',accountBinding:'opaque_binding_1',
 periodStartedAt:'2026-10-26T08:00:00Z',effectiveAt:'2026-10-26T08:00:00Z',
 expiresAt:'2026-11-26T08:00:00Z',state:'PAID'});
const hash=async str=>Array.from(new Uint8Array(await crypto.subtle.digest(
 'SHA-256',new TextEncoder().encode(str))),n=>n.toString(16).padStart(2,'0')).join('');
async function fixture(){
 const key=await createEphemeralTestKey();
 const jwt=await signTestSession(key,identity);
 const request=new Request('https://api.example.invalid/test',{headers:{authorization:'Bearer '+jwt}});
 const principal=await createServerIdentityResolver({
  trusted_scope:scope,
  verify_oidc_or_session:createTestHmacVerifier(key),
  read_member:async()=>member,read_session:async()=>session,
  identity_matches:async()=>true,
 })(request,epoch);
 assert.ok(isTrustedPrincipal(principal));
 const ports={
  registry,
  auth:{
   resolveTrustedPrincipal:async()=>principal,
   accountBindingFor:async(u)=>u==='s_001'?'opaque_binding_1':null,
   opaqueActorRefFor:async(u)=>u==='s_001'?'opaque_audit_actor_1':null,
  },
  store:{verifySandboxEvidence:()=>snapshot},
  ledger:{ownerForOriginalTransaction:()=>null,latestEntitlement:()=>null,existingEvent:()=>null},
 };
 const plan=await planSandboxPurchase({store:'apple',evidence:'offline-provider-mock'},ports,time);
 assert.equal(plan.disposition,'new');
 const row={
  outbox:plan.outbox,occurred_at:snapshot.effectiveAt,
  source_event_ref:'a_'+await hash(plan.idempotencyKey),
  resource_ref:'r_'+await hash(snapshot.transactionId),
  payload_digest:plan.payloadDigest,verified_provider:true,committed:true,
 };
 const bridge=(overrideRow=row,claim=null,latest=null,accept=true)=>bindBillingAuditBridge(
  scope,{readCommitted:async()=>overrideRow},{
   lookupByKey:async()=>claim,latestSourceTime:async()=>latest,
  },{
   schemaVersion:'rebuild-p05.0.1-candidate',
   validateForScope:async(s,e)=>accept &&
    e.schema_version==='rebuild-p05.0.1-candidate' &&
    e.brand_id===s.brand_id && e.app_id===s.app_id &&
    e.environment===s.environment && e.event_type==='billing.store_state_observed' &&
    e.idempotency_key===plan.idempotencyKey &&
    Object.keys(e).length===12,
  });
 return {principal,ports,plan,row,bridge};
}
test('latest AI-1 minted principal => latest AI-2 sandbox plan => latest AI-3 redacted Audit candidate',async()=>{
 const f=await fixture();
 const result=await f.bridge().plan('committed_outbox_1');
 assert.equal(result.disposition,'ready');
 assert.equal(result.canonical.event_type,'billing.store_state_observed');
 assert.equal(result.canonical.idempotency_key,f.plan.idempotencyKey);
 assert.equal(isAuditMetadata(result.audit),true);
 assert.equal(result.audit.classification,'metadata_only');
 assert.equal(JSON.stringify(result).includes('Private Name'),false);
 assert.equal(JSON.stringify(result).includes('opaque_binding_1'),false);
 assert.equal(JSON.stringify(result).includes('s_001'),false);
 assert.equal(JSON.stringify(result).includes('trx_1'),false);
 // Still a candidate-only plan: neither module commits to actual D1 nor Queue.
 assert.equal('delivered' in result,false);
 assert.equal('entitlement' in result,false);
});
test('uncommitted/fake-verified Billing rows quarantine; same key plus changed digest quarantines',async()=>{
 const f=await fixture();
 assert.equal((await f.bridge({...f.row,committed:false}).plan('o_1')).disposition,'quarantine');
 assert.equal((await f.bridge({...f.row,verified_provider:false}).plan('o_1')).disposition,'quarantine');
 const canon=await f.bridge().plan('o_1');
 assert.equal((await f.bridge(f.row,{event_id:canon.canonical.event_id,payload_digest:f.row.payload_digest}).plan('o_1')).disposition,'duplicate');
 assert.equal((await f.bridge(f.row,{event_id:canon.canonical.event_id,payload_digest:'0'.repeat(64)}).plan('o_1')).reason,'IDEMPOTENCY_CONFLICT');
});
test('latest AI-2 rejects client-made member and extra verified flags; AI-3 denies schema without owner approval',async()=>{
 const f=await fixture();
 await assert.rejects(planSandboxPurchase({store:'apple',evidence:'offline-provider-mock'},
  {...f.ports,auth:{...f.ports.auth,resolveTrustedPrincipal:async()=>({...f.principal})}},time),/AUTH_DENIED/);
 await assert.rejects(planSandboxPurchase({store:'apple',evidence:'offline-provider-mock',verified:true},f.ports,time),/CLIENT_CLAIMS_DENIED/);
 assert.equal((await f.bridge(f.row,null,null,false).plan('o_1')).reason,'CANONICAL_P05_DENIED');
 const stale=await f.bridge(f.row,null,'2026-10-26T08:10:00Z').plan('o_1');
 assert.equal(stale.disposition,'stale_audit_only');
 assert.equal('entitlement' in stale,false);
});
