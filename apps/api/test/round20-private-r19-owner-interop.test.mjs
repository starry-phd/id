import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {createOfflineCanonicalAuthDeletionPublisher} from
 '../../../modules/starry-id-v1/src/round16-canonical-deletion-publisher.ts';
import {createOfflineAuthCrossDomainDTO} from
 '../../../modules/starry-id-v1/src/round19-auth-cross-domain-dto.ts';
import {createOfflineBillingR19ReceiptReview} from
 '../../../packages/rebuild-billing/src/r19-saga-receipt.ts';
import {createOfflineR19TaskWalletReview} from
 '../../../packages/rebuild-ai3/src/r19-task-wallet-receipt-gate.ts';
import {createR19OfflineFourDomainWire} from
 '../src/round19-offline-four-domain-wiring.ts';
import {createR20PrivateOwnerInterop,R20_LIVE_OWNER_FANOUT_ENABLED,
 R20_SIGNED_EXTERNAL_AUTH_SOURCE_APPROVED,R20_TRUSTED_IDENTITY_MAPPING_APPROVED,
 R20_PHYSICAL_QUEUE_ACK_APPROVED} from
 '../src/round20-private-r19-owner-interop.ts';

const epoch=1793000000,event='starry-delete-'+'a'.repeat(64);
const scope={brand_id:'starry',environment:'staging'};
const ref=c=>'r_'+c.repeat(64);
const billingRequest={brand_id:'starry',environment:'staging',app_ref:ref('a'),
 store_app_ref:ref('b'),member_ref:'m_'+'c'.repeat(64),
 source_event_id:event,source_commit_ref:ref('d'),event_ref:ref('e'),
 event_digest:'f'.repeat(64),auth_version:4,occurred_at_sec:epoch,
 store:'apple',transaction_ref:ref('1'),refund_event_ref:ref('2'),
 refund_source_version:11,refund_kind:'CHARGEBACK'};
