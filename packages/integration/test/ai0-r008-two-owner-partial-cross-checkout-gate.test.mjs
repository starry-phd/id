import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {createOfflineR007OfficialProviderAdapterGate} from
 '../../rebuild-billing/src/wave1-r007-official-provider-adapter-deny.ts';
import {createOfflineR008CrossProviderConflictGate,R008_RECONCILIATION_LIVE}
 from '../../rebuild-billing/src/wave1-r008-cross-provider-conflict-deny.ts';
import {reviewR008PreviewProposal,R008_LIMITS}
 from '../../../apps/api/src/wave1-r008-preview-isolation-preflight.ts';
import {AI0_R006_LIVE} from '../src/ai0-r006-p05-canonical-proposal.ts';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const read=p=>readFileSync(resolve(root,p));
const m=JSON.parse(read('docs/operations/ai0-wave1-r008-2owner-immutable-staging.v1.json'));
const scope={brand_id:'starry',app_id:'starry.one',environment:'staging'};
const digest='m_'+'a'.repeat(64);
const order='o_'+'b'.repeat(64);
const now=1793000000;
const catalog=[{product_key:'vip.month',kind:'AUTO_RENEWABLE_SUBSCRIPTION',
 period:'MONTH',ios_sku:'vip.ios.month',android_sku:'vip.android.month'}];

function claim(provider){
 const platform=provider==='apple'?'ios':'android';
 return {
  provider,evidence_kind:provider==='apple'?'apple_jws_claim':'revenuecat_webhook_claim',
  brand_id:'starry',app_id:scope.app_id,environment:'staging',platform:'ios',
  event_id:'e.'+provider+'.0001',transaction_id:'t.'+provider+'.0001',
  original_transaction_id:'order0001',member_digest:digest,
  product_key:'vip.month',store_sku:'vip.ios.month',
  kind:'AUTO_RENEWABLE_SUBSCRIPTION',period:'MONTH',
  event_type:'purchase',source_version:1,occurred_at:now-2
 };
}
const anyAllowed=o=>['can_grant','can_purchase','can_restore','can_send_p05',
 'can_publish','may_deploy','may_reenable_preview','may_create_preview',
 'may_bind_resource','may_ack_queue','ads_enabled','live','publishable']
 .some(k=>o[k]===true);

test('R008 two owner original Git blobs are byte for byte, and pending owners are NOT falsely counted',()=>{
 assert.equal(m.version,'starry.ai0.r008.owner-staging-partial.v1');
 assert.equal(m.base.sha,'aecdee944158b40ffbbd129ddd126136687d7652');
 assert.equal(m.validated_owner_count,2);
 assert.equal(m.integration_status,'PARTIAL_2_OF_4_NOT_FOUR_OWNER_GATE2');
 assert.deepEqual(m.owners.map(o=>o.id),['AI-2','AI-4']);
 assert.deepEqual(m.not_yet_integrated,['AI-1','AI-3']);
 const seen=new Set();
 for(const owner of m.owners){
  assert.equal(owner.files.length,3);
  assert.match(owner.final_head_sha,/^[0-9a-f]{40}$/);
  for(const f of owner.files){
   assert.equal(seen.has(f.path),false);
   seen.add(f.path);
   const b=read(f.path);
   const original=createHash('sha1')
    .update(Buffer.from('blob '+b.length+'\0'))
    .update(b).digest('hex');
   assert.equal(original,f.blob_sha,f.path);
  }
 }
 assert.equal(seen.size,6);
 const r7=JSON.parse(read('docs/operations/ai0-wave1-r007-owner-blobs.v1.json'));
 assert.equal(r7.owners.length,4);
});

