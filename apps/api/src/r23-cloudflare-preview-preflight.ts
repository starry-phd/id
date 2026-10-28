/**
 * R23 AI-4 / Cloudflare Workers Preview PRE-FLIGHT ONLY.
 * Inert validator for an isolated, proposed Worker Preview build plan.
 * No Cloudflare SDK, network, credentials, file I/O, Wrangler CLI or deployment.
 *
 * Authoritative Cloudflare docs (read 2026-10-28):
 * https://developers.cloudflare.com/workers/previews/
 * https://developers.cloudflare.com/workers/previews/get-started/
 * https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/
 */
export const R23_PREVIEW_AUDIT_VERSION='starry.r23.preview-preflight.v0' as const;
export const R23_PREVIEW_MIN_WRANGLER='4.135.0' as const;
export const R23_PREVIEW_LIVE_EXECUTION_ALLOWED=false as const;
export const R23_PREVIEW_EXPECTED_CONFIG='apps/api/wrangler.preview.poc.toml' as const;
export const R23_PREVIEW_EXPECTED_COMMAND=
 'npx wrangler preview --config apps/api/wrangler.preview.poc.toml' as const;

export type R23PreviewEvidence=Readonly<{
 root_directory:string;
 preview_command:string;
 branch_includes:readonly string[];
 target_branch:string;
 worker_name:string;
 config_path:string;
 wrangler_version:string;
 config_text:string;
}>;
export type R23PreviewPreflight=Readonly<{
 contract:typeof R23_PREVIEW_AUDIT_VERSION;
 state:'BLOCKED'|'CONFIG_CANDIDATE_ONLY';
 reasons:readonly string[];
 requires_human_cloudflare_approval:true;
 requires_cost_and_access_review:true;
 config_path:typeof R23_PREVIEW_EXPECTED_CONFIG;
 suggested_command:typeof R23_PREVIEW_EXPECTED_COMMAND;
 may_mutate_trigger:false;may_run_build:false;may_create_preview:false;
 may_deploy_production:false;may_bind_real_d1:false;may_use_paid_services:false;
 rollback:'NO_LIVE_CHANGE_CLOSE_DRAFT_ONLY';
}>;
const ALLOWED_KEYS:readonly string[]=['root_directory','preview_command','branch_includes','target_branch',
 'worker_name','config_path','wrangler_version','config_text'] as const;
const BLOCKED_BINDINGS=/^\s*(?:\[\[?(?:d1_databases|r2_buckets|kv_namespaces|queues|services|durable_objects|workflows|unsafe|triggers|routes|observability|containers|ai|vectorize|hyperdrive)(?:[.\]\s]|$)|(?:account_id|zone_id|route|workers_dev|send_email|assets|secrets|token|api_key)\s*=)/im;
const NAME=/^starry-id-api-preview-[a-z0-9-]{3,40}$/;
const BRANCH=/^ai4\/r23-[a-z0-9-]{3,70}$/;
function ownPlain(input:unknown):Record<string,unknown>|null {
 try {
  if(!input||typeof input!=='object'||Array.isArray(input)||
   (Object.getPrototypeOf(input)!==Object.prototype&&Object.getPrototypeOf(input)!==null))
   return null;
  const keys=Reflect.ownKeys(input);
  if(keys.length!==ALLOWED_KEYS.length||keys.some(k=>typeof k!=='string'||!ALLOWED_KEYS.includes(k)))
   return null;
  const safe:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of ALLOWED_KEYS){
   const d=Object.getOwnPropertyDescriptor(input,key);
   if(!d||!d.enumerable||!('value'in d))return null;
   safe[key]=d.value;
  }
  return safe;
 }catch{return null;}
}
function parseVersion(raw:unknown):[number,number,number]|null{
 if(typeof raw!=='string'||!/^4\.\d{1,4}\.\d{1,4}$/.test(raw))return null;
 const [maj,min,patch]=raw.split('.').map(Number);
 return [maj,min,patch];
}
function atLeastPreviewVersion(raw:unknown):boolean{
 const v=parseVersion(raw);
 return !!v&&(v[0]>4||(v[0]===4&&(v[1]>135||(v[1]===135&&v[2]>=0))));
}
/** Extracts only top-level bare keys or exact preview vars from inert TOML text.
 * Does NOT parse arbitrary TOML, inspect secrets or act as a Wrangler config parser.
 * Full validation must still run with actual Wrangler in an authorized isolated PoC.
 */
