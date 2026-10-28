import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createOfflineR008AuthSessionCasReview,R008_AUTH_CAS_LIVE}
 from '../../../modules/starry-id-v1/src/wave1-round008-auth-session-monotonic-cas.ts';
import {createOfflineR008CrossProviderConflictGate,R008_RECONCILIATION_LIVE}
 from '../../rebuild-billing/src/wave1-r008-cross-provider-conflict-deny.ts';
import {reviewR008PreviewProposal,R008_LIMITS}
 from '../../../apps/api/src/wave1-r008-preview-isolation-preflight.ts';
import {preflight} from '../../../docs/release-readiness/check-release-readiness.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const read=p=>readFileSync(resolve(root,p));
const source=JSON.parse(read('docs/operations/ai0-wave1-r008-four-owner-source.v1.json'));
const blocked=o=>{for(const k of ['verified_live','may_send','may_ack',
 'may_ack_queue','may_grant','may_publish','may_bill','may_charge',
 'can_grant','can_send_p05','can_ack_webhook','may_deploy',
 'may_reenable_preview','may_bind_resource','ads_enabled','live','publishable'])
 if(Object.hasOwn(o,k))assert.equal(o[k],false,k);
};

test('R008 exact Git original blobs: 4 Owners, 12 unmodified source files',()=>{
 assert.equal(source.parent_sha,'e815561a2d6549da792df59190f7bb727bd5c9ce');
 assert.deepEqual(source.owners.map(x=>x.id),['AI-1','AI-2','AI-3','AI-4']);
 const prefixes={'AI-1':'modules/starry-id-v1/','AI-2':'packages/rebuild-billing/',
  'AI-3':'packages/rebuild-ai3/','AI-4':null};
 const paths=new Set();
 for(const o of source.owners){
  assert.match(o.head,/^[0-9a-f]{40}$/);
  assert.equal(o.files.length,3);
  for(const f of o.files){
   assert.equal(paths.has(f.path),false);paths.add(f.path);
   assert.match(f.sha,/^[0-9a-f]{40}$/);
   if(prefixes[o.id])assert.equal(f.path.startsWith(prefixes[o.id]),true);
   if(o.id==='AI-4')assert.equal(f.path.startsWith('apps/api/')||
    f.path.startsWith('docs/operations/'),true);
   const buf=read(f.path);
   const actual=createHash('sha1').update(Buffer.from('blob '+buf.length+'\0'))
    .update(buf).digest('hex');
   assert.equal(actual,f.sha,f.path);
  }
 }
 assert.equal(paths.size,12);
 const inherited=JSON.parse(read('docs/operations/ai0-wave1-r008-2owner-immutable-staging.v1.json'));
 for(const id of ['AI-2','AI-4']){
  const a=source.owners.find(x=>x.id===id);
  const b=inherited.owners.find(x=>x.id===id);
  assert.equal(a.head,b.final_head_sha);
  assert.deepEqual(a.files.map(x=>x.sha),b.files.map(x=>x.blob_sha));
 }
});

test('R008 real AI1 Auth local CAS success stays review_only and never grants',async()=>{
 let cas=0;
 const scope={brand_id:'starry',app_id:'starry.one',environment:'staging'};
 const claim={source:'synthetic_server_auth_resolver',...scope,
  event_id:'event-000001',actor_ref:'actor-000001',
  member_ref:'member-000001',session_ref:'session-000001',
  provider_ref:'provider-000001',token_fingerprint:'a'.repeat(64),
  auth_version:3,session_version:5,issuer_epoch:1,expires_at:1793000060};
 const lease={source:'synthetic_server_issuer_lease',kid:'issuer-001',
  issuer_epoch:1,generation:1};
 const gate=createOfflineR008AuthSessionCasReview({
  enabled:true,serverScope:scope,expectedOrigin:'https://id.starry.example',
  readServerAuthenticatedClaim:async()=>claim,
  readMockMonotonicFloor:async()=>5,
  readMockIssuerLease:async()=>lease,
  compareAndSwapLocalOnly:async()=>{cas++;return 'local_applied';}
 });
 const raw=new Request('https://id.starry.example/auth/review',
  {method:'POST',headers:{authorization:'Bearer valid_token_000001'}});
 const out=await gate.review(raw,1793000000);
 assert.equal(R008_AUTH_CAS_LIVE,false);
 assert.equal(out.status,'review_only');
 assert.equal(out.reason,'OFFLINE_CAS_NOT_LIVE_AUTHORITY');
 assert.equal(cas,1);blocked(out);
 const forged=new Request('https://id.starry.example/auth/review',
  {method:'POST',headers:{authorization:'Bearer valid_token_000001',
   'x-verified':'true'}});
 const rejected=await gate.review(forged,1793000000);
 assert.equal(rejected.reason,'UNTRUSTED_REQUEST');
 assert.equal(cas,1);blocked(rejected);
});

