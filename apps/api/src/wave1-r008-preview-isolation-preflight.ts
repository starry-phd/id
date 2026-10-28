/**
 * AI-4 R008: fail-closed static PREVIEW PROPOSAL review only.
 * NOT a Wrangler parser, authorization evidence, live Cloudflare query,
 * trusted binding inspector, signed attestation or deploy action.
 * Never call Cloudflare, subprocesses or inspect secrets from this module.
 */
export const R008_VERSION=
  'starry.ai4.r008.cloudflare-preview-isolation.offline-preflight.v1' as const;
export const R008_LIMITS=Object.freeze({
  worker:'id-starry',
  repository:'starry-phd/id',
  preview_command:'npx wrangler preview --config apps/api/wrangler.toml',
  config_path:'apps/api/wrangler.toml',
  required_environment:'preview',
  max_config_characters:16384,
  preview_builds_enabled:false,
  production_auto_builds_enabled:false,
  preview_deploy_authorized:false,
  external_test_resources_authorized:false,
  release_authorized:false,
  ads_enabled:false
} as const);
export type R008PreviewDenialReason=
 'INVALID_INPUT'|'SCOPE_DENIED'|'UNSAFE_PREVIEW_COMMAND'|
 'UNREVIEWED_BINDING_OR_ROUTE'|'PREVIEW_CONFIG_INCOMPLETE'|
 'SEPARATE_OWNER_AUTHORIZATION_REQUIRED';
export type R008Review=Readonly<{
 version:typeof R008_VERSION;
 state:'blocked'; reason:R008PreviewDenialReason;
 proposal_shape_reviewed:boolean;
 assessment:'offline_static_only_not_wrangler_validation';
 may_reenable_preview:false;may_create_preview:false;
 may_deploy:false;may_bind_resource:false;
 may_ack_queue:false;may_send:false;may_grant:false;
 may_initialize_ads:false;publishable:false;
}>;
const SAFETY=Object.freeze({
 assessment:'offline_static_only_not_wrangler_validation',
 may_reenable_preview:false,may_create_preview:false,may_deploy:false,
 may_bind_resource:false,may_ack_queue:false,may_send:false,may_grant:false,
 may_initialize_ads:false,publishable:false
} as const);
function denied(reason:R008PreviewDenialReason,shape=false):R008Review{
 return Object.freeze({
  version:R008_VERSION,state:'blocked',reason,
  proposal_shape_reviewed:shape,...SAFETY
 });
}
/** Descriptors only; never trigger arbitrary getter or proxy member access. */
function plainData(raw:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(raw===null||typeof raw!=='object'||Array.isArray(raw))return null;
  const proto=Object.getPrototypeOf(raw);
  if(proto!==Object.prototype&&proto!==null)return null;
  const own=Reflect.ownKeys(raw);
  if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))return null;
  const parsed:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of keys){
   const desc=Object.getOwnPropertyDescriptor(raw,key);
   if(!desc||!desc.enumerable||!('value' in desc))return null;
   parsed[key]=desc.value;
  }
  return parsed;
 }catch{return null;}
}
/**
 * Conservative non-authoritative text scanning rejects suspicious scope.
 * A positive shape review NEVER attests Cloudflare config validity/isolation.
 */
export function reviewR008PreviewProposal(raw:unknown):R008Review{
 const p=plainData(raw,['worker','repository','config_path','preview_command',
  'preview_config_text','requested_binding_names']);
 if(!p)return denied('INVALID_INPUT');
 if(p.worker!==R008_LIMITS.worker||p.repository!==R008_LIMITS.repository)
  return denied('SCOPE_DENIED');
 if(p.config_path!==R008_LIMITS.config_path||
   p.preview_command!==R008_LIMITS.preview_command)
  return denied('UNSAFE_PREVIEW_COMMAND');
 let bindingsEmpty=false;
 try{
  bindingsEmpty=Array.isArray(p.requested_binding_names)&&
    p.requested_binding_names.length===0&&
    Reflect.ownKeys(p.requested_binding_names).length===1;
 }catch{return denied('UNREVIEWED_BINDING_OR_ROUTE');}
 if(!bindingsEmpty)return denied('UNREVIEWED_BINDING_OR_ROUTE');
 if(typeof p.preview_config_text!=='string'||
   p.preview_config_text.length<10||
   p.preview_config_text.length>R008_LIMITS.max_config_characters)
  return denied('INVALID_INPUT');
 const conf=p.preview_config_text;
 // Reject ANY resource, env override, production route or dangerous secret.
 // This is a conservative denylist for an OFFLINE plan, not a TOML parser.
 if(/(?:d1_databases|r2_buckets|queues|services|service_bindings|durable_objects|kv_namespaces|unsafe|secrets|secrets_store|production|routes|route\s*=|cron|triggers|workflows|hyperdrive|ai_gateway|send_email|browser|dispatch_namespaces|containers)/i.test(conf))
  return denied('UNREVIEWED_BINDING_OR_ROUTE');
 if(!/^\[previews\]$/m.test(conf)||
   !/^\[previews\.vars\]$/m.test(conf)||
   !/^STARRY_ENVIRONMENT\s*=\s*"preview"\s*$/m.test(conf)||
   !/^STARRY_APP_ID\s*=\s*"starry-id"\s*$/m.test(conf))
  return denied('PREVIEW_CONFIG_INCOMPLETE');
 return denied('SEPARATE_OWNER_AUTHORIZATION_REQUIRED',true);
}
