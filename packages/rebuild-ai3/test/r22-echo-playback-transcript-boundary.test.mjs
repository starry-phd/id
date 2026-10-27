import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineR22EchoTaskBatteryBoundary,R22_ECHO_VERSION,R22_ECHO_LIVE_ENABLED}
 from '../src/r22-echo-playback-transcript-boundary.ts';
import {AI3_R19_AUTH_SQL,AI3_R19_TASK_SQL,AI3_R19_WALLET_SQL}
 from '../src/r19-task-wallet-receipt-gate.ts';
import {R22_ECHO_JOB_SQL} from '../src/r22-echo-playback-transcript-boundary.ts';
const scope={brand_id:'starry',environment:'staging'},m='member_1',t='task_1',
 source='auth_task_source_1234567890123456789',jobRef='job_transcript_12345678901234567890';
const A={member_ref:m,environment:'staging',status:'active',auth_version:3,session_revoked:0,policy_version:1};
const J={brand_id:'starry',environment:'staging',member_ref:m,task_ref:t,source_event_ref:source,
 job_event_ref:jobRef,event_type:'transcript_job_completed',status:'completed',attempt_no:1,
 policy_version:1,completed_at_ms:110000};
const T={task_ref:t,member_ref:m,environment:'staging',source_event_ref:source,status:'committed',
 commit_attempt:1,completed_at_ms:110001,policy_version:1};
const W={task_ref:t,member_ref:m,hold_status:'committed',created_ms:1000,expires_ms:181000,
 hold_policy_version:1,rate_version:1,price:7,balance:3,wallet_version:3,revoked:0,
 reserve_entries:1,commit_entries:1,commit_revision:3,commit_balance_after:3};
const C={kind:'OFFLINE_UNVERIFIED_TASK_WALLET_MAPPING',brand_id:'starry',
 environment:'staging',member_ref:m,task_ref:t,source_event_ref:source,task_attempt:1,
 policy_version:1,wallet_revision:3,signed_source_approved:false,
 member_mapping_approved:false,independent_floor_approved:false};
const R={status:'review_only',reason:'LOCAL_MAPPING_NOT_AUTHORIZED',candidate:C,
 may_settle:false,may_release_task:false,may_ack_queue:false,may_regrant:false,
 may_restore:false,may_publish:false,may_sell_battery:false,live:false};
