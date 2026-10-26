import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {signServerSession} from '../../../modules/starry-id-v1/src/session-crypto.ts';
import {createMemberPreviewSdk} from '../../../packages/sdk/src/member-preview.ts';
import {createOfflineRound5Vertical} from '../test-support/round5-vertical.ts';
import {isCandidate,VERSION,PUBLISHABLE} from '../../../packages/ai0-contracts/src/p05-candidate.mjs';
import {handleRequest} from '../src/index.ts';

const t=1793000000,now=new Date(t*1000).toISOString();
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const registry={brandId:'starry',appId:'starry-id',environment:'staging',
 storeEnvironment:'sandbox',store:'apple',storeAppId:'phd.starry.test',
 catalog:{'test.monthly':'subscription'}};
const user='s_member1',binding='123e4567-e89b-42d3-a456-426614174000';
const claims={...scope,provider:'apple',provider_subject:'stable_sub1',
 s_user_id:user,session_id:'sess_1',auth_version:4,
 issued_at:t,expires_at:t+400,key_id:'kid_fixture'};
const member={s_user_id:user,status:'active',auth_version:4,profile_revision:2,
 display_name:'Private Member',directory_opt_in:0,display_name_public:0};
const session={session_id:'sess_1',s_user_id:user,auth_version:4,
 app_id:'starry-id',environment:'staging',expires_at:t+400,revoked_at:null,
 step_up_method:null,step_up_verified_at:null,step_up_expires_at:null};
const snapshot={brandId:'starry',appId:'starry-id',store:'apple',storeEnvironment:'sandbox',
 storeAppId:'phd.starry.test',sku:'test.monthly',kind:'subscription',
 originalTransactionId:'secretOriginal1',transactionId:'secretTransaction1',
 providerEventId:'secretProvider1',accountBinding:binding,
 periodStartedAt:new Date((t-3600)*1000).toISOString(),
 effectiveAt:new Date((t-3600)*1000).toISOString(),
 expiresAt:new Date((t+2500000)*1000).toISOString(),state:'PAID'};

