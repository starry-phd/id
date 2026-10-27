import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {preflight} from '../release-readiness/check-release-readiness.mjs';
const officialPath=new URL('../release-readiness/release-readiness.v0.json',import.meta.url);
const candidatePath=new URL('./r18-cross-d1-assignments.v0.json',import.meta.url);
const roles=new Map([['AI-1',[2,120,'modules/starry-id-v1/']],['AI-2',[3,119,'packages/rebuild-billing/']],['AI-3',[4,118,'packages/rebuild-ai3/']],['AI-4',[5,121,'apps/api/']]]);
const sha=/^[a-f0-9]{40}$/;
export function auditR18(plan,official){
 const errors=[]; const fail=msg=>errors.push(msg);
 if(!plan||typeof plan!=='object'||Array.isArray(plan)||!official)
  return {ok:false,errors:['R18 proposal / official gate required'],release_authorized:false};
 const p=preflight(official);
 if(!p.valid||p.blocked.length!==11||p.manual_review_eligible||official.release_authorization?.granted!==false||
    official.deployment_automation?.enabled!==false||official.deployment_automation?.can_auto_deploy!==false)
  fail('official canonical release gate must remain valid and fully blocked');
 if(plan.schema_version!=='0.1.0-draft'||plan.kind!=='AI0_R18_CROSS_D1_OFFLINE_PREFLIGHT_NOT_RELEASE_AUTHORITY'||
    plan.repository!=='starry-phd/id'||plan.scope!=='starry_only_hglobal_paused'||plan.status!=='draft_not_approved')
  fail('proposal cannot become a live or cross-brand approval');
 if(plan.source?.verified_integration_pr!==123||!sha.test(plan.source?.verified_integration_sha??'')||
    plan.source.verified_integration_sha!=='f84eab58e20377b5bd1ce313b969befb531b4938'||
    plan.source.adr_pr!==87||plan.source.sop_pr!==70||
    plan.source.release_gate_path!=='docs/release-readiness/release-readiness.v0.json')
  fail('unexpected R17 fixed source or release authority');
 const d=plan.decision;
 if(d?.physical_consistency_architecture!=='UNDECIDED'||
    d?.offline_research_preference!=='B_DURABLE_OUTBOX_SAGA'||
    d?.logical_auth_source_candidate!=='AI-1_AUTH_COMMITTED_OUTBOX'||
    JSON.stringify(d?.options)!==JSON.stringify([
      {id:'A_SINGLE_STARRY_TRANSACTION_AUTHORITY',status:'unapproved_candidate'},
      {id:'B_DURABLE_OUTBOX_SAGA',status:'unapproved_candidate'},
      {id:'C_SNAPSHOT_READ_THEN_WRITE',status:'rejected_for_live'}]))
  fail('R18 must not assert a selected architecture or official publisher');
 for(const field of ['unique_live_publisher_approved','canonical_p05_approved',
   'lawful_q104_q119_retention_kms_approved','owner_physical_db_mapping_approved',
   'cross_d1_atomicity_proven','true_exactly_once_proven','rollback_resistant_witness_proven'])
  if(d?.[field]!==false)fail('unearned architecture proof/approval '+field);
 for(const field of ['owner_approval_obtained','live_cloudflare_authorized','store_authorized',
   'eas_authorized','paid_usage_authorized','main_merge_authorized',
   'deployment_authorized','queue_ack_authorized','publishable'])
  if(plan.authorization?.[field]!==false)fail('unearned permission '+field);
 if(plan.authorization?.hglobal_paused!==true)fail('H-Global must remain paused');
 if(!Array.isArray(plan.owners)||plan.owners.length!==4)fail('four distinct Owners required');
 const seen=new Set();
 for(const o of plan.owners??[]){
  const role=roles.get(o?.id);
  if(!role||seen.has(o.id)||o.issue!==role[0]||o.last_verified_owner_pr!==role[1]||
    o.path_prefix!==role[2]||typeof o.r18_task!=='string'||o.r18_task.length<25||
    !Array.isArray(o.negative_cases)||o.negative_cases.length<3||
    new Set(o.negative_cases).size!==o.negative_cases.length)
   fail('owner task/permission overlap or missing negative evidence: '+o?.id);
  seen.add(o?.id);
 }
 for(const id of roles.keys())if(!seen.has(id))fail('missing role '+id);
 const gateIds=new Set(official?.gates?.map(g=>g.id)??[]), scenarioIds=new Set();
 if(!Array.isArray(plan.scenario_matrix)||plan.scenario_matrix.length<9)
  fail('at least nine cross-D1 failure scenarios required');
 for(const s of plan.scenario_matrix??[]){
  if(!s||scenarioIds.has(s.id)||!/^[A-Z][A-Z_]{6,}$/.test(s.id)||
    !['blocked','retry_or_review_only','review_only'].includes(s.expected)||
    !Array.isArray(s.gate_ids)||s.gate_ids.length===0||s.gate_ids.some(g=>!gateIds.has(g))||
    !Array.isArray(s.owners)||s.owners.length===0||s.owners.some(o=>!roles.has(o))||
    s.may_ack_queue!==false||s.may_regrant!==false||s.may_restore!==false||s.live!==false)
   fail('scenario must be canonical, fail-closed, owned and nonlive: '+s?.id);
  scenarioIds.add(s?.id);
 }
 for(const required of ['PARTIAL_SINK_COMMIT','ACK_LOST_AFTER_COMMIT',
 'PITR_TOMBSTONE_ROLLBACK','TASK_WALLET_RACE','MISSING_EXTERNAL_TRUST_ANCHOR',
 'STORE_REFUND_OUT_OF_ORDER','SOURCE_REPLAY','POLICY_DRIFT_POST_COMMIT',
 'CROSS_BRAND_OR_ENV'])
  if(!scenarioIds.has(required))fail('missing adverse case '+required);
 return {ok:errors.length===0,errors,blocked_gates:p.blocked.length,
  owner_tasks:seen.size,scenarios:scenarioIds.size,
  architecture_decided:false,release_authorized:false,queue_ack_allowed:false,live:false};
}
export function readR18Inputs(){
 return {plan:JSON.parse(readFileSync(candidatePath,'utf8')),
  official:JSON.parse(readFileSync(officialPath,'utf8'))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {plan,official}=readR18Inputs();
 const result=auditR18(plan,official);
 if(!result.ok){console.error('R18 FAIL-CLOSED:',result.errors.join(' | '));process.exitCode=1}
 else console.log('AI-0 R18 PREP PASS: 4 Owners, '+result.scenarios+' offline fail-closed scenarios, 11/11 RELEASE BLOCKED, no live permission');
}
