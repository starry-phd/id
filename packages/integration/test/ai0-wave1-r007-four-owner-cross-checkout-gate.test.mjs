import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {AI0_R006_FIELDS,AI0_R006_P05_VERSION,AI0_R006_LIVE}
 from '../src/ai0-r006-p05-canonical-proposal.ts';
import {R007_AUTH_REVIEW_LIVE,R007_AUTH_REVIEW_VERSION,
 createOfflineR007AuthAuthorityReview}
 from '../../../modules/starry-id-v1/src/wave1-round007-p05-current-auth-monotonic-review.ts';
import {R007_ADAPTER_CONTRACT,R007_OFFICIAL_ADAPTER_LIVE,
 createOfflineR007OfficialProviderAdapterGate}
 from '../../rebuild-billing/src/wave1-r007-official-provider-adapter-deny.ts';
import {R007_VERSION,R007_PROTECTED_PINS,reviewR007UnregisteredTransport}
 from '../../../apps/api/src/wave1-r007-worker-protected-denial.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const m=JSON.parse(readFileSync(resolve(root,
 'docs/operations/ai0-wave1-r007-owner-blobs.v1.json'),'utf8'));
const allFalse=(o,ks)=>{for(const k of ks)assert.equal(o[k],false,k);};

test('R007 SAME checkout byte-preserves all 12 final owner Git blobs and R006 inheritance',()=>{
 assert.equal(m.integration_parent.r006_head_sha,
  '5be61848f745cc17de449d773147b8a6a5b5b742');
 assert.equal(m.integration_parent.ai0_r007_head_sha,
  '896a816a6c4276654eb5d48f99679ab12c717afa');
 assert.equal(m.owners.length,4);
 const paths=new Set();
 for(const owner of m.owners){
  assert.equal(owner.files.length,3);
  assert.match(owner.final_head_sha,/^[0-9a-f]{40}$/);
  for(const file of owner.files){
   assert.equal(paths.has(file.path),false,file.path);
   paths.add(file.path);
   const buf=readFileSync(resolve(root,file.path));
   const sha=createHash('sha1').update(Buffer.from('blob '+buf.length+'\0'))
    .update(buf).digest('hex');
   assert.equal(sha,file.blob_sha,file.path);
  }
 }
 assert.equal(paths.size,12);
 const previous=JSON.parse(readFileSync(resolve(root,
  'docs/operations/ai0-wave1-r006-owner-blobs.v1.json'),'utf8'));
 assert.equal(previous.owners.length,4);
});

test('R007 canonical P05 vNext remains the one 17-field offline-candidate, no live upgrade',()=>{
 assert.equal(AI0_R006_P05_VERSION,'starry.p05.canonical.vnext.offline-candidate');
 assert.equal(AI0_R006_FIELDS.length,17);
 assert.equal(AI0_R006_LIVE,false);
 assert.equal(R007_AUTH_REVIEW_LIVE,false);
 assert.equal(R007_OFFICIAL_ADAPTER_LIVE,false);
 assert.match(R007_AUTH_REVIEW_VERSION,/offline-review$/);
 assert.match(R007_ADAPTER_CONTRACT,/offline-candidate$/);
 assert.match(R007_VERSION,/offline-candidate$/);
});

test('R007 AI1 monotonic Auth does not accept caller-supplied proof or grant live rights',async()=>{
 let invoked=0;
 const auth=createOfflineR007AuthAuthorityReview({
  enabled:true,
  r006:{
   reviewFresh:async()=>{invoked++;return {status:'blocked',verified_live:false,may_send:false,may_ack_queue:false};},
   readServerReview:()=>{throw Error('must never read private proof after blocked public review');}
  },
  readCurrentActorSession:async()=>{throw Error('unauthorized current Auth read');},
  readCurrentIssuerLease:async()=>{throw Error('unauthorized issuer read');}
 });
 const r=await auth.review({verified:true,authority:'caller'},null,1793200000);
 assert.equal(r.status,'blocked');
 assert.equal(r.reason,'MISSING_R006_PROOF');
 assert.equal(invoked,1);
 allFalse(r,['verified_live','may_read_live','may_write_d1','may_send',
  'may_enqueue','may_ack_queue','may_grant','may_charge','may_publish']);
});

