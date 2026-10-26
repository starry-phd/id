import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createServerIdentityResolver} from '../../../modules/starry-id-v1/src/index.ts';
import {planSandboxPurchase} from '../src/index.ts';
import {createSandboxBillingD1Writer} from '../src/billing-d1.ts';
import {createRound4BillingAuditConsumer} from '../../../packages/rebuild-ai3/src/queue-consumer.ts';
import {dispatchQueueMessage} from '../../../packages/rebuild-ai3/src/queue-transport.ts';
import {isCandidate,VERSION,PUBLISHABLE} from '../../../packages/ai0-contracts/src/p05-candidate.mjs';

const now='2026-10-26T09:00:00.000Z',sec=Date.parse(now)/1000;
const scope={brandId:'starry',appId:'starry.test',environment:'staging',
 storeEnvironment:'sandbox',store:'apple',storeAppId:'phd.starry.test'};
const ai3Scope={brand_id:'starry',app_id:'starry.test',environment:'staging'};
const snapshot={brandId:'starry',appId:'starry.test',store:'apple',
 storeEnvironment:'sandbox',storeAppId:'phd.starry.test',
 sku:'test.monthly',kind:'subscription',originalTransactionId:'orig1',
 transactionId:'tx1',providerEventId:'evt1',accountBinding:'binding_001',
 periodStartedAt:'2026-10-26T08:00:00Z',
 effectiveAt:'2026-10-26T08:00:00Z',expiresAt:'2026-11-26T08:00:00Z',state:'PAID'};
