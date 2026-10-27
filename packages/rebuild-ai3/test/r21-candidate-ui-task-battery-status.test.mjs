import test from 'node:test';
import assert from 'node:assert/strict';
import {AI3_R19_AUTH_SQL,AI3_R19_TASK_SQL,AI3_R19_WALLET_SQL}
 from '../src/r19-task-wallet-receipt-gate.ts';
import {createOfflineR21CandidateTaskBatteryStatus,AI3_R21_UI_VERSION,
 AI3_R21_UI_SCREENS,LIVE_AI3_R21_CANDIDATE_UI_ENABLED}
 from '../src/r21-candidate-ui-task-battery-status.ts';
const sc={brand_id:'starry',environment:'staging'},m='member_1',task='task_1';
const auth={member_ref:m,environment:'staging',status:'active',auth_version:3,
 session_revoked:0,policy_version:1};
const taskRow={task_ref:task,member_ref:m,environment:'staging',
 source_event_ref:'auth_task_source_1234567890123456789',
 status:'committed',commit_attempt:1,completed_at_ms:110000,policy_version:1};
const wallet={task_ref:task,member_ref:m,hold_status:'committed',created_ms:1000,
 expires_ms:181000,hold_policy_version:1,rate_version:1,price:7,balance:3,
 wallet_version:4,revoked:0,reserve_entries:1,commit_entries:1,
 commit_revision:4,commit_balance_after:3};
const candidate={kind:'OFFLINE_UNVERIFIED_TASK_WALLET_MAPPING',brand_id:'starry',
 environment:'staging',member_ref:m,task_ref:task,
 source_event_ref:taskRow.source_event_ref,task_attempt:1,policy_version:1,
 wallet_revision:4,signed_source_approved:false,member_mapping_approved:false,
 independent_floor_approved:false};
const mapping={status:'review_only',reason:'LOCAL_MAPPING_NOT_AUTHORIZED',candidate,
 may_settle:false,may_release_task:false,may_ack_queue:false,may_regrant:false,
 may_restore:false,may_publish:false,may_sell_battery:false,live:false};
