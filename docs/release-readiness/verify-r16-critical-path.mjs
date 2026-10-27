import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {preflight} from './check-release-readiness.mjs';

const canonical=['G00-SSOT','G01-ISOLATION','G02-OIDC','G03-SESSION-D1',
  'G04-STORE','G05-BILLING-D1','G06-P05','G07-AUDIT-QUEUE',
  'G08-WORKER-SDK','G09-DEVICES','G10-OPS'];
const SHA=/^[0-9a-f]{40}$/;
export const loadLocalJson=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));

export function auditR16CriticalPath(plan,official){
 const errors=[],fail=msg=>errors.push(msg);
 if(!plan||!Array.isArray(plan.gates)||!Array.isArray(plan.parallel_preflight))
  return {ok:false,errors:['invalid plan shape'],release_authorized:false,can_auto_deploy:false};
 const r=preflight(official);
 if(!r.valid||r.blocked.length!==11||r.manual_review_eligible||
    official?.release_authorization?.granted!==false||
    official?.deployment_automation?.enabled!==false||
    official?.deployment_automation?.can_auto_deploy!==false)
  fail('authoritative release file is not valid/all 11 blocked/no deploy');
 if(plan.schema_version!=='0.1-proposed'||
    plan.kind!=='AI0_PLANNING_PRIORITY_MAP_NOT_RELEASE_GATE_EVIDENCE'||
    plan.source?.repository!=='starry-phd/id'||
    plan.source?.verified_offline_baseline_pr!==112||
    !SHA.test(plan.source?.verified_offline_baseline_sha??'')||
    plan.source?.authoritative_release_json!=='docs/release-readiness/release-readiness.v0.json'||
    plan.scope!=='starry_only_hglobal_paused'||plan.status!=='proposal_only'||
    plan.technical_dependency_proof!==false||
    plan.release_gate_status_authoritative_only_in_release_json!==true)
  fail('proposed plan has bad scope/origin/evidence meaning');
 for(const k of ['manual_owner_approval_obtained','real_staging_evidence_obtained',
   'real_store_evidence_obtained','live_cloudflare_test_authorized',
   'paid_resources_authorized','admin_wave2_authorized','auto_publish_authorized'])
  if(plan[k]!==false)fail('unsupported real approval or platform evidence: '+k);
 if(!Array.isArray(plan.notes)||plan.notes.length<3)
  fail('planning-only cautions missing');
 if(plan.gates.length!==canonical.length)
  fail('all 11 canonical gates must have a row');
 const byId=new Map(),officialById=new Map(official?.gates?.map(g=>[g.id,g])??[]);
 for(const gate of plan.gates){
  if(!gate||!canonical.includes(gate.id)||byId.has(gate?.id)){fail('unknown/duplicate gate '+gate?.id);continue}
  byId.set(gate.id,gate);
  if(gate.owner!==officialById.get(gate.id)?.owner)
   fail('gate owner differs from canonical source: '+gate.id);
  if(!Number.isSafeInteger(gate.priority_lane)||gate.priority_lane<0||gate.priority_lane>3||
     typeof gate.evidence_class!=='string'||!gate.evidence_class.length||
     typeof gate.offline_work_next!=='string'||gate.offline_work_next.length<15||
     typeof gate.missing_live_evidence!=='string'||gate.missing_live_evidence.length<15)
   fail('missing actionable but appropriately qualified evidence gap: '+gate.id);
  if(gate.planning_status!=='candidate_not_approved'||
     gate.proof_url!==null||gate.approval_record_url!==null)
   fail('planning candidate falsely treated as approval: '+gate.id);
  if(!Array.isArray(gate.signoff_dependencies)||
     gate.signoff_dependencies.some(x=>typeof x!=='string'))
   fail('invalid release signoff dependencies: '+gate.id);
 }
 for(const id of canonical)if(!byId.has(id))fail('gate missing: '+id);
 const visiting=new Set(),visited=new Set(),order=[];
 const visit=id=>{
  if(visiting.has(id)){fail('cycle in signoff planning graph near: '+id);return;}
  if(visited.has(id))return;
  const g=byId.get(id);if(!g){fail('unknown dependency '+id);return;}
  visiting.add(id);
  const deps=g.signoff_dependencies??[];
  if(deps.length!==new Set(deps).size)fail('duplicate dependency: '+id);
  for(const d of deps){
   if(d===id){fail('self dependency: '+id);continue;}
   if(!byId.has(d)){fail('unknown dependency '+d+' from '+id);continue}
   visit(d);
  }
  visiting.delete(id);visited.add(id);order.push(id);
 };
 for(const id of canonical)visit(id);
 if(plan.parallel_preflight.length!==4)fail('must identify four safe parallel preflight tracks');
 const seen=new Set();
 for(const p of plan.parallel_preflight){
  if(!p||seen.has(p?.id)||!/^P-[A-Z-]+$/.test(p.id))fail('invalid/duplicate parallel workstream');
  seen.add(p?.id);
  if(p.owner!=='AI-0'||p.authorization!=='not_yet_granted'||p.real_environment_action!==false||
     !Number.isInteger(p.priority)||p.priority<0||p.priority>1||
     typeof p.task!=='string'||p.task.length<15||
     !Array.isArray(p.gate_refs)||p.gate_refs.length===0||
     p.gate_refs.some(id=>!byId.has(id)))
   fail('preflight track requests real authority or lacks linked gates: '+p?.id);
 }
 return {ok:errors.length===0,errors,blocked_gates:r.blocked.length,
  gate_count:plan.gates.length,workstreams:plan.parallel_preflight.length,
  signoff_plan_order:order,
  authority:'release-readiness.v0.json_only',
  external_platform_verified:false,release_authorized:false,can_auto_deploy:false,
  warning:'Candidate planning dependencies are NOT a verified deployment order; all 11 real Gate approvals remain blocked.'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const plan=loadLocalJson('./r16-critical-path.v0.json');
 const official=loadLocalJson('./release-readiness.v0.json');
 const result=auditR16CriticalPath(plan,official);
 if(!result.ok){console.error('AI-0 R16 critical-path preflight FAILED:',result.errors.join(' | '));process.exitCode=1;}
 else console.log('AI-0 R16 PREP PASS: '+result.gate_count+' canonical release Gates blocked, '+
  result.workstreams+' unapproved safe offline preflight tracks; no staging, paid or release permission.');
}
