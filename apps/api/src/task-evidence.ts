/**
 * AI-4 R8: INTERNAL/OFFLINE ONLY adapter for AI-3 TrustedAuthority task ports.
 * The provider MUST be wired by a trusted SERVER composition root to an atomic,
 * committed task store. No network, Worker route, public SDK export or live D1.
 * Test fakes used here are NOT proof of a real task or eligible Battery grant.
 */
export const TASK_EVIDENCE_SCHEMA='starry.task-proof.v0-draft' as const;
export const LIVE_TASK_PROOF_ENABLED=false as const;
export const OFFLINE_TEST_PORT_ONLY=true as const;
export type TaskScope=Readonly<{brand_id:'starry';member_ref:string}>;
export type TaskRate=Readonly<{app_id:string;task_type:string;price:number;version:number}>;
export type BatteryRatePolicy=Readonly<{
 brand_id:'starry';version:number;registration_grant:number;first_task_grant:number;
 max_debt:number;max_task_cost:number;rates:readonly TaskRate[];
}>;
export type TaskEvidence=Readonly<{
 schema_version:typeof TASK_EVIDENCE_SCHEMA;
 brand_id:'starry';member_ref:string;task_ref:string;app_id:string;task_type:string;
 policy_version:number;rate_version:number;price:number;
 request_state:'accepted'|'succeeded'|'failed';
 proof_state:'committed';proof_source:'server_task_engine';
 proof_revision:number;completed_at:number|null;
}>;
export type ServerTaskEvidenceSource=Readonly<{
 readTask:(ref:string)=>Promise<unknown>;
 readPolicy:()=>Promise<unknown>;
 readFirstSuccessfulTask:(memberRef:string)=>Promise<unknown>;
}>;
export type BatteryTaskAuthorityPort=Readonly<{
 authorizePolicy:(candidate:BatteryRatePolicy)=>Promise<boolean>;
 verifyTaskRequest:(scope:TaskScope,ref:string,app:string,type:string)=>Promise<boolean>;
 verifyTaskOutcome:(scope:TaskScope,ref:string,result:'success'|'failure')=>Promise<boolean>;
 verifyFirstEligibleTask:(scope:TaskScope,ref:string)=>Promise<boolean>;
}>;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const TASK_FIELDS=['schema_version','brand_id','member_ref','task_ref','app_id','task_type',
 'policy_version','rate_version','price','request_state','proof_state','proof_source',
 'proof_revision','completed_at'] as const;
const POLICY_FIELDS=['brand_id','version','registration_grant','first_task_grant','max_debt',
 'max_task_cost','rates'] as const;
