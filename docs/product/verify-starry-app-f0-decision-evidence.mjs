import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {preflight} from '../release-readiness/check-release-readiness.mjs';

const expectedHypotheses=['VAL-H01','VAL-H02','VAL-H03'];
const expectedExperiments=['EXP-01','EXP-02','EXP-03','EXP-04'];
const expectedGates=['DEC-01','DEC-02','DEC-03','DEC-04'];
const expectedDecisions=Array.from({length:8},(_,i)=>'APP-D'+String(i+1).padStart(2,'0'));
const expectedAxes=['problem_frequency','output_reliability','value_clarity','privacy_compliance_fit','offline_build_feasibility','differentiation'];
const weights=[25,20,15,15,15,10];
const expectedAllowed=['write_docs','design_fakedata_studies','analyze_openly_provided_nonsensitive_user_feedback','offline_local_mock_validation','draft_backlog_without_implementation'];
const expectedLater=['create_real_consumer_app_config','implement_consumer_app_routes','integrate_paid_or_real_ai_endpoint','operate_real_oauth_or_store','recruit_or_contact_real_participants','upload_participant_data','real_eas_build','official_app_publish'];
const exactly=(a,b)=>Array.isArray(a)&&a.length===b.length&&b.every((x,i)=>a[i]===x);
export function auditAppF0Evidence(plan,release,portfolio,ux,app){
 const errors=[],fail=x=>errors.push(x);
 if(!plan||!release||!portfolio||!ux||!app)return {ok:false,errors:['All official inputs required']};
 const official=preflight(release);
 if(!official.valid||official.blocked.length!==11||official.manual_review_eligible||
   release.release_authorization?.granted!==false||
   release.deployment_automation?.can_auto_deploy!==false)
   fail('official release Gate not blocked');
 if(plan.schema_version!=='0.1.0-draft'||plan.kind!=='AI0_STARRY_CONSUMER_APP_F0_VALUE_VALIDATION_NO_MARKET_CLAIM'||
  plan.status!=='research_plan_only'||plan.scope!=='starry_only_hglobal_paused'||
  plan.provenance?.repo!=='starry-phd/id'||plan.provenance?.issue!==125||
  plan.provenance?.r19_verified_integrated_pr!==137||
  plan.provenance?.r19_verified_head!=='b713cbbc44307a325fec71fff74c81defbd95c71'||
  plan.provenance?.portfolio_file!=='docs/operations/future-starry-app-portfolio.v0.json'||
  plan.provenance?.ux_candidate_file!=='docs/product/starry-consumer-a-candidate.v0.json'||
  plan.provenance?.official_gate_file!=='docs/release-readiness/release-readiness.v0.json')
  fail('not pinned to actual R19 SSOT and product sources');
 const b=plan.product_boundary??{};
 if(b.starry_id_role!=='shared_service_only'||b.existing_expo_harness!=='starry-id-dev'||
  b.first_consumer_app_selected!==false||b.consumer_a_proposed_only!==true||
  b.consumer_b_proposed_only!==true||
  ['official_name','specific_task','target_audience','planned_market','official_ios_bundle',
  'official_android_package','battery_x_amount','battery_y_amount',
  'published_battery_rate','store_sku','pricing'].some(k=>b[k]!==null)||
  ['production_feature_approved','free_battery_sale_allowed','ai_model_cost_verified'].some(k=>b[k]!==false))
  fail('false actual first app/store/free Battery/cost decision');
 if(portfolio?.authoritative_decisions?.starry_id_is_shared_service_not_standalone_store_app!==true||
  portfolio.authoritative_decisions.first_consumer_app_selected!==false||
  portfolio.authoritative_decisions.free_battery_permanently_free!==true||
  portfolio.authoritative_decisions.free_battery_purchase_or_conversion_permitted!==false)
  fail('actual portfolio contradicts pending F0');
 if(ux?.status!=='design_only_not_product_approval'||ux.candidate?.approved!==false||
  ux.candidate?.market_validated!==false||ux.candidate?.ui_implemented!==false||
  ux.candidate?.id!=='CONSUMER_A_AI_TASK_APP')
  fail('actual UX must remain candidate-only');
 if(app?.expo?.slug!=='starry-id-dev'||app?.expo?.name!=='Starry ID Dev'||
  app?.expo?.ios?.bundleIdentifier!=='phd.starry.id.dev'||
  app?.expo?.android?.package!=='phd.starry.id.dev')
  fail('original Dev harness accidentally made a consumer store app');
 const hs=plan.hypothesis_catalog??[];
 if(!exactly(hs.map(x=>x.id),expectedHypotheses)||
    !exactly(hs.map(x=>x.candidate),['CONSUMER_A_AI_TASK_APP','CONSUMER_A_AI_TASK_APP','CONSUMER_B_SPECIALIZED_AI_TOOL']))
  fail('candidate hypotheses are not 3 distinct comparison targets');
 for(const h of hs)
  if(h.hypothesis_only!==true||h.status!=='not_tested'||h.selected!==false||
   h.approved!==false||!Array.isArray(h.quality_checks)||!h.quality_checks.length)
   fail('pretended real market evidence or approved product '+h.id);
 const e=plan.proposed_evaluation??{};
 if(e.rubric_status!=='ai0_proposal_only_not_approved_selection_criteria'||
  e.rating_scale_min!==1||e.rating_scale_max!==5||
  !exactly(e.axes?.map(x=>x.id),expectedAxes)||
  !exactly(e.axes?.map(x=>x.weight),weights)||
  e.axes?.reduce((v,x)=>v+x.weight,0)!==100)
  fail('rubric weights or proposal status changed');
 if(!exactly((e.scorecards??[]).map(x=>x.hypothesis_id),expectedHypotheses)||
  e.scorecards.some(x=>x.scores!==null||x.weighted_total!==null||
   x.selected!==false||x.needs_human_review!==true)||
  e.auto_select_allowed!==false||e.numerical_threshold_can_approve_product!==false)
  fail('fake ranking or automatic product choice');
 for(const k of ['actual_market_evidence_count','actual_interviews_completed',
  'actual_usability_sessions_completed','actual_cost_benchmarks_completed'])
  if(e[k]!==0)fail('real-world market or technical research falsely claimed: '+k);
 if(!Array.isArray(e.evidences)||e.evidences.length!==0)
  fail('research evidence must not be fabricated');
 const experiments=plan.proposed_experiments??[];
 if(!exactly(experiments.map(x=>x.id),expectedExperiments))fail('missing proposed experiments');
 for(const x of experiments)
  if(x.status!=='not_started'||x.executed!==false||x.live_recruitment_authorized!==false||
   x.actual_participants!==0||x.measured_outcome!==null||
   !Array.isArray(x.evidence_ids)||x.evidence_ids.length!==0||
   !exactly(x.target_hypotheses,expectedHypotheses))
   fail('fabricated research execution '+x.id);
 if(!Array.isArray(plan.research_interview_script)||
  plan.research_interview_script.length!==6||
  plan.research_interview_script.some(x=>typeof x!=='string'||x.length<25))
  fail('no neutral interview script');
 if(!exactly((plan.gates??[]).map(x=>x.id),expectedGates))fail('F0 decision Gate missing');
 for(const d of plan.gates??[])
  if(d.status!=='blocked'||d.can_auto_approve!==false||
   !Array.isArray(d.requires)||d.requires.length<2)
   fail('F0 candidate falsely approved '+d.id);
 if(!exactly(portfolio.decision_queue?.map(x=>x.id),expectedDecisions)||
  portfolio.decision_queue.some(x=>x.approval!=='PENDING'))
  fail('APP-D01-D08 should remain unapproved');
 const m=plan.mvp_boundary??{};
 if(!exactly(m.allowed_now,expectedAllowed)||
  !exactly(m.later_only_after_explicit_owner_approval,expectedLater)||
  m.integration_owner_work_separate!==true||
  m.r20_owners_in_progress!==true)
  fail('F0 proposal accidentally exceeds R20 or live scope');
 for(const [k,v] of Object.entries(m))
  if(!['allowed_now','later_only_after_explicit_owner_approval',
     'integration_owner_work_separate','r20_owners_in_progress'].includes(k)&&v!==false)
   fail('unapproved authority or accidental App implementation: '+k);
 for(const key of ['product_decision_approved','ui_implemented','real_market_test_completed',
  'real_cost_model_validated','release_authorized','live_db_authorized',
  'queue_ack_authorized','paid_usage_authorized','hglobal_development_authorized',
  'main_merge_authorized','cloudflare_deploy_authorized','publishable'])
  if(m[key]!==false)fail('R20/product authority flag not denied: '+key);
 return {ok:errors.length===0,errors,hypotheses:hs.length,proposed_experiments:experiments.length,
  decision_gates_blocked:plan.gates?.length??0,official_release_blocked:official.blocked.length,
  evidence_count:0,market_research_done:false,product_approved:false};
}
export function readAppF0Inputs(){
 return {
  plan:JSON.parse(readFileSync(new URL('./starry-app-f0-decision-evidence.v0.json',import.meta.url),'utf8')),
  release:JSON.parse(readFileSync(new URL('../release-readiness/release-readiness.v0.json',import.meta.url),'utf8')),
  portfolio:JSON.parse(readFileSync(new URL('../operations/future-starry-app-portfolio.v0.json',import.meta.url),'utf8')),
  ux:JSON.parse(readFileSync(new URL('./starry-consumer-a-candidate.v0.json',import.meta.url),'utf8')),
  app:JSON.parse(readFileSync(new URL('../../apps/mobile/app.json',import.meta.url),'utf8'))
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const x=readAppF0Inputs();
 const a=auditAppF0Evidence(x.plan,x.release,x.portfolio,x.ux,x.app);
 if(!a.ok){console.error('STARry F0 EVIDENCE BOUNDARY FAIL: '+a.errors.join(' | '));process.exitCode=1;}
 else console.log('STARry F0 product decision plan VERIFIED: '+a.hypotheses+
  ' unevaluated hypotheses, '+a.proposed_experiments+' UNRUN experiments, '+
  a.decision_gates_blocked+' F0 decision Gates BLOCKED, '+a.official_release_blocked+
  '/11 official Gates BLOCKED; no interviews, market results or approved App.');
}