const clone=x=>structuredClone(x);
function fixture(opts={}){
 const counts={auth:0,job:0,task:0,wallet:0,gate:0,legal:0,retention:0,policy:0};
 const val=(k,d)=>{counts[k]++;const v=opts[k];return typeof v==='function'?v(counts[k]):v===undefined?clone(d):v;};
 const db=(name,sql,params,fallback)=>({prepare(s){assert.equal(s,sql);
  return {bind(...args){assert.deepEqual(args,params);
   return {async first(){return val(name,fallback);}};}};}});
 const authDb=db('auth',AI3_R19_AUTH_SQL,[m,'staging'],A);
 const taskDbs={prepare(s){
  if(s===AI3_R19_TASK_SQL)return db('task',s,[t,m,'staging'],T).prepare(s);
  if(s===R22_ECHO_JOB_SQL)return db('job',s,[m,t,'staging'],J).prepare(s);
  throw Error('UNEXPECTED_SQL');
 }};
 const config={enabled:true,scope,authDb,taskDb:taskDbs,
  batteryDb:db('wallet',AI3_R19_WALLET_SQL,[m,t],W),
  taskWalletReview:{inspect:async()=>val('gate',R)},
  lawfulPurposeNow:async()=>val('legal',true),
  lawfulRetentionNow:async()=>val('retention',true),
  approvedPolicyNow:async()=>val('policy',1)};
 return {counts,make:(o={})=>createOfflineR22EchoTaskBatteryBoundary({...config,...o})};
}
const req=(event='transcript_job_completed')=>({event,member_ref:m,task_ref:t,now_ms:110500});
function noRights(r){
 for(const k of ['task_completed','wallet_settled','balance_verified','offline_file_verified',
 'can_unlock','can_replay_charge','may_grant','may_settle','may_release','may_regrant',
 'may_restore','may_ack_queue','may_publish','may_sell_battery','live'])
  assert.equal(r[k],false,k);
 assert.equal(r.schema_version,R22_ECHO_VERSION);
 assert.equal(JSON.stringify(r).includes(m),false);
 assert.equal(JSON.stringify(r).includes(t),false);
}
test('R22 playback, pause, seek, replay and 95% end never read protected Wallet DB',async()=>{
 assert.equal(R22_ECHO_LIVE_ENABLED,false);
 const f=fixture();
 for(const e of ['play','pause','seek','progress','ended']){
  const r=await f.make().project({event:e,now_ms:110500});
  assert.equal(r.state,'playback_local_only');noRights(r);
 }
 assert.equal(f.counts.auth,0);assert.equal(f.counts.task,0);
 assert.equal(f.counts.wallet,0);assert.equal(f.counts.gate,0);
});
test('R22 legacy CacheStorage download never validates native offline file nor grants',async()=>{
 const f=fixture(),r=await f.make().project({event:'offline_download'});
 assert.equal(r.state,'offline_cache_unverified');noRights(r);
 assert.equal(f.counts.wallet,0);
});
test('R22 a transcript/QA requested event is not AI paid task completion',async()=>{
 const f=fixture();
 for(const e of ['transcript_requested','qa_requested']){
  const r=await f.make().project({event:e});
  assert.equal(r.state,'job_pending');noRights(r);
 }
 assert.equal(f.counts.gate,0);
});
test('R22 three local mock ports only produce review_only with NO Battery rights',async()=>{
 const f=fixture(),r=await f.make().project(req());
 assert.equal(r.state,'review_only');assert.equal(r.evidence,'local_only');noRights(r);
 assert.equal(f.counts.auth,2);assert.equal(f.counts.job,2);
 assert.equal(f.counts.gate,2);
});
test('R22 simulated QA completion must match its own namespace',async()=>{
 const f=fixture({job:{...J,event_type:'qa_job_completed',
  job_event_ref:'job_qa_12345678901234567890'}});
 const r=await f.make().project(req('qa_job_completed'));
 assert.equal(r.state,'review_only');noRights(r);
});
test('R22 deletion/refund/play spoofing cannot be transcript/QA source evidence',async()=>{
 for(const v of ['account_deleted','store_refund','play','progress']){
  const f=fixture({job:{...J,event_type:v}}),r=await f.make().project(req());
  assert.equal(r.state,'blocked');noRights(r);
 }
});
test('R22 job/Task event late arrival, different event, duplicate attempt rejects',async()=>{
 for(const opt of [
  {job:{...J,attempt_no:2}},
  {job:{...J,completed_at_ms:120000}},
  {job:{...J,job_event_ref:source}},
  {job:{...J,member_ref:'member_2'}},
  {task:{...T,source_event_ref:'other_source_12345678901234567890'}},
  {task:{...T,status:'pending'}},
  {task:{...T,completed_at_ms:109000}},
  {task:{...T,commit_attempt:2}}
 ]){
  const f=fixture(opt),v=await f.make().project(req());noRights(v);
  assert.notEqual(v.state,'review_only');
 }
});
test('R22 Task committed but wallet not durable or reservation held denies',async()=>{
 for(const w of [{...W,hold_status:'held',commit_entries:0},
  {...W,commit_entries:0},{...W,reserve_entries:2},
  {...W,commit_revision:2},{...W,revoked:1},null]){
  const f=fixture({wallet:w}),v=await f.make().project(req());
  assert.equal(v.state,'wallet_receipt_mismatch');noRights(v);
 }
});
test('R22 absent nonrollback witness/PITR rollback via R20 blocks',async()=>{
 for(const gate of [{...R,status:'blocked',candidate:null},
  {...R,candidate:{...C,wallet_revision:4}},{...R,may_ack_queue:true}]){
  const f=fixture({gate}),v=await f.make().project(req());
  assert.equal(v.state,'wallet_receipt_mismatch');noRights(v);
 }
});
test('R22 member deleted/revoked during transcript calculation denies',async()=>{
 for(const a of [{...A,status:'deleted'},{...A,session_revoked:1},
  n=>n===1?A:{...A,status:'deleted'}]){
  const f=fixture({auth:a}),v=await f.make().project(req());
  assert.notEqual(v.state,'review_only');noRights(v);
 }
});
test('R22 legal purpose/retention/policy denied before protected DB reads',async()=>{
 for(const o of [{legal:false},{retention:false},{policy:null},{policy:0}]){
  const f=fixture(o),v=await f.make().project(req());
  assert.equal(v.state,'blocked');assert.equal(f.counts.auth,0);noRights(v);
 }
});
test('R22 source, sink or review changes across readback fail closed',async()=>{
 const variants=[
  {job:n=>n===1?J:{...J,job_event_ref:'other_job_12345678901234567890'}},
  {task:n=>n===1?T:{...T,status:'cancelled'}},
  {wallet:n=>n===1?W:{...W,commit_entries:0}},
  {gate:n=>n===1?R:{...R,candidate:{...C,wallet_revision:4}}},
  {legal:n=>n===1},{retention:n=>n===1},{policy:n=>n===1?1:2}
 ];
 for(const o of variants){
  const f=fixture(o),v=await f.make().project(req());
  assert.notEqual(v.state,'review_only');noRights(v);
 }
});
test('R22 foreign environment and invalid runtime ports are fail closed',async()=>{
 const f=fixture();
 assert.throws(()=>f.make({scope:{brand_id:'hglobal',environment:'staging'}}),/SCOPE/);
 assert.throws(()=>f.make({scope:{brand_id:'starry',environment:'production'}}),/SCOPE/);
 for(const item of [null,{},'task_committed']){
  const v=await f.make().project({event:item});assert.equal(v.state,'blocked');noRights(v);
 }
});
test('R22 disabled and malformed PII-containing rows cannot leak data',async()=>{
 const f=fixture(),v=await f.make({enabled:false}).project(req());
 assert.equal(v.state,'blocked');noRights(v);
 for(const obj of [{job:{...J,private_token:'EXPOSE'}},
  {auth:{...A,secret:'EXPOSE'}},{task:{...T,cookie:'EXPOSE'}},
  {job:()=>{throw Error('API unavailable');}}]){
  const f2=fixture(obj),z=await f2.make().project(req());
  assert.equal(z.state,'blocked');noRights(z);
 }
});