async function plan(){
 const principal=await createServerIdentityResolver({
  trusted_scope:ai3Scope,
  verify_oidc_or_session:async()=>({
   brand_id:'starry',app_id:'starry.test',environment:'staging',
   provider:'apple',provider_subject:'subject-1',
   s_user_id:'s_001',session_id:'session_1',auth_version:1,expires_at:sec+3600}),
  read_member:async()=>({s_user_id:'s_001',status:'active',auth_version:1,
   profile_revision:1,display_name:null,directory_opt_in:false,display_name_public:false}),
  read_session:async()=>({session_id:'session_1',s_user_id:'s_001',
   app_id:'starry.test',environment:'staging',auth_version:1,revoked_at:null,
   expires_at:sec+3600,step_up_method:null,step_up_verified_at:null,step_up_expires_at:null}),
  identity_matches:async()=>true,
 })({syntheticSession:'not-a-real-provider'},sec);
 return planSandboxPurchase({store:'apple',evidence:'offline-fixture'},{
  registry:{...scope,catalog:{'test.monthly':'subscription'}},
  auth:{resolveTrustedPrincipal:async()=>principal,
   accountBindingFor:async()=> 'binding_001',
   opaqueActorRefFor:async()=> 'actor_opaque_001'},
  store:{verifySandboxEvidence:async()=>snapshot},
  ledger:{ownerForOriginalTransaction:()=>null,latestEntitlement:()=>null,existingEvent:()=>null},
 },now);
}
async function env(){
 const p=await plan();
 const state={after:null,order:null,batchCount:0,
  inbox:new Set(),quarantine:[],inboxDown:false,quarantineDown:false};
 const db={
  prepare(sql){return {bind(...args){return {sql,args,first:async()=>{
   if(sql.includes('AS source_time'))return state.order;
   if(sql.includes('FROM billing_atomic_receipt r'))return state.after;
   return null;
  }};}}},
  async batch(stmts){
   state.batchCount++;
   state.after={verified_provider:1,guard_applied:1,brand_id:'starry',
    app_id:'starry.test',environment:'staging',payload_digest:p.payloadDigest,
    safe_payload_json:JSON.stringify(p.p05)};
   state.order={source_time:snapshot.effectiveAt,latest_time:snapshot.effectiveAt,
    applied_key:p.idempotencyKey,right_status:'active'};
   return stmts.map(()=>({success:true}));
  },
 };
 const key=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign']);
 const writer=createSandboxBillingD1Writer({db,scope,hmacKey:key});
 const audit={
  claimAndAppendAtomically:async c=>{
   if(state.inboxDown)throw new Error('audit-DB-down');
   if(state.inbox.has(c.key))return 'duplicate';
   state.inbox.add(c.key);return 'inserted';
  },
  recordQuarantine:async(_scope,ref,reason)=>{
   if(state.quarantineDown)throw new Error('quarantine-DB-down');
   state.quarantine.push({ref,reason});
  },
 };
 // Test-only authority: AI-0 PUBLISHABLE remains FALSE, no real Queue is emitted.
 const authority={schemaVersion:VERSION,
  accepts:async (sc,p05)=>isCandidate(p05,sc)};
 const consumer=createRound4BillingAuditConsumer(ai3Scope,authority,writer,audit,writer);
 return {state,writer,consumer,p,authority};
}
test('AI-0 13-field canonical shape is test-compatible but not publishable',async()=>{
 const x=await env();
 assert.equal(PUBLISHABLE,false);
 assert.equal(isCandidate(x.p.p05,ai3Scope),true);
});
test('same checkout REAL AI-2 committed reader/order drives REAL AI-3 consumer after D1 batch',async()=>{
 const x=await env();
 const before=await x.consumer.consume(x.p.idempotencyKey,1);
 assert.equal(before.outcome,'retry');
 assert.equal(before.ack_safe,false);
 assert.equal(before.reason,'SOURCE_NOT_YET_COMMITTED');
 assert.equal(x.state.inbox.size,0);
 assert.equal(x.state.quarantine.length,0);
 await x.writer.commit(x.p,now);
 const first=await x.consumer.consume(x.p.idempotencyKey,1);
 assert.deepEqual([first.outcome,first.ack_safe],['ack',true]);
 const duplicate=await x.consumer.consume(x.p.idempotencyKey,2);
 assert.equal(duplicate.outcome,'ack');
 assert.equal(x.state.inbox.size,1);
});
test('AI-2 DB temporal source rejects superseded refund event from AI-3 audit inbox',async()=>{
 const x=await env();await x.writer.commit(x.p,now);
 x.state.order={source_time:snapshot.effectiveAt,
  latest_time:'2026-11-26T09:00:00Z',applied_key:'another_event',right_status:'active'};
 const result=await x.consumer.consume(x.p.idempotencyKey,1);
 assert.equal(result.outcome,'quarantine_recorded');
 assert.equal(x.state.quarantine[0].reason,'STALE_BILLING_EVENT');
 assert.equal(x.state.inbox.size,0);
});
test('uncertain source ordering retries then requires durable DLQ before ACK',async()=>{
 const x=await env();await x.writer.commit(x.p,now);
 x.state.order={source_time:snapshot.effectiveAt,
  latest_time:snapshot.effectiveAt,applied_key:'unknown_event',right_status:'active'};
 const decision=await x.consumer.consume(x.p.idempotencyKey,1);
 assert.equal(decision.outcome,'retry');assert.equal(decision.ack_safe,false);
 const attempts=5;
 const queue={body:{event_ref:x.p.idempotencyKey},attempts,
  ack(){throw Error('must not ack without durable DLQ');},
  retry(){this.retried=true;}};
 const broken={persist:async()=>{throw Error('DLQ-unavailable')}};
 const status=await dispatchQueueMessage(queue,x.consumer,broken);
 assert.equal(status,'retried');assert.equal(queue.retried,true);
});
test('AI-3 source read error and canonical denial prevent inbox writes and ACK',async()=>{
 const x=await env();await x.writer.commit(x.p,now);
 const denied=createRound4BillingAuditConsumer(ai3Scope,
  {schemaVersion:VERSION,accepts:async()=>false},x.writer,{
   claimAndAppendAtomically:async()=>{throw Error('must-not-write');},
   recordQuarantine:async(_scope,ref,reason)=>x.state.quarantine.push({ref,reason}),
  },x.writer);
 const d=await denied.consume(x.p.idempotencyKey,1);
 assert.equal(d.outcome,'quarantine_recorded');
 assert.equal(x.state.quarantine[0].reason,'AI0_P05_NOT_APPROVED');
 const unavailable=createRound4BillingAuditConsumer(ai3Scope,x.authority,{
  readAfterCommit:async()=>{throw Error('D1 unreachable');}
 },{
  claimAndAppendAtomically:async()=>{throw Error('must-not-write');},
  recordQuarantine:async()=>{throw Error('must-not-quarantine');},
 },x.writer);
 const q=await unavailable.consume(x.p.idempotencyKey,1);
 assert.equal(q.outcome,'retry');assert.equal(q.ack_safe,false);
});
test('quarantine DB outage cannot ACK unverified client-supplied record',async()=>{
 const x=await env();x.state.quarantineDown=true;
 const a=await x.consumer.consume(x.p.idempotencyKey,1);
 assert.equal(a.outcome,'retry');assert.equal(a.ack_safe,false);
});
test('wrong Starry scope cannot bypass Billing afterCommitOrder',async()=>{
 const x=await env();await x.writer.commit(x.p,now);
 const y=await x.writer.afterCommitOrder({brand_id:'hglobal',
  app_id:'starry.test',environment:'staging'},x.p.idempotencyKey);
 assert.equal(y,'unknown');
});
