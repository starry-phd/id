/**
 * AI-3 Round5: manual replay review-only projection.
 * NO requeue/ack, no grants, no wallet/rights change, no Cloudflare client.
 * Manual approvals/retention must be explicitly authorized by AI-0 and AI-1.
 */
import {assertScope} from './index.ts';
import type {Scope} from './index.ts';
const KEY=/^b_[a-f0-9]{64}$/;
const REASON=/^[A-Z][A-Z0-9_]{2,71}$/;
const REQUIRED=Object.freeze([
 'AI0_APPROVED_EVENT_REPLAY_POLICY',
 'AI1_FRESH_CURRENT_ADMIN_GRANT_AND_STEP_UP',
 'INDEPENDENT_HUMAN_APPROVAL_AUDIT',
 'REVALIDATE_AI2_COMMITTED_SOURCE',
 'AI3_INBOX_AND_QUEUE_DUPLICATE_SAFETY',
] as const);
export type PersistedReplayEvidence=Readonly<{
 event_ref:string;reason_code:string;
}>;
export type ReplayEvidenceReader=Readonly<{
 readPersistedQuarantineOrDlq:(scope:Scope,ref:string)=>Promise<unknown>;
}>;
export type ReplayReviewResult=Readonly<{
 status:'blocked'|'review_only';
 event_ref:string|null;reason_code:string|null;
 required_approvals:readonly string[];
 enqueue_permitted:false;
}>;
function exactEvidence(value:unknown,ref:string):value is PersistedReplayEvidence{
 try{
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  if(proto!==Object.prototype&&proto!==null)return false;
  const keys=Reflect.ownKeys(value);
  if(keys.length!==2||keys.some(k=>k!=='event_ref'&&k!=='reason_code'))return false;
  const props=keys.map(k=>Object.getOwnPropertyDescriptor(value,k));
  if(props.some(p=>!p||!p.enumerable||!('value' in p)))return false;
  const v=value as Record<string,unknown>;
  return v.event_ref===ref&&typeof v.reason_code==='string'&&REASON.test(v.reason_code);
 }catch{return false;}
}
export function createManualReplayReviewOnly(scope:Scope,reader:ReplayEvidenceReader){
 assertScope(scope,scope);
 if(scope.environment==='production')
  throw new Error('AI3_REPLAY_DRAFT_ONLY');
 const blocked=(ref:string|null):ReplayReviewResult=>Object.freeze({
  status:'blocked',event_ref:ref,reason_code:null,
  required_approvals:REQUIRED,enqueue_permitted:false,
 });
 return Object.freeze({
  async inspect(ref:unknown):Promise<ReplayReviewResult>{
   if(typeof ref!=='string'||!KEY.test(ref))return blocked(null);
   let evidence:unknown;
   try{evidence=await reader.readPersistedQuarantineOrDlq(scope,ref);}
   catch{return blocked(ref);}
   if(!exactEvidence(evidence,ref))return blocked(ref);
   return Object.freeze({
    status:'review_only',event_ref:ref,reason_code:evidence.reason_code,
    required_approvals:REQUIRED,enqueue_permitted:false as const,
   });
  },
 });
}
