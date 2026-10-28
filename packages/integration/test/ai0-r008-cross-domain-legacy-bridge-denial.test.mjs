import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createOfflineR007AuthAuthorityReview}
 from '../../../modules/starry-id-v1/src/wave1-round007-p05-current-auth-monotonic-review.ts';
import {createOfflineR008CrossProviderConflictGate}
 from '../../rebuild-billing/src/wave1-r008-cross-provider-conflict-deny.ts';
import {reviewR008PreviewProposal}
 from '../../../apps/api/src/wave1-r008-preview-isolation-preflight.ts';
import {preflight}
 from '../../../docs/release-readiness/check-release-readiness.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const deny=o=>{for(const k of ['may_send','may_ack','may_ack_queue','may_grant',
 'may_publish','may_deploy','may_reenable_preview','may_create_preview',
 'can_grant','can_ack_webhook','can_send_p05','live','publishable']){
 if(Object.hasOwn(o,k))assert.equal(o[k],false,k);
}};
test('R008 inherited AI1 current Auth cannot use claimant-supplied verified flag',async()=>{
 let touched=0;
 const x=createOfflineR007AuthAuthorityReview({
  enabled:true,
  r006:{reviewFresh:async()=>({status:'blocked',verified_live:false,
   may_send:false,may_ack_queue:false}),
   readServerReview:()=>{touched++;throw Error('must not read');}},
  readCurrentActorSession:async()=>{touched++;throw Error('must not read');},
  readCurrentIssuerLease:async()=>{touched++;throw Error('must not read');}
 });
 const out=await x.review({verified:true},null,1793000000);
 assert.equal(out.reason,'MISSING_R006_PROOF');
 assert.equal(touched,0);deny(out);
});
test('R008 AI2 reviewed claims + AI4 Preview proposal cannot become permission',()=>{
 const bill=createOfflineR008CrossProviderConflictGate({
  enabled:false,scope:{brand_id:'starry',app_id:'starry.one',
   environment:'staging'},nowSeconds:()=>1793000000});
 const payment=bill.reconcile({verified:true,can_grant:true});
 assert.equal(payment.reason,'DEFAULT_DISABLED');deny(payment);
 const preview=reviewR008PreviewProposal({
  worker:'id-starry',repository:'starry-phd/id',
  config_path:'apps/api/wrangler.toml',
  preview_command:'npx wrangler preview --config apps/api/wrangler.toml',
  preview_config_text:'[previews]\n[previews.vars]\nSTARRY_ENVIRONMENT = "preview"\nSTARRY_APP_ID = "starry-id"',
  requested_binding_names:[]
 });
 assert.equal(preview.reason,'SEPARATE_OWNER_AUTHORIZATION_REQUIRED');
 deny(preview);
});
test('R008 inherited AI3 two unchosen ADR options reject late deletion even after local commit',()=>{
 const script=[
  'import importlib.util,json,sys',
  'p="packages/rebuild-ai3/src/wave1_r007_p05_recovery_matrix.py"',
  's=importlib.util.spec_from_file_location("bridge_review",p)',
  'm=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)',
  'out=[]',
  'for opt in m.SCENARIOS:',
  ' r=m.OfflineRecoveryMatrix(opt);c=m.Candidate()',
  ' first=r.claim(c,m.Snapshot(),m.Snapshot())',
  ' late=r.reconciliation(c,late=m.Snapshot(state="deleted"))',
  ' out.append([opt,first.status,first.may_ack,late.reason,late.may_ack,late.live])',
  'print(json.dumps(out))'
 ].join('\n');
 const p=spawnSync('python3',['-c',script],{
  cwd:root,encoding:'utf8',timeout:15000});
 assert.equal(p.status,0,p.stderr);
 const out=JSON.parse(p.stdout);
 assert.equal(out.length,2);
 for(const x of out){
  assert.equal(x[1],'review_only');
  assert.equal(x[2],false);
  assert.equal(x[3],'LATE_REVOKE_ERASURE_OR_LEGAL_DRIFT');
  assert.equal(x[4],false);assert.equal(x[5],false);
 }
});
test('R008 2/4 owner delivery remains partial and all official release gates blocked',()=>{
 const m=JSON.parse(readFileSync(resolve(root,
  'docs/operations/ai0-wave1-r008-2owner-immutable-staging.v1.json'),'utf8'));
 assert.equal(m.integration_status,'PARTIAL_2_OF_4_NOT_FOUR_OWNER_GATE2');
 assert.deepEqual(m.not_yet_integrated,['AI-1','AI-3']);
 const release=JSON.parse(readFileSync(resolve(root,
  'docs/release-readiness/release-readiness.v0.json'),'utf8'));
 const r=preflight(release);
 assert.equal(r.valid,true);
 assert.equal(r.blocked.length,11);
 assert.equal(r.manual_review_eligible,false);
 assert.equal(r.can_auto_deploy,false);
 assert.equal(release.release_authorization.granted,false);
});
