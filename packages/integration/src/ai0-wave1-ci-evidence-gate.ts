/**
 * AI-0 Wave1: classifies an explicitly supplied, read-only GitHub CI snapshot.
 * No network access, token, deployment capability, or trust attestation here.
 * This v1 gate NEVER authorizes a merge, Store action or Production.
 */
export const AI0_WAVE1_EVIDENCE_SCHEMA='starry.ai0.wave1.offline-ci-evidence.v1' as const;
export const AI0_WAVE1_EXPECTED_WORKFLOWS=Object.freeze([
 'AI-0 Current Complete Offline Integration Gate (release BLOCKED)',
 'AI-1 Rebuild Starry ID v1',
 'Rebuild Starry Billing Sandbox (AI-2)'
] as const);
type OfflineState='verified'|'unverified';
type ExternalState='pass'|'fail'|'pending'|'unknown';
type EvidenceResult=Readonly<{
 schema_version:typeof AI0_WAVE1_EVIDENCE_SCHEMA;
 expected_sha:string|null;
 offline_gate:OfflineState;
 external_worker_build:ExternalState;
 reasons:readonly string[];
 exact_sha_offline_ci_verified:boolean;
 independent_external_check_verified:boolean;
 contract_gate:'blocked';
 store_sandbox_gate:'blocked';
 release_gate:'blocked';
 may_merge_main:false;
 may_deploy:false;
 may_open_store:false;
 may_grant_entitlement:false;
 may_ack_queue:false;
 live:false;
}>;
const SHA=/^[0-9a-f]{40}$/;
function record(value:unknown,keys:readonly string[]):Record<string,unknown>|null{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return null;
  if(Reflect.ownKeys(value).length!==keys.length)return null;
  const out:Record<string,unknown>=Object.create(null);
  for(const key of keys){
   const d=Object.getOwnPropertyDescriptor(value,key);
   if(!d?.enumerable||!('value' in d))return null;
   out[key]=d.value;
  }
  return out;
 }catch{return null;}
}
function output(sha:string|null,offline:OfflineState,external:ExternalState,errs:string[]):EvidenceResult{
 return Object.freeze({
  schema_version:AI0_WAVE1_EVIDENCE_SCHEMA,
  expected_sha:sha,
  offline_gate:offline,
  external_worker_build:external,
  reasons:Object.freeze([...new Set(errs)]),
  exact_sha_offline_ci_verified:offline==='verified',
  independent_external_check_verified:external==='pass',
  contract_gate:'blocked' as const,
  store_sandbox_gate:'blocked' as const,
  release_gate:'blocked' as const,
  may_merge_main:false as const,
  may_deploy:false as const,
  may_open_store:false as const,
  may_grant_entitlement:false as const,
  may_ack_queue:false as const,
  live:false as const
 });
}
/**
 * Input is a CI observation snapshot, NOT a signed attestation.
 * Caller must obtain actual workflow/check-run records from GitHub API.
 * A successful offline gate says nothing about Cloudflare Preview or Store.
 */
export function evaluateAi0Wave1Evidence(input:unknown):EvidenceResult{
 const root=record(input,['expected_sha','workflows','external_check']);
 const sha=root&&typeof root.expected_sha==='string'&&SHA.test(root.expected_sha)
  ?root.expected_sha:null;
 if(!root||!sha)return output(null,'unverified','unknown',['INVALID_OR_UNTRUSTED_SNAPSHOT']);
 const reasons:string[]=[];
 let offline:OfflineState='unverified';
 if(!Array.isArray(root.workflows)||root.workflows.length!==AI0_WAVE1_EXPECTED_WORKFLOWS.length){
  reasons.push('MISSING_OR_EXTRA_WORKFLOWS');
 }else{
  const found=new Set<string>();
  const ids=new Set<number>();
  let valid=true;
  for(const raw of root.workflows){
   const item=record(raw,['name','head_sha','id','status','conclusion']);
   if(!item||typeof item.name!=='string'||
      !AI0_WAVE1_EXPECTED_WORKFLOWS.some(name=>name===item.name)||
      found.has(item.name)||
      typeof item.id!=='number'||!Number.isSafeInteger(item.id)||item.id<=0||
      ids.has(item.id)){
    reasons.push('UNKNOWN_OR_DUPLICATE_WORKFLOW');valid=false;continue;
   }
   found.add(item.name);ids.add(item.id);
   if(item.head_sha!==sha){reasons.push('WORKFLOW_WRONG_HEAD_SHA');valid=false;}
   if(item.status!=='completed'||item.conclusion!=='success'){
    reasons.push('WORKFLOW_NOT_COMPLETED_SUCCESS');valid=false;
   }
  }
  if(found.size!==AI0_WAVE1_EXPECTED_WORKFLOWS.length){
   reasons.push('MISSING_REQUIRED_WORKFLOW');valid=false;
  }
  if(valid)offline='verified';
 }
 let external:ExternalState='unknown';
 if(root.external_check===null){reasons.push('EXTERNAL_CHECK_MISSING');}
 else{
  const x=record(root.external_check,['name','head_sha','status','conclusion']);
  if(!x||x.name!=='Workers Builds: id-starry'){
   reasons.push('EXTERNAL_CHECK_INVALID');
  }else if(x.head_sha!==sha){
   reasons.push('EXTERNAL_CHECK_WRONG_HEAD_SHA');
  }else if(x.status==='completed'&&x.conclusion==='success'){
   external='pass';
  }else if(x.status==='completed'&&x.conclusion==='failure'){
   external='fail';reasons.push('CLOUDFLARE_BUILD_FAILED');
  }else if((x.status==='queued'||x.status==='in_progress')
     &&x.conclusion===null){
   external='pending';reasons.push('CLOUDFLARE_BUILD_PENDING');
  }else{
   reasons.push('EXTERNAL_CHECK_NOT_VERIFIED');
  }
 }
 if(offline==='unverified'&&reasons.length===0)reasons.push('OFFLINE_EVIDENCE_INCOMPLETE');
 return output(sha,offline,external,reasons);
}
