import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preflight} from '../release-readiness/check-release-readiness.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const SOURCES=[{"owner":"AI-1","pr":138,"head_sha":"aabd113711d4201e2ba5e81aab2f8a68c0d48b34","base_sha":"b713cbbc44307a325fec71fff74c81defbd95c71","files":[{"path":"modules/starry-id-v1/ADR-ROUND20-AUTH-IDENTITY-BOUNDARY.md","blob_sha":"a612d187caac099bb090876edfe867576ea3e85e"},{"path":"modules/starry-id-v1/src/round20-auth-identity-boundary.ts","blob_sha":"cea537c2d2e6d0058857e6f31e6c9bb3bdd4e4a8"},{"path":"modules/starry-id-v1/test/round20-auth-identity-boundary.test.mjs","blob_sha":"3f379f70330585e4abe19489fb8dc2d1a82d9316"}]},{"owner":"AI-2","pr":139,"head_sha":"2344dbe246a39c375c8394fe43754e99b84ba9d3","base_sha":"b713cbbc44307a325fec71fff74c81defbd95c71","files":[{"path":"packages/rebuild-billing/docs/ROUND20-AUTH-BILLING-STORE-NAMESPACE-GATE.md","blob_sha":"b0c156127fc70c0f692620a1d2f3d5c29c6c13d5"},{"path":"packages/rebuild-billing/src/r20-namespace-mapping-gate.ts","blob_sha":"cde293f5c7bc5b59fbc36b69321531fce91d1aca"},{"path":"packages/rebuild-billing/test/r20-namespace-mapping-gate.test.mjs","blob_sha":"f3c9de8afa1b9bf05446c0c29b72e6cd411e3ce3"}]},{"owner":"AI-3","pr":142,"head_sha":"398e447cb650fee533ed8374ffa1e75680d873dd","base_sha":"b713cbbc44307a325fec71fff74c81defbd95c71","files":[{"path":"packages/rebuild-ai3/docs/ROUND20-SOURCE-TASK-WALLET-MAPPING-GATE.md","blob_sha":"352cf1e7cc77971723690fd8afaa5f07e6b5099c"},{"path":"packages/rebuild-ai3/src/r20-task-wallet-source-binding.ts","blob_sha":"59fc09daca6fdc8301f29b57ee5519be320ef91f"},{"path":"packages/rebuild-ai3/test/r20-task-wallet-source-binding.test.mjs","blob_sha":"28854f915252fd693dfce5602345f31034659959"},{"path":"packages/rebuild-ai3/test/test_r20_three_db_source_wallet_binding.py","blob_sha":"74cde56d2de616bef4a1935474641154bbe4f737"}]},{"owner":"AI-4","pr":141,"head_sha":"5c051cd4bd1056a599d9e6cd45152b299dd03567","base_sha":"b713cbbc44307a325fec71fff74c81defbd95c71","files":[{"path":"apps/api/src/round20-private-r19-owner-interop.ts","blob_sha":"46061d88de73ef4d7df13f89ac1f0240d11494fd"},{"path":"apps/api/test/round20-private-r19-owner-interop.test.mjs","blob_sha":"f9f5bc47cb42cebd75e5fb42c8ae6e660cabbfd4"},{"path":"docs/ai/AI4-ROUND20-OWNER-R19-ADAPTER-MAPPING.md","blob_sha":"ba4bb08cc49e2c7f56a8da456436e3f380c97b1a"}]}];
const allowedDenials=["architecture_a_or_b_approved","lawful_q104_q119_approved","canonical_p05_approved","hmac_kms_authorized","external_witness_verified","cloudflare_multi_d1_atomicity_verified","queue_ack_enabled","store_authorized","oidc_authorized","eas_authorized","battery_purchase_allowed","hglobal_engineering_allowed","paid_usage_allowed","merge_main_allowed","deploy_allowed","publishable"];
const allowedClaims=["four_owner_individual_ci_success","integrated_new_head_ci_requires_independent_verification","offline_only","all_official_gates_blocked"];
export function auditR20Sources(plan,release,read=(path)=>readFileSync(resolve(ROOT,path))){
 const errors=[],fail=x=>errors.push(x);
 if(!plan||!release)return {ok:false,errors:['missing source or release']};
 const g=preflight(release);
 if(!g.valid||g.blocked.length!==11||g.manual_review_eligible||
  release.release_authorization?.granted!==false||
  release.deployment_automation?.can_auto_deploy!==false)fail('11 official release gates must remain blocked');
 const base=plan.baseline||{};
 if(plan.schema_version!=='0.1.0'||plan.kind!=='AI0_R20_EXACT_FOUR_OWNER_OFFLINE_GATE'||
  base.integration_pr!==137||base.integration_sha!=='b713cbbc44307a325fec71fff74c81defbd95c71'||
  base.app_research_pr!==140||base.app_research_sha!=='bd57cfc420efc970dc8f152d7a926a19be5dbcf9'||
  plan.original_blob_count!==13)fail('R20 approved source lineage mismatch');
 if(!Array.isArray(plan.owners)||plan.owners.length!==4)fail('four R20 owner inputs missing');
 let checked=0;
 const used=new Set();
 for(let i=0;i<4;i++){
  const want=SOURCES[i],owner=plan.owners?.[i];
  if(!owner||owner.owner!==want.owner||owner.pr!==want.pr||
   owner.head_sha!==want.head_sha||owner.base_sha!==want.base_sha||
   !Array.isArray(owner.files)||owner.files.length!==want.files.length){
    fail('owner source pinned ref mismatch '+want.owner);continue;
  }
  for(let j=0;j<want.files.length;j++){
   const x=owner.files[j],expected=want.files[j];
   if(!x||x.path!==expected.path||x.blob_sha!==expected.blob_sha||
    !/^[a-f0-9]{40}$/.test(x.blob_sha)||
    x.path.startsWith('/')||x.path.split('/').some(a=>!a||a==='..'||a==='.')||
    used.has(x.path)){fail('owner blob manifest mismatch '+want.owner+' #'+j);continue;}
   used.add(x.path);
   try{
    const src=read(x.path);
    const bytes=Buffer.isBuffer(src)?src:Buffer.from(src);
    const git=createHash('sha1').update(Buffer.from('blob '+bytes.length)).update(Buffer.from([0])).update(bytes).digest('hex');
    if(git!==x.blob_sha)fail('actual Git Blob bytes mutated '+x.path);
    else checked++;
   }catch{fail('missing owner blob '+x.path);}
  }
 }
 if(used.size!==13||checked!==13)fail('R20 incomplete owner source files');
 for(const k of allowedDenials)if(plan.denials?.[k]!==false)fail('illegal live approval '+k);
 for(const [k,v] of Object.entries(plan.denials??{}))if(v!==false)fail('unrecognized live approval '+k);
 for(const k of allowedClaims)if(plan.claims?.[k]!==true)fail('false offline CI interpretation '+k);
 return {ok:errors.length===0,errors,files:checked,owners:4,official_blocked:g.blocked.length,
  cross_d1_physical_proven:false,integrated_ci_not_proven_by_manifest:true};
}
export function loadR20Sources(){
 return {plan:JSON.parse(readFileSync(new URL('./r20-four-owner-original-sources.v0.json',import.meta.url),'utf8')),
  release:JSON.parse(readFileSync(new URL('../release-readiness/release-readiness.v0.json',import.meta.url),'utf8'))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {plan,release}=loadR20Sources(),x=auditR20Sources(plan,release);
 if(!x.ok){console.error(x.errors.join(' | '));process.exitCode=1;}
 else console.log('R20 13/13 exact Git owner blob SHA, 4 Owners, 11/11 RELEASE GATES BLOCKED; CI actual run separate.');
}
