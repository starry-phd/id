import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createServerIdentityResolver} from '../../../modules/starry-id-v1/src/index.ts';
import {planSandboxPurchase} from '../../rebuild-billing/src/index.ts';
import {createSandboxBillingD1Writer} from '../../rebuild-billing/src/billing-d1.ts';
import {isCandidate,VERSION,PUBLISHABLE} from '../../ai0-contracts/src/p05-candidate.mjs';
import {createRound4BillingAuditConsumer} from '../src/queue-consumer.ts';
import {createAi3AuditD1Store} from '../src/d1-audit-adapter.ts';
import {dispatchQueueMessage} from '../src/queue-transport.ts';

const now='2026-10-26T09:00:00.000Z',secs=Math.floor(Date.parse(now)/1000);
const scope={brand_id:'starry',app_id:'starry.test',environment:'staging'};
const reg={brandId:'starry',appId:'starry.test',environment:'staging',
 storeEnvironment:'sandbox',store:'apple',storeAppId:'phd.starry.test',
 catalog:{'test.monthly':'subscription'}};
const evidence={brandId:'starry',appId:'starry.test',store:'apple',
 storeEnvironment:'sandbox',storeAppId:'phd.starry.test',sku:'test.monthly',
 kind:'subscription',originalTransactionId:'original-secret-001',
 transactionId:'transaction-secret-001',providerEventId:'event-secret-001',
 accountBinding:'binding_secret_001',periodStartedAt:'2026-10-26T08:00:00Z',
 effectiveAt:'2026-10-26T08:00:00Z',expiresAt:'2026-11-26T08:00:00Z',
 state:'PAID'};
async function serverPlan(){
 const sealed=await createServerIdentityResolver({
  trusted_scope:scope,
  verify_oidc_or_session:async()=>({...scope,provider:'apple',provider_subject:'stable-sub',
   s_user_id:'s_001',session_id:'sess_1',auth_version:1,expires_at:secs+120}),
  read_member:async()=>({s_user_id:'s_001',status:'active',auth_version:1,
   profile_revision:0,display_name:null,directory_opt_in:false,display_name_public:false}),
  read_session:async()=>({session_id:'sess_1',s_user_id:'s_001',auth_version:1,
   app_id:'starry.test',environment:'staging',expires_at:secs+120,revoked_at:null,
   step_up_method:null,step_up_verified_at:null,step_up_expires_at:null}),
  identity_matches:async()=>true,
 })({},secs);
 return planSandboxPurchase({store:'apple',evidence:'opaque:fixture'},{
  registry:reg,
  auth:{resolveTrustedPrincipal:async()=>sealed,
   accountBindingFor:async()=>evidence.accountBinding,
   opaqueActorRefFor:async()=> 'anon_billing_backend'},
  store:{verifySandboxEvidence:async()=>evidence},
  ledger:{ownerForOriginalTransaction:()=>null,latestEntitlement:()=>null,existingEvent:()=>null},
 },now);
}
/**
 * AI-2's actual transaction/reader methods run unchanged, with a test-only
 * D1-shaped backend that records a receipt ONLY if its 5-statement batch
 * succeeds. This is NOT real Cloudflare D1 or an official App Store receipt.
 */