const flags=r=>{
 for(const k of ['may_ack_queue','may_dlq','may_release_task','may_settle_task',
  'may_regrant','may_restore','may_publish','may_sell_battery','publishable','live'])
  assert.equal(r[k],false,k);
 assert.equal(Object.isFrozen(r),true);
 assert.equal(r.missing_authorities.length,5);
};
const sqlPort=db=>({prepare:sql=>({bind:(...args)=>({
 first:async()=>db.prepare(sql).get(...args)??null,
 all:async()=>db.prepare(sql).all(...args)
})})});
function fixture(){
 // FIVE independent physical SQLite :memory: connections, no attached DB.
 const auth=new DatabaseSync(':memory:'),
  billing=new DatabaseSync(':memory:'),
  battery=new DatabaseSync(':memory:'),
  task=new DatabaseSync(':memory:'),
  sagaDb=new DatabaseSync(':memory:');
 const load=(base,file)=>readFileSync(new URL(base+file,import.meta.url),'utf8');
 auth.exec('PRAGMA foreign_keys=ON');
 for(const name of ['001_starry_identity.DRAFT.sql',
  '007_starry_age_deletion_admin.UP.DRAFT.sql',
  '011_starry_one_use_deletion.UP.DRAFT.sql',
  '012_starry_stepup_challenge_scope.UP.DRAFT.sql',
  '013_starry_deletion_source_immutability.UP.DRAFT.sql'])
  auth.exec(load('../../../modules/starry-id-v1/schema/',name));
 auth.exec(load('../../../modules/starry-id-v1/test/fixtures/',
  'round16_auth_dispatch_lease.DRAFT.sql'));
 auth.prepare("INSERT INTO starry_members VALUES('u1','active',3,1,'profile',1,1,?,?)")
  .run(epoch,epoch);
 const ins=auth.prepare("INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
 ins.run('s1','u1','app-a','staging',3,'a'.repeat(64),epoch+120,'passkey',epoch-5,epoch+90);
 ins.run('s2','u1','app-b','staging',3,'b'.repeat(64),epoch+120,null,null,null);
 // Real Battery base schema and disjoint test-only Task/Session projections.
 battery.exec(load('../../../packages/rebuild-ai3/schema/','0005_free_battery_DRAFT.sql'));
 battery.exec(load('../../../packages/rebuild-ai3/schema/','0010_auth_delete_battery_inbox_DRAFT.sql'));
 task.exec('CREATE TABLE ai3_r19_test_task_projection(task_ref TEXT,member_ref TEXT,environment TEXT,source_event_ref TEXT,status TEXT,commit_attempt INTEGER,completed_at_ms INTEGER,policy_version INTEGER)');
 auth.exec('CREATE TABLE ai3_r19_test_auth_projection(member_ref TEXT,environment TEXT,status TEXT,auth_version INTEGER,session_revoked INTEGER,policy_version INTEGER)');
 sagaDb.exec('CREATE TABLE local_observation(event_id TEXT PRIMARY KEY,scope TEXT)');
 let legal=true,retention=true,revision='policy-r19-draft',clock=epoch;
 let authReads=0,billingReads=0,batteryReads=0,sagaReads=0;
 const authDb={prepare(sql){authReads++;return sqlPort(auth).prepare(sql)}};
 const lawful=async()=>legal, retained=async()=>retention, now=()=>clock;
 const issuer=createOfflineCanonicalAuthDeletionPublisher({enabled:true,
  scope,db:authDb,lawfulDeletionProcessingApprovedNow:lawful,readServerNow:now});
 const authAdapter=createOfflineAuthCrossDomainDTO({enabled:true,scope,
  db:authDb,lawfulDeletionProcessingApprovedNow:lawful,
  lawfulMinimalRetentionApprovedNow:retained,
  readApprovedPolicyRevisionNow:async()=>revision,readServerNow:now});
 const billScope={...scope,app_ref:billingRequest.app_ref,store_app_ref:billingRequest.store_app_ref};
 const billingAdapter=createOfflineBillingR19ReceiptReview({enabled:true,
  scope:billScope,billingDb:{prepare(sql){billingReads++;return sqlPort(billing).prepare(sql)}},
  ports:{lawfulProcessingAndRetention:async()=>legal&&retention,
   readDeletedAuth:async()=>null,readStoreCandidate:async()=>null,
   readIndependentFloorCandidate:async()=>null}});
 const batteryAdapter=createOfflineR19TaskWalletReview({enabled:true,scope,
  authDb:sqlPort(auth),taskDb:sqlPort(task),
  batteryDb:{prepare(sql){batteryReads++;return sqlPort(battery).prepare(sql)}},
  provenance:{readCandidate:async()=>null},
  floor:{readCandidate:async()=>null},
  lawfulPurposeNow:lawful,lawfulRetentionNow:retained,
  approvedPolicyVersionNow:async()=>1});
 const saga=createR19OfflineFourDomainWire(scope,'policy-r19-draft',{
  readPolicy:async()=>({revision,processing_approved:legal,retention_approved:retention}),
  inspectAuth:async()=>null,readBilling:async()=>null,
  inspectBattery:async()=>null,readTask:async()=>null,
  inspectExistingSaga:async()=>{sagaReads++;return {status:'blocked'};}
 });
 const law=async()=>({revision,processing_approved:legal,retention_approved:retention});
 const interop=createR20PrivateOwnerInterop(scope,'policy-r19-draft',
  {auth:authAdapter,billing:billingAdapter,battery:batteryAdapter,saga,readLaw:law});
 function commit(){
  auth.prepare('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?,?,?,NULL)')
   .run('a'.repeat(64),'u1','s1',3,event,epoch,epoch+60);
  assert.equal(auth.prepare('UPDATE starry_deletion_challenges SET consumed_at=? WHERE challenge_ref=?')
   .run(epoch,'a'.repeat(64)).changes,1);
 }
 const close=()=>{for(const x of [auth,billing,battery,task,sagaDb])x.close()};
 return {auth,billing,battery,task,sagaDb,issuer,authAdapter,billingAdapter,
  batteryAdapter,saga,interop,commit,close,
  setLaw:v=>{legal=v},setRetention:v=>{retention=v},
  setRevision:v=>{revision=v},setClock:v=>{clock=v},
  get authReads(){return authReads},get billingReads(){return billingReads},
  get batteryReads(){return batteryReads},get sagaReads(){return sagaReads}};
}
test('R20 REAL R19 Auth/Billing/Battery adapters run against 5 separate SQLite: mapping absent BLOCKS',async()=>{
 const f=fixture();try{
  f.commit();const claim=await f.issuer.claim(event);assert.ok(claim);
  const source=await f.authAdapter.readForOfflineConsumer(claim,'saga',scope);
  assert.equal(source?.disposition,'offline_untrusted_cross_domain_auth_projection');
  assert.equal(source?.event.member_ref,'u1');
  const bill=await f.billingAdapter.inspect(billingRequest);
  assert.equal(bill.status,'retry');assert.equal(bill.reason,'STORE_ORIGIN_MISSING');
  const wallet=await f.batteryAdapter.inspect('u1','task_01',epoch*1000);
  assert.equal(wallet.status,'blocked');assert.equal(wallet.reason,'AUTH_NOT_CURRENT_OR_MEMBER_REVOKED');
  const r=await f.interop.review(claim,billingRequest,'u1','task_01',epoch);
  assert.equal(r.status,'blocked');assert.equal(r.reason,'OWNER_R19_RECEIPT_NOT_CURRENT_OR_LOCALLY_COMMITTED');
  assert.equal(r.owner_observation.auth,'offline_candidate_only');
  assert.equal(r.owner_observation.billing,'retry');
  assert.equal(r.owner_observation.battery,'blocked');
  assert.equal(r.owner_observation.saga,'not_checked');
  assert.ok(f.authReads>0);assert.equal(f.batteryReads,0);
  assert.equal(f.sagaDb.prepare('SELECT COUNT(*) n FROM local_observation').get().n,0);
  assert.equal(f.sagaReads,0);flags(r);
  assert.equal(R20_LIVE_OWNER_FANOUT_ENABLED,false);
  assert.equal(R20_TRUSTED_IDENTITY_MAPPING_APPROVED,false);
  assert.equal(R20_SIGNED_EXTERNAL_AUTH_SOURCE_APPROVED,false);
  assert.equal(R20_PHYSICAL_QUEUE_ACK_APPROVED,false);
 }finally{f.close()}
});
test('R20 unsealed Auth caller, expired lease, policy drift block before dependent domain reads',async()=>{
 const f=fixture();try{
  f.commit();const claim=await f.issuer.claim(event);assert.ok(claim);
  for(const invalid of [{...claim},{event_id:event,approved:true},null]){
   const before=f.billingReads;
   const r=await f.interop.review(invalid,billingRequest,'u1','task_01',epoch);
   assert.equal(r.reason,'ACTUAL_AI1_AUTH_R19_DTO_MISSING');flags(r);
   assert.equal(f.billingReads,before);
  }
  f.setClock(epoch+31);
  assert.equal((await f.interop.review(claim,billingRequest,'u1','task_01',epoch+31)).status,'blocked');
  f.setClock(epoch);f.setRetention(false);
  const before=f.authReads;
  assert.equal((await f.interop.review(claim,billingRequest,'u1','task_01',epoch)).reason,
   'LAWFUL_PURPOSE_RETENTION_OR_POLICY_MISSING');
  assert.equal(f.authReads,before);
 }finally{f.close()}
});
test('R20 cross-brand/production and hostile locator are rejected without protected Owner reads',async()=>{
 const f=fixture();try{
  assert.throws(()=>createR20PrivateOwnerInterop({...scope,brand_id:'hglobal'},'policy-r19-draft',{
   auth:f.authAdapter,billing:f.billingAdapter,battery:f.batteryAdapter,saga:f.saga,readLaw:async()=>true
  }),/SCOPE_DENIED/);
  assert.throws(()=>createR20PrivateOwnerInterop({...scope,environment:'production'},'policy-r19-draft',{
   auth:f.authAdapter,billing:f.billingAdapter,battery:f.batteryAdapter,saga:f.saga,readLaw:async()=>true
  }),/SCOPE_DENIED/);
  for(const malformed of ['',null,{},'task/evil']){
   const r=await f.interop.review(null,billingRequest,'u1',malformed,epoch);
   assert.equal(r.status,'blocked');flags(r);
  }
  assert.equal(f.authReads,0);assert.equal(f.sagaReads,0);
 }finally{f.close()}
});
test('R20 REAL Auth R19 detects Session reactivation after source claim',async()=>{
 const f=fixture();try{
  f.commit();const c=await f.issuer.claim(event);assert.ok(c);
  f.auth.prepare("UPDATE starry_sessions SET revoked_at=NULL WHERE session_id='s1'").run();
  const out=await f.interop.review(c,billingRequest,'u1','task_01',epoch);
  assert.equal(out.reason,'ACTUAL_AI1_AUTH_R19_DTO_MISSING');flags(out);
 }finally{f.close()}
});
test('R20 REAL Billing R19 missing Store source does not convert deletion event into refund',async()=>{
 const f=fixture();try{
  const before=f.billingReads;
  const b=await f.billingAdapter.inspect(billingRequest);
  assert.equal(b.status,'retry');assert.equal(b.receipt,null);
  assert.equal(f.billingReads,before);
  assert.equal(f.billing.prepare("SELECT name FROM sqlite_master WHERE name='billing_r18_refund_inbox_DRAFT'").get(),undefined);
 }finally{f.close()}
});
test('R20 REAL Battery R19 Task committed without Auth signed provenance blocks; free Battery never sold',async()=>{
 const f=fixture();try{
  f.auth.prepare('INSERT INTO ai3_r19_test_auth_projection VALUES(?,?,?,?,?,?)')
   .run('u1','staging','active',3,0,1);
  f.task.prepare('INSERT INTO ai3_r19_test_task_projection VALUES(?,?,?,?,?,?,?,?)')
   .run('task_01','u1','staging','auth_task_source_1234567890123456789','committed',1,epoch*1000,1);
  const out=await f.batteryAdapter.inspect('u1','task_01',epoch*1000);
  assert.equal(out.status,'blocked');assert.equal(out.may_sell_battery,false);
  assert.equal(out.candidate_receipt,null);
 }finally{f.close()}
});
test('R20 missing physical authority is immutable even with syntactically persuasive fake Owner results',async()=>{
 const authCandidate={disposition:'offline_untrusted_cross_domain_auth_projection',
  reader:'saga',scope,event:{event_id:event,member_ref:'u1',occurred_at_sec:epoch,event_type:'account_deleted'},
  auth_version:4,source_attempt_no:1,policy_revision:'policy-r19-draft',may_publish:false,
  may_ack_queue:false,may_grant:false,may_restore:false,may_regrant:false,live:false};
 const billCandidate={status:'review_only',reason:'LOCAL_CANDIDATE_MATCH',
  receipt:{kind:'offline_candidate_only',brand_id:'starry',environment:'staging',
   member_ref:'m_'+'c'.repeat(64),app_ref:ref('a'),source_event_id:event,
   auth_version:4,refund_event_ref:ref('2'),refund_source_version:11,
   locally_matched:true,official_store_verified:false,independent_witness_verified:false},
  may_ack_queue:false,may_regrant:false,may_restore:false,may_publish:false,live:false};
 const batteryCandidate={status:'review_only',reason:'OFFLINE_UNTRUSTED_RECEIPT_NOT_AUTHORIZED',
  candidate_receipt:{brand_id:'starry',environment:'staging',task_ref:'task_01',
   source_event_ref:'auth_task_source_1234567890123456789',policy_version:1,
   wallet_revision:3,task_attempt:1,kind:'OFFLINE_UNTRUSTED_LOCAL_RECEIPT'},
  may_settle:false,may_release:false,may_ack_queue:false,may_regrant:false,
  may_restore:false,may_sell_battery:false,live:false};
 let sagaCalls=0;
 const make=(a=authCandidate,b=billCandidate,t=batteryCandidate)=>createR20PrivateOwnerInterop(
  scope,'policy-r19-draft',{auth:{readForOfflineConsumer:async()=>a},
   billing:{inspect:async()=>b},battery:{inspect:async()=>t},
   saga:{inspect:async()=>{sagaCalls++;throw Error('NEVER INVOKE WITHOUT PHYSICAL AUTHORITY')}},
   readLaw:async()=>({revision:'policy-r19-draft',processing_approved:true,retention_approved:true})
  });
 for(const [a,b,t] of [
  [authCandidate,billCandidate,batteryCandidate],
  [authCandidate,{...billCandidate,may_ack_queue:true},batteryCandidate],
  [authCandidate,billCandidate,{...batteryCandidate,may_release:true}],
  [authCandidate,{...billCandidate,receipt:{...billCandidate.receipt,source_event_id:'wrong'}},batteryCandidate],
  [authCandidate,billCandidate,{...batteryCandidate,candidate_receipt:{...batteryCandidate.candidate_receipt,environment:'development'}}]
 ]){
  const r=await make(a,b,t).review({},billingRequest,'u1','task_01',epoch);
  assert.notEqual(r.status,'live');flags(r);
 }
 assert.equal(sagaCalls,0);
});
test('R20 local simulated completeness is always review-only, never ACK, publish or authorized cross-DB reconciliation',async()=>{
 const source={disposition:'offline_untrusted_cross_domain_auth_projection',
  reader:'saga',scope,event:{event_id:event,member_ref:'u1',occurred_at_sec:epoch,event_type:'account_deleted'},
  auth_version:4,source_attempt_no:1,policy_revision:'policy-r19-draft',
  may_publish:false,may_ack_queue:false,may_grant:false,may_restore:false,may_regrant:false,live:false};
 const b={status:'review_only',reason:'LOCAL_CANDIDATE_MATCH',
  receipt:{kind:'offline_candidate_only',brand_id:'starry',environment:'staging',
   member_ref:'m_'+'c'.repeat(64),app_ref:ref('a'),source_event_id:event,
   auth_version:4,refund_event_ref:ref('2'),refund_source_version:11,
   locally_matched:true,official_store_verified:false,independent_witness_verified:false},
  may_ack_queue:false,may_regrant:false,may_restore:false,may_publish:false,live:false};
 const t={status:'review_only',reason:'OFFLINE_UNTRUSTED_RECEIPT_NOT_AUTHORIZED',
  candidate_receipt:{brand_id:'starry',environment:'staging',task_ref:'task_01',
   source_event_ref:'task_source_1234567890123456789012',policy_version:1,
   wallet_revision:3,task_attempt:1,kind:'OFFLINE_UNTRUSTED_LOCAL_RECEIPT'},
  may_settle:false,may_release:false,may_ack_queue:false,may_regrant:false,
  may_restore:false,may_sell_battery:false,live:false};
 let sagaTouched=0;
 const g=createR20PrivateOwnerInterop(scope,'policy-r19-draft',{
  auth:{readForOfflineConsumer:async()=>source},
  billing:{inspect:async()=>b},
  battery:{inspect:async()=>t},
  saga:{inspect:async()=>{sagaTouched++;return {status:'local_consistent_review_only'}}},
  readLaw:async()=>({revision:'policy-r19-draft',processing_approved:true,retention_approved:true})
 });
 const out=await g.review({},billingRequest,'u1','task_01',epoch);
 assert.equal(out.status,'review_only');flags(out);
 assert.equal(out.reason,'OFFLINE_OWNER_R19_LOCAL_RECEIPTS_NOT_AN_APPROVED_MAPPING');
 assert.equal(sagaTouched,0);
 assert.ok(out.missing_authorities.includes('Q104_Q119_APPROVED_CROSS_DOMAIN_IDENTITY_MAPPING'));
});
