import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {createOfflineCanonicalAuthDeletionPublisher}
 from '../../../modules/starry-id-v1/src/round16-canonical-deletion-publisher.ts';
import {createOfflineR20AuthIdentityBoundary}
 from '../../../modules/starry-id-v1/src/round20-auth-identity-boundary.ts';
import {createOfflineBillingR20NamespaceGate}
 from '../../../packages/rebuild-billing/src/r20-namespace-mapping-gate.ts';
import {createOfflineR20TaskWalletBinding}
 from '../../../packages/rebuild-ai3/src/r20-task-wallet-source-binding.ts';
import {createR20PrivateOwnerInterop}
 from '../src/round20-private-r19-owner-interop.ts';
import {R21_SCREENS,R21_FAILURE_COPY,R21_CANDIDATE_UI_ONLY,
 R21_LIVE_UI_ROUTE_ENABLED,R21_OFFICIAL_PRODUCT_SELECTED,
 createR21CandidateConsumerUIResolver}
 from '../src/round21-candidate-consumer-ui-state-resolver.ts';

const scope={brand_id:'starry',environment:'staging'};
const n=1793000000,event='starry-delete-'+'a'.repeat(64);
const spec=JSON.parse(readFileSync(new URL(
 '../../../docs/product/starry-consumer-a-candidate.v0.json',import.meta.url),'utf8'));