test('R007 AI2 unverified Store/RC and forged payment claims remain unable to grant',()=>{
 const gate=createOfflineR007OfficialProviderAdapterGate({
  enabled:false,
  scope:{brand_id:'starry',app_id:'starry-id',environment:'staging'},
  skuCatalog:[{product_key:'premium.monthly',kind:'AUTO_RENEWABLE_SUBSCRIPTION',
   period:'MONTH',ios_sku:'premium.monthly.ios',android_sku:'premium.monthly.android'}],
  nowSeconds:()=>1793200000
 });
 const bad=Object.create(null);
 Object.defineProperty(bad,'verified',{get(){throw Error('dangerous getter');}});
 const r=gate.inspect(bad);
 assert.equal(r.status,'blocked');
 assert.equal(r.reason,'DEFAULT_DISABLED');
 allFalse(r,['source_is_officially_verified','apple_jws_verified',
  'google_developer_api_verified','google_rtdn_is_payment_proof',
  'revenuecat_webhook_verified','revenuecat_app_user_id_verified',
  'signed_current_auth_verified','durable_cas_verified',
  'independent_anti_pitr_verified','can_purchase','can_restore',
  'can_grant','can_remove_ads','can_ack_webhook','can_send_p05',
  'can_publish','ads_enabled','live']);
});

test('R007 AI3 both undecided #87 synthetic recovery options never authorize real ACK',()=>{
 const script=`import importlib.util,json,sys
path="packages/rebuild-ai3/src/wave1_r007_p05_recovery_matrix.py"
spec=importlib.util.spec_from_file_location("r007_owner_recovery",path)
mod=importlib.util.module_from_spec(spec);sys.modules[spec.name]=mod
spec.loader.exec_module(mod)
out=[]
for scenario in mod.SCENARIOS:
    gate=mod.OfflineRecoveryMatrix(scenario)
    response=gate.claim(mod.Candidate(),mod.Snapshot(),mod.Snapshot())
    out.append({"scenario":scenario,"status":response.status,
      "synthetic_commit":response.synthetic_local_commit,
      "real_authority":response.real_authority_verified,
      "independent_pitr":response.independent_pitr_witness_verified,
      "may_ack":response.may_ack,"may_send":response.may_send,
      "may_enqueue":response.may_enqueue,
      "may_grant_battery":response.may_grant_battery,
      "may_sell_battery":response.may_sell_battery,
      "may_write_real_d1":response.may_write_real_d1,
      "may_publish":response.may_publish,"live":response.live})
print(json.dumps(out))`;
 const p=spawnSync('python3',['-c',script],{cwd:root,encoding:'utf8',timeout:15000});
 assert.equal(p.status,0,p.stderr);
 const results=JSON.parse(p.stdout);
 assert.equal(results.length,2);
 assert.deepEqual(results.map(x=>x.scenario),
  ['A_ONE_STARRY_AUTHORITY','B_DURABLE_OUTBOX_SAGA']);
 for(const r of results){
  assert.equal(r.status,'review_only');
  assert.equal(r.synthetic_commit,true);
  allFalse(r,['real_authority','independent_pitr','may_ack','may_send',
   'may_enqueue','may_grant_battery','may_sell_battery',
   'may_write_real_d1','may_publish','live']);
 }
});

test('R007 AI4 protected Worker transport is an immutable redacted deny-only result',()=>{
 const hostile={};
 Object.defineProperty(hostile,'verified',{get(){throw Error('must not read');}});
 const response=reviewR007UnregisteredTransport(hostile);
 assert.equal(Object.isFrozen(response),true);
 assert.equal(response.state,'blocked');
 assert.equal(response.reason,'PROTECTED_ROUTE_NOT_REGISTERED');
 allFalse(response,['may_verify','may_authenticate','may_dispatch','may_send',
  'may_ack_queue','may_grant','may_initialize_ads','may_request_ad',
  'may_deploy','publishable']);
 assert.ok(R007_PROTECTED_PINS.length>=1);
 for(const pin of R007_PROTECTED_PINS)
  allFalse(pin,['actual_worker_registered','public_success_authorized']);
});

test('R007 integration Gate remains blocked regardless of local synthetic CI',()=>{
 assert.equal(m.gate1.status,'PARTIAL_BLOCKED');
 assert.equal(m.gate2.r007_integrated_exact_sha_offline,'PENDING_NEW_CI');
 assert.equal(m.gate3.status,'BLOCKED');
 assert.equal(m.gate3.g00_g10_blocked,11);
 allFalse(m.gate3,['p05_publishable','release_authorization_granted']);
 allFalse(m.restrictions,['main_merge','preview_deploy','staging_deploy',
  'production_deploy','real_d1','real_queue','real_store','ads_on',
  'admob_sdk','battery_paid','paid_resources','hglobal_development']);
 assert.equal(m.cloudflare_external.status,'UNRESOLVED_EXTERNAL_FAILURE');
});