async function billingFixture(){
 const key=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign']);
 const state={committedRow:null,failCommit:false,failRead:false,batches:0,plan:null};
 const db={prepare(sql){return {bind(...args){return {
  sql,args,first:async()=>{
   if(state.failRead)throw Error('Billing D1 temporarily offline');
   if(sql.includes('FROM billing_entitlement WHERE'))return null;
   if(sql.includes('FROM billing_event e JOIN'))return null;
   if(sql.includes('FROM billing_atomic_receipt r'))return state.committedRow;
   return null;
  },
 }}}},
 async batch(stmts){
  state.batches++;assert.equal(stmts.length,5);
  if(state.failCommit)throw Error('transaction rolled back');
  state.committedRow={
   verified_provider:1,guard_applied:1,payload_digest:state.plan.payloadDigest,
   brand_id:'starry',app_id:'starry.test',environment:'staging',
   safe_payload_json:JSON.stringify(state.plan.p05),
  };
  return Array.from({length:5},()=>({success:true}));
 }};
 return {writer:createSandboxBillingD1Writer({db,scope:reg,hmacKey:key}),state};
}
/** The actual AI-3 D1.batch SQL executes in a scoped test-only statement engine. */
function auditFixture(){
 const db={
  inbox:new Map(),audit:new Map(),quarantine:new Map(),failAt:0,batchCount:0,
  prepare(sql){return {bind(...args){return {sql,args}}}},
  async batch(commands){
   this.batchCount++;
   const s={inbox:new Map(this.inbox),audit:new Map(this.audit),quarantine:new Map(this.quarantine)};
   const receipts=[];
   for(let index=0;index<commands.length;index++){
    if(this.failAt===index+1)throw Error('Injected AI-3 D1 batch atomic rollback');
    const {sql,args}=commands[index];
    let meta={changes:0},results=[];
    if(sql.startsWith('INSERT INTO ai3_r4_inbox')){
     const k=args.slice(0,4).join('|');
     if(!s.inbox.has(k)){s.inbox.set(k,{event_id:args[4],payload_digest:args[5]});meta.changes=1;}
    }else if(sql.startsWith('INSERT INTO ai3_r4_audit')){
     const key=args.slice(0,3).join('|')+'|'+args[4];
     const prev=s.inbox.get(key),ak=args.slice(0,4).join('|');
     if(prev&&prev.event_id===args[3]&&prev.payload_digest===args.at(-1)&&!s.audit.has(ak)){
      s.audit.set(ak,{event_id:args[3],idempotency_key:args[4],schema_version:args[5],
       event_type:args[6],occurred_at:args[7],actor_ref:args[8],resource_ref:args[9],
       classification:args[10],result:args[11]});meta.changes=1;
     }
    }else if(sql.startsWith('SELECT event_id,payload_digest')){
     const v=s.inbox.get(args.join('|'));results=v?[v]:[];
    }else if(sql.startsWith('SELECT event_id,idempotency_key')){
     const v=s.audit.get(args.join('|'));results=v?[v]:[];
    }else if(sql.startsWith('INSERT INTO ai3_r4_quarantine')){
     const k=args.join('|');
     if(!s.quarantine.has(k)){s.quarantine.set(k,true);meta.changes=1;}
    }else if(sql.startsWith('SELECT reason FROM ai3_r4_quarantine')){
     results=s.quarantine.has(args.join('|'))?[{reason:args[4]}]:[];
    }else throw Error('unexpected AI-3 SQL in fixture');
    receipts.push({success:true,meta,results});
   }
   this.inbox=s.inbox;this.audit=s.audit;this.quarantine=s.quarantine;
   return receipts;
  },
 };
 return db;
}
async function fixture(){
 const plan=await serverPlan(),billing=await billingFixture(),auditDb=auditFixture();
 billing.state.plan=plan;
 const store=createAi3AuditD1Store(auditDb,scope);
 let order='current',gate=true;
 const consumer=createRound4BillingAuditConsumer(scope,{
  schemaVersion:VERSION,accepts:async(s,p)=>gate&&isCandidate(p,s),
 },billing.writer,store,{afterCommitOrder:async()=>order});
 const actions=[],dlq=[];
 const consume=async(attempt=1,deadLetterOK=true)=>{
  actions.length=0;
  const msg={body:{event_ref:plan.idempotencyKey},attempts:attempt,
   ack:()=>actions.push('ack'),retry:options=>actions.push(['retry',options?.delaySeconds])};
  const deadLetter={persist:async entry=>{
   if(!deadLetterOK)throw Error('DLQ_DOWN');
   dlq.push(entry);
   return {outcome:'durably_written',event_ref:entry.event_ref};
  }};
  const res=await dispatchQueueMessage(msg,consumer,deadLetter);
  return {res,actions:[...actions],dlq:[...dlq]};
 };
 return {plan,billing,auditDb,store,consumer,consume,order:v=>order=v,gate:v=>gate=v};
}
test('same-checkout AI-2 #44 writer + AI-0 #43 P05 + AI-3 audit D1 + Queue delivery',async()=>{
 const f=await fixture(),{plan}=f;
 assert.equal(PUBLISHABLE,false);
 assert.equal(isCandidate(plan.p05,scope),true);
 assert.equal((await f.billing.writer.readAfterCommit(plan.idempotencyKey)),null);
 assert.equal((await f.billing.writer.commit(plan,now)).disposition,'committed');
 const source=await f.billing.writer.readAfterCommit(plan.idempotencyKey);
 assert.equal(source.provider_verified,true);
 assert.equal(source.committed,true);
 assert.equal(source.payload_digest,plan.payloadDigest);
 assert.deepEqual(Object.keys(source.p05).sort(),
  ['brand_id','app_id','environment','schema_version','event_id','event_type',
   'occurred_at','correlation_id','idempotency_key','actor_ref','resource_ref','result','classification'].sort());
 const outcome=await f.consume();
 assert.equal(outcome.res,'acked');
 assert.deepEqual(outcome.actions,['ack']);
 assert.equal(f.auditDb.inbox.size,1);assert.equal(f.auditDb.audit.size,1);
 for(const raw of ['binding_secret_001','transaction-secret-001','s_001','original-secret-001']){
  assert.equal(JSON.stringify([...f.auditDb.audit.values()]).includes(raw),false);
 }
});
test('AI-2 after-commit source missing is retried not quarantined or implicitly ACKed',async()=>{
 const f=await fixture();
 assert.equal((await f.consume(1)).res,'retried');
 assert.equal((await f.consumer.consume(f.plan.idempotencyKey,1)).reason,'SOURCE_NOT_YET_COMMITTED');
 assert.equal(f.auditDb.audit.size,0);assert.equal(f.auditDb.quarantine.size,0);
 await f.billing.writer.commit(f.plan,now);
 assert.deepEqual((await f.consume(2)).actions,['ack']);
});
test('atomic Billing commit failure rolls back source and retries with no audit',async()=>{
 const f=await fixture();f.billing.state.failCommit=true;
 await assert.rejects(f.billing.writer.commit(f.plan,now),/BILLING_ATOMIC_BATCH_FAILED/);
 assert.equal((await f.consume(1)).res,'retried');
 assert.equal(f.auditDb.inbox.size,0);assert.equal(f.auditDb.audit.size,0);
 f.billing.state.failCommit=false;await f.billing.writer.commit(f.plan,now);
 assert.equal((await f.consume(2)).res,'acked');
});
test('duplicate delivery after lost ACK is idempotent across real AI-2 reader and AI-3 D1 batch',async()=>{
 const f=await fixture();await f.billing.writer.commit(f.plan,now);
 assert.equal((await f.consume(1)).res,'acked');
 assert.equal((await f.consume(2)).res,'acked');
 assert.equal(f.auditDb.audit.size,1);assert.equal(f.auditDb.inbox.size,1);
});
test('conflicting source digest after commit quarantines and never changes original audit',async()=>{
 const f=await fixture();await f.billing.writer.commit(f.plan,now);
 assert.equal((await f.consume()).res,'acked');
 f.billing.state.committedRow={...f.billing.state.committedRow,
  payload_digest:'c'.repeat(64)};
 assert.equal((await f.consume(2)).res,'acked'); // safe ONLY after quarantine receipt
 assert.equal(f.auditDb.audit.size,1);assert.equal(f.auditDb.quarantine.size,1);
});
test('stale provider refund/notification candidate remains quarantined; no entitlement changed by AI-3',async()=>{
 const f=await fixture();await f.billing.writer.commit(f.plan,now);
 f.order('superseded');
 assert.equal((await f.consume()).res,'acked');
 assert.equal(f.auditDb.audit.size,0);
 assert.equal(f.auditDb.quarantine.size,1);
 assert.equal(typeof f.consumer.commitEntitlement,'undefined');
});
test('audit D1 transaction failure requires retry; DLQ writes must persist before ACK',async()=>{
 const f=await fixture();await f.billing.writer.commit(f.plan,now);
 f.auditDb.failAt(2);
 const r=await f.consume(1);
 assert.equal(r.res,'retried');assert.equal(f.auditDb.audit.size,0);
 const noDlq=await f.consume(5,false);
 assert.equal(noDlq.res,'retried');assert.equal(noDlq.actions.some(x=>x==='ack'),false);
 const yesDlq=await f.consume(5,true);
 assert.equal(yesDlq.res,'dlq_acked');assert.deepEqual(yesDlq.actions,['ack']);
 assert.deepEqual(Object.keys(yesDlq.dlq[0]),['event_ref','reason_code','attempt']);
 assert.equal(f.auditDb.audit.size,0);
});
test('quarantine D1 outage cannot ACK even with authoritative committed Billing source',async()=>{
 const f=await fixture();await f.billing.writer.commit(f.plan,now);
 f.gate(false);f.auditDb.failAt(1);
 assert.equal((await f.consume(1)).res,'retried');
 assert.equal(f.auditDb.quarantine.size,0);assert.equal(f.auditDb.audit.size,0);
});
test('real AI-2 committed-reader database outage is retried and never acknowledged as valid',async()=>{
 const f=await fixture();await f.billing.writer.commit(f.plan,now);
 f.billing.state.failRead=true;
 assert.equal((await f.consume(1)).res,'retried');
 assert.equal(f.auditDb.audit.size,0);
});
