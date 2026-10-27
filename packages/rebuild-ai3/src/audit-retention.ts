/**
 * Q115 Starry-only retention policy: 90 days ordinary audit, important
 * management >= 1 calendar year, longer lawful obligations take precedence.
 * No deletion, alteration or real storage binding is provided by this module.
 */
export const AUTOMATED_AUDIT_PURGE_ENABLED=false as const;
export type AuditClass='ordinary'|'important_management';
export type MinimalAuditRecord=Readonly<{
 brand_id:'starry';event_ref:string;classification:AuditClass;occurred_at_ms:number;
}>;
export type LegalRetentionPort=Readonly<{
 status:(event_ref:string)=>Promise<
  Readonly<{legal_hold:'held'|'clear'|'unknown';statutory_keep_until_ms:number|null}>>;
 approvedReview:(event_ref:string)=>Promise<boolean>;
}>;
export type RetentionDecision=Readonly<{
 disposition:'blocked'|'not_due'|'review_only';
 reason:string;earliest_review_ms:number|null;purge_permitted:false;
}>;
const ID=/^[a-z][a-zA-Z0-9._:-]{0,95}$/;
const DAY_MS=86_400_000;
const safeTime=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&
 n>=0&&n<=8_640_000_000_000_000;
const result=(disposition:RetentionDecision['disposition'],reason:string,
 earliest_review_ms:number|null=null):RetentionDecision=>Object.freeze({
 disposition,reason,earliest_review_ms,purge_permitted:false,
});
function plusYear(start:number):number{
 const date=new Date(start);
 // UTC calendar anniversary. Feb 29 rolls forward on nonleap year.
 const anniversary=Date.UTC(date.getUTCFullYear()+1,date.getUTCMonth(),date.getUTCDate(),
  date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds(),date.getUTCMilliseconds());
 if(!safeTime(anniversary))throw Error('AI3_RETENTION_YEAR_OVERFLOW');
 return anniversary;
}
export async function planAuditReview(
 row:MinimalAuditRecord,now:number,legal:LegalRetentionPort,
):Promise<RetentionDecision>{
 if(!row||row.brand_id!=='starry'||typeof row.event_ref!=='string'||
  !ID.test(row.event_ref)||!['ordinary','important_management'].includes(row.classification)||
  !safeTime(row.occurred_at_ms)||!safeTime(now)||now<row.occurred_at_ms)
  return result('blocked','SCOPE_OR_TIME_DENIED');
 if(!legal||typeof legal.status!=='function'||typeof legal.approvedReview!=='function')
  return result('blocked','LEGAL_AUTHORITY_MISSING');
 const minimum=row.classification==='ordinary'?
  row.occurred_at_ms+90*DAY_MS:plusYear(row.occurred_at_ms);
 if(!safeTime(minimum))return result('blocked','TIME_OVERFLOW');
 let info:Awaited<ReturnType<LegalRetentionPort['status']>>;
 try{info=await legal.status(row.event_ref)}
 catch{return result('blocked','LEGAL_AUTHORITY_OUTAGE');}
 if(!info||!['held','clear','unknown'].includes(info.legal_hold)||
  (info.statutory_keep_until_ms!==null&&!safeTime(info.statutory_keep_until_ms)))
  return result('blocked','LEGAL_STATUS_UNVERIFIED');
 if(info.legal_hold!=='clear')return result('blocked','LEGAL_HOLD_OR_UNKNOWN');
 const earliest=Math.max(minimum,info.statutory_keep_until_ms??0);
 if(now<earliest)return result('not_due','MINIMUM_OR_STATUTORY_RETENTION',earliest);
 try{
  if(await legal.approvedReview(row.event_ref)!==true)
   return result('blocked','PRIVACY_REVIEW_NOT_APPROVED',earliest);
 }catch{return result('blocked','PRIVACY_REVIEW_OUTAGE',earliest);}
 return result('review_only','NO_AUTO_PURGE_WITHOUT_SEPARATE_GATE',earliest);
}
