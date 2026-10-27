import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {preflight} from '../release-readiness/check-release-readiness.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const expectedScreens=['DISCOVER','SIGN_IN','HOME','TASK_COMPOSE','TASK_REVIEW','TASK_STATUS','TASK_RESULT','TASK_HISTORY','BATTERY_LEDGER','ACCOUNT_SETTINGS','DELETE_ACCOUNT','HELP_APPEAL'];
const expectedFlows=['UX-01','UX-02','UX-03','UX-04','UX-05'];
const errorsExpected=['NOT_SIGNED_IN','AUTH_REVOKED','PRICE_UNAPPROVED','POLICY_UNKNOWN','TASK_UNKNOWN','TASK_FAILED','RECEIPT_MISMATCH','DELETION_PENDING','ACCOUNT_DELETED'];
const expectedDecisions=Array.from({length:8},(_,i)=>'APP-D'+String(i+1).padStart(2,'0'));
const expectedAcc=Array.from({length:12},(_,i)=>'ACC-'+String(i+1).padStart(2,'0'));
const validGates=new Set(['G00-SSOT','G01-ISOLATION','G02-OIDC','G03-SESSION-D1','G04-STORE','G05-BILLING-D1','G06-P05','G07-AUDIT-QUEUE','G08-WORKER-SDK','G09-DEVICES','G10-OPS']);
function exactIds(actual,want){
 return Array.isArray(actual)&&actual.length===want.length&&want.every((s,i)=>actual[i]===s)&&new Set(actual).size===want.length;
}
export function auditCandidateUx(plan,release,portfolio,devApp){
 const errors=[],deny=x=>errors.push(x);
 if(!plan||typeof plan!=='object'||!release||!portfolio||!devApp)
  return {ok:false,errors:['all four real files required']};
 const g=preflight(release);
 if(!g.valid||g.blocked.length!==11||g.manual_review_eligible||
   release.release_authorization?.granted!==false||
   release.deployment_automation?.can_auto_deploy!==false)
  deny('G00-G10 11/11 BLOCKED was bypassed');
 if(plan.schema_version!=='0.1.0-candidate'||plan.kind!=='STARry_CONSUMER_A_CONDITIONAL_UX_BLUEPRINT'||
  plan.status!=='design_only_not_product_approval'||plan.scope!=='starry_only'||
  plan.source?.repo!=='starry-phd/id'||plan.source?.tracking_issue!==125||
  plan.source?.baseline_ai0_integrated_pr!==131||
  plan.source?.baseline_ai0_integrated_sha!=='f006e90311b3fecedae0f7c75004c940adfacede'||
  plan.source?.source_portfolio!=='docs/operations/future-starry-app-portfolio.v0.json'||
  plan.source?.authoritative_release_file!=='docs/release-readiness/release-readiness.v0.json')
  deny('unapproved UX scope/baseline');
 const a=plan.candidate??{};
 if(a.id!=='CONSUMER_A_AI_TASK_APP'||a.brand!=='starry'||a.paid_battery!==false||
  a.approved!==false||a.market_validated!==false||a.ui_implemented!==false||
  a.display_name!==null||a.user_segment!==null||a.specific_task!==null||
  a.official_app_id!==null||a.ios_bundle_id!==null||a.android_package!==null||
  a.store_region!==null||a.store_listing!==null||a.price!==null||a.currency!==null)
  deny('invented consumer product name, store ID, pricing, research or shipped UI');
 if(portfolio.authoritative_decisions?.starry_id_is_shared_service_not_standalone_store_app!==true||
  portfolio.authoritative_decisions?.first_consumer_app_selected!==false||
  portfolio.authoritative_decisions?.free_battery_permanently_free!==true||
  portfolio.authoritative_decisions?.free_battery_purchase_or_conversion_permitted!==false||
  portfolio.authoritative_decisions?.wave2_admin_ui_approved!==false)
  deny('parent approved decision no longer candidate');
 if(devApp?.expo?.name!=='Starry ID Dev'||
  devApp.expo.slug!=='starry-id-dev'||
  devApp.expo.ios?.bundleIdentifier!=='phd.starry.id.dev'||
  devApp.expo.android?.package!=='phd.starry.id.dev')
  deny('Dev harness was turned into real Store consumer app');
 const screens=plan.screens??[],found=screens.map(x=>x.id);
 if(!exactIds(found,expectedScreens))deny('screen plan must retain 12 ordered states');
 for(const s of screens){
  if(!['P0','P1'].includes(s.priority)||!['public_preview','guest_only_placeholder','member','member_stepup_required','privacy_limited'].includes(s.access)||
   !Array.isArray(s.gate_ids)||s.gate_ids.length===0||
   s.gate_ids.some(x=>!validGates.has(x))||
   s.allowed_without_login!==['public_preview','guest_only_placeholder','privacy_limited'].includes(s.access))
   deny('unsafe UX page access/gate: '+s.id);
 }
 if(screens.find(x=>x.id==='DELETE_ACCOUNT')?.access!=='member_stepup_required'||
  screens.find(x=>x.id==='TASK_RESULT')?.access!=='member'||
  screens.find(x=>x.id==='BATTERY_LEDGER')?.access!=='member')
  deny('sensitive screen lost auth or step-up');
 const flows=plan.journeys??[];
 if(!exactIds(flows.map(x=>x.id),expectedFlows))deny('expected five conditional workflows');
 for(const f of flows)
  if(f.requires_product_approval!==true||f.live_execution!==false||
   !Array.isArray(f.screens)||f.screens.some(x=>!found.includes(x)))
   deny('journey wrongly calls live endpoint or missing screen: '+f.id);
 if(!exactIds((plan.ux_failure_states??[]).map(x=>x.id),errorsExpected))
  deny('missing fail-closed user state');
 for(const state of plan.ux_failure_states??[])
  if(state.success_allowed!==false||state.grant_allowed!==false||
   state.queue_ack_allowed!==false||typeof state.ui_message!=='string'||
   state.ui_message.length<8)
   deny('UI advertises unverified success/refund/regrant/ack: '+state.id);
 if(!exactIds((plan.acceptance_scenarios??[]).map(x=>x.id),expectedAcc))
  deny('missing owner acceptance case');
 for(const item of plan.acceptance_scenarios??[])
  if(item.status!=='spec_only'||!['AI-0','AI-1','AI-2','AI-3','AI-4'].includes(item.owner))
   deny('candidate paper QA falsely marked actual CI/E2E: '+item.id);
 if(!exactIds(plan.decisions_pending,expectedDecisions)||
  !exactIds((portfolio.decision_queue??[]).map(x=>x.id),expectedDecisions)||
  (portfolio.decision_queue??[]).some(x=>x.approval!=='PENDING'))
  deny('decision was falsely approved or silently removed');
 if(plan.future_mobile_owner!=='AI-4'||plan.evidence_level!=='planning_only_not_a_real_device_store_or_backend_test'||
  !Array.isArray(plan.accessibility_requirements)||plan.accessibility_requirements.length<8)
  deny('missing mobile ownership/evidence/accessibility');
 const releaseFlags=plan.release??{};
 const allowedTrue=new Set(['candidate_only']);
 const requiredFalse=['live_ui_routes_authorized','backend_calls_authorized','production_app_selected',
 'app_name_approved','app_store_id_approved','play_package_approved','task_catalog_approved',
 'free_battery_amounts_approved','auth_live_authorized','p05_canonical_approved',
 'cross_d1_physical_approved','legal_retention_approved','live_queue_ack_authorized',
 'publishable','paid_features_authorized','free_battery_purchasable','store_listing_authorized',
 'wave2_admin_approved','hglobal_development_authorized','merge_main_authorized',
 'deploy_authorized','paid_usage_authorized'];
 if(releaseFlags.candidate_only!==true||
  requiredFalse.some(key=>releaseFlags[key]!==false)||
  Object.entries(releaseFlags).some(([key,val])=>!allowedTrue.has(key)&&val!==false))
  deny('UX blueprint declared unauthorized publication/platform/cost');
 return {ok:errors.length===0,errors,screen_count:found.length,journey_count:flows.length,
  blocked_state_count:(plan.ux_failure_states??[]).length,
  acceptance_spec_count:(plan.acceptance_scenarios??[]).length,
  decisions_pending:(plan.decisions_pending??[]).length,
  release_gates_blocked:g.blocked.length,ui_implemented:false,live_services_used:false};
}
export function readCandidateUxInputs(){
 return {plan:JSON.parse(readFileSync(resolve(root,'docs/product/starry-consumer-a-candidate.v0.json'),'utf8')),
 release:JSON.parse(readFileSync(resolve(root,'docs/release-readiness/release-readiness.v0.json'),'utf8')),
 portfolio:JSON.parse(readFileSync(resolve(root,'docs/operations/future-starry-app-portfolio.v0.json'),'utf8')),
 devApp:JSON.parse(readFileSync(resolve(root,'apps/mobile/app.json'),'utf8'))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const v=readCandidateUxInputs(),a=auditCandidateUx(v.plan,v.release,v.portfolio,v.devApp);
 if(!a.ok){console.error('STARry UX PLAN SAFE GATE FAILED: '+a.errors.join(' | '));process.exitCode=1;}
 else console.log('STARry CONSUMER-A UX CANDIDATE VERIFIED: '+a.screen_count+
  ' screen specs, '+a.journey_count+' flows, '+a.blocked_state_count+
  ' fail-closed UX states, '+a.acceptance_spec_count+' paper QA cases, '+
  a.decisions_pending+' pending owner decisions; '+a.release_gates_blocked+'/11 GATES BLOCKED; no App built.');
}
