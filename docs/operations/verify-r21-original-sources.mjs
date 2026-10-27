import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {preflight} from '../release-readiness/check-release-readiness.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const SOURCES=[{"owner":"AI-1","pr":144,"head_sha":"0576cc57ac6bba0c384795fb72abb5092a7ac359","base_sha":"e54bee1d012a2a43d90ce9a24e4a5f59d29bacbb","files":[{"path":"modules/starry-id-v1/ADR-ROUND21-CANDIDATE-UI-AUTH-STATE.md","blob_sha":"29e1e0415161a3f363f569eff1dff65e99fb2110"},{"path":"modules/starry-id-v1/src/round21-candidate-ui-auth-state.ts","blob_sha":"3bfbda4210accfb34a17218ff50b3c054986483d"},{"path":"modules/starry-id-v1/test/round21-candidate-ui-auth-state.test.mjs","blob_sha":"2d75e685c9b45bd009ae45967cf670a43bbc130b"}]},{"owner":"AI-2","pr":145,"head_sha":"d7070efe70992db1363976c1fe4977731dee30dd","base_sha":"e54bee1d012a2a43d90ce9a24e4a5f59d29bacbb","files":[{"path":"packages/rebuild-billing/docs/ROUND21-CANDIDATE-BILLING-UI-STATE.md","blob_sha":"6e990a7aa7a5a2077c97f8148eebd58a56124638"},{"path":"packages/rebuild-billing/src/r21-candidate-ui-billing-state.ts","blob_sha":"4701831083d3ed2d4db613879608635d3d3f01ce"},{"path":"packages/rebuild-billing/test/r21-candidate-ui-billing-state.test.mjs","blob_sha":"f6ede51373bbca58c2e21f9f70d07d779f43694f"}]},{"owner":"AI-3","pr":146,"head_sha":"21da5c7a8b271e593746234eb785490d51ad14e4","base_sha":"e54bee1d012a2a43d90ce9a24e4a5f59d29bacbb","files":[{"path":"packages/rebuild-ai3/docs/ROUND21-CANDIDATE-UI-TASK-BATTERY-STATUS.md","blob_sha":"187ed01e68c316b11b98063a314138d2ffb1ff96"},{"path":"packages/rebuild-ai3/src/r21-candidate-ui-task-battery-status.ts","blob_sha":"13b5069293032787f02dbcdb4326386c4a5a1a5a"},{"path":"packages/rebuild-ai3/test/r21-candidate-ui-task-battery-status.test.mjs","blob_sha":"875662b1b3fd78644fd5a06e967108bc2d811a48"},{"path":"packages/rebuild-ai3/test/test_r21_candidate_ui_sqlite.py","blob_sha":"bc586703fdd89317819008af85a00cb64a1b4faf"}]},{"owner":"AI-4","pr":147,"head_sha":"9d0888660d0a8a873b07d13832f5c3cda8645978","base_sha":"e54bee1d012a2a43d90ce9a24e4a5f59d29bacbb","files":[{"path":"apps/api/src/round21-candidate-consumer-ui-state-resolver.ts","blob_sha":"8758c34977955cd89cf41d3b4b04d82d23f1401e"},{"path":"apps/api/test/round21-candidate-consumer-ui-state-resolver.test.mjs","blob_sha":"d61492bdca58640ddbb8e1bf9779e5b6e6704174"},{"path":"docs/ai/AI4-ROUND21-CANDIDATE-UI-STATUS-CONTRACT.md","blob_sha":"63d3669a338c8cfeaaf01e935fa0a1943f32fa0f"}]}];
const PARENT='e54bee1d012a2a43d90ce9a24e4a5f59d29bacbb';
const denyKeys=["r21_consumer_ui_implemented","r21_full_positive_owner_dto_wiring_verified","first_echo_native_routes_written","real_auth_session_verified","official_p05_signed","lawful_q104_q119_granted","independent_nonrollback_witness_verified","physical_cross_d1_verified","cloudflare_live_services_used","real_queue_ack","paid_battery","store_iap_approved","expo_eas_build_approved","production_release_granted","hglobal_work_authorized","merge_main_authorized","deploy_authorized","publishable"];
const claimKeys=["individual_owner_ci_is_green","new_integrated_ci_not_proven_by_manifest","ui_state_only","unknown_states_fail_closed","starry_id_shared_not_store_product","first_app_named_echo_starry_from_owner_instruction"];
export function auditR21ExactSources(plan,release,read=(p)=>readFileSync(resolve(ROOT,p))){
 const errors=[],fail=s=>errors.push(s);
 if(!plan||!release)return {ok:false,errors:['missing manifest or release']};
 const gate=preflight(release);
 if(!gate.valid||gate.blocked.length!==11||gate.manual_review_eligible||
  release.release_authorization?.granted!==false||
  release.deployment_automation?.can_auto_deploy!==false)
  fail('official release Gate must remain 11/11 blocked');
 if(plan.schema_version!=='0.1.0'||
  plan.kind!=='AI0_R21_FOUR_OWNER_EXACT_SOURCE_CANDIDATE_UI_INTEGRATION'||
  plan.scope!=='starry_private_offline_only'||
  plan.baseline?.r20_integration_pr!==143||
  plan.baseline?.r20_integration_sha!==PARENT||
  plan.baseline?.r21_owner_base_sha!==PARENT||
  plan.baseline?.r21_contract!=='candidate_only_not_real_app_ui'||
  plan.total_owner_original_blobs!==13)
  fail('source baseline and candidate scope mismatch');
 if(!Array.isArray(plan.owner_inputs)||plan.owner_inputs.length!==4)
  fail('not all four R21 owners present');
 const seen=new Set();let hashes=0;
 for(let i=0;i<SOURCES.length;i++){
  const want=SOURCES[i],got=plan.owner_inputs?.[i];
  if(!got||got.owner!==want.owner||got.pr!==want.pr||got.head_sha!==want.head_sha||
   got.base_sha!==PARENT||!Array.isArray(got.files)||got.files.length!==want.files.length){
   fail('Owner wrong PR/fixed SHA/count '+want.owner);continue;
  }
  for(let j=0;j<want.files.length;j++){
   const a=got.files[j],b=want.files[j];
   if(!a||a.path!==b.path||a.blob_sha!==b.blob_sha||
    !/^[0-9a-f]{40}$/.test(a.blob_sha)||a.path.startsWith('/')||
    a.path.split('/').some(v=>!v||v==='.'||v==='..')||
    seen.has(a.path)){
    fail('unsafe/altered Owner file '+want.owner+' '+j);continue;
   }
   seen.add(a.path);
   try{
    const raw=read(a.path),bytes=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
    const hash=createHash('sha1').update(Buffer.from('blob '+bytes.length))
      .update(Buffer.from([0])).update(bytes).digest('hex');
    if(hash!==a.blob_sha)fail('actual original Git owner blob changed '+a.path);
    else hashes++;
   }catch{fail('unavailable original file '+a.path);}
  }
 }
 if(hashes!==13||seen.size!==13)fail('13/13 R21 original Git blobs not verified');
 for(const k of denyKeys)if(plan.denials?.[k]!==false)
  fail('illegal R21 UI/production authorization '+k);
 for(const [k,v] of Object.entries(plan.denials??{}))
  if(!denyKeys.includes(k)||v!==false)fail('unknown or enabled release flag '+k);
 for(const k of claimKeys)if(plan.claims?.[k]!==true)
  fail('false R21 contract claim '+k);
 return {ok:errors.length===0,errors,owner_count:SOURCES.length,original_owner_blobs_hash_verified:hashes,
  official_release_gates_blocked:gate.blocked.length,live_ui_implemented:false,official_product_released:false,
  integrated_ci_must_be_checked_via_actual_github_actions:true};
}
export function loadR21Sources(){
 return {plan:JSON.parse(readFileSync(new URL('./r21-four-owner-original-sources.v0.json',import.meta.url),'utf8')),
  release:JSON.parse(readFileSync(new URL('../release-readiness/release-readiness.v0.json',import.meta.url),'utf8'))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const x=loadR21Sources(),r=auditR21ExactSources(x.plan,x.release);
 if(!r.ok){console.error('AI-0 R21 same-checkout source failed: '+r.errors.join(' | '));process.exitCode=1;}
 else console.log('AI-0 R21 SOURCE GATE: '+r.original_owner_blobs_hash_verified+'/13 original Owner Git blobs, 4 owners, G00-G10 11/11 BLOCKED; no App implementation or release.');
}
