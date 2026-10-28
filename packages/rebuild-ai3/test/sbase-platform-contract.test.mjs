import test from 'node:test';
import assert from 'node:assert/strict';
import {createCandidateBatteryClient,SBASE_BATTERY_CONTRACT_VERSION,
 SBASE_BATTERY_LIVE_ENABLED} from '../src/sbase-battery-client-contract.ts';
import {createCandidateAuditRetryPlanner,SBASE_AUDIT_COMPAT_VERSION,
 SBASE_AUDIT_LIVE_ENABLED} from '../src/sbase-audit-retry-contract.ts';
import {CANDIDATE_VERSION} from '../src/index.ts';

const scope={brand_id:'starry',app_id:'starry-echo',environment:'staging'};
const request={...scope,operation:'battery.policy.read'};
const snapshot={...scope,status:'candidate_free',policy_version:1};
const event={...scope,schema_version:CANDIDATE_VERSION,event_id:'e_123456789',
 event_type:'identity.session.revoked',occurred_at:'2026-10-28T03:00:00Z',
 correlation_id:'c_123456789',idempotency_key:'i_123456789',
 resource_ref:'pseudonymous_resource_123',actor_ref:'pseudonymous_actor_123',
 result:'recorded',classification:'metadata_only'};
const copy=x=>structuredClone(x);
function batteryFixture(opts={}){
 const calls={auth:0,snapshot:0};
 const client=createCandidateBatteryClient({enabled:opts.enabled??true,
  scope:opts.scope??scope,async verifyScopedRead(){
   calls.auth++;const o=opts.auth;
   return typeof o==='function'?o(calls.auth):o??'active';
  },async readPolicyStatus(){
   calls.snapshot++;const o=opts.snapshot;
   return typeof o==='function'?o(calls.snapshot):o===undefined?copy(snapshot):o;
  }});
 return {calls,client};
}
function noBatteryRights(r){
 for(const key of ['authorized_balance','may_grant','may_reserve',
  'may_commit','may_release','may_purchase','may_sell',
  'may_convert_payment','may_regrant','may_restore','may_ack_queue','live'])
  assert.equal(r[key],false,key);
 assert.equal(r.pricing,'permanently_free');
 assert.equal(r.unrelated_readonly_ui_may_degrade,true);
 assert.equal(r.contract_version,SBASE_BATTERY_CONTRACT_VERSION);
}
function auditFixture(opts={}){
 const calls={canonical:0,signed:0,dedupe:0,legal:0};
 const value=(k,d)=>{calls[k]++;const o=opts[k];
  return typeof o==='function'?o(calls[k]):o===undefined?d:o;};
 const planner=createCandidateAuditRetryPlanner({enabled:opts.enabled??true,
  scope:opts.scope??scope,
  retry:opts.retry??{max_attempts:4,base_delay_ms:1000,max_delay_ms:5000},
  ports:{async validateCandidate(){return value('canonical','candidate_valid');},
   async verifySource(){return value('signed','candidate_signed');},
   async readDedupe(){return value('dedupe','unseen');},
   async lawfulRetentionNow(){return value('legal',true);}}
 });
 return {planner,calls};
}
const retry=(e=event,attempt=1,failure='transient')=>({event:e,attempt,failure});
function noAuditRights(x){
 for(const k of ['may_ack_queue','may_publish','may_send_notification',
  'may_change_battery','may_restore','live'])assert.equal(x[k],false,k);
}
test('SBASE BatteryClient candidate versioned free read is non-authoritative',async()=>{
 assert.equal(SBASE_BATTERY_LIVE_ENABLED,false);
 const f=batteryFixture(),r=await f.client.readFreePolicyStatus(request);
 assert.equal(r.status,'candidate_only');assert.equal(r.error_code,'NOT_APPROVED');
 assert.deepEqual(f.calls,{auth:2,snapshot:2});noBatteryRights(r);
});
test('SBASE BatteryClient default OFF and no paid or balance methods',async()=>{
 const f=batteryFixture({enabled:false}),r=await f.client.readFreePolicyStatus(request);
 assert.equal(r.error_code,'DISABLED');assert.equal(f.calls.auth,0);
 for(const key of ['purchase','getBalance','reserve','commit','release','grant','refund','getExpiring'])
  assert.equal(key in f.client,false,key);
 noBatteryRights(r);
});
test('SBASE cross App/scope/production/H-Global denied before backend call',async()=>{
 const f=batteryFixture();
 for(const x of [{...request,app_id:'other-app'}, {...request,brand_id:'hglobal'},
  {...request,environment:'development'},
  {...request,operation:'battery.purchase'},
  {...request,billing_sku:'illegal'},null]){
  const r=await f.client.readFreePolicyStatus(x);
  assert.equal(r.error_code,'BAD_SCOPE');noBatteryRights(r);
 }
 assert.deepEqual(f.calls,{auth:0,snapshot:0});
 assert.throws(()=>batteryFixture({scope:{...scope,environment:'production'}}),/SCOPE/);
 assert.throws(()=>batteryFixture({scope:{...scope,brand_id:'hglobal'}}),/SCOPE/);
});
test('SBASE current member revoked, unknown Auth and late revocation deny',async()=>{
 for(const a of ['revoked','unknown',n=>n===1?'active':'revoked']){
  const f=batteryFixture({auth:a}),r=await f.client.readFreePolicyStatus(request);
  assert.equal(r.status,'blocked');noBatteryRights(r);
  assert.notEqual(r.error_code,'NOT_APPROVED');
 }
});
test('SBASE offline / service outage isolates unrelated read-only screens',async()=>{
 const f=batteryFixture({snapshot:()=>{throw Error('offline')}});
 const r=await f.client.readFreePolicyStatus(request);
 assert.equal(r.status,'unavailable');assert.equal(r.error_code,'SERVICE_UNAVAILABLE');
 noBatteryRights(r);
});
test('SBASE forged scope/extra funds/source fields rejected with no privilege',async()=>{
 for(const x of [null,{...snapshot,brand_id:'hglobal'},
  {...snapshot,app_id:'another'},
  {...snapshot,environment:'production'}, {...snapshot,policy_version:0},
  {...snapshot,balance:99999}, {...snapshot,purchase_token:'secret'}]){
  const f=batteryFixture({snapshot:x}),r=await f.client.readFreePolicyStatus(request);
  assert.equal(r.error_code,'UNTRUSTED_STATUS');noBatteryRights(r);
 }
});
test('SBASE policy drift / late source loss blocks; does not infer rollback proof',async()=>{
 for(const value of [n=>n===1?snapshot:{...snapshot,policy_version:2},
  n=>n===1?snapshot:null]){
  const f=batteryFixture({snapshot:value}),r=await f.client.readFreePolicyStatus(request);
  assert.equal(r.status,'blocked');noBatteryRights(r);
 }
});
test('SBASE no accessor/getter exfiltration in purported status record',async()=>{
 const bad={...snapshot};Object.defineProperty(bad,'policy_version',
  {enumerable:true,get(){throw Error('exfiltration');}});
 const f=batteryFixture({snapshot:bad}),r=await f.client.readFreePolicyStatus(request);
 assert.equal(r.error_code,'UNTRUSTED_STATUS');noBatteryRights(r);
});
test('SBASE audit adapter strictly reuses existing candidate P05 version',async()=>{
 assert.equal(SBASE_AUDIT_LIVE_ENABLED,false);
 assert.equal(SBASE_AUDIT_COMPAT_VERSION,CANDIDATE_VERSION);
 const f=auditFixture(),r=await f.planner.plan(retry());
 assert.equal(r.disposition,'review_only');assert.equal(r.reason,'CANDIDATE_ONLY');
 assert.equal(r.next_delay_ms,1000);
 assert.deepEqual(f.calls,{canonical:2,signed:2,dedupe:2,legal:2});
 noAuditRights(r);
});
test('SBASE audit exponential backoff only an offline suggestion and capped',async()=>{
 const f=auditFixture();const r=await f.planner.plan(retry(event,3));
 assert.equal(r.disposition,'review_only');assert.equal(r.next_delay_ms,4000);noAuditRights(r);
 const r2=await f.planner.plan(retry(event,4));
 assert.equal(r2.disposition,'dead_letter_review');assert.equal(r2.next_delay_ms,null);
 noAuditRights(r2);
});
test('SBASE P05 rejects forged brand, App, environment, secret fields, type',async()=>{
 const f=auditFixture();
 for(const e of [{...event,brand_id:'hglobal'},{...event,app_id:'other'},
  {...event,environment:'production'},{...event,event_type:'store.purchase'},
  {...event,token:'secret'},{...event,occurred_at:'not-a-date'}]){
  const r=await f.planner.plan(retry(e));
  assert.equal(r.disposition,'blocked');assert.equal(r.reason,'INVALID_EVENT_OR_SCOPE');
  noAuditRights(r);
 }
 assert.equal(f.calls.canonical,0);
});
test('SBASE unsigned/unverified issuer must never plan Queue publish/ACK',async()=>{
 for(const x of [{signed:'unsigned'},{signed:'unknown'},
  {canonical:'denied'},{canonical:'unknown'}]){
  const f=auditFixture(x),r=await f.planner.plan(retry());
  assert.equal(r.reason,'SOURCE_UNSIGNED_OR_UNVERIFIED');noAuditRights(r);
 }
});
test('SBASE replayed, duplicate and uncertain D1 dedupe receipt fail closed',async()=>{
 for(const d of ['seen','unknown']){
  const f=auditFixture({dedupe:d}),r=await f.planner.plan(retry());
  assert.equal(r.reason,'DUPLICATE_OR_UNKNOWN');noAuditRights(r);
 }
});
test('SBASE late revocation, PITR/dedupe disagreement and source drift blocked',async()=>{
 for(const options of [{signed:n=>n===1?'candidate_signed':'unsigned'},
  {dedupe:n=>n===1?'unseen':'seen'},
  {canonical:n=>n===1?'candidate_valid':'unknown'}]){
  const f=auditFixture(options),r=await f.planner.plan(retry());
  assert.equal(r.reason,'EVIDENCE_CHANGED');noAuditRights(r);
 }
});
test('SBASE legal retention failure before and after verification blocks',async()=>{
 for(const legal of [false,n=>n===1]){
  const f=auditFixture({legal}),r=await f.planner.plan(retry());
  assert.equal(r.reason,'POLICY_UNAVAILABLE');noAuditRights(r);
 }
});
test('SBASE permanent failures or disabled port deny without requeue',async()=>{
 const f=auditFixture();
 const r=await f.planner.plan(retry(event,1,'permanent'));
 assert.equal(r.reason,'PERMANENT_FAILURE');noAuditRights(r);
 const g=auditFixture({enabled:false});
 assert.equal((await g.planner.plan(retry())).disposition,'blocked');
});
test('SBASE invalid bounded backoff, absent source, production Scope rejected',async()=>{
 assert.throws(()=>auditFixture({retry:{max_attempts:999,base_delay_ms:0,max_delay_ms:0}}),/RETRY_CONFIG/);
 const f=auditFixture({signed:()=>{throw Error('Service down');}});
 assert.equal((await f.planner.plan(retry())).reason,'PORT_UNAVAILABLE');
 const g=auditFixture({scope:{...scope,environment:'production'}});
 const out=await g.planner.plan(retry({...event,environment:'production'}));
 assert.equal(out.reason,'POLICY_UNAVAILABLE');noAuditRights(out);
});
test('SBASE unknown event or malformed attempt never yields a privileged ACK',async()=>{
 const f=auditFixture();
 for(const input of [{event:null,attempt:1,failure:'transient'},
  {event,attempt:0,failure:'transient'},
  {event,attempt:-1,failure:'transient'},
  {event,attempt:2,failure:'non-transient'}]){
  const r=await f.planner.plan(input);
  assert.equal(r.disposition,'blocked');noAuditRights(r);
 }
});