const RATE_FIELDS=['app_id','task_type','price','version'] as const;
const SCOPE_FIELDS=['brand_id','member_ref'] as const;
const SOURCE_FIELDS=['readTask','readPolicy','readFirstSuccessfulTask'] as const;
const integer=(v:unknown,min=0)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const ident=(v:unknown):v is string=>typeof v==='string'&&ID.test(v);
/** Clone ONLY exact own data properties. Reject accessors, prototypes and Proxies. */
function flat(value:unknown,fields:readonly string[]):Record<string,unknown>|null {
 if(!value||typeof value!=='object')return null;
 try {
  if(Array.isArray(value))return null;
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null)return null;
  const keys=Reflect.ownKeys(value);
  if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)))
   return null;
  const result:Record<string,unknown>=Object.create(null) as Record<string,unknown>;
  for(const key of fields){
   const d=Object.getOwnPropertyDescriptor(value,key);
   if(!d||d.enumerable!==true||!Object.prototype.hasOwnProperty.call(d,'value'))
    return null;
   result[key]=d.value;
  }
  return result;
 } catch {return null;}
}
function plainArray(value:unknown):unknown[]|null{
 try {
  if(!Array.isArray(value)||value.length===0||value.length>256)return null;
  if(Object.getPrototypeOf(value)!==Array.prototype)return null;
  const keys=Reflect.ownKeys(value);
  if(keys.length!==value.length+1)return null;
  const items:unknown[]=[];
  for(let i=0;i<value.length;i++){
   const d=Object.getOwnPropertyDescriptor(value,String(i));
   if(!d||!Object.prototype.hasOwnProperty.call(d,'value'))return null;
   items.push(d.value);
  }
  return items;
 }catch{return null;}
}
function scopeCheck(scope:unknown):TaskScope|null{
 const s=flat(scope,SCOPE_FIELDS);
 return s?.brand_id==='starry'&&ident(s.member_ref)
  ?{brand_id:'starry',member_ref:s.member_ref}:null;
}
function normalizePolicy(value:unknown):BatteryRatePolicy|null{
 const p=flat(value,POLICY_FIELDS);
 if(!p||p.brand_id!=='starry'||!integer(p.version,1)||
  !integer(p.registration_grant)||!integer(p.first_task_grant)||
  !integer(p.max_debt)||!integer(p.max_task_cost,1))return null;
 const rates=plainArray(p.rates);
 if(!rates)return null;
 const seen=new Set<string>();const valid:TaskRate[]=[];
 for(const original of rates){
  const r=flat(original,RATE_FIELDS);
  if(!r||!ident(r.app_id)||!ident(r.task_type)||!integer(r.price,1)||
   !integer(r.version,1)||(r.price as number)>(p.max_task_cost as number))return null;
  const key=r.app_id+'|'+r.task_type;
  if(seen.has(key))return null;
  seen.add(key);
  valid.push({app_id:r.app_id,task_type:r.task_type,
   price:r.price as number,version:r.version as number});
 }
 valid.sort((a,b)=>a.app_id.localeCompare(b.app_id)||a.task_type.localeCompare(b.task_type));
 return {brand_id:'starry',version:p.version as number,
  registration_grant:p.registration_grant as number,
  first_task_grant:p.first_task_grant as number,max_debt:p.max_debt as number,
  max_task_cost:p.max_task_cost as number,rates:valid};
}
function normalizeProof(value:unknown):TaskEvidence|null{
 const p=flat(value,TASK_FIELDS);
 if(!p||p.schema_version!==TASK_EVIDENCE_SCHEMA||p.brand_id!=='starry'||
  !ident(p.member_ref)||!ident(p.task_ref)||!ident(p.app_id)||!ident(p.task_type)||
  !integer(p.policy_version,1)||!integer(p.rate_version,1)||!integer(p.price,1)||
  !integer(p.proof_revision,1)||p.proof_state!=='committed'||
  p.proof_source!=='server_task_engine'||
  !['accepted','succeeded','failed'].includes(String(p.request_state)))return null;
 if(p.request_state==='accepted'&&p.completed_at!==null)return null;
 if(p.request_state!=='accepted'&&!integer(p.completed_at))return null;
 return {
  schema_version:TASK_EVIDENCE_SCHEMA,brand_id:'starry',
  member_ref:p.member_ref,task_ref:p.task_ref,app_id:p.app_id,task_type:p.task_type,
  policy_version:p.policy_version as number,rate_version:p.rate_version as number,
  price:p.price as number,request_state:p.request_state as TaskEvidence['request_state'],
  proof_state:'committed',proof_source:'server_task_engine',
  proof_revision:p.proof_revision as number,completed_at:p.completed_at as number|null
 };
}
/**
 * Offline adapter only. This validates a provider-returned committed record,
 * not a self-signed client flag. A real app requires AI-1 trusted session and
 * an atomic task-store query/receipt approved through AI-0 Gate.
 */
export function createOfflineServerTaskAuthority(source:ServerTaskEvidenceSource):BatteryTaskAuthorityPort {
 const s=flat(source,SOURCE_FIELDS);
 if(!s||SOURCE_FIELDS.some(k=>typeof s[k]!=='function'))
  throw Error('AI4_TASK_SOURCE_REQUIRED');
 const safe=async<T>(f:()=>Promise<T>):Promise<T|null>=>{
  try{return await f();}catch{return null;}
 };
 const policy=async()=>normalizePolicy(await safe(()=>source.readPolicy()));
 const read=async(scope:unknown,ref:unknown)=>{
  const sc=scopeCheck(scope);
  if(!sc||!ident(ref))return null;
  const task=normalizeProof(await safe(()=>source.readTask(ref)));
  const approved=await policy();
  if(!task||!approved||task.member_ref!==sc.member_ref||
   task.task_ref!==ref||task.policy_version!==approved.version)return null;
  const rate=approved.rates.find(r=>r.app_id===task.app_id&&r.task_type===task.task_type);
  if(!rate||rate.version!==task.rate_version||rate.price!==task.price)return null;
  return task;
 };
 const ports:BatteryTaskAuthorityPort={
  async authorizePolicy(candidate){
   const expected=await policy(),submitted=normalizePolicy(candidate);
   return !!(expected&&submitted&&JSON.stringify(expected)===JSON.stringify(submitted));
  },
  async verifyTaskRequest(scope,ref,app,type){
   if(!ident(app)||!ident(type))return false;
   const task=await read(scope,ref);
   return !!(task&&task.app_id===app&&task.task_type===type&&
    task.request_state==='accepted');
  },
  async verifyTaskOutcome(scope,ref,result){
   if(result!=='success'&&result!=='failure')return false;
   const task=await read(scope,ref);
   return !!(task&&task.request_state===(result==='success'?'succeeded':'failed')&&
    task.completed_at!==null);
  },
  async verifyFirstEligibleTask(scope,ref){
   const sc=scopeCheck(scope);
   if(!sc||!ident(ref))return false;
   const task=await read(sc,ref);
   if(!task||task.request_state!=='succeeded')return false;
   const first=await safe(()=>source.readFirstSuccessfulTask(sc.member_ref));
   return first===ref;
  }
 };
 return Object.freeze(ports);
}