test('R008 real AI3 privacy barrier denies both unchosen ADR queue ACKs',()=>{
 const script=[
  'import importlib.util,json,sys',
  'p="packages/rebuild-ai3/src/wave1_r008_p05_p06_failure_order.py"',
  's=importlib.util.spec_from_file_location("ai0_r008_recovery_bridge",p)',
  'm=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)',
  'out=[]',
  'for strategy in m.STRATEGIES:',
  ' x=m.OfflineP05P06FailureOrder(strategy)',
  ' e=m.SyntheticEvent();state=m.SyntheticState()',
  ' first=x.local_review(e,state,state)',
  ' erase=x.p06_erasure_barrier(e,phase="before_ack")',
  ' ack=x.queue_boundary(e,state,stage="before_ack")',
  ' out.append([strategy,first.status,first.may_ack,erase.status,',
  '  erase.may_ack,ack.status,ack.may_ack,ack.live])',
  'print(json.dumps(out))'
 ].join('\n');
 const p=spawnSync('python3',['-c',script],{cwd:root,encoding:'utf8',
  timeout:15000});
 assert.equal(p.status,0,p.stderr);
 const results=JSON.parse(p.stdout);
 assert.equal(results.length,2);
 for(const x of results){
  assert.equal(x[1],'review_only');
  assert.deepEqual(x.slice(2),[false,'blocked',false,'blocked',false,false]);
 }
});

test('R008 AI2 and AI4 cannot treat synthetic Auth as purchase or Preview approval',()=>{
 const pay=createOfflineR008CrossProviderConflictGate({
  enabled:false,scope:{brand_id:'starry',app_id:'starry.one',environment:'staging'},
  nowSeconds:()=>1793000000
 }).reconcile({official_verification:true});
 assert.equal(R008_RECONCILIATION_LIVE,false);
 assert.equal(pay.status,'blocked');blocked(pay);
 const p=reviewR008PreviewProposal({
  worker:'id-starry',repository:'starry-phd/id',
  config_path:'apps/api/wrangler.toml',
  preview_command:'npx wrangler preview --config apps/api/wrangler.toml',
  preview_config_text:'[previews]\n[previews.vars]\nSTARRY_ENVIRONMENT = "preview"\nSTARRY_APP_ID = "starry-id"',
  requested_binding_names:[]
 });
 assert.equal(p.reason,'SEPARATE_OWNER_AUTHORIZATION_REQUIRED');
 assert.equal(R008_LIMITS.preview_builds_enabled,false);
 blocked(p);
});

test('R008 4-owner offline source cannot release P05, Ads, Battery or G00-G10',()=>{
 assert.equal(source.stage,'CANDIDATE_PENDING_NEW_CI');
 assert.equal(source.release,'BLOCKED_11_GATES');
 assert.equal(source.p05_live,false);
 assert.equal(source.ads_enabled,false);
 assert.equal(source.battery_paid,false);
 const readiness=preflight(JSON.parse(read('docs/release-readiness/release-readiness.v0.json')));
 assert.equal(readiness.valid,true);
 assert.equal(readiness.blocked.length,11);
 assert.equal(readiness.manual_review_eligible,false);
 assert.equal(readiness.can_auto_deploy,false);
});
