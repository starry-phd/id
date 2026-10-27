import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';

const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const VALID_IDS=Array.from({length:10},(_,i)=>'P'+String(i+1).padStart(2,'0'));
const VALID_OWNERS=new Set(['AI-0','AI-1','AI-2','AI-3','AI-4']);
const GATES=['G00-SSOT','G01-ISOLATION','G02-OIDC','G03-SESSION-D1','G04-STORE','G05-BILLING-D1','G06-P05','G07-AUDIT-QUEUE','G08-WORKER-SDK','G09-DEVICES','G10-OPS'];
const SHA=/^[a-f0-9]{40}$/;
export const loadJson=p=>JSON.parse(readFileSync(join(repoRoot,p),'utf8'));

export function checkAdminPrepEvidence(register,release,{exists=existsSync}={}){
 const errors=[],fail=m=>errors.push(m);
 if(!register||!Array.isArray(register.components))return {ok:false,errors:['invalid registry']};
 if(register.kind!=='first_wave_admin_prep_evidence_candidates_not_completed'||
    register.repository!=='starry-phd/id'||register.brand_id!=='starry'||register.hglobal_paused!==true)
   fail('source / brand / scope mismatch');
 if(register.baseline?.pr!==100||!SHA.test(register.baseline?.sha??'')||
    register.source_contract!=='docs/contracts/FUTURE-STARRY-ADMIN-API.md'||
    register.source_issue!=='https://github.com/starry-phd/id/issues/13')
   fail('source provenance missing');
 for(const key of ['wave1_all_p01_p10_accepted','wave2_ui_development_authorized','sixty_capabilities_approved','admin_domain_approved','production_deploy_authorized'])
   if(register[key]!==false)fail('unapproved admin capability falsely enabled: '+key);
 if(register.all_release_gates_blocked!==true||
    register.evidence_grade!=='source_paths_only_not_actual_behavioral_verification')
   fail('false evidence classification');
 if(register.components.length!==10)fail('P01–P10 coverage is incomplete');
 const seen=new Set();
 for(const x of register.components){
   if(!x||!VALID_IDS.includes(x.id)||seen.has(x.id))fail('invalid/duplicate P identifier');
   seen.add(x?.id);
   if(typeof x.capability!=='string'||x.capability.length<5)fail('missing capability');
   if(!Array.isArray(x.owners)||x.owners.length===0||x.owners.some(v=>!VALID_OWNERS.has(v)))fail('owner mapping missing');
   if(x.status!=='candidate_unverified'||x.wave1_accepted!==false||
      x.actual_staging_evidence!==null||x.owner_approval_url!==null)
      fail('unsupported acceptance/staging/owner approval claimed for '+x.id);
   if(!Array.isArray(x.local_evidence)||x.local_evidence.length===0||
      !Array.isArray(x.missing_real_evidence)||x.missing_real_evidence.length===0)
      fail('source or missing evidence incomplete for '+x.id);
   for(const p of x.local_evidence??[]){
      if(typeof p!=='string'||!p.match(/^(apps|docs|modules|packages|\.github)\/[\w./-]+$/)||
         p.includes('..')||p.startsWith('/')||!exists(join(repoRoot,p)))
         fail('unverified source path in '+x.id+': '+p);
   }
 }
 if(VALID_IDS.some(k=>!seen.has(k)))fail('P01–P10 identifiers not fully covered');
 if(!exists(join(repoRoot,register.source_contract)))fail('source contract missing');
 const contract=readFileSync(join(repoRoot,register.source_contract),'utf8');
 if(VALID_IDS.some(id=>!contract.includes('**'+id+'**')))fail('P01–P10 not present in canonical contract');
 if(!release||!Array.isArray(release.gates)||release.gates.length!==11||
    GATES.some(id=>!release.gates.some(x=>x.id===id&&x.status==='blocked'))||
    release.release_authorization?.granted!==false||
    release.deployment_automation?.can_auto_deploy!==false)
     fail('release Gates changed');
 return {ok:errors.length===0,errors,p_count:register.components.length,release_approved:false,
         assurance:'file-existence-and-internal-consistency-only'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=checkAdminPrepEvidence(loadJson('docs/operations/r14-admin-prep-evidence.v0.json'),loadJson('docs/release-readiness/release-readiness.v0.json'));
 if(!result.ok){console.error(result.errors.join('\n'));process.exitCode=1;}
 else console.log('AI-0 R14 ADMIN-PREP preflight PASS: P01–P10 candidates traceable, 0 accepted, 11/11 release Gates BLOCKED');
}