async function fixture() {
 const sessionKey=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
 const billingKey=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const st={member:{...member},session:{...session},linked:true,clock:t,storeSnapshot:{...snapshot},
  providerCalls:0,candidate:true,order:'current',billingAbort:false,auditAbort:false,quarantineAbort:false,
  dlqAbort:false,stored:null,billingBatches:0,auditBatches:0,queueActions:[],dlq:[],
  inbox:new Map(),audit:new Map(),quarantine:new Map()};
 const identityDb={prepare(sql){return {bind(...args){return {async first(){
  if(sql.startsWith('SELECT s_user_id,status,auth_version'))return args[0]===user?st.member:null;
  if(sql.startsWith('SELECT session_id,s_user_id'))return args[0]==='sess_1'?st.session:null;
  if(sql.startsWith('SELECT 1 AS matched FROM starry_identities'))
   return st.linked&&args.join('|')==='apple|stable_sub1|'+user?{matched:1}:null;
  if(sql.startsWith('SELECT s_user_id,app_id,environment,store,store_app_id'))
   return args[0]===user?{s_user_id:user,app_id:'starry-id',environment:'staging',
    store:'apple',store_app_id:registry.storeAppId,store_environment:'sandbox',
    account_binding:binding,revoked_at:null,expires_at:null}:null;
  throw Error('UNEXPECTED_IDENTITY_SQL');
 },async run(){throw Error('ID_READ_ONLY');}};}}}};
 const billingDb={prepare(sql){return {bind(...args){return {sql,args,async first(){
  if(sql.includes('FROM billing_entitlement WHERE'))return null;
  if(sql.includes('FROM billing_event e JOIN'))return null;
  if(sql.includes('FROM billing_atomic_receipt r'))return st.stored;
  throw Error('UNEXPECTED_BILLING_SQL');
 }};}};},async batch(statements){
  st.billingBatches++;
  if(st.billingAbort)throw Error('BILLING_ATOMIC_ROLLBACK');
  assert.equal(statements.length,5);
  st.stored={verified_provider:1,guard_applied:1,payload_digest:statements[1].args[11],
   brand_id:'starry',app_id:'starry-id',environment:'staging',
   safe_payload_json:statements[3].args[5]};
  return Array.from({length:5},()=>({success:true}));
 }};
 const auditDb={prepare(sql){return {bind(...args){return {sql,args}}}},
  async batch(statements){
   st.auditBatches++;
   if(st.auditAbort)throw Error('AUDIT_ATOMIC_ROLLBACK');
   const inbox=new Map(st.inbox),audit=new Map(st.audit),quarantine=new Map(st.quarantine);
   const receipts=[];
   for(const {sql,args} of statements){
    const result={success:true,meta:{changes:0},results:[]};
    if(sql.startsWith('INSERT INTO ai3_r4_inbox')){
     const key=args.slice(0,4).join('|');
     if(!inbox.has(key)){inbox.set(key,{event_id:args[4],payload_digest:args[5]});result.meta.changes=1;}
    }else if(sql.startsWith('INSERT INTO ai3_r4_audit')){
     const k=args.slice(0,3).join('|')+'|'+args[4];
     const row=inbox.get(k),id=args.slice(0,4).join('|');
     if(row?.event_id===args[3]&&row.payload_digest===args.at(-1)&&!audit.has(id)){
      audit.set(id,{event_id:args[3],idempotency_key:args[4],schema_version:args[5],
       event_type:args[6],occurred_at:args[7],actor_ref:args[8],
       resource_ref:args[9],classification:args[10],result:args[11]});
      result.meta.changes=1;
     }
    }else if(sql.startsWith('SELECT event_id,payload_digest')){
     const row=inbox.get(args.join('|'));result.results=row?[row]:[];
    }else if(sql.startsWith('SELECT event_id,idempotency_key')){
     const row=audit.get(args.join('|'));result.results=row?[row]:[];
    }else if(sql.startsWith('INSERT INTO ai3_r4_quarantine')){
     if(st.quarantineAbort)throw Error('QUARANTINE_ABORT');
     const k=args.join('|');if(!quarantine.has(k)){quarantine.set(k,true);result.meta.changes=1;}
    }else if(sql.startsWith('SELECT reason FROM ai3_r4_quarantine')){
     result.results=quarantine.has(args.join('|'))?[{reason:args[4]}]:[];
    }else throw Error('UNEXPECTED_AUDIT_SQL');
    receipts.push(result);
   }
   st.inbox=inbox;st.audit=audit;st.quarantine=quarantine;
   return receipts;
  }
 };
 const system=createOfflineRound5Vertical({
  offline_fixture_only:true,scope,registry,identityDb,billingDb,auditDb,
  nowSeconds:()=>st.clock,resolveSessionKey:async kid=>kid==='kid_fixture'?sessionKey:null,
  billingHmacKey:billingKey,
  serverActorFor:async u=>u===user?'anon_offline_one':null,
  verifiedSandboxStore:{verifySandboxEvidence:async()=>{
   st.providerCalls++;return st.storeSnapshot;
  }},
  ledger:{ownerForOriginalTransaction:()=>null,latestEntitlement:()=>null,existingEvent:()=>null},
  serverOrder:{afterCommitOrder:async()=>st.order},
  candidateAuthority:{schemaVersion:VERSION,accepts:async(s,e)=>st.candidate&&isCandidate(e,s)},
  dlq:{persist:async record=>{
   if(st.dlqAbort)throw Error('DLQ_UNAVAILABLE');
   st.dlq.push(record);return {outcome:'durably_written',event_ref:record.event_ref};
  }}
 });
 const token=await signServerSession(claims,scope,t,{kid:'kid_fixture',key:sessionKey});
 const request=(tokenArg=token,headers={})=>new Request('https://example.test/__offline/billing/commit',
  {method:'POST',headers:{authorization:'Bearer '+tokenArg,...headers}});
 const queue=(eventRef,attempts=1)=>({body:{event_ref:eventRef},attempts,
  ack:()=>st.queueActions.push('ack'),
  retry:o=>st.queueActions.push(['retry',o?.delaySeconds])});
 return {st,system,request,queue,token};
}
test('full offline AI1 signed Session+D1, SDK Member, AI2 planner+atomic writer, AI0 P05, AI3 D1 inbox+Queue ACK',async()=>{
 const f=await fixture();
 const sdk=createMemberPreviewSdk('https://example.test',async()=>f.token,
  async(url,init)=>f.system.member(new Request(url,init)));
 const p=await sdk.readSelf();
 assert.equal(p.s_user_id,user);assert.equal(p.display_name,'Private Member');
 const paid=await f.system.purchaseOffline(f.request(),'opaque:offline-sandbox',now);
 assert.equal(paid.disposition,'committed');
 assert.match(paid.eventRef,/^b_[a-f0-9]{64}$/);
 assert.equal(f.st.providerCalls,1);
 assert.equal(f.st.billingBatches,1);assert.ok(f.st.stored);
 assert.equal(await f.system.dispatchOffline(f.queue(paid.eventRef)),'acked');
 assert.equal(f.st.audit.size,1);assert.equal(f.st.inbox.size,1);
 assert.deepEqual(f.st.queueActions,['ack']);
 assert.equal(await f.system.dispatchOffline(f.queue(paid.eventRef,2)),'acked');
 assert.equal(f.st.audit.size,1);
 assert.equal(PUBLISHABLE,false);
 assert.equal(handleRequest(new Request('https://example.test/v1/member/self'),
  {STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'}).status,404);
 assert.equal(handleRequest(new Request('https://example.test/__offline/billing/commit'),
  {STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'}).status,404);
});
test('suspended user, revoked Session, forged signature and untrusted header never call provider nor write Billing',async()=>{
 for(const mutation of ['revoked','suspended','version','wrong_key']){
  const f=await fixture();
  if(mutation==='revoked')f.st.session.revoked_at=t;
  if(mutation==='suspended')f.st.member.status='suspended';
  if(mutation==='version')f.st.session.auth_version=5;
  const auth=mutation==='wrong_key'?f.token+'tamper':f.token;
  await assert.rejects(f.system.purchaseOffline(f.request(auth),'test',now),/R5_AUTH_DENIED/);
  assert.equal(f.st.providerCalls,0);assert.equal(f.st.billingBatches,0);
 }
 const f=await fixture();
 await assert.rejects(f.system.purchaseOffline(f.request(f.token,{'x-admin-verified':'true'}),'test',now),
  /R5_BILLING_REQUEST_DENIED/);
 assert.equal(f.st.providerCalls,0);
});
test('missing Billing commit retries without ACK or premature quarantine, even when quarantine storage is down',async()=>{
 const f=await fixture();
 const failedKey='b_'+'a'.repeat(64);
 assert.equal(await f.system.dispatchOffline(f.queue(failedKey)),'retried');
 assert.equal(f.st.audit.size,0);assert.equal(f.st.quarantine.size,0);
 assert.equal(f.st.queueActions[0][0],'retry');
 const g=await fixture();g.st.quarantineAbort=true;
 assert.equal(await g.system.dispatchOffline(g.queue(failedKey)),'retried');
 assert.equal(g.st.audit.size,0);assert.equal(g.st.queueActions[0][0],'retry');
});
test('AI0 candidate denial never creates audit; Store binding mismatch never commits',async()=>{
 const f=await fixture(),r=await f.system.purchaseOffline(f.request(),'test',now);
 f.st.candidate=false;
 assert.equal(await f.system.dispatchOffline(f.queue(r.eventRef)),'acked');
 assert.equal(f.st.audit.size,0);assert.equal(f.st.quarantine.size,1);
 const x=await fixture();x.st.storeSnapshot={...snapshot,accountBinding:'wrong_binding'};
 await assert.rejects(x.system.purchaseOffline(x.request(),'test',now),/ACCOUNT_BINDING_DENIED/);
 assert.equal(x.st.billingBatches,0);
});
test('audit D1 rollback forbids ACK; exhausted retry requires durable DLQ receipt',async()=>{
 const f=await fixture(),r=await f.system.purchaseOffline(f.request(),'test',now);
 f.st.auditAbort=true;
 assert.equal(await f.system.dispatchOffline(f.queue(r.eventRef,1)),'retried');
 assert.equal(f.st.queueActions.some(a=>a==='ack'),false);
 f.st.dlqAbort=true;
 assert.equal(await f.system.dispatchOffline(f.queue(r.eventRef,5)),'retried');
 assert.equal(f.st.queueActions.some(a=>a==='ack'),false);
 f.st.dlqAbort=false;
 assert.equal(await f.system.dispatchOffline(f.queue(r.eventRef,5)),'dlq_acked');
 assert.equal(f.st.dlq.length,1);
 assert.equal(f.st.audit.size,0);
});
test('wrong scope, production runtime and fake queue identity fail before owner ports',async()=>{
 const f=await fixture();
 await assert.rejects(f.system.purchaseOffline(f.request(),'test','2030-01-01T00:00:00.000Z'),
  /R5_CLOCK_DENIED/);
 const key='b_'+'a'.repeat(64);
 assert.equal(await f.system.dispatchOffline({...f.queue(key),body:{event_ref:key,paid:true}}),'retried');
 assert.equal(f.st.queueActions.some(a=>a==='ack'),false);
});


test('round6: missing committed Billing source retries every pre-exhaustion delivery; no ACK, no quarantine, no DLQ',async()=>{
 const f=await fixture();
 const absent='b_'+'f'.repeat(64);
 for(let attempt=1;attempt<=4;attempt++){
  assert.equal(await f.system.dispatchOffline(f.queue(absent,attempt)),'retried');
  assert.deepEqual(f.st.queueActions.at(-1)[0],'retry');
  assert.equal(f.st.quarantine.size,0);
  assert.equal(f.st.inbox.size,0);
  assert.equal(f.st.audit.size,0);
  assert.equal(f.st.dlq.length,0);
  assert.equal(f.st.queueActions.includes('ack'),false);
 }
});
test('round6: formerly missing source becomes ACK-safe only after authoritative Billing commit and AI3 atomic readback',async()=>{
 const f=await fixture();
 const r=await f.system.purchaseOffline(f.request(),'opaque:offline-sandbox',now);
 const committed=f.st.stored;
 f.st.stored=null; // Simulated visibility gap; no accepted HTTP claim may replace it.
 for(let attempt=1;attempt<=3;attempt++){
  assert.equal(await f.system.dispatchOffline(f.queue(r.eventRef,attempt)),'retried');
  assert.equal(f.st.quarantine.size,0);
  assert.equal(f.st.queueActions.includes('ack'),false);
 }
 f.st.stored=committed; // authoritative committed source is now visible
 assert.equal(await f.system.dispatchOffline(f.queue(r.eventRef,4)),'acked');
 assert.equal(f.st.audit.size,1);
 assert.equal(f.st.inbox.size,1);
 assert.equal(f.st.quarantine.size,0);
 assert.equal(f.st.queueActions.filter(a=>a==='ack').length,1);
});
test('round6: forged committed-looking Queue body cannot replace missing AI2 source',async()=>{
 const f=await fixture();
 const absent='b_'+'c'.repeat(64);
 for(const extras of [{committed:true,provider_verified:true},{authorization:'mock'},{p05:{}}]){
  assert.equal(await f.system.dispatchOffline({...f.queue(absent),body:{event_ref:absent,...extras}}),'retried');
  assert.equal(f.st.queueActions.includes('ack'),false);
  assert.equal(f.st.quarantine.size,0);
 }
});