function configEligible(raw:unknown,workerName:string):boolean{
 if(typeof raw!=='string'||raw.length>12000||raw.length<50||
  /[\u0000-\u0008\u000B-\u001F]/.test(raw))return false;
 const text=raw.split(/\r?\n/).map(line=>line.replace(/\s+#.*$/,'')).join('\n');
 if(BLOCKED_BINDINGS.test(text)||/(?:production|id-starry|hglobal|secret|password|bearer)/i.test(text))return false;
 const lines=text.split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
 const sections=lines.filter(line=>line.startsWith('['));
 if(sections.length!==2||sections[0]!=='[previews]'||sections[1]!=='[previews.vars]')
  return false;
 const header=lines.slice(0,lines.indexOf('[previews]'));
 if(header.length!==3)return false;
 const matches=(line:string,key:string)=>new RegExp('^'+key+'\\s*=\\s*"([^"]+)"$').exec(line);
 const names=header.map(line=>matches(line,'name')?.[1]).filter(Boolean);
 if(names.length!==1||names[0]!==workerName)return false;
 const mains=header.map(line=>matches(line,'main')?.[1]).filter(Boolean);
 if(mains.length!==1||mains[0]!=='src/index.ts')return false;
 const dates=header.map(line=>matches(line,'compatibility_date')?.[1]).filter(Boolean);
 if(dates.length!==1||!/^2026-\d{2}-\d{2}$/.test(dates[0]!))return false;
 // Empty previews block is supported, but explicitly require only safe Preview vars.
 if(lines.indexOf('[previews.vars]')!==lines.indexOf('[previews]')+1)return false;
 const vars=lines.slice(lines.indexOf('[previews.vars]')+1);
 return vars.length===2&&
  vars.includes('STARRY_ENVIRONMENT = "staging"')&&
  vars.includes('STARRY_APP_ID = "starry-id"');
}
/**
 * This is a conservative proposal review. Even CONFIG_CANDIDATE_ONLY never
 * authorizes Wrangler Preview. A user must approve the account, budget,
 * deployment target, private resource isolation and access protection first.
 */
export function auditR23CloudflarePreview(input:unknown):R23PreviewPreflight{
 const reasons:string[]=[];
 const x=ownPlain(input);
 if(!x)reasons.push('SNAPSHOT_SHAPE_OR_UNEXPECTED_FIELD');
 else {
  if(x.root_directory!=='/')reasons.push('ROOT_DIRECTORY_NOT_REPO_ROOT');
  if(x.config_path!==R23_PREVIEW_EXPECTED_CONFIG)
   reasons.push('CONFIG_PATH_NOT_ISOLATED');
  if(x.preview_command!==R23_PREVIEW_EXPECTED_COMMAND)
   reasons.push('PREVIEW_COMMAND_MISSING_EXPLICIT_CONFIG');
  if(!atLeastPreviewVersion(x.wrangler_version))
   reasons.push('WRANGLER_PREVIEW_MIN_VERSION_NOT_MET');
  if(typeof x.worker_name!=='string'||!NAME.test(x.worker_name))
   reasons.push('WORKER_MUST_BE_NEW_ISOLATED_POC');
  if(typeof x.target_branch!=='string'||!BRANCH.test(x.target_branch))
   reasons.push('BRANCH_MUST_BE_NEW_UNWATCHED_AI4_R23');
  if(!Array.isArray(x.branch_includes)||x.branch_includes.length!==1||
   x.branch_includes[0]!==x.target_branch)
   reasons.push('TRIGGER_MUST_TARGET_ONLY_ISOLATED_BRANCH');
  const name=typeof x.worker_name==='string'?x.worker_name:'';
  if(!configEligible(x.config_text,name))
   reasons.push('PREVIEWS_SECTION_OR_SAFE_BINDINGS_MISSING');
 }
 return Object.freeze({
  contract:R23_PREVIEW_AUDIT_VERSION,
  state:reasons.length===0?'CONFIG_CANDIDATE_ONLY':'BLOCKED',
  reasons:Object.freeze(reasons),
  requires_human_cloudflare_approval:true,requires_cost_and_access_review:true,
  config_path:R23_PREVIEW_EXPECTED_CONFIG,
  suggested_command:R23_PREVIEW_EXPECTED_COMMAND,
  may_mutate_trigger:false,may_run_build:false,may_create_preview:false,
  may_deploy_production:false,may_bind_real_d1:false,may_use_paid_services:false,
  rollback:'NO_LIVE_CHANGE_CLOSE_DRAFT_ONLY'
 });
}
