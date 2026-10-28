import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {handleRequest} from '../src/index.ts';
import {auditWave1WorkerOpenApiContract,WAVE1_API_CONTRACT,
 WAVE1_API_LIVE_APPROVED,WAVE1_API_NEW_AUTH_ENDPOINTS_ENABLED}
 from '../src/wave1-worker-openapi-parity.ts';

const spec=readFileSync(new URL('../openapi.yaml',import.meta.url),'utf8');
const env={STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'};
const req=(url,method='GET')=>new Request('https://api.starry.invalid'+url,{method});
const actual=()=>({
 health:handleRequest(req('/v1/health'),env),
 unknown:handleRequest(req('/v1/no-route'),env),
 unsafeVerb:handleRequest(req('/v1/health','POST'),env),
 foreignApp:handleRequest(req('/v1/health'),{...env,STARRY_APP_ID:'hglobal-id'}),
 production:handleRequest(req('/v1/health'),{...env,STARRY_ENVIRONMENT:'production'}),
 auth:handleRequest(req('/v1/auth/login'),env)
});
function assertNeverAuthorized(r){
 assert.equal(r.contract,WAVE1_API_CONTRACT);
 assert.equal(r.evidence_level,'repo_source_offline_only');
 assert.equal(r.live_verified,false);
 for(const k of ['may_deploy','may_authenticate','may_grant_entitlement','may_ack_queue','publishable'])
  assert.equal(r[k],false,k);
 assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.reasons));
}
test('W1 R001 actually reads canonical OpenAPI and REAL live-disabled Worker response without remote calls',async()=>{
 const result=await auditWave1WorkerOpenApiContract(spec,actual());
 assert.equal(WAVE1_API_LIVE_APPROVED,false);
 assert.equal(WAVE1_API_NEW_AUTH_ENDPOINTS_ENABLED,false);
 assert.equal(result.status,'offline_consistent');assert.deepEqual(result.reasons,[]);
 assertNeverAuthorized(result);
});
test('W1 canonical OpenAPI cannot quietly publish an Auth, Billing, Battery or Admin route',async()=>{
 for(const path of ['/v1/auth/session','/v1/billing','/v1/battery','/v1/admin']){
  const poisoned=spec.replace('\ncomponents:\n','\n  '+path+':\n    get:\n      operationId: dangerous\ncomponents:\n');
  const r=await auditWave1WorkerOpenApiContract(poisoned,actual());
  assert.ok(r.reasons.includes('EXTRA_OR_MISSING_PUBLIC_ROUTE'));assertNeverAuthorized(r);
 }
});
test('W1 fail closed for extra GET/POST methods in OpenAPI spec',async()=>{
 const changed=spec.replace('      operationId: getLiveness','      operationId: getLiveness\n    post:\n      operationId: unsafe');
 const r=await auditWave1WorkerOpenApiContract(changed,actual());
 assert.ok(r.reasons.includes('HEALTH_OPERATION_MISMATCH'));assertNeverAuthorized(r);
});
test('W1 exact schema forbids misleading readiness/production/brand fields',async()=>{
 for(const pair of [
  ['required: [status, brand_id, app_id, environment, service, kind]','required: [status, app_id]'],
  ['brand_id: {type: string, const: starry}','brand_id: {type: string, const: hglobal}'],
  ['environment: {type: string, enum: [development, staging]}','environment: {type: string, enum: [production]}'],
  ['kind: {type: string, const: liveness-only}','kind: {type: string, const: readiness}']
 ]){
  const r=await auditWave1WorkerOpenApiContract(spec.replace(pair[0],pair[1]),actual());
  assert.ok(r.reasons.includes('HEALTH_SCHEMA_INCOMPLETE'));assertNeverAuthorized(r);
 }
});
test('W1 malicious YAML format / unknown version rejected without parsing remote URL or leaking secrets',async()=>{
 for(const invalid of [null,{},'openapi: 3.0.3\npaths: {}',
  spec.replace('openapi: 3.1.0','openapi: 4.0.0'),
  spec.replace('\npaths:\n','\npaths_missing:\n')]){
  const r=await auditWave1WorkerOpenApiContract(invalid,actual());
  assert.equal(r.status,'blocked');assertNeverAuthorized(r);
 }
});
test('W1 REAL worker /health semantic drift from OpenAPI is release blocked',async()=>{
 const fake=actual();
 fake.health=new Response(JSON.stringify({status:'ready',brand_id:'starry'}),{status:200});
 const r=await auditWave1WorkerOpenApiContract(spec,fake);
 assert.ok(r.reasons.includes('LIVENESS_RESPONSE_MISMATCH'));assertNeverAuthorized(r);
});
test('W1 missing no-store/nosniff or permissive CORS on response blocked',async()=>{
 const changes=[
  {'cache-control':'public, max-age=3600'},
  {'x-content-type-options':'none'},
  {'access-control-allow-origin':'*'}
 ];
 for(const change of changes){
  const fake=actual(),headers=new Headers(fake.health.headers);
  for(const [key,value] of Object.entries(change))headers.set(key,value);
  fake.health=new Response(await fake.health.text(),{status:200,headers});
  const r=await auditWave1WorkerOpenApiContract(spec,fake);
  assert.ok(r.reasons.includes('MISSING_SECURITY_HEADERS'));assertNeverAuthorized(r);
 }
});
test('W1 future accidental protected auth or cross-brand success on Worker is blocked',async()=>{
 for(const role of ['auth','foreignApp','production']){
  const fake=actual();
  fake[role]=new Response(JSON.stringify({status:'ok'}),{status:200});
  const r=await auditWave1WorkerOpenApiContract(spec,fake);
  assert.ok(r.reasons.includes(role==='auth'?'AUTH_ROUTE_EXPOSED':'PRODUCTION_OR_FOREIGN_SCOPE_LEAK'));
  assertNeverAuthorized(r);
 }
});
test('W1 cannot silently accept unsupported verb or unknown path',async()=>{
 for(const role of ['unknown','unsafeVerb']){
  const fake=actual();fake[role]=new Response(null,{status:200});
  const r=await auditWave1WorkerOpenApiContract(spec,fake);
  assert.ok(r.reasons.includes('UNSAFE_VERB_ACCEPTED'));assertNeverAuthorized(r);
 }
});
test('W1 all noncanonical or malformed probes fail closed',async()=>{
 for(const data of [null,{}, {health:'fake'}]){
  const r=await auditWave1WorkerOpenApiContract(spec,data);
  assert.equal(r.status,'blocked');assertNeverAuthorized(r);
 }
});
