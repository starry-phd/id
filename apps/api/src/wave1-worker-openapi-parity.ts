/**
 * AI-4 Wave1 Round-001 / Central Starry API liveness OpenAPI drift gate.
 * Pure offline inspection only. No API routes, bindings, token or rights.
 * Intentionally narrow: the canonical YAML currently exposes ONE liveness route.
 */
export const WAVE1_API_CONTRACT='starry.id.wave1.openapi-liveness.v1' as const;
export const WAVE1_API_LIVE_APPROVED=false as const;
export const WAVE1_API_NEW_AUTH_ENDPOINTS_ENABLED=false as const;
type Finding='OPENAPI_NOT_31'|'EXTRA_OR_MISSING_PUBLIC_ROUTE'|
 'HEALTH_OPERATION_MISMATCH'|'HEALTH_SCHEMA_INCOMPLETE'|
 'LIVENESS_RESPONSE_MISMATCH'|'MISSING_SECURITY_HEADERS'|
 'AUTH_ROUTE_EXPOSED'|'PRODUCTION_OR_FOREIGN_SCOPE_LEAK'|
 'UNSAFE_VERB_ACCEPTED';
export type Wave1ContractResult=Readonly<{
 contract:typeof WAVE1_API_CONTRACT;
 status:'offline_consistent'|'blocked';
 reasons:readonly Finding[];
 spec_matches_worker:boolean;
 evidence_level:'repo_source_offline_only';
 live_verified:false;may_deploy:false;may_authenticate:false;
 may_grant_entitlement:false;may_ack_queue:false;publishable:false;
}>;
export type Wave1HttpProbe=Readonly<{
 health:Response;unknown:Response;unsafeVerb:Response;
 foreignApp:Response;production:Response;auth:Response;
}>;
const REQUIRED=[
 'status: {type: string, const: ok}',
 'brand_id: {type: string, const: starry}',
 'app_id: {type: string, const: starry-id}',
 'environment: {type: string, enum: [development, staging]}',
 'service: {type: string, const: id-api}',
 'kind: {type: string, const: liveness-only}'
] as const;
const hasOwn=(a:object,k:string)=>Object.prototype.hasOwnProperty.call(a,k);
const isExactHealth=(v:unknown):boolean=>{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const o=v as Record<string,unknown>;
 const fields=['status','brand_id','app_id','environment','service','kind'];
 return Object.keys(o).length===fields.length&&fields.every(k=>hasOwn(o,k))&&
  o.status==='ok'&&o.brand_id==='starry'&&o.app_id==='starry-id'&&
  (o.environment==='development'||o.environment==='staging')&&
  o.service==='id-api'&&o.kind==='liveness-only';
};
/** Canonical spec's public surface must match actual current Worker. Reject
 * new auth/billing/admin paths, even if accidentally inserted as draft YAML.
 * Not a general YAML parser; OpenAPI structural validation is still pending.
 */
function inspectSpec(raw:string,issues:Finding[]):void{
 if(raw.length>90000||!/^\s*openapi:\s*3\.1\.0\s*$/m.test(raw))
  issues.push('OPENAPI_NOT_31');
 const p=raw.indexOf('\npaths:\n'),c=raw.indexOf('\ncomponents:\n');
 if(p<0||c<=p){issues.push('EXTRA_OR_MISSING_PUBLIC_ROUTE');return;}
 const section=raw.slice(p+7,c);
 const routes=[...section.matchAll(/^ {2}(\/[^:\n]+):\s*$/gm)].map(x=>x[1]);
 if(routes.length!==1||routes[0]!=='/v1/health')
  issues.push('EXTRA_OR_MISSING_PUBLIC_ROUTE');
 const methods=[...section.matchAll(/^ {4}([a-z]+):\s*$/gm)].map(x=>x[1]);
 if(methods.length!==1||methods[0]!=='get'||!section.includes('operationId: getLiveness'))
  issues.push('HEALTH_OPERATION_MISMATCH');
 if(!section.includes("required: [status, brand_id, app_id, environment, service, kind]")||
  REQUIRED.some(line=>!section.includes(line)))
  issues.push('HEALTH_SCHEMA_INCOMPLETE');
}
const normal=async (response:Response):Promise<unknown>=>{
 try{const value:unknown=await response.clone().json();return value;}
 catch{return null;}
};
/** Uses supplied real Worker Response objects; never executes fetch/network. */
export async function auditWave1WorkerOpenApiContract(
 spec:unknown,probes:Wave1HttpProbe
):Promise<Wave1ContractResult>{
 const failures:Finding[]=[];
 if(typeof spec!=='string'){failures.push('OPENAPI_NOT_31')}
 else inspectSpec(spec,failures);
 const required=['health','unknown','unsafeVerb','foreignApp','production','auth'] as const;
 if(!probes||required.some(k=>!(probes[k] instanceof Response))){
  failures.push('LIVENESS_RESPONSE_MISMATCH');
 }else{
  const v=await normal(probes.health);
  if(probes.health.status!==200||!isExactHealth(v))
   failures.push('LIVENESS_RESPONSE_MISMATCH');
  const headers=probes.health.headers;
  if(headers.get('cache-control')!=='no-store'||
   headers.get('x-content-type-options')!=='nosniff'||
   !headers.get('content-type')?.startsWith('application/json')||
   headers.has('access-control-allow-origin'))
   failures.push('MISSING_SECURITY_HEADERS');
  if(probes.unknown.status!==404||probes.unsafeVerb.status!==405)
   failures.push('UNSAFE_VERB_ACCEPTED');
  if(probes.auth.status!==404)failures.push('AUTH_ROUTE_EXPOSED');
  if(probes.foreignApp.status!==403||probes.production.status!==503)
   failures.push('PRODUCTION_OR_FOREIGN_SCOPE_LEAK');
 }
 const unique=Object.freeze([...new Set(failures)]);
 return Object.freeze({
  contract:WAVE1_API_CONTRACT,
  status:unique.length===0?'offline_consistent':'blocked',
  reasons:unique,spec_matches_worker:unique.length===0,
  evidence_level:'repo_source_offline_only',
  live_verified:false,may_deploy:false,may_authenticate:false,
  may_grant_entitlement:false,may_ack_queue:false,publishable:false
 });
}
