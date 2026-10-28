import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {G07_TRIAL_DEFINITIONS,G07_TRIAL_PLAN_VERSION,buildG07TrialPlan}
 from '../tools/r24-g07-staging-trial-plan.mjs';
import {inspectCheckout} from '../tools/r23-g07-readiness-preflight.mjs';
const root=resolve(fileURLToPath(new URL('../../..',import.meta.url)));
const cli=resolve(root,'packages/rebuild-ai3/tools/r24-g07-staging-trial-plan.mjs');
function noPowers(p){
 for(const key of ['candidate_actions_enabled','may_execute','may_ack_queue',
 'may_write_d1','may_restore','may_approve_release','may_sell_battery',
 'real_cloudflare_test_performed','verified_live','architecture_approved'])
  assert.equal(p[key],false,key);
 assert.equal(p.status,'BLOCKED_AWAITING_EXTERNAL_AUTHORIZATION');
}
test('actual R23 #171 checkout remains physically unverified; no live experiment',()=>{
 const live=inspectCheckout(root),p=buildG07TrialPlan();
 assert.equal(live.status,'blocked');
 assert.equal(live.topology.d1_binding_declared,false);
 assert.ok(p.repository_preflight_missing.includes('STAGING_D1_BINDING_NOT_DECLARED'));
 assert.equal(p.schema_version,G07_TRIAL_PLAN_VERSION);noPowers(p);
});
test('all plans cover 12 common scenarios and undecided A+B proposals',()=>{
 assert.equal(G07_TRIAL_DEFINITIONS.length,16);
 const p=buildG07TrialPlan();
 assert.equal(p.scenarios.length,16);
 assert.equal(p.scenarios.filter(s=>s.architecture==='all').length,12);
 assert.equal(new Set(p.scenarios.map(s=>s.id)).size,16);noPowers(p);
});
test('A proposal only includes A transaction authority and common cases',()=>{
 const p=buildG07TrialPlan({architecture:'A'});
 assert.equal(p.scenarios.length,13);
 assert.equal(p.scenarios.some(s=>s.id==='G07-A1'),true);
 assert.equal(p.scenarios.some(s=>s.id==='G07-B1'),false);
 noPowers(p);
});
test('B proposal includes Saga partial commit, lost reply, out-of-order scenarios',()=>{
 const p=buildG07TrialPlan({architecture:'B'});
 assert.equal(p.scenarios.length,15);
 assert.deepEqual(p.scenarios.filter(s=>s.architecture==='B').map(s=>s.id),
  ['G07-B1','G07-B2','G07-B3']);noPowers(p);
});
test('unapproved architecture cannot be silently resolved or used to run',()=>{
 assert.throws(()=>buildG07TrialPlan({architecture:'C'}),/UNRECOGNIZED/);
 for(const arch of ['undecided','A','B']){
  const p=buildG07TrialPlan({architecture:arch});
  assert.equal(p.architecture_approved,false);noPowers(p);
 }
});
test('all scenarios require synthetic data and no actual run completion evidence',()=>{
 for(const s of G07_TRIAL_DEFINITIONS){
  assert.equal(s.member_data,'synthetic_only');
  assert.equal(s.result,'NOT_EXECUTED');
  assert.equal(s.execution_mode,'authorized_isolated_staging_only');
  assert.match(s.required_proof,/^[A-Z0-9_]+$/);
 }
});
test('proof plan covers duplicate grant and Queue ACK-after-D1-commit',()=>{
 const p=buildG07TrialPlan();
 for(const id of ['G07-02','G07-05','G07-06','G07-07','G07-B2']){
  assert.ok(p.scenarios.some(s=>s.id===id));
 }
 assert.ok(p.stop_on.includes('DUPLICATE_GRANT_OR_ACK_BEFORE_COMMIT'));
});
test('PITR requires external nonrollback witness and refuses old version',()=>{
 const p=buildG07TrialPlan();
 assert.ok(p.scenarios.find(s=>s.id==='G07-10').required_proof.includes('WITNESS'));
 assert.ok(p.stop_on.includes('PITR_REVISION_BELOW_INDEPENDENT_WITNESS'));
 noPowers(p);
});
test('lawful retention, revocation, wrong app/env, DLQ and expiry tested',()=>{
 const kinds=new Set(buildG07TrialPlan().scenarios.map(s=>s.kind));
 for(const k of ['revocation_race','legal_retention','isolation','poison_dlq','hold_expiry'])
  assert.ok(kinds.has(k),k);
});
test('plan never embeds actual Cloudflare URL, member/session secrets or env values',()=>{
 const p=JSON.stringify(buildG07TrialPlan());
 for(const marker of ['api.cloudflare.com','sk_live','eyJhbGci','@gmail','database_id','client_secret'])
  assert.equal(p.includes(marker),false,marker);
});
test('staging approval from forged local object cannot make a live-ready plan',()=>{
 const fake={gate_id:'G07-AUDIT-QUEUE',status:'blocked',verified_live:false,
  missing:[],topology:{d1_binding_declared:true,queue_producer_declared:true,
   queue_consumer_with_dlq_declared:true}};
 const p=buildG07TrialPlan({architecture:'A',repositoryInspection:fake});
 noPowers(p);assert.equal(p.repository_preflight_missing.length,0);
});
test('fail open or malformed inspection is rejected, never yields allowed run',()=>{
 for(const report of [null,{}, {gate_id:'G07-AUDIT-QUEUE',status:'ready',verified_live:true}]){
  if(report===null)continue;
  assert.throws(()=>buildG07TrialPlan({repositoryInspection:report}),/PREFLIGHT/);
 }
});
test('CLI --plan produces deterministic non-executed acceptance matrix',()=>{
 const cmd=()=>spawnSync(process.execPath,[cli,'--plan'],{cwd:root,encoding:'utf8'});
 const a=cmd(),b=cmd();
 assert.equal(a.status,0,a.stderr);assert.equal(b.status,0,b.stderr);
 assert.equal(a.stdout,b.stdout);
 const parsed=JSON.parse(a.stdout);assert.equal(parsed.scenarios.length,16);noPowers(parsed);
});
test('CLI assert blocked passes without any live Cloudflare action',()=>{
 const a=spawnSync(process.execPath,[cli,'--assert-blocked'],{cwd:root,encoding:'utf8'});
 assert.equal(a.status,0,a.stderr);assert.match(a.stdout,/BLOCKED/);
});
test('CLI --execute and arbitrary flags refuse, no write or deploy',()=>{
 for(const flag of ['--execute','--deploy','--run-live','--migrate']){
  const a=spawnSync(process.execPath,[cli,flag],{cwd:root,encoding:'utf8'});
  assert.equal(a.status,2,flag);
 }
});
test('official release Gate remains 11/11 blocked while plan only suggests tests',()=>{
 const release=JSON.parse(readFileSync(resolve(root,'docs/release-readiness/release-readiness.v0.json'),'utf8'));
 assert.equal(release.gates.length,11);
 assert.equal(release.gates.every(g=>g.status==='blocked'),true);
 assert.equal(release.release_authorization.granted,false);
 const p=buildG07TrialPlan();noPowers(p);
});
