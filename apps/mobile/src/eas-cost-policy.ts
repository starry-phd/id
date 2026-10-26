/** DEV-I 2026-10-26 approved EAS Free cost-control rules.
 * This is a pure decision/evidence planner, never invokes EAS APIs or builds.
 */
export type Platform='ios'|'android'|'web';
export type EasOperation='build'|'update'|'workflow';
export type ReleaseEvidence=Readonly<{
 brand_id:'starry';app_id:'starry-id';platform:Platform;
 environment:'development'|'staging'|'production';
 repo:'starry-phd/id';pr:number|null;commit_sha:string;
 trigger_reason:string;operation:EasOperation;runtime_version:string|null;
 eas_build_id:string|null;eas_update_id:string|null;
 quota_units:number|null;estimated_usd:number|null;
 actual_billed_usd:number|null;billing_source:string|null;
 status:'not_started'|'candidate'|'completed';
}>;
export function planUnapprovedEasOperation(input:unknown):Readonly<{
 approved:false;execution_allowed:false;reason:'EXPLICIT_OWNER_APPROVAL_REQUIRED';evidence:ReleaseEvidence
}> {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('EAS_INVALID_EVIDENCE');
 const e=input as Record<string,unknown>;
 const allowed=['brand_id','app_id','platform','environment','repo','pr',
  'commit_sha','trigger_reason','operation','runtime_version'];
 if(Reflect.ownKeys(e).length!==allowed.length
   ||Reflect.ownKeys(e).some(k=>typeof k!=='string'||!allowed.includes(k)))throw new Error('EAS_INVALID_EVIDENCE');
 if(e.brand_id!=='starry'||e.app_id!=='starry-id'||e.repo!=='starry-phd/id'
  ||!['ios','android','web'].includes(String(e.platform))
  ||!['development','staging','production'].includes(String(e.environment))
  ||!['build','update','workflow'].includes(String(e.operation))
  ||!(e.pr===null||(typeof e.pr==='number'&&Number.isSafeInteger(e.pr)&&e.pr>0))
  ||typeof e.commit_sha!=='string'||!/^[a-f0-9]{40}$/.test(e.commit_sha)
  ||typeof e.trigger_reason!=='string'||e.trigger_reason.trim().length<5||e.trigger_reason.length>180
  ||!(e.runtime_version===null||(typeof e.runtime_version==='string'&&e.runtime_version.length>0&&e.runtime_version.length<128)))
  throw new Error('EAS_INVALID_EVIDENCE');
 return Object.freeze({approved:false as const,execution_allowed:false as const,
  reason:'EXPLICIT_OWNER_APPROVAL_REQUIRED' as const,
  evidence:Object.freeze({...e,brand_id:'starry' as const,app_id:'starry-id' as const,
   repo:'starry-phd/id' as const,platform:e.platform as Platform,
   environment:e.environment as ReleaseEvidence['environment'],operation:e.operation as EasOperation,
   pr:e.pr as number|null,commit_sha:e.commit_sha as string,trigger_reason:e.trigger_reason as string,
   runtime_version:e.runtime_version as string|null,
   eas_build_id:null,eas_update_id:null,quota_units:null,
   estimated_usd:null,actual_billed_usd:null,billing_source:null,
   status:'not_started' as const})});
}
