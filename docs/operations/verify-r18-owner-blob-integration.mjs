import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {preflight} from '../release-readiness/check-release-readiness.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const manifestPath=new URL('./r18-exact-owner-blob-integration.v0.json',import.meta.url);
const releasePath=new URL('../release-readiness/release-readiness.v0.json',import.meta.url);
const expected=new Map([
 ['AI-1',{pr:127,head:'251150155421b5c13702efe4c6ee4b0a4f30bcc8',count:4,root:'modules/starry-id-v1/'}],
 ['AI-2',{pr:126,head:'5ea5238154647a85e68141a133166c78aed054b9',count:3,root:'packages/rebuild-billing/'}],
 ['AI-3',{pr:128,head:'cbaf08c91725f987edb4d928b8910849182b0f97',count:4,root:'packages/rebuild-ai3/'}],
 ['AI-4',{pr:129,head:'2a938031f179b0d390ca7d3eafa5362a87946510',count:3,root:'apps/api/'}]
]);
const SHA=/^[0-9a-f]{40}$/;
export function auditR18IntegratedOriginalBlobs(manifest,release,read=(path)=>readFileSync(resolve(root,path))){
 const errors=[],fail=x=>errors.push(x);
 if(!manifest||typeof manifest!=='object'||!release)
  return {ok:false,errors:['manifest and real gate JSON required']};
 const official=preflight(release);
 if(!official.valid||official.blocked.length!==11||official.manual_review_eligible||
  release.release_authorization?.granted!==false||
  release.deployment_automation?.can_auto_deploy!==false)
  fail('official release Gates not all still blocked');
 if(manifest.schema_version!=='0.1.0'||
    manifest.kind!=='AI0_R18_EXACT_ORIGINAL_OWNER_BLOB_INTEGRATION_OFFLINE_ONLY'||
    manifest.repo!=='starry-phd/id'||manifest.parent_ai0_pr!==130||
    manifest.parent_ai0_sha!=='b858da39c28541f1325606807b23ed5394b817d8'||
    manifest.baseline_r17_pr!==123||
    manifest.baseline_r17_sha!=='f84eab58e20377b5bd1ce313b969befb531b4938'||
    manifest.owner_original_blob_files!==14)
  fail('wrong AI-0 base or changed R18 source count');
 const auth=manifest.authorization??{};
 const flags=['architecture_a_or_b_approved','sole_live_publisher_approved','canonical_p05_approved',
 'lawful_q104_q119_approved','independent_nonrollback_witness_proven',
 'real_d1_queue_test_authorized','queue_ack_allowed','free_battery_purchasable',
 'store_enabled','eas_build_authorized','paid_usage_authorized','hglobal_development_authorized',
 'release_authorized','main_merge_authorized','deploy_authorized','publishable'];
 for(const key of flags)if(auth[key]!==false)fail('false release/paid/physical authority: '+key);
 const claimed=manifest.ci_claims??{};
 for(const k of ['owner_checks_only_not_sufficient','fresh_integrated_sha_required','g00_g10_all_blocked_required',
  'exact_original_git_blob_sha_required'])if(claimed[k]!==true)fail('unsafe CI interpretation: '+k);
 if(!Array.isArray(manifest.owner_provenance)||manifest.owner_provenance.length!==4)
  fail('four original owner inputs required');
 const usedOwners=new Set(),usedPaths=new Set();
 for(const row of manifest.owner_provenance??[]){
  const want=expected.get(row?.owner);
  if(!want||usedOwners.has(row.owner)||row.pr!==want.pr||row.head_sha!==want.head||
    row.base_r17_sha!==manifest.baseline_r17_sha||
    !Array.isArray(row.files)||row.files.length!==want.count){
   fail('owner path count / fixed commit source changed: '+row?.owner);
   continue;
  }
  usedOwners.add(row.owner);
  for(const file of row.files){
   const p=file?.path,sha=file?.git_blob_sha;
   if(typeof p!=='string'||!SHA.test(sha??'')||p.startsWith('/')||p.includes('..')||
    !((p.startsWith(want.root))||(row.owner==='AI-4'&&p==='docs/ai/AI4-ROUND18-OUTBOX-SAGA-TRANSPORT.md'))||
    usedPaths.has(p)){
    fail('duplicate, forbidden or unpinned owner source: '+p);continue;
   }
   usedPaths.add(p);
   try{
    const content=read(p);
    const bytes=Buffer.isBuffer(content)?content:Buffer.from(content);
    const digest=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\\0'.replace('\\0','\0'))).update(bytes).digest('hex');
    if(digest!==sha)fail('integrated content differs from original Git owner blob '+p);
   }catch(e){fail('missing/unreadable original owner blob '+p)}
  }
 }
 if(usedOwners.size!==4||usedPaths.size!==14)
  fail('R18 integrated file coverage incomplete');
 return {ok:errors.length===0,errors,source_owners:usedOwners.size,exact_git_blob_files:usedPaths.size,
  release_blocked:official.blocked.length,release_authorized:false,integrated_ci_still_required:true};
}
export function readR18IntegratedInputs(){
 return {manifest:JSON.parse(readFileSync(manifestPath,'utf8')),
  official:JSON.parse(readFileSync(releasePath,'utf8'))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const inputs=readR18IntegratedInputs(),r=auditR18IntegratedOriginalBlobs(inputs.manifest,inputs.official);
 if(!r.ok){console.error('AI-0 R18 EXACT SOURCE GATE FAIL: '+r.errors.join(' | '));process.exitCode=1;}
 else console.log('AI-0 R18 EXACT ORIGINAL BLOBS '+r.exact_git_blob_files+'/14, 4 Owner inputs; 11/11 release Gates BLOCKED; run NEW integrated CI on this HEAD.');
}
