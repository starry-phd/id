/** AI-0 ONLY: offline P05 transport candidate validator. Not authority to publish. */
export const VERSION='billing.p05.v1-candidate';
export const PUBLISHABLE=false;
export const FIELDS=Object.freeze([
 'brand_id','app_id','environment','schema_version','event_id','event_type',
 'occurred_at','correlation_id','idempotency_key','actor_ref','resource_ref',
 'result','classification']);
const F=new Set(FIELDS),K=/^b_[a-f0-9]{64}$/;
const ACTOR=/^(?:anon|actor|audit|opaque)_[A-Za-z0-9._:-]{1,120}$/;
const APP=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATE=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/;
function calendar(v){
 if(typeof v!=='string')return false;
 const m=DATE.exec(v);if(!m)return false;
 const [y,mo,day,h,mi,s]=m.slice(1,7).map(Number);
 const leap=y%4===0&&(y%100!==0||y%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 const zone=m[8];
 return y>=100 && mo>=1&&mo<=12&&day>=1&&day<=days[mo-1]
  &&h<=23&&mi<=59&&s<=59
  &&(zone==='Z'||Number(zone.slice(1,3))<=23&&Number(zone.slice(4,6))<=59)
  &&Number.isFinite(Date.parse(v));
}
function plain(v,allow){
 if(v===null||typeof v!=='object'||Array.isArray(v))return false;
 const proto=Object.getPrototypeOf(v);
 if(proto!==null&&proto!==Object.prototype)return false;
 const keys=Reflect.ownKeys(v);
 return keys.length===allow.size&&keys.every(k=>{
  if(typeof k!=='string'||!allow.has(k))return false;
  const d=Object.getOwnPropertyDescriptor(v,k);
  return !!d&&d.enumerable===true&&Object.hasOwn(d,'value');
 });
}
const S=new Set(['brand_id','app_id','environment']);
/** Checks shape/scope only. Source must separately be authoritative committed Billing D1. */
export function isCandidate(e,scope){
 try{
  if(!plain(e,F)||!plain(scope,S))return false;
  if(scope.brand_id!=='starry'||typeof scope.app_id!=='string'||!APP.test(scope.app_id)
    ||!['development','staging'].includes(scope.environment))return false;
  if(e.brand_id!=='starry'||e.app_id!==scope.app_id||e.environment!==scope.environment
    ||e.schema_version!==VERSION||e.event_type!=='billing.store_state_observed'
    ||e.result!=='recorded'||e.classification!=='metadata_only')return false;
  if(typeof e.idempotency_key!=='string'||!K.test(e.idempotency_key)
    ||e.event_id!==e.idempotency_key||e.correlation_id!==e.idempotency_key
    ||e.resource_ref!==e.idempotency_key)return false;
  return typeof e.actor_ref==='string'&&ACTOR.test(e.actor_ref)&&calendar(e.occurred_at);
 }catch{return false;}
}
