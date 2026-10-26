import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verify,pathManifest} from '../verify-api-surface.mjs';
const base=JSON.parse(readFileSync(pathManifest,'utf8')),copy=()=>structuredClone(base);
test('exact GitHub source inventory: only GET health in source, member test-only, P05 disabled',()=>{
 assert.deepEqual(verify(base),[]);
});
test('invented API-5 owner and unapproved public member exposure fail closed',()=>{
 for(const change of [
  m=>m.ownership.ai5_activated=true,
  m=>m.ownership.current='AI-5',
  m=>m.surfaces.find(x=>x.id==='MEMBER-SELF-GET').status='published',
  m=>m.surfaces.find(x=>x.id==='MEMBER-SELF-GET').public_sdk_export='readSelf',
  m=>m.surfaces.find(x=>x.id==='STORE-AUDIT-P05').status='production',
  m=>m.safety.production_deploy_allowed=true,
  m=>m.scope.hglobal='shared_cloudflare_and_d1',
  m=>m.surfaces.pop()
 ]){const x=copy();change(x);assert.ok(verify(x).length>0)}
});
test('detect API and SDK drift against exact checked source content',()=>{
 const files=new Map();
 const fake=path=>{
  if(files.has(path))return files.get(path);
  return readFileSync(new URL('../../../'+path,import.meta.url),'utf8');
 };
 files.set('apps/api/src/index.ts',fake('apps/api/src/index.ts')+"\nurl.pathname === '/v1/member/self';");
 assert.ok(verify(base,fake).includes('WORKER_ROUTE_DRIFT'));
 files.clear();
 files.set('packages/sdk/src/index.ts',fake('packages/sdk/src/index.ts')+"\nexport {createMemberPreviewSdk} from './member-preview';");
 assert.ok(verify(base,fake).includes('MEMBER_SDK_PUBLICLY_EXPORTED'));
 files.clear();
 files.set('apps/api/openapi.yaml',fake('apps/api/openapi.yaml').replace('paths:\n  /v1/health:', 'paths:\n  /v1/member/self:\n    get:\n      summary: Test-injected unauthorized route\n  /v1/health:'));
 assert.ok(verify(base,fake).includes('OPENAPI_EXPOSURE_DRIFT'));
});
