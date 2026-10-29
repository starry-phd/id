import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const FILE=fileURLToPath(new URL('./release-readiness.v0.json',import.meta.url));
const REQUIRE=['G00-SSOT','G01-ISOLATION','G02-OIDC','G03-SESSION-D1','G04-STORE','G05-BILLING-D1','G06-P05','G07-AUDIT-QUEUE','G08-WORKER-SDK','G09-DEVICES','G10-OPS'];
export function validate(m){
 const err=[]; const error=x=>err.push(x);
 if(!m||typeof m!=='object'||Array.isArray(m))return ['invalid root'];
 if(m.schema_version!=='0.1.0'||m.purpose!=='manual_release_preflight_not_a_deployment_permission')error('schema/purpose changed');
 if(m.system!=='Starry (Starry ID + approved app scope only; H-Global excluded)')error('brand scope changed');
 if(!/^[0-9a-f]{40}$/.test(m.baseline?.sha||''))error('untrusted baseline sha');
 if(m.baseline?.offline_ci?.level!=='offline_synthetic_only')error('simulation must remain qualified');
 if(m.requirements?.new_registry!=='seed_only'||m.requirements?.reconciliation_complete!==false)error('requirements claims must be reconciled with reviewed SSOT before changing');
 if(m.requirements?.original_heading_index_count!==128)error('source count mismatch');
 if(m.eas_cost_policy?.free_default!==true||m.eas_cost_policy?.ci_on_every_pr!==true
 ||m.eas_cost_policy?.automatic_native_build_on_every_pr!==false
 ||m.eas_cost_policy?.requires_owner_approval_for_paid!==true
 ||m.eas_cost_policy?.native_testing_still_required!==true)error('DEV-I cost/test policy changed');
 if(m.deployment_automation?.enabled!==false||m.deployment_automation?.can_auto_deploy!==false)error('automation may not deploy');
 if(!Array.isArray(m.gates)||m.gates.length!==REQUIRE.length)return [...err,'missing release gates'];
 const ids=new Set();
 for(const g of m.gates){
  if(ids.has(g.id)||!REQUIRE.includes(g.id))error('duplicate or unexpected gate '+g.id);ids.add(g.id);
  if(typeof g.owner!=='string'||!/^AI-[0-4]$/.test(g.owner))error(g.id+' missing owner');
  if(!Array.isArray(g.required_evidence)||g.required_evidence.length<2||g.required_evidence.some(x=>typeof x!=='string'||x.length<12))error(g.id+' missing evidence requirements');
  if(!['blocked','verified'].includes(g.status))error(g.id+' unknown state');
  if(!Array.isArray(g.evidence))error(g.id+' invalid evidence');
  if(g.status==='verified'){
   if(!Array.isArray(g.evidence)||g.evidence.length===0||g.evidence.some(e=>!e||typeof e!=='object'||!/^[0-9a-f]{40}$/.test(e.commit_sha||'')||!/^https:\/\//.test(e.url||'')||!e.kind))error(g.id+' lacks provenance evidence');
   if(typeof g.verified_by!=='string'||g.verified_by.length<3||!/^https:\/\//.test(g.approval_record_url||''))error(g.id+' lacks reviewer record');
  }
 }
 for(const k of REQUIRE)if(!ids.has(k))error('absent '+k);
 if(typeof m.release_authorization?.granted!=='boolean')error('malformed authorization');
 if(m.release_authorization?.granted){
  if(m.gates.some(g=>g.status!=='verified'))error('cannot authorize with blocked gates');
  if(!/^https:\/\//.test(m.release_authorization?.owner_approval_record_url||'')||!m.release_authorization?.verified_approver)error('missing final owner approval evidence');
 }
 return err;
}
export function preflight(m){
 const errors=validate(m);
 const blocked=Array.isArray(m?.gates)?m.gates.filter(g=>g.status!=='verified').map(g=>g.id):[];
 return {valid:errors.length===0,errors,blocked,manual_review_eligible:errors.length===0&&blocked.length===0&&m?.release_authorization?.granted===true,can_auto_deploy:false};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const m=JSON.parse(readFileSync(FILE,'utf8'));
 const r=preflight(m);
 console.log(JSON.stringify({validation:r.valid?'PASS':'FAIL',release:r.manual_review_eligible?'ELIGIBLE_FOR_INDEPENDENT_MANUAL_REVIEW':'BLOCKED',blocked_gates:r.blocked,can_auto_deploy:false,errors:r.errors},null,2));
 if(!r.valid)process.exitCode=1;
 if(process.argv.includes('--assert-blocked')&&r.manual_review_eligible)process.exitCode=2;
}
