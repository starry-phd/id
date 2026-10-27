import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preflight} from '../release-readiness/check-release-readiness.mjs';

// Frozen GitHub API evidence, independently obtained from each R19 owner Draft.
const FROZEN=[
  {
    "owner": "AI-1",
    "pr": 132,
    "head_sha": "de2d4201bf4cf76b0db424fecc73f6bbb15524a9",
    "base_sha": "f006e90311b3fecedae0f7c75004c940adfacede",
    "files": [
      {
        "path": "modules/starry-id-v1/ADR-ROUND19-AUTH-CROSS-DOMAIN-DTO.md",
        "git_blob_sha": "978aa6d9c9ad2e3791b68036acc9e6cc2f0dfee6"
      },
      {
        "path": "modules/starry-id-v1/src/round19-auth-cross-domain-dto.ts",
        "git_blob_sha": "fb071042e24bea93a824247fc0d0f7e493501b43"
      },
      {
        "path": "modules/starry-id-v1/test/round19-auth-cross-domain-dto.test.mjs",
        "git_blob_sha": "68ee474f08713fde2405742ff9d2b0b4b9c04da8"
      }
    ]
  },
  {
    "owner": "AI-2",
    "pr": 135,
    "head_sha": "df6f49a84a89d8f0c0dde57463bfad6cb091323d",
    "base_sha": "f006e90311b3fecedae0f7c75004c940adfacede",
    "files": [
      {
        "path": "packages/rebuild-billing/docs/ROUND19-SAGA-RECEIPT-READONLY-GATE.md",
        "git_blob_sha": "c38390dd4aac0b330be5370d744dfaaa06ae4b97"
      },
      {
        "path": "packages/rebuild-billing/src/r19-saga-receipt.ts",
        "git_blob_sha": "ec596fdb7fb939569a801f78757d7b21f617b924"
      },
      {
        "path": "packages/rebuild-billing/test/r19-saga-receipt.test.mjs",
        "git_blob_sha": "4494dfbce9d1b1a8f0e208e6744befaccbbc7915"
      }
    ]
  },
  {
    "owner": "AI-3",
    "pr": 133,
    "head_sha": "9ba8a24b670c202de30a72676b7579a402260bd7",
    "base_sha": "f006e90311b3fecedae0f7c75004c940adfacede",
    "files": [
      {
        "path": "packages/rebuild-ai3/docs/ROUND19-TASK-WALLET-CROSS-D1-RECEIPT-GATE.md",
        "git_blob_sha": "4790fd58a719cb429bdc565cbea6afb294a2da74"
      },
      {
        "path": "packages/rebuild-ai3/src/r19-task-wallet-receipt-gate.ts",
        "git_blob_sha": "06e2e1b35de3542c91f992cc5a8c8b4a9b44ccd6"
      },
      {
        "path": "packages/rebuild-ai3/test/r19-task-wallet-receipt-gate.test.mjs",
        "git_blob_sha": "82b66283d44e0c10480c7803c80c2af158293f5c"
      },
      {
        "path": "packages/rebuild-ai3/test/test_r19_three_db_task_wallet.py",
        "git_blob_sha": "c4da4c2171c415d1b1b880931d8a7d9f7efe9cec"
      }
    ]
  },
  {
    "owner": "AI-4",
    "pr": 134,
    "head_sha": "48f234ee252dc027c00ef0e692682649b32cfbd5",
    "base_sha": "f006e90311b3fecedae0f7c75004c940adfacede",
    "files": [
      {
        "path": "apps/api/src/round19-offline-four-domain-wiring.ts",
        "git_blob_sha": "cda876d9c277095e379cafe66c96a3c3f06e87b8"
      },
      {
        "path": "apps/api/test/round19-offline-four-domain-wiring.test.mjs",
        "git_blob_sha": "9b1b8a4f408cdef3c9b8a543934d3965e469c0b6"
      },
      {
        "path": "apps/api/test/round19-real-owner-adapters.test.mjs",
        "git_blob_sha": "4d524a40791b50b875d82c5f57a2183964486f41"
      },
      {
        "path": "docs/ai/AI4-ROUND19-FOUR-DOMAIN-WIRING.md",
        "git_blob_sha": "1d4278131c0ab66e850aec83ef79a481d44e8502"
      }
    ]
  }
];
const root=fileURLToPath(new URL('../../',import.meta.url));
const shaRx=/^[0-9a-f]{40}$/;
const safePath=(s)=>typeof s==='string'&&!s.startsWith('/')&&
 !s.split('/').some(x=>x===''||x==='.'||x==='..')&&!s.includes('\\');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function auditR19FourOwnerOriginalBlobs(plan,official,read=(path)=>readFileSync(resolve(root,path))){
 const errors=[],fail=x=>errors.push(x);
 if(!plan||typeof plan!=='object'||!official)
  return {ok:false,errors:['R19 manifest and official release JSON required']};
 const released=preflight(official);
 if(!released.valid||released.blocked.length!==11||released.manual_review_eligible||
  official.release_authorization?.granted!==false||
  official.deployment_automation?.can_auto_deploy!==false)
  fail('official G00-G10 not all blocked');
 if(plan.schema_version!=='0.1.0'||
  plan.kind!=='AI0_R19_FOUR_OWNER_EXACT_SOURCE_OFFLINE_INTEGRATION'||
  plan.scope!=='starry_only_offline'||
  plan.baseline?.r18_integrated_pr!==131||
  plan.baseline?.r18_integrated_sha!=='f006e90311b3fecedae0f7c75004c940adfacede'||
  plan.baseline?.ai0_product_candidate_pr!==136||
  plan.baseline?.ai0_product_candidate_sha!=='84a5b8c4995f24a5c693100a0987273905c07d1f'||
  plan.baseline?.owner_r19_common_base_sha!=='f006e90311b3fecedae0f7c75004c940adfacede'||
  plan.expected_original_owner_files!==14||
  plan.genuine_cross_d1_atomicity_proven!==false)fail('false parent/source/physical DB assertion');
 if(!Array.isArray(plan.source_owners)||plan.source_owners.length!==4)
  fail('expected exactly four R19 Owner PRs');
 const used=new Set();
 for(let i=0;i<FROZEN.length;i++){
  const actual=plan.source_owners?.[i],expected=FROZEN[i];
  if(!actual||actual.owner!==expected.owner||actual.pr!==expected.pr||
    actual.head_sha!==expected.head_sha||actual.base_sha!==expected.base_sha||
    !Array.isArray(actual.files)||actual.files.length!==expected.files.length){
   fail('R19 owner PR/head/count not immutable: '+expected.owner);continue;
  }
  for(let j=0;j<expected.files.length;j++){
   const actualFile=actual.files[j],want=expected.files[j];
   if(!actualFile||actualFile.path!==want.path||
    actualFile.git_blob_sha!==want.git_blob_sha||!shaRx.test(actualFile.git_blob_sha)||
    !safePath(actualFile.path)||used.has(actualFile.path)){
    fail('R19 original Owner git file mismatch '+expected.owner+' file '+j);continue;
   }
   used.add(actualFile.path);
   try{
    const raw=read(actualFile.path),bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
    const gitDigest=createHash('sha1').update(Buffer.from('blob '+bytes.length))
     .update(Buffer.from([0])).update(bytes).digest('hex');
    if(gitDigest!==want.git_blob_sha)fail('byte content differs from GitHub original Owner blob '+want.path);
   }catch{fail('missing original Owner file '+want.path)}
  }
 }
 if(used.size!==14)fail('not all fourteen owner paths integrated');
 for(const [k,v] of Object.entries(plan.release_authorizations??{})){
  if(v!==false)fail('R19 unapproved official operation: '+k);
 }
 const requiredAuth=['merge_main','production','preview','staging','live_d1',
  'real_queue_ack','real_dlq','store','oidc','eas','paid_usage','free_battery_sales',
  'canonical_p05','physical_a_or_b_chosen','lawful_retention_q104_q119',
  'external_floor_or_kms','hglobal_work','publishable'];
 for(const k of requiredAuth)if(plan.release_authorizations?.[k]!==false)
  fail('missing fail-closed R19 permission '+k);
 const reqClaims=['four_individual_owner_head_ci_success',
  'integrated_same_head_ci_success_not_yet_claimed',
  'real_r19_owner_multidb_tests_runnable_by_full_gate',
  'official_gates_must_all_remain_blocked','app_product_and_ux_are_candidate_only'];
 for(const k of reqClaims)if(plan.assessment?.[k]!==true)
  fail('R19 planning/documentary claim changed '+k);
 return {ok:errors.length===0,errors,original_owner_blobs:used.size,
  owner_sources:FROZEN.length,official_release_gates_blocked:released.blocked.length,
  publisher_live:false,queue_ack_allowed:false,integrated_ci_proven_by_manifest:false};
}
export function readR19Inputs(){
 return {plan:JSON.parse(readFileSync(new URL('./r19-owner-original-blob-manifest.v0.json',import.meta.url),'utf8')),
 official:JSON.parse(readFileSync(new URL('../release-readiness/release-readiness.v0.json',import.meta.url),'utf8'))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {plan,official}=readR19Inputs(),out=auditR19FourOwnerOriginalBlobs(plan,official);
 if(!out.ok){console.error('AI-0 R19 SOURCE ERROR '+out.errors.join(' | '));process.exitCode=1;}
 else console.log('AI-0 R19 ORIGINAL BLOBS '+out.original_owner_blobs+'/14 from 4 actual Owner PRs; '+out.official_release_gates_blocked+'/11 BLOCKED; no release authorization.');
}
