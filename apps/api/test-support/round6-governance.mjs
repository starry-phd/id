/** AI-4 Round6 fail-closed repo source contract. REVIEW ONLY, no deployment decisions. */
import {readFileSync} from 'node:fs';
const file=(relative)=>readFileSync(new URL('../../../'+relative,import.meta.url),'utf8');
export const loadRound6Inputs=()=>({
 policy:JSON.parse(file('apps/api/contracts/round6-release-guard.json')),
 openapi:file('apps/api/openapi.yaml'),
 worker:file('apps/api/src/index.ts'),
 sdk:file('packages/sdk/src/index.ts'),
 candidate:file('packages/ai0-contracts/src/p05-candidate.mjs'),
 mobile:file('apps/mobile/src/brand-registry.ts'),
});
const fail=(ok,reason)=>{if(!ok)throw new Error('AI4_ROUND6_GUARD_'+reason);};
export function verifyRound6Guard({policy,openapi,worker,sdk,candidate,mobile}){
 fail(policy?.schema==='ai4-api-release-guard.v1','SCHEMA');
 fail(policy.scope?.brand_id==='starry'&&policy.scope?.app_id==='starry-id'
  &&JSON.stringify(policy.scope.environments)==='["development","staging"]'
  &&policy.scope.hglobal_implementation===false,'SCOPE');
 fail(policy.owner?.api_sdk==='AI-4'&&policy.owner?.proposed_ai5_activated===false,'OWNER');
 const p=policy.public_api;
 fail(p?.openapi_version==='0.1.0'&&p.release_authorized===false
  &&p.member_routes_published===false
  &&JSON.stringify(p.implemented_routes)==='["GET /v1/health"]','LIVE_API_FLAG');
 const paths=[...openapi.matchAll(/^  (\/[^\s:]+):\s*$/gm)].map(m=>m[1]);
 fail(JSON.stringify(paths)==='["/v1/health"]'
  &&/^  version: 0\.1\.0$/m.test(openapi)
  &&/openapi: 3\.1\.0/.test(openapi),'OPENAPI_COMPAT');
 fail(worker.includes("url.pathname === '/v1/health'")
  &&!worker.includes('/v1/member')&&!worker.includes('/v1/billing')
  &&!worker.includes('__offline')&&!/from\s+['"][^'"]*test-support/.test(worker)
  &&!/(?:\bqueue\s*\(|queue\s*:)/.test(worker),'WORKER_EXPOSURE');
 const exports=[...sdk.matchAll(/^export (?:type|interface|const|function) (\w+)/gm)].map(m=>m[1]).sort();
 fail(JSON.stringify(exports)===JSON.stringify([...p.public_sdk_exports].sort())
  &&!sdk.includes("from './member-preview")
  &&!sdk.includes('createMemberPreviewSdk'),'SDK_EXPORT');
 fail(policy.events?.p05_version==='billing.p05.v1-candidate'
  &&policy.events?.p05_publishable===false
  &&candidate.includes("export const VERSION='billing.p05.v1-candidate'")
  &&candidate.includes('export const PUBLISHABLE=false'),'P05_PUBLICATION');
 fail(Object.keys(policy.gates??{}).length===11
  &&Array.from({length:11},(_,i)=>'G'+String(i).padStart(2,'0'))
    .every(k=>policy.gates[k]==='BLOCKED'),'GATES');
 const d=policy.devices;
 fail(d?.default_eas_tier==='free'&&d.automated_per_pr_eas_build===false
  &&d.staging_approved===false&&d.testflight_approved===false
  &&d.play_internal_approved===false&&d.ios_android_device_verified===false
  &&policy.no_live_bindings===true,'DEVICES_AND_CLOUD');
 fail(mobile.includes('memberAuthEnabled:false')
  &&mobile.includes('crossBrandSyncEnabled:false'),'MOBILE_AUTH_DISABLED');
 return Object.freeze({public_route:'/v1/health',sdk_version:'0.1.0',release:'BLOCKED'});
}
