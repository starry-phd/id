/**
 * AI-3 R8: Starry-only anonymous appeal evidence contract (Q114).
 * Private Worker/secret/storage adapters have NOT been authorized or wired.
 * No raw attachment/PII, requester OAuth identity, IP or credential persisted.
 */
export const LIVE_ANONYMOUS_APPEALS_ENABLED=false as const;
export type StarryScope=Readonly<{brand_id:'starry';app_id:string;environment:'development'|'staging'}>;
export type Upload=Readonly<{object_ref:string;sha256:string;bytes:number;media_type:string}>;
export type AppealRequest=Readonly<{client_key:string;topic_code:string;uploads:readonly Upload[]}>;
export type SafeAppeal=Readonly<{
 case_ref:string;brand_id:'starry';app_id:string;environment:'development'|'staging';
 client_key:string;topic_code:string;credential_digest:string;
 uploaded_hashes:readonly string[];created_ms:number;status:'received';
}>;
export type SafeCaseStatus=Readonly<{case_ref:string;status:'received'|'reviewing'|'closed';updated_ms:number}>;
export type Receipt=Readonly<{status:'created'|'duplicate';case_ref:string}>;
/** Must be server-only, proven 256-bit unpredictable generation and constant-time checks. */
export type ServerSecrets=Readonly<{
 issue:()=>Promise<Readonly<{case_ref:string;credential:string;credential_digest:string}>>;
 verify:(expected_digest:string,supplied_secret:string)=>Promise<boolean>;
}>;
/** Enforced in trusted Worker composition, not based on client booleans. */
export type SafetyGate=Readonly<{
 limit:(op:'submit'|'lookup')=>Promise<boolean>;
 topicAllowed:(topic_code:string)=>Promise<boolean>;
 scan:(uploads:readonly Upload[])=>Promise<boolean>;
}>;
export type AppealStore=Readonly<{
 findKey:(scope:StarryScope,client_key:string)=>Promise<boolean>;
 atomicCreate:(caseRecord:SafeAppeal)=>Promise<Receipt>;
 status:(scope:StarryScope,case_ref:string)=>Promise<Readonly<{
  case_ref:string;credential_digest:string;status:SafeCaseStatus['status'];
  updated_ms:number;
}>|null>;
}>;
const ID=/^[a-z][A-Za-z0-9._:-]{0,95}$/;
const HEX64=/^[a-f0-9]{64}$/;
const CLIENT=/^a_[a-f0-9]{64}$/;
const CASE=/^case_[a-f0-9]{64}$/;
const TOPIC=/^[A-Z][A-Z0-9_]{2,39}$/;
const ALLOWED_TYPES=new Set(['application/pdf','image/jpeg','image/png']);
const deny=(code:string):never=>{throw new Error('AI3_APPEAL_'+code)};
function record(v:unknown):v is Record<string,unknown>{
 try{
  if(v===null||typeof v!=='object'||Array.isArray(v))return false;
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)return false;
  return Reflect.ownKeys(v).every(k=>{
   const d=Object.getOwnPropertyDescriptor(v,k);
   return typeof k==='string'&&d?.enumerable===true&&'value' in d;
  });
 }catch{return false;}
}
function shape(v:unknown,keys:readonly string[]):v is Record<string,unknown>{
 return record(v)&&Reflect.ownKeys(v).length===keys.length&&
  Reflect.ownKeys(v).every(k=>keys.includes(String(k)));
}
function scopeOk(scope:StarryScope){
 if(!shape(scope,['brand_id','app_id','environment'])||
  scope.brand_id!=='starry'||typeof scope.app_id!=='string'||!ID.test(scope.app_id)||
  !['development','staging'].includes(scope.environment as string))deny('SCOPE_DENIED');
}
function requestOk(v:unknown):v is AppealRequest{
 if(!shape(v,['client_key','topic_code','uploads'])||
  typeof v.client_key!=='string'||!CLIENT.test(v.client_key)||
  typeof v.topic_code!=='string'||!TOPIC.test(v.topic_code)||
  !Array.isArray(v.uploads)||v.uploads.length>3)return false;
 const refs=new Set<string>();
 for(const raw of v.uploads){
  if(!shape(raw,['object_ref','sha256','bytes','media_type'])||
   typeof raw.object_ref!=='string'||!ID.test(raw.object_ref)||
   typeof raw.sha256!=='string'||!HEX64.test(raw.sha256)||
   typeof raw.bytes!=='number'||!Number.isSafeInteger(raw.bytes)||raw.bytes<=0||raw.bytes>10_000_000||
   typeof raw.media_type!=='string'||!ALLOWED_TYPES.has(raw.media_type)||
   refs.has(raw.object_ref))return false;
  refs.add(raw.object_ref);
 }
 return true;
}
function credentialOk(v:unknown):v is {case_ref:string;credential:string;credential_digest:string}{
 return shape(v,['case_ref','credential','credential_digest'])&&
  typeof v.case_ref==='string'&&CASE.test(v.case_ref)&&
  typeof v.credential==='string'&&HEX64.test(v.credential)&&
  typeof v.credential_digest==='string'&&HEX64.test(v.credential_digest);
}
export type SubmissionResult=Readonly<{
 outcome:'created'|'duplicate_no_new_credential';
 case_ref:string|null;
 credential:string|null; // delivered once, NEVER stored/logged in case record
}>;
export function createAnonymousAppeals(scope:StarryScope,gate:SafetyGate,
 secrets:ServerSecrets,store:AppealStore){
 scopeOk(scope);
 return Object.freeze({
  async submit(input:unknown,now:number):Promise<SubmissionResult>{
   if(!Number.isSafeInteger(now)||now<0)deny('MALFORMED');
   if(!requestOk(input))deny('MALFORMED');
   const req:AppealRequest=input;
   if(!gate||typeof gate.limit!=='function'||await gate.limit('submit')!==true)
    deny('RATE_OR_AUTHORITY_DENIED');
   if(typeof gate.topicAllowed!=='function'||await gate.topicAllowed(req.topic_code)!==true)
    deny('TOPIC_NOT_APPROVED');
   if(typeof gate.scan!=='function'||await gate.scan(req.uploads)!==true)
    deny('ATTACHMENT_NOT_CLEARED');
   if(!store||typeof store.findKey!=='function'||typeof store.atomicCreate!=='function')
    deny('STORE_UNAVAILABLE');
   if(await store.findKey(scope,req.client_key)===true)
    return Object.freeze({outcome:'duplicate_no_new_credential',case_ref:null,credential:null});
   if(!secrets||typeof secrets.issue!=='function')deny('PROOF_GATE_MISSING');
   const issued=await secrets.issue();
   if(!credentialOk(issued))deny('SERVER_ENTROPY_UNVERIFIED');
   const caseRecord:SafeAppeal=Object.freeze({
    case_ref:issued.case_ref,brand_id:'starry',app_id:scope.app_id,
    environment:scope.environment,client_key:req.client_key,
    topic_code:req.topic_code,credential_digest:issued.credential_digest,
    uploaded_hashes:Object.freeze(req.uploads.map(x=>x.sha256)),
    created_ms:now,status:'received',
   });
   const receipt=await store.atomicCreate(caseRecord);
   if(!shape(receipt,['status','case_ref'])||receipt.case_ref!==caseRecord.case_ref||
    !['created','duplicate'].includes(receipt.status as string))
    deny('WRITE_RECEIPT_INVALID');
   if(receipt.status==='duplicate')
    return Object.freeze({outcome:'duplicate_no_new_credential',case_ref:null,credential:null});
   return Object.freeze({outcome:'created',case_ref:issued.case_ref,credential:issued.credential});
  },
  async lookup(caseRef:unknown,suppliedSecret:unknown):Promise<SafeCaseStatus|null>{
   // Even malformed/unknown cases cannot avoid the rate gate.
   if(!gate||typeof gate.limit!=='function'||await gate.limit('lookup')!==true)
    deny('RATE_OR_AUTHORITY_DENIED');
   if(typeof caseRef!=='string'||!CASE.test(caseRef)||
    typeof suppliedSecret!=='string'||!HEX64.test(suppliedSecret))return null;
   if(!store||typeof store.status!=='function'||!secrets||
    typeof secrets.verify!=='function')deny('PROOF_GATE_MISSING');
   const row=await store.status(scope,caseRef);
   if(!shape(row,['case_ref','credential_digest','status','updated_ms'])||
    row.case_ref!==caseRef||typeof row.credential_digest!=='string'||
    !HEX64.test(row.credential_digest)||!['received','reviewing','closed'].includes(row.status as string)||
    !Number.isSafeInteger(row.updated_ms)||row.updated_ms<0)return null;
   if(await secrets.verify(row.credential_digest,suppliedSecret)!==true)return null;
   return Object.freeze({case_ref:caseRef,status:row.status as SafeCaseStatus['status'],
    updated_ms:row.updated_ms as number});
  },
 });
}
