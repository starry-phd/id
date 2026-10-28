/**
 * AI-3 SBASE-20261028. Candidate-only BatteryClient contract for 30–50 Apps.
 * NOT the existing R7 wallet implementation, not an approved business API.
 * No balance/grant/expiry/FEFO/overdraft/Task action or D1/HTTP secret here.
 */
export const SBASE_BATTERY_CONTRACT_VERSION='starry.battery.client.v0-candidate' as const;
export const SBASE_BATTERY_LIVE_ENABLED=false as const;
export type BatteryClientScope=Readonly<{
 brand_id:'starry';app_id:string;environment:'development'|'staging';
}>;
export type BatteryClientErrorCode=
 'DISABLED'|'BAD_SCOPE'|'APP_SCOPE_DENIED'|'MEMBER_REVOKED'|
 'AUTH_UNAVAILABLE'|'SERVICE_UNAVAILABLE'|'UNTRUSTED_STATUS'|
 'CONCURRENT_CHANGE'|'NOT_APPROVED';
export type BatteryClientResult=Readonly<{
 contract_version:typeof SBASE_BATTERY_CONTRACT_VERSION;
 status:'blocked'|'unavailable'|'candidate_only';
 error_code:BatteryClientErrorCode;
 capability:'free_policy_status_only';pricing:'permanently_free';
 /** Always false even when private test fixtures appear coherent. */
 authorized_balance:false;may_grant:false;may_reserve:false;may_commit:false;
 may_release:false;may_purchase:false;may_sell:false;may_convert_payment:false;
 may_regrant:false;may_restore:false;may_ack_queue:false;live:false;
 unrelated_readonly_ui_may_degrade:true;
}>;
const IDENT=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const safeId=(x:unknown):x is string=>typeof x==='string'&&IDENT.test(x);
function plainKeys(v:unknown,fields:readonly string[]):v is Record<string,unknown>{
 try{
  if(v===null||typeof v!=='object'||Array.isArray(v))return false;
  const p=Object.getPrototypeOf(v);
  if(p!==Object.prototype&&p!==null)return false;
  const keys=Reflect.ownKeys(v);
  if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)))
   return false;
  return fields.every(k=>{
   const d=Object.getOwnPropertyDescriptor(v,k);
   return !!d&&d.enumerable&&'value' in d;
  });
 }catch{return false;}
}
const result=(status:BatteryClientResult['status'],
 error_code:BatteryClientErrorCode):BatteryClientResult=>Object.freeze({
 contract_version:SBASE_BATTERY_CONTRACT_VERSION,status,error_code,
 capability:'free_policy_status_only',pricing:'permanently_free',
 authorized_balance:false,may_grant:false,may_reserve:false,may_commit:false,
 may_release:false,may_purchase:false,may_sell:false,may_convert_payment:false,
 may_regrant:false,may_restore:false,may_ack_queue:false,live:false,
 unrelated_readonly_ui_may_degrade:true
});
/** No actual authorization publisher is supplied here: injected ports are
 * private server candidates, NEVER bind them directly from a client request.
 */
export function createCandidateBatteryClient(config:Readonly<{
 enabled?:boolean;scope:BatteryClientScope;
 /** Must originate from AI-1/AI-4 authorized server, not app-supplied boolean. */
 verifyScopedRead:()=>Promise<'active'|'revoked'|'unknown'>;
 /** Read-only, no network/storage implementation and no private member data. */
 readPolicyStatus:()=>Promise<unknown>;
}>){
 if(!config||typeof config.verifyScopedRead!=='function'||
  typeof config.readPolicyStatus!=='function')throw Error('AI3_SBASE_PORT_REQUIRED');
 const s=config.scope;
 if(!plainKeys(s,['brand_id','app_id','environment'])||s.brand_id!=='starry'||
  !safeId(s.app_id)||!['development','staging'].includes(s.environment as string))
  throw Error('AI3_SBASE_SCOPE_DENIED');
 const scope:BatteryClientScope=Object.freeze({brand_id:'starry',
  app_id:s.app_id as string,environment:s.environment as BatteryClientScope['environment']});
 const read=async()=>{
  const v=await config.readPolicyStatus();
  if(!plainKeys(v,['brand_id','app_id','environment','status','policy_version'])||
   v.brand_id!=='starry'||v.app_id!==scope.app_id||
   v.environment!==scope.environment||v.status!=='candidate_free'||
   typeof v.policy_version!=='number'||!Number.isSafeInteger(v.policy_version)||
   v.policy_version<1)return null;
  return JSON.stringify([v.brand_id,v.app_id,v.environment,v.status,v.policy_version]);
 };
 return Object.freeze({
  /** No purchase, wallet, grant or task method on this SDK surface. */
  async readFreePolicyStatus(input:unknown):Promise<BatteryClientResult>{
   if(config.enabled!==true)return result('blocked','DISABLED');
   if(!plainKeys(input,['brand_id','app_id','environment','operation'])||
    input.brand_id!==scope.brand_id||input.app_id!==scope.app_id||
    input.environment!==scope.environment||input.operation!=='battery.policy.read')
    return result('blocked','BAD_SCOPE');
   try{
    const grant=await config.verifyScopedRead();
    if(grant==='revoked')return result('blocked','MEMBER_REVOKED');
    if(grant!=='active')return result('blocked','AUTH_UNAVAILABLE');
    const first=await read();
    if(!first)return result('blocked','UNTRUSTED_STATUS');
    const second=await read();
    if(!second||first!==second)return result('blocked','CONCURRENT_CHANGE');
    const late=await config.verifyScopedRead();
    if(late==='revoked')return result('blocked','MEMBER_REVOKED');
    if(late!=='active')return result('blocked','AUTH_UNAVAILABLE');
    // A truthful local candidate is never an approved policy or entitlement.
    return result('candidate_only','NOT_APPROVED');
   }catch{return result('unavailable','SERVICE_UNAVAILABLE');}
  }
 });
}