const copy=x=>structuredClone(x);
function setup(over={}){
 const counts={auth:0,task:0,wallet:0,map:0,legal:0,retention:0,policy:0,rate:0};
 const pick=(k,f)=>{counts[k]++;const v=over[k];return typeof v==='function'?v(counts[k]):v===undefined?copy(f):v};
 const sql=(k,q,args,defaultValue)=>({prepare(s){assert.equal(s,q);return{
  bind(...params){assert.deepEqual(params,args);return{
   async first(){return pick(k,defaultValue);}
  }}};
 }});
 const deps={enabled:true,scope:sc,
  authDb:sql('auth',AI3_R19_AUTH_SQL,[m,'staging'],auth),
  taskDb:sql('task',AI3_R19_TASK_SQL,[task,m,'staging'],taskRow),
  batteryDb:sql('wallet',AI3_R19_WALLET_SQL,[m,task],wallet),
  mapping:{async inspect(mem,t,clock){assert.equal(mem,m);assert.equal(t,task);
   assert.equal(clock,110500);return pick('map',mapping);}},
  lawfulPurposeNow:async()=>pick('legal',true),
  lawfulRetentionNow:async()=>pick('retention',true),
  approvedPolicyVersionNow:async()=>pick('policy',1),
  approvedFreeBatteryRateNow:async()=>pick('rate',true)};
 return {counts,make:(params={})=>createOfflineR21CandidateTaskBatteryStatus({...deps,...params})};
}
function protectedUi(ui,state,screen='TASK_STATUS'){
 assert.equal(ui.schema_version,AI3_R21_UI_VERSION);
 assert.equal(ui.state,state);assert.equal(ui.message_key,state);
 assert.equal(ui.screen,screen);assert.equal(ui.kind,'offline_candidate_ui_only');
 for(const k of ['task_completed','wallet_settled','status_authoritative','can_submit',
  'can_retry','may_settle','may_release','may_regrant','may_restore',
  'may_ack_queue','may_sell_battery','live'])assert.equal(ui[k],false,k);
 assert.equal(ui.balance_display,null);assert.equal(ui.rate_display,null);
 const serialized=JSON.stringify(ui);
 for(const sensitive of [m,task,taskRow.source_event_ref,'member_ref','wallet_revision',
  '"balance":','"price":','email','sku'])assert.equal(serialized.includes(sensitive),false,sensitive);
}
test('R21 versioned 4-screen states are private, no raw identifiers or numeric balance',async()=>{
 assert.equal(LIVE_AI3_R21_CANDIDATE_UI_ENABLED,false);
 assert.deepEqual(AI3_R21_UI_SCREENS,['TASK_REVIEW','TASK_STATUS','TASK_RESULT','BATTERY_LEDGER']);
 const f=setup();
 for(const screen of AI3_R21_UI_SCREENS)
  protectedUi(await f.make().project(m,task,screen,110500),
   screen==='BATTERY_LEDGER'?'unconfirmed_balance':'review_only',screen);
});
test('R21 disabled and forged scope/input fail before any protected DB read',async()=>{
 const f=setup();
 protectedUi(await f.make({enabled:false}).project(m,task,'TASK_STATUS',110500),'blocked');
 protectedUi(await f.make().project(m,task,'FORGED',110500),'blocked');
 assert.throws(()=>f.make({scope:{brand_id:'hglobal',environment:'staging'}}),/SCOPE/);
 assert.throws(()=>f.make({scope:{brand_id:'starry',environment:'production'}}),/SCOPE/);
 assert.equal(f.counts.auth,0);
});
test('R21 lawful purpose/retention and unknown policy gate all sensitive reads',async()=>{
 for(const o of [{legal:false},{retention:false},{policy:null},{policy:0}]){
  const f=setup(o);protectedUi(await f.make().project(m,task,'TASK_REVIEW',110500),'blocked','TASK_REVIEW');
  assert.equal(f.counts.auth,0);
 }
});
test('R21 unapproved free Battery rate blocks and never reveals numeric rate',async()=>{
 const f=setup({rate:false});
 protectedUi(await f.make().project(m,task,'TASK_REVIEW',110500),'rate_not_approved','TASK_REVIEW');
 assert.equal(f.counts.auth,0);
});
test('R21 invalid/revoked/deleted current member cannot show old Task success',async()=>{
 for(const a of [{...auth,status:'deleted'},{...auth,session_revoked:1},
  {...auth,environment:'development'},null]){
  const f=setup({auth:a});protectedUi(await f.make().project(m,task,'TASK_STATUS',110500),'blocked');
  assert.equal(f.counts.wallet,0);
 }
});
test('R21 absent task shows unknown, never retry or completed',async()=>{
 const f=setup({task:null});
 protectedUi(await f.make().project(m,task,'TASK_STATUS',110500),'task_unknown');
});
test('R21 absent Wallet: committed Task mismatch, pending Task unverified balance',async()=>{
 const f=setup({wallet:null});
 protectedUi(await f.make().project(m,task,'TASK_RESULT',110500),'receipt_mismatch','TASK_RESULT');
 const f2=setup({wallet:null,task:{...taskRow,status:'pending'}});
 protectedUi(await f2.make().project(m,task,'BATTERY_LEDGER',110500),'balance_unverified','BATTERY_LEDGER');
});
test('R21 reserved unfinished Task displays hold pending, double-submit disabled',async()=>{
 const f=setup({task:{...taskRow,status:'pending'},wallet:{...wallet,hold_status:'held',
  commit_entries:0,commit_revision:null,commit_balance_after:null}});
 protectedUi(await f.make().project(m,task,'TASK_STATUS',110500),'hold_pending');
 assert.equal(f.counts.map,0);
});
test('R21 Task failed + released hold may say failed, not settle or refund',async()=>{
 const f=setup({task:{...taskRow,status:'cancelled'},wallet:{...wallet,hold_status:'released'}});
 protectedUi(await f.make().project(m,task,'TASK_STATUS',110500),'task_failed');
});
test('R21 Task success but local Wallet held/partial/replayed always receipt mismatch',async()=>{
 for(const w of [{...wallet,hold_status:'held'},{...wallet,commit_entries:0},
  {...wallet,reserve_entries:2},{...wallet,commit_revision:2},
  {...wallet,commit_balance_after:10}]){
  const f=setup({wallet:w});protectedUi(await f.make().project(m,task,'TASK_RESULT',110500),
   'receipt_mismatch','TASK_RESULT');assert.equal(f.counts.map,0);
 }
});
test('R21 wrong source member/environment or policy closes view',async()=>{
 for(const o of [{task:{...taskRow,member_ref:'member_2'}},
  {task:{...taskRow,environment:'development'}},
  {wallet:{...wallet,member_ref:'member_2'}},
  {wallet:{...wallet,revoked:1}},
  {task:{...taskRow,policy_version:2}}]){
  const f=setup(o);protectedUi(await f.make().project(m,task,'TASK_STATUS',110500),'blocked');
 }
});
test('R21 R20 independent floor/provenance absent or mismatched blocks success',async()=>{
 for(const p of [{...mapping,status:'blocked',candidate:null},
  {...mapping,may_ack_queue:true},
  {...mapping,candidate:{...candidate,independent_floor_approved:true}},
  {...mapping,candidate:{...candidate,source_event_ref:'wrong_ref_1234567890123456789'}},
  null]){
  const f=setup({map:p});
  protectedUi(await f.make().project(m,task,'TASK_RESULT',110500),'receipt_mismatch','TASK_RESULT');
 }
});
test('R21 PITR older wallet/Task, legal or policy revision drift never leak status',async()=>{
 for(const o of [{wallet:n=>n===1?wallet:{...wallet,wallet_version:2}},
  {task:n=>n===1?taskRow:{...taskRow,status:'pending'}},
  {auth:n=>n===1?auth:{...auth,status:'deleted'}}]){
  const f=setup(o);protectedUi(await f.make().project(m,task,'TASK_STATUS',110500),'receipt_mismatch');
 }
 for(const o of [{legal:n=>n===1},{retention:n=>n===1},
  {policy:n=>n===1?1:2},{rate:n=>n===1}]){
  const f=setup(o);protectedUi(await f.make().project(m,task,'TASK_RESULT',110500),'blocked','TASK_RESULT');
 }
});
test('R21 malformed getter/method exception/missing mandatory adapters all fail closed',async()=>{
 const evil={...wallet};Object.defineProperty(evil,'balance',
  {enumerable:true,get(){throw Error('sensitive data')}});
 for(const o of [{wallet:evil},{map:()=>{throw Error('DB down')}},
  {task:{...taskRow,secret:'bad'}},{wallet:{...wallet,sku:'forbidden'}}]){
  const f=setup(o);protectedUi(await f.make().project(m,task,'TASK_STATUS',110500),
   'blocked');
 }
 const f=setup();
 assert.throws(()=>f.make({mapping:null}),/PORTS/);
});
