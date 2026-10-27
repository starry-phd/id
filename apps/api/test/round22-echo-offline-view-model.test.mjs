import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createOfflineCandidateAuthUI} from '../../../modules/starry-id-v1/src/round21-candidate-ui-auth-state.ts';
import {createOfflineR21BillingUiProjection} from '../../../packages/rebuild-billing/src/r21-candidate-ui-billing-state.ts';
import {createOfflineR21CandidateTaskBatteryStatus} from '../../../packages/rebuild-ai3/src/r21-candidate-ui-task-battery-status.ts';
import {createEchoR22OfflineViewModel,ECHO_R22_VIEW_CONTRACT,
 ECHO_R22_LIVE_API_ENABLED,ECHO_R22_NATIVE_AUDIO_ENABLED,ECHO_R22_CACHE_MIGRATION_ENABLED,
 ECHO_R22_API_OPERATIONS,ECHO_R22_DRY_API_CONTRACT} from '../src/round22-echo-offline-view-model.ts';

const scope={brand_id:'starry',environment:'staging'},revision='echo-r22-demo-policy';
const req=(operation,track_ref=null,query=null)=>({operation,track_ref,query});
const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');
const permissions=['authenticated','is_playing','task_completed','transcript_ready','vip_unlocked',
 'wallet_balance_verified','paid_entitlement_active','can_play','can_share','can_download',
 'can_submit','can_charge','can_purchase_battery','may_ack_queue','may_dlq',
 'may_release_task','may_settle_task','may_regrant','may_restore','may_publish','live','publishable'];