const ownerAuth=()=>({
 status:'review_only',reason:'UNAPPROVED_IDENTITY_MAPPING_REVIEW_ONLY',
 schema_version:'starry.auth.identity-boundary.v0-offline',
 source:{namespace:'auth.account_deleted',event_id:event,
  auth_version:4,policy_revision:'policy-r21'},
 identity_mapping_approved:false,may_publish:false,may_ack_queue:false,
 may_restore:false,may_regrant:false,may_release_task:false,live:false
});
const ownerBilling=()=>({
 status:'review_only',reason:'LOCAL_NAMESPACE_CANDIDATE_ONLY',
 candidate:{kind:'r20_unapproved_namespace_mapping_candidate',mapping_version:1,
  auth_event_id:event,auth_member_ref:'u1',
  billing_member_digest:'m_'+'c'.repeat(64),
  billing_source_event_id:'BillingAccountDeleteEvent-00001',
  store:'apple',store_app_ref:'r_'+'b'.repeat(64),
  store_transaction_ref:'r_'+'1'.repeat(64),
  store_refund_event_ref:'r_'+'2'.repeat(64),store_source_version:3,
  hmac_binding_approved:false,store_signature_verified:false,
  external_pitr_witness_verified:false,publishable:false},
 may_ack_queue:false,may_regrant:false,may_restore:false,may_publish:false,
 may_grant:false,live:false
});
const ownerTask=()=>({
 status:'review_only',reason:'LOCAL_MAPPING_NOT_AUTHORIZED',
 candidate:{kind:'OFFLINE_UNVERIFIED_TASK_WALLET_MAPPING',
  brand_id:'starry',environment:'staging',member_ref:'u1',task_ref:'task_1',
  source_event_ref:'task_source_12345678901234567890',task_attempt:1,
  policy_version:1,wallet_revision:3,signed_source_approved:false,
  member_mapping_approved:false,independent_floor_approved:false},
 may_settle:false,may_release_task:false,may_ack_queue:false,
 may_regrant:false,may_restore:false,may_publish:false,may_sell_battery:false,
 live:false
});
const ownerSaga=()=>({
 status:'review_only',reason:'OFFLINE_OWNER_R19_LOCAL_RECEIPTS_NOT_AN_APPROVED_MAPPING',
 owner_observation:{auth:'offline_candidate_only',billing:'review_only',
  battery:'review_only',saga:'not_checked'},
 missing_authorities:['OFFICIAL_P05_SIGNED_AUTH_ISSUER_AND_LEASE'],
 may_ack_queue:false,may_dlq:false,may_release_task:false,may_settle_task:false,
 may_regrant:false,may_restore:false,may_publish:false,may_sell_battery:false,
 publishable:false,live:false
});
const noActions=r=>{
 for(const k of ['task_completed','account_deleted_success','authenticated',
  'wallet_balance_verified','paid_entitlement_active','can_submit','can_charge',
  'can_purchase_battery','may_ack_queue','may_dlq','may_regrant','may_restore',
  'may_release_task','may_publish','live','publishable','private_data_included'])
  assert.equal(r[k],false,k);
 assert.equal(Object.isFrozen(r),true);
 assert.equal(JSON.stringify(r).includes('u1'),false);
 assert.equal(JSON.stringify(r).includes('m_'+'c'.repeat(64)),false);
 assert.equal(JSON.stringify(r).includes(event),false);
};
function fakeFixture(){
 const calls={law:0,auth:0,billing:0,task:0,saga:0,session:0,rate:0,hint:0};
 const state={policy:true,retention:true,auth:ownerAuth(),billing:ownerBilling(),
  task:ownerTask(),saga:ownerSaga(),session:'unknown',
  rate:'mock_published_only',hint:'none',drift:false};
 const ports={
  readLaw:async()=>{calls.law++;return {revision:'policy-r21',
   processing_approved:state.policy&&!state.drift,retention_approved:state.retention};},
  readAuthR20:async()=>{calls.auth++;return state.auth;},
  readBillingR20:async()=>{calls.billing++;return state.billing;},
  readTaskWalletR20:async()=>{calls.task++;return state.task;},
  readSagaR20:async()=>{calls.saga++;return state.saga;},
  readSessionDenial:async()=>{calls.session++;return {kind:state.session}},
  readRateCandidate:async()=>{calls.rate++;return {kind:state.rate}},
  readTaskHint:async()=>{calls.hint++;return {kind:state.hint}}
 };
 return {calls,state,ports,gate:()=>createR21CandidateConsumerUIResolver(scope,ports)};
}
test('R21 12 screens and nine Chinese failure phrases are EXACT #136 candidate spec',()=>{
 assert.equal(spec.release.production_app_selected,false);
 assert.equal(spec.candidate.approved,false);
 assert.equal(spec.candidate.ui_implemented,false);
 assert.deepEqual(R21_SCREENS,spec.screens.map(x=>x.id));
 assert.deepEqual(Object.keys(R21_FAILURE_COPY),spec.ux_failure_states.map(x=>x.id));
 for(const item of spec.ux_failure_states){
  assert.equal(R21_FAILURE_COPY[item.id],item.ui_message);
  assert.equal(item.success_allowed,false);
  assert.equal(item.grant_allowed,false);
 }
 assert.equal(R21_CANDIDATE_UI_ONLY,true);
 assert.equal(R21_LIVE_UI_ROUTE_ENABLED,false);
 assert.equal(R21_OFFICIAL_PRODUCT_SELECTED,false);
});
test('Public DISCOVER, SIGN_IN and HELP_APPEAL never read law, Auth, Billing or Wallet',async()=>{
 const f=fakeFixture();
 for(const screen of ['DISCOVER','SIGN_IN','HELP_APPEAL']){
  const r=await f.gate().resolve(screen);
  assert.equal(r.screen_id,screen);noActions(r);
  assert.equal(r.source,'public_candidate_spec');
 }
 assert.deepEqual(f.calls,{law:0,auth:0,billing:0,task:0,saga:0,session:0,rate:0,hint:0});
});
test('Every private screen remains blocked with missing Q104/Q119 lawful purpose before owner DB',async()=>{
 const f=fakeFixture();f.state.policy=false;
 for(const item of spec.screens.filter(x=>!x.allowed_without_login)){
  const r=await f.gate().resolve(item.id);
  assert.equal(r.failure_code,'POLICY_UNKNOWN');noActions(r);
 }
 assert.equal(f.calls.auth,0);
 assert.equal(f.calls.billing,0);assert.equal(f.calls.task,0);
});
test('Explicit revoked session can only downgrade to reauth_required (never signed-in)',async()=>{
 const f=fakeFixture();f.state.session='revoked';
 const out=await f.gate().resolve('HOME');
 assert.equal(out.failure_code,'AUTH_REVOKED');
 assert.equal(out.state,'reauth_required');
 assert.equal(f.calls.auth,0);noActions(out);
});
test('Invalid/missing owner R20 Auth adapter cannot be forged into a signed-in or deleted state',async()=>{
 const f=fakeFixture();
 for(const v of [null,{status:'review_only',approved:true},
  {...ownerAuth(),may_ack_queue:true}, {...ownerAuth(),source:{...ownerAuth().source,oauth_subject:'leaked'}}]){
  f.state.auth=v;
  const out=await f.gate().resolve('HOME');
  assert.equal(out.failure_code,'NOT_SIGNED_IN');noActions(out);
 }
});
test('R20 Auth offline deletion review yields DELETION_PENDING, not account_deleted_success',async()=>{
 const f=fakeFixture();
 for(const screen of ['DELETE_ACCOUNT','ACCOUNT_SETTINGS']){
  const out=await f.gate().resolve(screen);
  assert.equal(out.failure_code,'DELETION_PENDING');
  assert.equal(out.state,'deletion_pending');noActions(out);
 }
});
test('No official rate: TASK_REVIEW cannot submit, even when mocked published',async()=>{
 const f=fakeFixture();
 for(const rate of ['unknown','unapproved','mock_published_only']){
  f.state.rate=rate;
  const r=await f.gate().resolve('TASK_REVIEW');
  assert.equal(r.failure_code,'PRICE_UNAPPROVED');noActions(r);
 }
 assert.equal(f.calls.billing,0);assert.equal(f.calls.task,0);
});
test('Task timeout, double-click replay, pending and no receipt all render TASK_UNKNOWN',async()=>{
 const f=fakeFixture();
 for(const hint of ['none','timeout','duplicate','pending']){
  f.state.hint=hint;
  const out=await f.gate().resolve('TASK_STATUS');
  assert.equal(out.failure_code,'TASK_UNKNOWN');noActions(out);
 }
});
test('Task failure/mismatch/PITR rollback never display completed Task or charged Wallet',async()=>{
 const f=fakeFixture();
 for(const [hint,code] of [
  ['failed','TASK_FAILED'],['receipt_mismatch','RECEIPT_MISMATCH'],
  ['pitr_rollback','RECEIPT_MISMATCH']
 ]){
  f.state.hint=hint;
  const r=await f.gate().resolve('TASK_STATUS');
  assert.equal(r.failure_code,code);noActions(r);
 }
});
test('Even all three Owner R20 local review_only projections do not show TASK_RESULT success',async()=>{
 const f=fakeFixture();
 const out=await f.gate().resolve('TASK_RESULT');
 assert.equal(out.failure_code,'RECEIPT_MISMATCH');
 assert.equal(f.calls.billing,1);assert.equal(f.calls.task,1);
 assert.equal(f.calls.saga,1);noActions(out);
});
test('Battery LEDGER cannot display unconfirmed balance, purchase, cashout or expiry',async()=>{
 const f=fakeFixture();
 const out=await f.gate().resolve('BATTERY_LEDGER');
 assert.equal(out.failure_code,'RECEIPT_MISMATCH');noActions(out);
 assert.equal('balance' in out,false);
 assert.equal('sku' in out,false);
});
test('Foreign brand, production environment, invalid screens and absent ports denied',async()=>{
 const f=fakeFixture();
 for(const s of [{...scope,brand_id:'hglobal'},{...scope,environment:'production'}])
  assert.throws(()=>createR21CandidateConsumerUIResolver(s,f.ports),/SCOPE_DENIED/);
 assert.throws(()=>createR21CandidateConsumerUIResolver(scope,{}),/PORTS_REQUIRED/);
 await assert.rejects(()=>f.gate().resolve('PURCHASE_BATTERY'),/UNKNOWN_SCREEN_DENIED/);
});
test('Malformed Owner R20 Billing/Task/Saga responses fail closed with missing_adapter',async()=>{
 for(const owner of ['billing','task','saga']){
  const f=fakeFixture();
  f.state[owner]=null;
  const r=await f.gate().resolve('TASK_RESULT');
  assert.ok(['POLICY_UNKNOWN','TASK_UNKNOWN'].includes(r.failure_code));
  assert.equal(r.missing_adapter,true);noActions(r);
 }
});
test('Privacy: hostile accessor owner result never serialized or executed outside safe boundary',async()=>{
 const f=fakeFixture();const evil={...ownerBilling()};
 Object.defineProperty(evil,'candidate',{enumerable:true,get(){throw Error('PII_READ');}});
 f.state.billing=evil;
 const out=await f.gate().resolve('TASK_RESULT');
 assert.equal(out.missing_adapter,true);noActions(out);
});
test('No output ever contains forbidden ACCOUNT_DELETED success code under offline candidate evidence',async()=>{
 const f=fakeFixture();
 for(const screen of R21_SCREENS){
  const out=await f.gate().resolve(screen);
  noActions(out);
  assert.notEqual(out.failure_code,'ACCOUNT_DELETED');
  assert.notEqual(out.state,'task_completed');
 }
});
/** REAL owner modules: independent Auth/Billing/Task/Battery/Saga SQLite,
 * not a fake one-DB test. Every module is actually invoked with its ports.
 * The source observations remain UNAPPROVED, never a signed UI authority.
 */
