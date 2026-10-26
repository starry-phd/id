/** REBUILD Phase 0: AI-3 isolated, non-deployed Starry trust/audit domain draft. */
export type Environment='development'|'staging'|'production';
export type Scope=Readonly<{brand_id:'starry';app_id:string;environment:Environment}>;
export const BATTERY=Object.freeze({
  brand_id:'starry' as const,price:'free' as const,
  purchasable:false,grants:false,balances:false,reserve:false,
  debit:false,fefo:false,expiry:false,overdraft:false,
});
export const EVENT_KINDS=Object.freeze([
 'identity.session.revoked','identity.member.deleted','identity.grant.revoked',
 'security.access.denied','notification.delivery.queued','notification.delivery.rejected',
 'privacy.erasure.requested','appeal.received','audit.replay.requested',
] as const);
export type EventKind=typeof EVENT_KINDS[number];
export const CANDIDATE_VERSION='rebuild-ai3.0.1-candidate' as const;
export type AuditMetadata=Scope & Readonly<{
 schema_version:typeof CANDIDATE_VERSION;event_id:string;event_type:EventKind;
 occurred_at:string;correlation_id:string;idempotency_key:string;
 resource_ref:string;actor_ref:string;result:'recorded'|'denied'|'queued';
 classification:'metadata_only';
}>;
const KEYS=new Set([
 'brand_id','app_id','environment','schema_version','event_id','event_type',
 'occurred_at','correlation_id','idempotency_key','resource_ref','actor_ref',
 'result','classification',
]);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const safeId=(v:unknown):v is string=>typeof v==='string'&&ID.test(v);
function plain(v:unknown):v is Record<string,unknown>{
 if(v===null||typeof v!=='object')return false;
 try{
  if(Array.isArray(v))return false;
  const p=Object.getPrototypeOf(v);
  if(p!==Object.prototype&&p!==null)return false;
  return Reflect.ownKeys(v).every(k=>{
   const d=Object.getOwnPropertyDescriptor(v,k);
   return typeof k==='string'&&d!==undefined&&d.enumerable===true&&'value' in d;
  });
 }catch{return false;}
}
const validEnv=(v:unknown):v is Environment=>
 v==='development'||v==='staging'||v==='production';