function assertSafe(v){
 assert.equal(v.contract,ECHO_R22_VIEW_CONTRACT);
 for(const k of permissions)assert.equal(v[k],false,k);
 assert.equal(v.personal_data_included,false);
 assert.equal(v.demo_fixture_only,true);
 assert.equal(v.source_authoritative,false);
 assert.equal(v.offline_state,'not_verified');
 assert.equal(v.share_url,null);assert.equal(v.transcript_text,null);
 for(const forbidden of ['member_ref','session_id','token','audio_url','store_sku',
  'price','email','receipt','auth_event_id','wallet_balance','transcript_segments'])
  assert.equal(Object.hasOwn(v,forbidden),false,forbidden);
 assert.equal(Object.isFrozen(v),true);
}
function fixture(){
 // FIVE distinct physical disposable DBs. No Cloudflare D1/Worker/legacy DB.
 const auth=new DatabaseSync(':memory:'),bill=new DatabaseSync(':memory:'),
  task=new DatabaseSync(':memory:'),battery=new DatabaseSync(':memory:'),
  saga=new DatabaseSync(':memory:');
 auth.exec(read('../../../modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql'));
 battery.exec(read('../../../packages/rebuild-ai3/schema/0005_free_battery_DRAFT.sql'));
 bill.exec('CREATE TABLE local_billing_candidate(ref TEXT PRIMARY KEY)');
 task.exec('CREATE TABLE local_task_candidate(ref TEXT PRIMARY KEY,status TEXT)');
 saga.exec('CREATE TABLE local_saga_journal(ref TEXT PRIMARY KEY,status TEXT)');
 const adapter=db=>({prepare:sql=>({bind:(...args)=>({first:async()=>db.prepare(sql).get(...args)??null})})});
 let legal=true,media='mock_local',transcript='pending';
 let authReads=0,billReads=0,taskReads=0,mediaReads=0,transcriptReads=0,lawReads=0;
 const authOwner=createOfflineCandidateAuthUI({
  enabled:true,scope,authDb:adapter(auth),
  lawfulSessionReadApprovedNow:async()=>legal,
  lawfulDeletionProcessingApprovedNow:async()=>legal,
  lawfulMinimalRetentionApprovedNow:async()=>legal,
  readApprovedPolicyRevisionNow:async()=>revision,readServerNow:()=>1793000000
 });
 const r='r_'+'a'.repeat(64),r2='r_'+'b'.repeat(64);
 const billingOwner=createOfflineR21BillingUiProjection({
  enabled:true,scope:{...scope,app_ref:r,store_app_ref:r2},db:adapter(bill),
  ports:{
   lawfulProcessingAndRetention:async()=>legal,
   readAuthCandidate:async()=>null,
   readStoreCandidate:async()=>null,
   inspectR20:async()=>{throw Error('MUST NOT ASSUME MAPPING')}
  }
 });
 const taskOwner=createOfflineR21CandidateTaskBatteryStatus({
  enabled:true,scope,authDb:adapter(auth),taskDb:adapter(task),batteryDb:adapter(battery),
  mapping:{inspect:async()=>{throw Error('NEVER AUTHORIZE WALLET')}},
  lawfulPurposeNow:async()=>legal,lawfulRetentionNow:async()=>legal,
  approvedPolicyVersionNow:async()=>1,approvedFreeBatteryRateNow:async()=>false
 });
 const ports={
  readLaw:async()=>{lawReads++;return {revision,processing_approved:legal,retention_approved:legal}},
  readMedia:async track_ref=>{mediaReads++;return {track_ref,kind:'mock_media_only',availability:media}},
  readTranscript:async track_ref=>{transcriptReads++;return {track_ref,kind:'mock_transcript_only',state:transcript}},
  readAuthUI:async()=>{authReads++;return authOwner.project({screen:'ACCOUNT_SETTINGS',mode:'guest',scope})},
  readBillingUI:async()=>{billReads++;return billingOwner.project({screen:'HOME',mapping:{}})},
  readTaskUI:async()=>{taskReads++;return taskOwner.project('member_1','task_1','TASK_STATUS',1793000000000)}
 };
 const vm=()=>createEchoR22OfflineViewModel(scope,revision,ports);
 return {auth,bill,task,battery,saga,ports,vm,
  setLaw:v=>{legal=v},setMedia:v=>{media=v},setTranscript:v=>{transcript=v},
  get reads(){return {authReads,billReads,taskReads,mediaReads,transcriptReads,lawReads}},
  close(){for(const db of [auth,bill,task,battery,saga])db.close()}
 };
}
test('Echo R22 actual 8 private API operations, live/native/cache flags disabled',()=>{
 assert.equal(ECHO_R22_LIVE_API_ENABLED,false);
 assert.equal(ECHO_R22_NATIVE_AUDIO_ENABLED,false);
 assert.equal(ECHO_R22_CACHE_MIGRATION_ENABLED,false);
 assert.equal(ECHO_R22_API_OPERATIONS.length,8);
 assert.equal(Object.values(ECHO_R22_DRY_API_CONTRACT).some(x=>typeof x==='string'),true);
});
test('guest public catalog renders only curated fixture; zero Auth/Billing/Task/SQL reads',async()=>{
 const f=fixture();try{
  const result=await f.vm().resolve(req('catalog.list'));
  assert.equal(result.status,'preview_only');
  assert.equal(result.tracks.length,2);
  assert.equal(result.tracks[0].track_ref,'echo-demo-01');
  assert.equal(f.reads.lawReads,0);assert.equal(f.reads.authReads,0);
  assert.equal(f.reads.billReads,0);assert.equal(f.reads.taskReads,0);
  assert.equal(f.reads.mediaReads,0);assert.equal(f.reads.transcriptReads,0);
  assertSafe(result);
 }finally{f.close()}
});
test('guest search is private fixture-only and never echoes private search query',async()=>{
 const f=fixture();try{
  const match=await f.vm().resolve(req('catalog.search',null,'示範 A'));
  assert.equal(match.tracks.length,1);assertSafe(match);
  const query='private@email.example';
  const no=await f.vm().resolve(req('catalog.search',null,query));
  assert.equal(no.reason,'EMPTY_SEARCH');assert.equal(no.tracks.length,0);
  assert.ok(!JSON.stringify(no).includes(query));assertSafe(no);
  assert.equal(f.reads.authReads,0);
 }finally{f.close()}
});
test('guest mock player metadata NEVER starts native playback or returns R2 file URL',async()=>{
 const f=fixture();try{
  const out=await f.vm().resolve(req('player.observe','echo-demo-01'));
  assert.equal(out.status,'preview_only');
  assert.equal(out.reason,'MOCK_PLAYER_NOT_AUTHORIZED');
  assert.equal(out.player_state,'mock_ready');
  assertSafe(out);
  assert.ok(!JSON.stringify(out).includes('/api/r2/file'));
 }finally{f.close()}
});
test('audio unavailable and offline cache miss never marked downloaded',async()=>{
 const f=fixture();try{
  for(const m of ['unavailable','offline_missing']){
   f.setMedia(m);
   const out=await f.vm().resolve(req('player.observe','echo-demo-01'));
   assert.equal(out.status,'unavailable');assert.equal(out.player_state,'unavailable');assertSafe(out);
  }
  const offline=await f.vm().resolve(req('offline.observe','echo-demo-01'));
  assert.equal(offline.reason,'OFFLINE_NATIVE_ADAPTER_MISSING');assertSafe(offline);
  assert.equal(f.reads.mediaReads,2);
 }finally{f.close()}
});
test('transcript pending, cancelled and ready mock never claim actual transcript ready',async()=>{
 const f=fixture();try{
  const pairs=[['pending','TRANSCRIPT_PENDING','pending'],
   ['cancelled','TRANSCRIPT_CANCELLED','cancelled'],
   ['ready_mock','TRANSCRIPT_UNVERIFIED','unverified']];
  for(const [state,reason,t] of pairs){
   f.setTranscript(state);
   const out=await f.vm().resolve(req('transcript.observe','echo-demo-01'));
   assert.equal(out.reason,reason);assert.equal(out.transcript_state,t);
   assertSafe(out);
  }
 }finally{f.close()}
});
test('actual AI-1 R21 guest Auth + actual AI-2 R21 unknown Billing: VIP never unlocked',async()=>{
 const f=fixture();try{
  const out=await f.vm().resolve(req('player.observe','echo-vip-demo'));
  assert.equal(out.status,'reauth_required');
  assert.equal(out.reason,'VIP_ENTITLEMENT_UNKNOWN');
  assert.equal(f.reads.authReads,1);assert.equal(f.reads.billReads,1);
  assert.equal(f.reads.mediaReads,0);assertSafe(out);
 }finally{f.close()}
});
test('real AI-3 R21 Task/Battery missing rate and receipt: AI QA never dispatched',async()=>{
 const f=fixture();try{
  const result=await f.vm().resolve(req('qa.observe','echo-demo-01'));
  assert.equal(result.reason,'QA_SOURCE_UNVERIFIED');
  assert.equal(f.reads.taskReads,1);
  assert.equal(f.task.prepare('SELECT COUNT(*) AS n FROM local_task_candidate').get().n,0);
  assert.equal(f.saga.prepare('SELECT COUNT(*) AS n FROM local_saga_journal').get().n,0);
  assertSafe(result);
 }finally{f.close()}
});
test('forged receipt mismatch read-only Owner task DTO cannot trigger money or ACK',async()=>{
 const f=fixture();try{
  const original=await f.ports.readTaskUI();
  f.ports.readTaskUI=async()=>({...original,state:'receipt_mismatch',message_key:'receipt_mismatch'});
  const out=await f.vm().resolve(req('qa.observe','echo-demo-01'));
  assert.equal(out.reason,'TASK_RECEIPT_MISMATCH');assertSafe(out);
 }finally{f.close()}
});
test('untrusted Share preview never authenticates linked member or persists VIP',async()=>{
 const f=fixture();try{
  const out=await f.vm().resolve(req('share.observe','echo-demo-01'));
  assert.equal(out.reason,'SHARE_UNTRUSTED');assert.equal(out.share_url,null);
  assert.equal(f.reads.authReads,0);assert.equal(f.reads.mediaReads,0);
  assertSafe(out);
 }finally{f.close()}
});
test('admin access impossible with real R21 guest reauth response',async()=>{
 const f=fixture();try{
  const out=await f.vm().resolve(req('admin.observe','echo-demo-01'));
  assert.equal(out.status,'reauth_required');assert.equal(out.reason,'ADMIN_NOT_AUTHORIZED');
  assertSafe(out);assert.equal(f.reads.authReads,1);
 }finally{f.close()}
});
test('lawful retention/policy denial occurs before all protected reads',async()=>{
 const f=fixture();try{
  f.setLaw(false);
  for(const op of ['player.observe','transcript.observe','qa.observe',
   'share.observe','admin.observe','offline.observe']){
   const out=await f.vm().resolve(req(op,'echo-demo-01'));
   assert.equal(out.reason,'LEGAL_OR_POLICY_MISSING');assertSafe(out);
  }
  assert.equal(f.reads.authReads,0);assert.equal(f.reads.mediaReads,0);
  assert.equal(f.reads.taskReads,0);assert.equal(f.reads.transcriptReads,0);
 }finally{f.close()}
});
test('lawful permission revocation after media read cannot authorize playback',async()=>{
 const f=fixture();try{
  const old=f.ports.readMedia;
  f.ports.readMedia=async v=>{const o=await old(v);f.setLaw(false);return o};
  const out=await f.vm().resolve(req('player.observe','echo-demo-01'));
  assert.equal(out.reason,'LEGAL_OR_POLICY_MISSING');assertSafe(out);
 }finally{f.close()}
});
test('foreign brand/env and malformed/signed R2 URLs rejected without media read',async()=>{
 const f=fixture();try{
  assert.throws(()=>createEchoR22OfflineViewModel(
   {brand_id:'hglobal',environment:'staging'},revision,f.ports),/SCOPE_DENIED/);
  assert.throws(()=>createEchoR22OfflineViewModel(
   {brand_id:'starry',environment:'production'},revision,f.ports),/SCOPE_DENIED/);
  for(const raw of [null,{},req('player.observe','https://demo.invalid/file'),
   req('player.observe','/api/r2/file/abc'),
   {operation:'player.observe',track_ref:'echo-demo-01',query:null,
    cookie:'legacy_session'}]){
   const o=await f.vm().resolve(raw);
   assert.equal(o.reason,'MALFORMED_REQUEST');assertSafe(o);
  }
  assert.equal(f.reads.mediaReads,0);
 }finally{f.close()}
});
test('getter injection / malformed R21 Owner response blocked, not forwarded to UI',async()=>{
 const f=fixture();try{
  f.ports.readAuthUI=async()=>({get authenticated(){throw Error('NO')}}); 
  const out=await f.vm().resolve(req('admin.observe','echo-demo-01'));
  assert.equal(out.status,'blocked');assert.equal(out.reason,'OWNER_READ_FAILED');assertSafe(out);
 }finally{f.close()}
});
test('five physically separate local DBs never get a new row on read-only UI observation',async()=>{
 const f=fixture();try{
  await f.vm().resolve(req('catalog.list'));
  await f.vm().resolve(req('player.observe','echo-demo-01'));
  await f.vm().resolve(req('transcript.observe','echo-demo-01'));
  await f.vm().resolve(req('qa.observe','echo-demo-01'));
  await f.vm().resolve(req('admin.observe','echo-demo-01'));
  assert.equal(f.bill.prepare('SELECT COUNT(*) n FROM local_billing_candidate').get().n,0);
  assert.equal(f.task.prepare('SELECT COUNT(*) n FROM local_task_candidate').get().n,0);
  assert.equal(f.saga.prepare('SELECT COUNT(*) n FROM local_saga_journal').get().n,0);
  assert.notEqual(f.auth,f.bill);assert.notEqual(f.bill,f.task);
  assert.notEqual(f.task,f.battery);assert.notEqual(f.battery,f.saga);
 }finally{f.close()}
});