function realOwnerFixture(){
 const auth=new DatabaseSync(':memory:');
 const billing=new DatabaseSync(':memory:');
 const task=new DatabaseSync(':memory:');
 const battery=new DatabaseSync(':memory:');
 const saga=new DatabaseSync(':memory:');
 const load=p=>readFileSync(new URL(p,import.meta.url),'utf8');
 auth.exec('PRAGMA foreign_keys=ON');
 for(const name of ['001_starry_identity.DRAFT.sql',
  '007_starry_age_deletion_admin.UP.DRAFT.sql','011_starry_one_use_deletion.UP.DRAFT.sql',
  '012_starry_stepup_challenge_scope.UP.DRAFT.sql',
  '013_starry_deletion_source_immutability.UP.DRAFT.sql'])
  auth.exec(load('../../../modules/starry-id-v1/schema/'+name));
 auth.exec(load('../../../modules/starry-id-v1/test/fixtures/round16_auth_dispatch_lease.DRAFT.sql'));
 auth.prepare("INSERT INTO starry_members VALUES('u1','active',3,1,'profile',1,1,?,?)")
  .run(n,n);
 const ins=auth.prepare("INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
 ins.run('s1','u1','app-a','staging',3,'a'.repeat(64),n+120,'passkey',n-5,n+90);
 ins.run('s2','u1','app-b','staging',3,'b'.repeat(64),n+120,null,null,null);
 billing.exec('CREATE TABLE refund_candidate(ref TEXT PRIMARY KEY,kind TEXT)');
 task.exec('CREATE TABLE task_candidate(ref TEXT PRIMARY KEY,status TEXT)');
 battery.exec(load('../../../packages/rebuild-ai3/schema/0005_free_battery_DRAFT.sql'));
 battery.exec(load('../../../packages/rebuild-ai3/schema/0010_auth_delete_battery_inbox_DRAFT.sql'));
 saga.exec('CREATE TABLE local_saga_ref(event_ref TEXT PRIMARY KEY,status TEXT)');
 const db=x=>({prepare:sql=>({bind:(...args)=>({
  first:async()=>x.prepare(sql).get(...args)??null,
  all:async()=>x.prepare(sql).all(...args)
 })})});
 let privateReads=0;
 const issuer=createOfflineCanonicalAuthDeletionPublisher({enabled:true,
  scope,db:db(auth),lawfulDeletionProcessingApprovedNow:async()=>true,
  readServerNow:()=>n});
 const a=createOfflineR20AuthIdentityBoundary({enabled:true,scope,
  authDb:db(auth),lawfulDeletionProcessingApprovedNow:async()=>true,
  lawfulMinimalRetentionApprovedNow:async()=>true,
  readApprovedPolicyRevisionNow:async()=> 'policy-r21',readServerNow:()=>n,
  readRefundCandidate:async ref=>{privateReads++;return billing.prepare(
   'SELECT ref,kind FROM refund_candidate WHERE ref=?').get(ref)??null;},
  readTaskCandidate:async ref=>{privateReads++;return task.prepare(
   'SELECT ref,status FROM task_candidate WHERE ref=?').get(ref)??null;},
  readDigestCandidate:async()=>null});
 const b=createOfflineBillingR20NamespaceGate({enabled:true,scope:{...scope,
  app_ref:'r_'+'a'.repeat(64),store_app_ref:'r_'+'b'.repeat(64)},
  ports:{lawfulProcessingAndRetention:async()=>true,
   readAuthOriginal:async()=>null,readBindingCandidate:async()=>null,
   readFloorCandidate:async()=>null,inspectBillingR19:async()=>null}});
 const t=createOfflineR20TaskWalletBinding({enabled:true,scope,
  source:{readTaskSource:async()=>null},task:{readTaskReceipt:async()=>null},
  battery:{inspect:async()=>null},legalNow:async()=>true,
  retentionNow:async()=>true,policyNow:async()=>1});
 const s=createR20PrivateOwnerInterop(scope,'policy-r21',{
  auth:{readForOfflineConsumer:async()=>null},
  billing:{inspect:async()=>({status:'disabled',reason:'DISABLED',receipt:null,
   may_ack_queue:false,may_regrant:false,may_restore:false,may_publish:false,live:false})},
  battery:{inspect:async()=>({status:'blocked',reason:'DISABLED',candidate_receipt:null,
   may_settle:false,may_release:false,may_ack_queue:false,may_regrant:false,
   may_restore:false,may_sell_battery:false,live:false})},
  saga:{inspect:async()=>{throw Error('NO_SAGA_MUTATIONS')}},
  readLaw:async()=>({revision:'policy-r21',processing_approved:true,retention_approved:true})
 });
 function commit(){
  auth.prepare('INSERT INTO starry_deletion_challenges VALUES(?,?,?,?,?,?,?,NULL)')
   .run('a'.repeat(64),'u1','s1',3,event,n,n+60);
  auth.prepare('UPDATE starry_deletion_challenges SET consumed_at=? WHERE challenge_ref=?')
   .run(n,'a'.repeat(64));
 }
 const adapters={auth:a,billing:b,task:t,saga:s};
 return {auth,billing,task,battery,saga,issuer,commit,
  get privateReads(){return privateReads},
  ports:{readLaw:async()=>({revision:'policy-r21',
   processing_approved:true,retention_approved:true}),
   readAuthR20:async()=>adapters.auth.inspect(null,{reader:'saga',scope,
    auth_event_ref:event,store_refund_ref:'refund_12345678901234567890',
    task_ref:'task_1234567890123456789012',
    digest_ref:'digest_12345678901234567890'}),
   readBillingR20:async()=>adapters.billing.inspect(null),
   readTaskWalletR20:async()=>adapters.task.inspect('u1','task_1',n*1000),
   readSagaR20:async()=>adapters.saga.review(null,null,'u1','task_1',n)},
  close:()=>{for(const x of [auth,billing,task,battery,saga])x.close()}
 };
}
test('Five real independent SQLite stores plus genuine R20 Auth/Billing/Task/Saga factories deny fake member UI',async()=>{
 const f=realOwnerFixture();try{
  f.commit();const claim=await f.issuer.claim(event);assert.ok(claim);
  const resolver=createR21CandidateConsumerUIResolver(scope,{
   ...f.ports,
   readAuthR20:async()=>f.ports.readAuthR20() // true R20 guard runs; no signed claim supplied
  });
  for(const id of ['HOME','TASK_RESULT','BATTERY_LEDGER','DELETE_ACCOUNT']){
   const out=await resolver.resolve(id);
   assert.ok(['NOT_SIGNED_IN','DELETION_PENDING','RECEIPT_MISMATCH'].includes(out.failure_code));
   noActions(out);
  }
  assert.equal(f.billing.prepare('SELECT COUNT(*) n FROM refund_candidate').get().n,0);
  assert.equal(f.task.prepare('SELECT COUNT(*) n FROM task_candidate').get().n,0);
  assert.equal(f.saga.prepare('SELECT COUNT(*) n FROM local_saga_ref').get().n,0);
 }finally{f.close()}
});
test('Late member Auth session deletion never causes candidate completed or deletion success',async()=>{
 const f=realOwnerFixture();try{
  f.commit();const claim=await f.issuer.claim(event);assert.ok(claim);
  f.auth.prepare("UPDATE starry_sessions SET revoked_at=NULL WHERE session_id='s1'").run();
  const resolver=createR21CandidateConsumerUIResolver(scope,f.ports);
  for(const screen of ['HOME','DELETE_ACCOUNT']){
   const out=await resolver.resolve(screen);
   assert.equal(out.failure_code,'NOT_SIGNED_IN');
   noActions(out);
  }
 }finally{f.close()}
});