export function rfc3339(v:unknown):v is string{
 if(typeof v!=='string')return false;
 const m=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(v);
 if(!m)return false;
 const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number);
 if(year<100||month<1||month>12||hour>23||minute>59||second>59)return false;
 const leap=year%4===0&&(year%100!==0||year%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(day<1||day>days[month-1])return false;
 const zone=m[8];
 if(zone!=='Z'&&(Number(zone.slice(1,3))>23||Number(zone.slice(4,6))>59))return false;
 return Number.isFinite(Date.parse(v));
}
export function isAuditMetadata(v:unknown):v is AuditMetadata{
 if(!plain(v))return false;
 try{
  if(Reflect.ownKeys(v).length!==KEYS.size||Reflect.ownKeys(v).some(k=>!KEYS.has(String(k))))return false;
  return v.brand_id==='starry'&&safeId(v.app_id)&&validEnv(v.environment)
   &&v.schema_version===CANDIDATE_VERSION&&safeId(v.event_id)
   &&EVENT_KINDS.includes(v.event_type as EventKind)&&rfc3339(v.occurred_at)
   &&safeId(v.correlation_id)&&safeId(v.idempotency_key)
   &&safeId(v.resource_ref)&&safeId(v.actor_ref)
   &&['recorded','denied','queued'].includes(String(v.result))
   &&v.classification==='metadata_only';
 }catch{return false;}
}
export function assertScope(trusted:Scope,actual:unknown):void{
 if(!plain(actual)||trusted.brand_id!=='starry'||!safeId(trusted.app_id)
  ||!validEnv(trusted.environment)||actual.brand_id!==trusted.brand_id
  ||actual.app_id!==trusted.app_id||actual.environment!==trusted.environment)
  throw new Error('AI3_SCOPE_DENIED');
}
export function assertEvent(trusted:Scope,event:unknown):asserts event is AuditMetadata{
 if(!isAuditMetadata(event))throw new Error('AI3_INVALID_METADATA');
 assertScope(trusted,event);
}
export function batteryCapability(trusted:Scope,actual:unknown,action:string):void{
 assertScope(trusted,actual);
 if(action!=='battery.policy.read')throw new Error('AI3_BATTERY_UNAPPROVED');
}
/** AI-1 must originate these decisions from verified server principal/session/grants. */
export type TrustedAuthPort=Readonly<{
 authorize:(scope:Scope,action:'audit.read'|'notification.deliver'|'audit.replay')=>
  Promise<Readonly<{outcome:'allow'|'deny';subject_ref:string}>|null>;
 notificationPreference:(scope:Scope,event:AuditMetadata)=>
  Promise<Readonly<{recipient_ref:string;channels:readonly ('inbox'|'email'|'push')[]}>|null>;
}>;
const NOTIF_KEYS=new Set(['event','recipient_ref','channel','template_id']);
/** Bind only in a trusted Worker composition; never inject a port from HTTP JSON. */
export function bindTrust(scope:Scope,port:TrustedAuthPort){
 assertScope(scope,scope);
 const allow=async(action:'audit.read'|'notification.deliver'|'audit.replay')=>{
  const proof=await port.authorize(scope,action);
  if(!plain(proof)||proof.outcome!=='allow'||!safeId(proof.subject_ref))
   throw new Error('AI3_AUTH_DENIED');
 };
 return Object.freeze({
  async auditRead(actual:unknown):Promise<void>{
   assertScope(scope,actual);
   if(!plain(actual)||Reflect.ownKeys(actual).length!==3
     ||Reflect.ownKeys(actual).some(k=>!['brand_id','app_id','environment'].includes(String(k))))
     throw new Error('AI3_AUDIT_READ_DENIED');
   await allow('audit.read');
  },
  async notification(input:unknown):Promise<Readonly<{event_id:string;recipient_ref:string;channel:string}>>{
   if(!plain(input)||Reflect.ownKeys(input).length!==NOTIF_KEYS.size
    ||Reflect.ownKeys(input).some(k=>!NOTIF_KEYS.has(String(k))))
    throw new Error('AI3_NOTIFICATION_DENIED');
   assertEvent(scope,input.event);
   if(!safeId(input.recipient_ref)||!safeId(input.template_id)
    ||!['inbox','email','push'].includes(String(input.channel)))
    throw new Error('AI3_NOTIFICATION_DENIED');
   await allow('notification.deliver');
   const preference=await port.notificationPreference(scope,input.event);
   if(!plain(preference)||!safeId(preference.recipient_ref)
    ||!Array.isArray(preference.channels)
    ||!preference.channels.every(x=>['inbox','email','push'].includes(x))
    ||preference.recipient_ref!==input.recipient_ref
    ||!preference.channels.includes(input.channel as 'inbox'|'email'|'push'))
    throw new Error('AI3_NOTIFICATION_DENIED');
   return Object.freeze({event_id:input.event.event_id,recipient_ref:preference.recipient_ref,channel:String(input.channel)});
  },
  async replay(event:unknown,approval:unknown):Promise<Readonly<{disposition:'review_only';event_id:string}>>{
   assertEvent(scope,event);
   if(event.event_type!=='notification.delivery.queued'
    ||!plain(approval)||Reflect.ownKeys(approval).length!==2
    ||!safeId(approval.approval_ref)||!safeId(approval.reason_code))
    throw new Error('AI3_REPLAY_DENIED');
   await allow('audit.replay');
   // Actual Queue replay remains disabled pending retention/approval Gate.
   return Object.freeze({disposition:'review_only' as const,event_id:event.event_id});
  },
 });
}
export function auditIngress(trusted:Scope,event:unknown):Readonly<{namespace:string;event_id:string}>{
 assertEvent(trusted,event);
 return Object.freeze({namespace:[event.brand_id,event.app_id,event.environment,event.idempotency_key].join('|'),event_id:event.event_id});
}
/** AI-1 remains the only writer of revoked session/version state. */
export function revocationOrder(current:number,incoming:number):'invalidate_only'|'stale_audit_only'{
 if(!Number.isSafeInteger(current)||current<0||!Number.isSafeInteger(incoming)||incoming<1)
  throw new Error('AI3_VERSION_DENIED');
 return incoming>current?'invalidate_only':'stale_audit_only';
}
export function retryPlan(input:Readonly<{
 attempt:number;failure:'timeout'|'network'|'http'|'auth_denied'|'invalid_data';
 http_status?:number;idempotency_key?:string;
}>):Readonly<{decision:'retry'|'dead_letter'|'reject';delay_ms:number}>{
 const reject={decision:'reject' as const,delay_ms:0};
 if(!Number.isSafeInteger(input.attempt)||input.attempt<1||!safeId(input.idempotency_key)
   ||input.failure==='auth_denied'||input.failure==='invalid_data')return reject;
 const transient=input.failure==='network'||input.failure==='timeout'
  ||(input.failure==='http'&&[408,425,429,500,502,503,504].includes(input.http_status??0));
 if(!transient)return reject;
 return input.attempt>=5?{decision:'dead_letter',delay_ms:0}
  :{decision:'retry',delay_ms:Math.min(60000,1000*2**(input.attempt-1))};
}
/** AI-1 owns member erasure. No approved audit retention/purge policy exists. */
export function erasureGate(v:unknown):Readonly<{disposition:'policy_pending';performed:false}>{
 if(!plain(v)||Reflect.ownKeys(v).length!==2
  ||v.kind!=='member_erasure'||!safeId(v.request_ref))
  throw new Error('AI3_PRIVACY_DENIED');
 return {disposition:'policy_pending',performed:false};
}
