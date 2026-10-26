import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const here=fileURLToPath(new URL('./',import.meta.url));
const root=fileURLToPath(new URL('../../',import.meta.url));
function load(path){return readFileSync(root+path,'utf8')}
export const pathManifest=here+'api-surface.v0.json';
export function verify(m,read=load){
 const errors=[],bad=s=>errors.push(s);
 if(!m||m.version!=='0.1.0'||!Array.isArray(m.surfaces))return ['API_MANIFEST_INVALID'];
 if(!/^[0-9a-f]{40}$/.test(m.source_commit))bad('SOURCE_COMMIT_INVALID');
 if(m.scope?.brand!=='starry'||m.scope?.app_id!=='starry-id'||m.scope?.hglobal!=='paused_separate_auth_d1_cloudflare_and_api')bad('BRAND_SEPARATION_LOST');
 if(m.ownership?.current!=='AI-4'||m.ownership?.ai5_activated!==false||m.ownership?.proposed_future!=='AI-5')bad('AI5_NOT_APPROVED_OR_OWNER_CHANGED');
 if(m.safety?.api5_is_not_approved!==true||m.safety?.live_api_publication_allowed!==false||m.safety?.production_deploy_allowed!==false||m.safety?.owner_permission_required!==true)bad('UNAPPROVED_RELEASE');
 const ids=m.surfaces.map(x=>x.id);
 if(new Set(ids).size!==4||['HEALTH-GET','MEMBER-SELF-GET','STORE-AUDIT-P05','CROSS-BRAND-SYNC'].some(x=>!ids.includes(x)))bad('SURFACE_INVENTORY_CHANGED');
 for(const x of m.surfaces){
  for(const key of ['spec','handler','client'])if(x[key]){try{read(x[key])}catch{bad('MISSING_SOURCE:'+x.id+':'+key)}}
 }
 const health=m.surfaces.find(x=>x.id==='HEALTH-GET');
 const member=m.surfaces.find(x=>x.id==='MEMBER-SELF-GET');
 const event=m.surfaces.find(x=>x.id==='STORE-AUDIT-P05');
 const sync=m.surfaces.find(x=>x.id==='CROSS-BRAND-SYNC');
 if(health?.status!=='implemented_source_only_not_deployed'||health?.path!=='/v1/health'||health?.public_sdk_export!=='createStarryHealthClient')bad('HEALTH_SCOPE_INVALID');
 if(member?.status!=='test_only_disabled'||member?.path!=='/v1/member/self'||member?.public_sdk_export!==null)bad('MEMBER_EXPOSURE_UNAPPROVED');
 if(event?.status!=='candidate_nonpublishable'||sync?.status!=='disabled')bad('SENSITIVE_SURFACE_ENABLED');
 try{
  const worker=read('apps/api/src/index.ts');
  const paths=[...worker.matchAll(/url\.pathname\s*===\s*['"]([^'"]+)['"]/g)].map(x=>x[1]);
  if(paths.length!==1||paths[0]!=='/v1/health')bad('WORKER_ROUTE_DRIFT');
  const publishedSpec=read('apps/api/openapi.yaml');
  const block=publishedSpec.split(/^paths:\s*$/m)[1]?.split(/^components:\s*$/m)[0]??'';
  const exposed=[...block.matchAll(/^ {2}(\/[^:\s]+):\s*$/gm)].map(x=>x[1]);
  if(exposed.length!==1||exposed[0]!=='/v1/health')bad('OPENAPI_EXPOSURE_DRIFT');
  if(!/^openapi:\s*3\.1\.0$/m.test(publishedSpec))bad('OPENAPI_VERSION');
  const draftSpec=read('apps/api/openapi.member.DRAFT.yaml');
  if(!draftSpec.includes('/v1/member/self:')||!draftSpec.includes('NOT SERVED'))bad('MEMBER_SPEC_PREMATURE');
  const sdk=read('packages/sdk/src/index.ts');
  if(!sdk.includes('createStarryHealthClient')||!sdk.includes("CROSS_BRAND_SYNC_STATUS = 'FEATURE_DISABLED'"))bad('SDK_SCOPE_CHANGED');
  if(/member-preview|createMemberPreviewSdk|readStarrySelfDraft/.test(sdk))bad('MEMBER_SDK_PUBLICLY_EXPORTED');
  const memberSource=read('apps/api/src/member-contract.ts');
  if(!memberSource.includes("'/v1/member/self'"))bad('MEMBER_CONTRACT_MISSING');
  const p05=read('packages/ai0-contracts/src/p05-candidate.mjs');
  if(!p05.includes('export const PUBLISHABLE=false'))bad('P05_PUBLISHING_UNBLOCKED');
  const wrangler=read('apps/api/wrangler.toml');
  if(/^\[env\.production\]/m.test(wrangler)||/^\s*workers_dev\s*=\s*true/m.test(wrangler))bad('UNREVIEWED_DEPLOYMENT_CONFIG');
 }catch(e){bad('SOURCE_CHECK_FAILED:'+String(e).slice(0,100))}
 return errors;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const m=JSON.parse(readFileSync(pathManifest,'utf8')),errors=verify(m);
 console.log(JSON.stringify({status:errors.length===0?'PASS_SOURCE_SNAPSHOT':'FAIL',actual_public_routes_in_code:['GET /v1/health'],ai5_activated:false,release:'BLOCKED',errors},null,2));
 if(errors.length)process.exitCode=1;
}
