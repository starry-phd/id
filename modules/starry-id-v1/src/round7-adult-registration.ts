/** AI-1: Q93=A/Q106=A, offline adult self-declaration + authoritative risk gate.
 * DOB is used in memory only, not persisted; a selfie/document verification,
 * regional law and minor/consent compliance are NOT supplied by this module.
 */
import type {TrustedScope} from './index.ts';
export type RegistrationRiskDecision='approved'|'review_required'|'denied';
export type AdultRegistrationEvidence=Readonly<{
  brand_id:'starry';app_id:string;environment:'development'|'staging';
  adult_self_declared:true;age_check_passed:true;checked_at:number;
}>;
const issued=new WeakSet<object>();
export function isVerifiedAdultRegistrationEvidence(value:unknown):value is AdultRegistrationEvidence{
 return typeof value==='object'&&value!==null&&issued.has(value);
}
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(v);
function plain(value:unknown,keys:readonly string[]):value is Record<string,unknown>{
 try {
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.getPrototypeOf(value)!==Object.prototype)return false;
  const p=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(value);
  return names.length===keys.length&&keys.every(k=>Object.hasOwn(p,k)&&
    'value' in p[k]&&p[k].enumerable)&&names.every(k=>typeof k==='string'&&keys.includes(k));
 }catch{return false;}
}
function adult(birthDate:unknown,now:number):boolean{
 if(typeof birthDate!=='string'||!/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(birthDate))return false;
 const [y,m,d]=birthDate.split('-').map(Number),date=new Date(now*1000);
 if(!Number.isSafeInteger(now)||now<0||!Number.isFinite(date.getTime())||
    date.getUTCFullYear()<1900)return false;
 const birth=new Date(Date.UTC(y,m-1,d));
 if(birth.getUTCFullYear()!==y||birth.getUTCMonth()!==m-1||birth.getUTCDate()!==d)return false;
 const currentY=date.getUTCFullYear(),currentM=date.getUTCMonth()+1,currentD=date.getUTCDate();
 return currentY-y-(currentM<m||currentM===m&&currentD<d?1:0)>=18 &&
    y<=currentY && birth.getTime()<=date.getTime();
}
export function createOfflineAdultRegistrationGate(deps:Readonly<{
 enabled?:boolean;scope:TrustedScope;
 // Trusted backend, may require official proof when self-report is suspect.
 evaluateRisk:(input:Readonly<{birthDate:string;now:number}>)=>Promise<RegistrationRiskDecision>;
}>) {
 const scope=Object.freeze({...deps.scope});
 if(scope.brand_id!=='starry'||!validId(scope.app_id)||
  !['development','staging'].includes(scope.environment))throw Error('ADULT_SCOPE_DENIED');
 const enabled=deps.enabled===true;
 return Object.freeze({
  async evaluate(untrusted:unknown,serverNow:number):Promise<AdultRegistrationEvidence|null>{
   if(!enabled||!Number.isSafeInteger(serverNow)||serverNow<0||
    !plain(untrusted,['birthDate','adultConfirmed'])||
    untrusted.adultConfirmed!==true||!adult(untrusted.birthDate,serverNow))return null;
   try{
    const result=await deps.evaluateRisk(Object.freeze({birthDate:untrusted.birthDate as string,now:serverNow}));
    // Neither review_required nor unknown values are registration approval.
    if(result!=='approved')return null;
    const proof=Object.freeze({brand_id:'starry' as const,app_id:scope.app_id,
     environment:scope.environment as 'development'|'staging',
     adult_self_declared:true as const,age_check_passed:true as const,checked_at:serverNow});
    issued.add(proof);
    return proof;
   }catch{return null;}
  },
 });
}
/** Q97=A and Q119=A conflict with unsanctioned permanent identity retention.
 * No gift issuance until a privacy-lawful, minimal, keyed anti-reissue authority
 * has been reviewed and signed off by AI-0/privacy Gate.
 */
export function registrationGiftDecision(_proof:unknown):'PRIVACY_GATE_BLOCKED'{
 return 'PRIVACY_GATE_BLOCKED';
}
export const HGLOBAL_MEMBER_API_ENABLED=false as const;
export const STARRY_ID_STANDALONE_STORE_APP=false as const;