test('R008 REAL two-owner checkout: two untrusted Store/RC claims never grant or acknowledge',()=>{
 const r007=createOfflineR007OfficialProviderAdapterGate({
  enabled:true,scope,skuCatalog:catalog,nowSeconds:()=>now});
 const s=r007.inspect(claim('apple'));
 // R007 local replay/version state is provider-session scoped; independent
 // providers must be reviewed by independent synthetic R007 adapters.
 const rc=createOfflineR007OfficialProviderAdapterGate({
  enabled:true,scope,skuCatalog:catalog,nowSeconds:()=>now
 }).inspect(claim('revenuecat'));
 assert.equal(s.status,'review_only');
 assert.equal(rc.status,'review_only');
 const correlation={brand_id:'starry',app_id:scope.app_id,environment:'staging',
  platform:'ios',product_key:'vip.month',period:'MONTH',
  store_member_digest:digest,rc_member_digest:digest,
  store_original_order_digest:order,rc_original_order_digest:order,
  store_event_version:1,rc_event_version:1,
  store_event_at:now-2,rc_event_at:now-1};
 const gate=createOfflineR008CrossProviderConflictGate({enabled:true,scope,nowSeconds:()=>now});
 const result=gate.reconcile({store:s,revenuecat:rc,correlation});
 assert.equal(result.status,'review_only');
 assert.equal(result.reason,'MATCHING_UNVERIFIED_CLAIMS_NO_AUTHORITY');
 assert.equal(R008_RECONCILIATION_LIVE,false);
 assert.equal(anyAllowed(result),false);
 assert.equal(result.correlation_is_authoritative,false);
 assert.equal(result.current_signed_auth_verified,false);
 assert.equal(result.independent_anti_pitr_verified,false);
});

test('R008 REAL two-owner checkout: matched Preview shape remains denied despite mocked double source',()=>{
 const text=['[previews]','[previews.vars]',
  'STARRY_ENVIRONMENT = "preview"','STARRY_APP_ID = "starry-id"'].join('\n');
 const r=reviewR008PreviewProposal({worker:'id-starry',repository:'starry-phd/id',
  config_path:'apps/api/wrangler.toml',
  preview_command:'npx wrangler preview --config apps/api/wrangler.toml',
  preview_config_text:text,requested_binding_names:[]});
 assert.equal(r.state,'blocked');
 assert.equal(r.reason,'SEPARATE_OWNER_AUTHORIZATION_REQUIRED');
 assert.equal(r.proposal_shape_reviewed,true);
 assert.equal(anyAllowed(r),false);
 assert.equal(R008_LIMITS.preview_builds_enabled,false);
 assert.equal(R008_LIMITS.production_auto_builds_enabled,false);
});

test('R008 two-owner Cloudflare proposal and Store claim cannot elevate canonical P05 or permissions',()=>{
 assert.equal(AI0_R006_LIVE,false);
 assert.equal(m.cloudflare_preview_enabled,false);
 assert.equal(m.cloudflare_production_auto_build_enabled,false);
 assert.equal(m.cloudflare_status,'HISTORICAL_AUDIT_ONLY_REQUERY_TO_CLAIM_CURRENT');
 assert.equal(m.gate1,'PARTIAL_BLOCKED');
 assert.equal(m.gate3,'BLOCKED_11_OF_11');
 assert.equal(m.p05_publishable,false);
 assert.equal(m.release_authorization_granted,false);
 assert.equal(m.ads_on,false);
 assert.equal(m.battery_paid,false);
 assert.equal(Object.values(m.authorized_actions).some(Boolean),false);
});

test('R008 staging is no live deployment, and separate owner tests remain included in offline CI',()=>{
 const wf=read('.github/workflows/ai0-current-offline-gate.yml').toString();
 assert.ok(wf.includes('npm test'));
 assert.ok(wf.includes('packages/rebuild-billing/test/*.test.mjs'));
 assert.ok(wf.includes('packages/integration/test/*.test.mjs'));
 assert.ok(wf.includes('npm run api:check'));
 assert.ok(wf.includes('--assert-blocked'));
 const config=read('apps/api/wrangler.toml').toString();
 assert.doesNotMatch(config,/^\[previews\]$/m);
 assert.doesNotMatch(config,/^\[env\.production\]$/m);
});
