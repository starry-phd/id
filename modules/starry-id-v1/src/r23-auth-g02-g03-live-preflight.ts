/**
 * AI-1 R23 G02/G03 controlled-test prerequisite scanner.
 * Inspects repository bytes ONLY: no network, secrets, signer, D1 connection,
 * store login, deployment, or capability to mark a release gate passed.
 */
export const R23_AUTH_LIVE_PREFLIGHT_SCHEMA='starry.auth.r23.g02-g03.preflight.v1' as const;
export const R23_AUTH_LIVE_VERIFIED=false as const;
type Gate='G02-OIDC'|'G03-SESSION-D1'|'R23_RELEASE';
type Observation='repo_missing'|'repo_candidate_only'|'unverified_live'|
 'owner_approval_missing'|'manifest_inconsistent';
type Blocker=Readonly<{id:string;gate:Gate;owner:'AI-1'|'AI-4'|'AI-0';
 observed:Observation;required:string}>;
export type R23AuthReadinessReport=Readonly<{
 schema_version:typeof R23_AUTH_LIVE_PREFLIGHT_SCHEMA;
 source:'git_repo_files_only';status:'blocked';
 observed_g02:'blocked'|'invalid_or_unverified';
 observed_g03:'blocked'|'invalid_or_unverified';
 manifest_safe_to_assert_blocked:boolean;
 code_exists:boolean;staging_auth_d1_declared:boolean;
 protected_auth_route_declared:boolean;
 verified_live:false;can_authenticate_live:false;can_create_session:false;
 can_revoke_session_live:false;can_grant_private_access:false;
 can_deploy:false;can_approve_release:false;no_external_data_processed:true;
 blockers:readonly Blocker[];
}>;
export type R23AuthPreflightInput=Readonly<{
 releaseReadiness:unknown;
 workerToml:unknown;
 apiSource:unknown;
 oidcSource:unknown;
 signedRequestBoundarySource:unknown;
 sessionPersistenceSource:unknown;
}>;
const REQUIRED_GATES=[
 'G00-SSOT','G01-ISOLATION','G02-OIDC','G03-SESSION-D1',
 'G04-STORE','G05-BILLING-D1','G06-P05','G07-AUDIT-QUEUE',
 'G08-WORKER-SDK','G09-DEVICES','G10-OPS'
] as const;
const prop=(v:unknown,key:string):unknown=>{
 try{return v&&typeof v==='object'?
  Object.getOwnPropertyDescriptor(v,key)?.value:undefined;}
 catch{return undefined;}
};
function gate(raw:unknown,id:string):boolean{
 if(!Array.isArray(raw))return false;
 const found=raw.filter(x=>prop(x,'id')===id);
 return found.length===1&&prop(found[0],'status')==='blocked'&&
  prop(found[0],'owner')==='AI-1'&&
  prop(found[0],'verified_by')===null&&
  prop(found[0],'approval_record_url')===null;
}
/** Strip TOML comments and inspect ONLY active staging declarations; NOT provider evidence. */
function staging(text:unknown):string{
 if(typeof text!=='string'||text.length>200000)return '';
 const clean=text.split(/\r?\n/).map(line=>line.split('#',1)[0].trim());
 const result:string[]=[];let enabled=false;
 for(const line of clean){
  if(/^\[+(?!\[?\s*$)[^\]]+\]+$/.test(line)){
   const name=line.replace(/^\[+|\]+$/g,'').trim();
   enabled=name==='env.staging'||name.startsWith('env.staging.');
  }
  if(enabled&&line)result.push(line);
 }
 return result.join('\n');
}
function safeManifest(raw:unknown):boolean{
 const g=prop(raw,'gates');
 if(!Array.isArray(g)||g.length!==REQUIRED_GATES.length)return false;
 if(REQUIRED_GATES.some(id=>g.filter(x=>prop(x,'id')===id).length!==1))return false;
 if(g.some(x=>prop(x,'status')!=='blocked'))return false;
 const owner=prop(raw,'release_authorization');
 const deploy=prop(raw,'deployment_automation');
 return prop(owner,'granted')===false
  &&prop(owner,'owner_approval_record_url')===null
  &&prop(deploy,'enabled')===false
  &&prop(deploy,'can_auto_deploy')===false
  &&gate(g,'G02-OIDC')&&gate(g,'G03-SESSION-D1');
}
function codeHas(source:unknown,patterns:RegExp[]):boolean{
 return typeof source==='string'&&source.length<300000
  &&patterns.every(p=>p.test(source));
}
function b(id:string,gate:Gate,owner:Blocker['owner'],
 observed:Observation,required:string):Blocker{
 return Object.freeze({id,gate,owner,observed,required});
}
/** Even if fake source/config/manifest claims pass, this is NEVER a live attestor. */
export function inspectR23AuthLiveReadiness(input:R23AuthPreflightInput):R23AuthReadinessReport{
 const gates=prop(input?.releaseReadiness,'gates');
 const g02=gate(gates,'G02-OIDC'),g03=gate(gates,'G03-SESSION-D1');
 const blocked=safeManifest(input?.releaseReadiness);
 const oidc=codeHas(input?.oidcSource,[
  /export async function verifySignedOidcIdToken\(/,
  /export async function verifyPkceS256\(/,
  /export function createVerifiedOidcCallback\(/
 ]);
 const signed=codeHas(input?.signedRequestBoundarySource,[
  /export function createOfflineStarryRequestAuthBoundary\(/,
  /createVerifiedSignedSession/,/createStarryD1Port/,
  /createServerIdentityResolver/,/R23_HTTP_AUTH_LIVE_ENABLED=false/
 ]);
 const persisted=codeHas(input?.sessionPersistenceSource,[
  /export function createStarrySessionPersistence\(/,
  /rotateRefreshCAS/,/bumpMemberVersionCAS/,
  /createForExistingMember/
 ]);
 const exists=oidc&&signed&&persisted;
 const stage=staging(input?.workerToml);
 const declared=/\[\[env\.staging\.d1_databases\]\]/.test(stage)
  &&/^\s*binding\s*=\s*["'][A-Za-z][A-Za-z0-9_]{0,63}["']\s*$/m.test(stage)
  &&/^\s*database_name\s*=\s*["'][^"']+["']\s*$/m.test(stage);
 // Source scanning does NOT establish that a route is really deployed or protected.
 const route=codeHas(input?.apiSource,[
  /export function handleRequest\(/,
  /createOfflineStarryRequestAuthBoundary/,
  /authenticate\(request,/
 ]);
 const blockers:Blocker[]=[];
 if(!blocked)blockers.push(b('G02_G03_MANIFEST_INVALID_OR_UNSAFE','R23_RELEASE','AI-0',
  'manifest_inconsistent','Restore official 11/11 blocked and owner deployment authorization=false; confirm authoritative signed decision independently'));
 if(!oidc)blockers.push(b('OIDC_CRYPTO_SOURCE_MISSING','G02-OIDC','AI-1',
  'repo_missing','Review signed Apple/Google ID token + PKCE/state/nonce offline implementation'));
 if(!signed||!persisted)blockers.push(b('AUTH_SESSION_SOURCE_MISSING','G03-SESSION-D1','AI-1',
  'repo_missing','Review current signed Bearer, Member/Session/provider link, refresh CAS and auth_version source'));
 if(!declared)blockers.push(b('STAGING_AUTH_D1_NOT_CONFIGURED','G03-SESSION-D1','AI-4',
  'repo_missing','Separate explicitly approved disposable staging Auth D1; migration, binding, negative read-after-write/revoke evidence'));
 else blockers.push(b('STAGING_D1_REAL_CAS_UNVERIFIED','G03-SESSION-D1','AI-1',
  'unverified_live','Record actual isolated D1 member/Session version CAS, revoke, rollback and restored snapshot regression'));
 if(!route)blockers.push(b('PROTECTED_AUTH_API_NOT_WIRED','G03-SESSION-D1','AI-4',
  'repo_missing','Approved protected Auth route and per-request backend verifier; /v1/health is liveness-only'));
 else blockers.push(b('AUTH_ROUTE_REAL_TRAFFIC_UNVERIFIED','G03-SESSION-D1','AI-4',
  'unverified_live','Independently verify protected route, real Workers config, AppRegistry and auth denial in authorized staging'));
 blockers.push(
  b('OFFICIAL_OIDC_PROVIDER_JWKS_UNVERIFIED','G02-OIDC','AI-1',
   'unverified_live','Approve Apple/Google issuer/audience; read-only official JWKS trust chain, key rotation, kid unknown/stale and alg pinning checks'),
  b('OIDC_CODE_EXCHANGE_NOT_SANDBOX_VERIFIED','G02-OIDC','AI-1',
   'unverified_live','Isolated real provider authorization-code PKCE/state/nonce one-time CAS, redirect allowlist, replay and logout tests after approval'),
  b('MANAGED_SESSION_KID_SECRETS_NOT_APPROVED','G03-SESSION-D1','AI-0',
   'owner_approval_missing','Separate KMS/managed secret access, rotation/retirement, fail-closed key outage, no secret in logs/repo'),
  b('REAL_SESSION_REVOKE_AND_RESTORE_NOT_VERIFIED','G03-SESSION-D1','AI-1',
   'unverified_live','Actual physical D1 CAS, concurrent replay, expire/suspend/delete, PITR nonrollback witness across app/environment'),
  b('LAW_Q104_Q119_AND_PHYSICAL_87_NOT_APPROVED','R23_RELEASE','AI-0',
   'owner_approval_missing','Lawful retention/consent/HMAC provenance and #87 physical D1 split selection before processing personal records'),
  b('P05_SIGNED_SINGLE_SOURCE_AND_ACK_NOT_VERIFIED','R23_RELEASE','AI-0',
   'owner_approval_missing','Unique signed P05 issuer, durable Queue ACK-after-commit and independent recovery witness'),
  b('G02_G03_OWNER_RELEASE_APPROVAL_MISSING','R23_RELEASE','AI-0',
   'owner_approval_missing','Human-approved live synthetic staging environment and independent Gate evidence before deployment')
 );
 return Object.freeze({
  schema_version:R23_AUTH_LIVE_PREFLIGHT_SCHEMA,
  source:'git_repo_files_only',status:'blocked',
  observed_g02:g02?'blocked':'invalid_or_unverified',
  observed_g03:g03?'blocked':'invalid_or_unverified',
  manifest_safe_to_assert_blocked:blocked,
  code_exists:exists,staging_auth_d1_declared:declared,
  protected_auth_route_declared:route,verified_live:false,
  can_authenticate_live:false,can_create_session:false,
  can_revoke_session_live:false,can_grant_private_access:false,
  can_deploy:false,can_approve_release:false,no_external_data_processed:true,
  blockers:Object.freeze(blockers)
 });
}
