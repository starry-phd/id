import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {preflight} from '../release-readiness/check-release-readiness.mjs';

const requireIds=['STARRY_ID_SHARED_SERVICE','CONSUMER_A_AI_TASK_APP','CONSUMER_B_SPECIALIZED_AI_TOOL','STARRY_ADMIN_WAVE2'];
const reqDecisions=Array.from({length:8},(_,i)=>'APP-D'+String(i+1).padStart(2,'0'));
const reqJourneys=Array.from({length:8},(_,i)=>'J'+String(i+1).padStart(2,'0')+'_'+['VALUE_ENTRY','STARRY_SIGN_IN_AND_REGISTER_X','AI_TASK_RESERVE_SETTLE_RELEASE','FIRST_TRUSTED_TASK_Y','RETRY_CANCEL_TIMEOUT','COMMON_ID_ACROSS_STARRY_APPS','ACCOUNT_DELETION_AND_APPEALS','OPTIONAL_STORE_SUBSCRIPTION'][i]);
const reqPhases=['F0','F1','F2','F3','F4'];

export function auditFutureAppPortfolio(plan,official){
 const errors=[],fail=x=>errors.push(x);
 if(!plan||typeof plan!=='object'||Array.isArray(plan)||!official)
  return {ok:false,errors:['candidate plan and authoritative release JSON needed']};
 const gate=preflight(official),ids=new Set(official?.gates?.map(g=>g.id)??[]);
 if(!gate.valid||gate.blocked.length!==11||gate.manual_review_eligible||
   official.release_authorization?.granted!==false||
   official.deployment_automation?.can_auto_deploy!==false)fail('authoritative release is no longer 11/11 blocked');
 if(plan.schema_version!=='0.1.0-draft'||plan.kind!=='AI0_FUTURE_STARRY_APP_PORTFOLIO_NOT_PRODUCT_APPROVAL'||
   plan.status!=='planning_only'||plan.scope!=='starry_only_hglobal_paused'||
   plan.source?.repository!=='starry-phd/id'||plan.source?.tracking_issue!==125||
   plan.source?.verified_integration_pr!==123||
   plan.source?.verified_integration_sha!=='f84eab58e20377b5bd1ce313b969befb531b4938'||
   plan.source?.r18_ai0_preflight_pr!==124||
   plan.source?.r18_ai0_preflight_sha!=='ca5fc5185eae5f864b806b55b0b1ef6daee1f420'||
   plan.source?.official_release_file!=='docs/release-readiness/release-readiness.v0.json')
  fail('invalid source, scope or claimed product approval');
 const d=plan.authoritative_decisions;
 for(const k of ['starry_id_is_shared_service_not_standalone_store_app',
    'starry_id_dev_harness_only','free_battery_permanently_free'])
  if(d?.[k]!==true)fail('approved Starry ID/free Battery boundary regressed: '+k);
 for(const k of ['first_consumer_app_selected','second_consumer_app_selected',
    'free_battery_purchase_or_conversion_permitted','battery_x_amount_approved',
    'battery_y_amount_approved','battery_fee_and_debt_cap_approved',
    'iap_sku_and_price_approved','cross_brand_auth_enabled','wave2_admin_ui_approved'])
  if(d?.[k]!==false)fail('unsupported product approval or cross-brand feature: '+k);
 for(const k of ['first_consumer_official_bundle_identifier',
    'first_consumer_official_android_package','first_consumer_official_store_listing',
    'first_consumer_official_release_date','first_consumer_official_market',
    'first_consumer_official_name','first_consumer_official_store_developer'])
  if(d?.[k]!==null)fail('invented real product/store identity: '+k);
 const candidates=plan.candidate_products;
 if(!Array.isArray(candidates)||candidates.length!==4||new Set(candidates.map(x=>x.id)).size!==4||
    reqIds.some((id,i)=>candidates[i]?.id!==id))fail('wrong four product classifications');
 for(const p of candidates??[]){
  if(p.store_publication_allowed!==false||p.has_user_consumer_value_proven!==false)
   fail('unapproved candidate claimed market fit or store publication: '+p.id);
 }
 if(candidates?.[0]?.role!=='shared_service_only'||candidates?.[0]?.status!=='not_a_store_product'||
    candidates?.[1]?.status!=='research_candidate_only'||
    candidates?.[2]?.status!=='research_candidate_only'||
    candidates?.[3]?.status!=='deferred_interface_reservation')
  fail('shared Starry ID accidentally scheduled as standalone Store or admin activated');
 const paid=plan.optional_paid_features;
 if(paid?.status!=='deferred_not_approved'||paid?.store_authority_required!==true||
   paid?.paid_entitlement_billing_owned!==true||paid?.may_exchange_free_battery!==false||
   paid?.may_sell_free_battery!==false||paid?.real_sku!==null||paid?.price!==null||
   paid?.currency!==null)fail('free Battery mixed with paid entitlement');
 if(!Array.isArray(plan.journeys)||plan.journeys.length!==8||
    reqJourneys.some((x,i)=>plan.journeys[i]?.id!==x))
  fail('first consumer user journeys changed/missing');
 for(const j of plan.journeys??[]){
  if(j?.requires_real_services!==false||!['AI-0','AI-1','AI-2','AI-3','AI-4'].includes(j?.owner)||
     !Array.isArray(j.gate_ids)||j.gate_ids.length===0||
     j.gate_ids.some(x=>!ids.has(x)))fail('journey uses unapproved live service, owner or Gate: '+j?.id);
 }
 if(!Array.isArray(plan.phases)||plan.phases.length!==5||
    reqPhases.some((x,i)=>plan.phases[i]?.id!==x))fail('five phases required');
 for(const p of plan.phases??[])
  if(p.live_activity!==false||!Array.isArray(p.release_gate_ids)||!p.release_gate_ids.length||
     p.release_gate_ids.some(x=>!ids.has(x)))fail('phase contains live activity or fake Gate: '+p?.id);
 if(plan.phases?.[1]?.status!=='owner_r18_in_progress_unverified')
  fail('R18 owner coding cannot be declared complete by the roadmap');
 if(!Array.isArray(plan.decision_queue)||plan.decision_queue.length!==8||
    reqDecisions.some((x,i)=>plan.decision_queue[i]?.id!==x||
      plan.decision_queue[i].approval!=='PENDING'))
  fail('unapproved decision was silently filled');
 for(const [key,val] of Object.entries(plan.authority??{}))
  if(val!==false)fail('future app roadmap cannot grant platform/product/live permission: '+key);
 for(const [key,val] of Object.entries(plan.claim_boundaries??{})){
  if(key==='new_owner_r18_code_count' ? val!==0 : val!==false)
   fail('roadmap incorrectly claims actual Owner code or live proof: '+key);
 }
 if(plan.store_readiness?.ios?.verified_on_real_app!==false||
    plan.store_readiness?.ios?.official_testflight_completed!==false||
    plan.store_readiness?.android?.verified_on_real_app!==false||
    plan.store_readiness?.android?.play_internal_completed!==false||
    plan.store_readiness?.android?.requires_off_app_deletion_link!==true||
    plan.store_readiness?.expo?.eas_build_authorized!==false||
    plan.store_readiness?.expo?.eas_submit_authorized!==false||
    plan.store_readiness?.expo?.eas_update_authorized!==false||
    plan.store_readiness?.expo?.paid_usage_authorized!==false)
  fail('missing real Store, deletion or EAS guard');
 return {ok:errors.length===0,errors,official_blocked:gate.blocked.length,candidates:candidates?.length??0,
   decisions_pending:plan.decision_queue?.length??0,journeys:plan.journeys?.length??0,
   phases:plan.phases?.length??0,release_authorized:false,owner_r18_integrated:false};
}
export function readFutureAppInputs(){
 return {
  plan:JSON.parse(readFileSync(new URL('./future-starry-app-portfolio.v0.json',import.meta.url),'utf8')),
  official:JSON.parse(readFileSync(new URL('../release-readiness/release-readiness.v0.json',import.meta.url),'utf8'))
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {plan,official}=readFutureAppInputs(),v=auditFutureAppPortfolio(plan,official);
 if(!v.ok){console.error('FUTURE APP PLANNING GATE FAILED:',v.errors.join(' | '));process.exitCode=1;}
 else console.log('AI-0 Future App PLAN ONLY PASS: '+v.candidates+' product roles, '+v.decisions_pending+
  ' decisions pending, '+v.journeys+' journeys, '+v.phases+' phases, '+v.official_blocked+
  '/11 release Gates BLOCKED; no store listing, live resources, fees or R18 owner claims');
}
