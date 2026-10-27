/** R7 approved product rules, OFFLINE POC only. No live D1, Worker, Store, H-Global. */
export const LIVE_BATTERY_WRITES_ENABLED=false as const;
export const BATTERY_PRICE='permanently_free' as const;
export const RESERVATION_TTL_MS=180000 as const;
export const OVERDRAFT_MAX_USES=2 as const;
export type Scope=Readonly<{brand_id:'starry';member_ref:string}>;
export type Rate=Readonly<{app_id:string;task_type:string;price:number;version:number}>;
export type Policy=Readonly<{brand_id:'starry';version:number;registration_grant:number;
 first_task_grant:number;max_debt:number;max_task_cost:number;rates:readonly Rate[]}>;
export type Hold=Readonly<{task_ref:string;app_id:string;task_type:string;price:number;
 rate_version:number;policy_version:number;created_at:number;expires_at:number;
 status:'held'|'committed'|'released'|'expired'|'revoked'}>;
export type Kind='registration_grant'|'first_task_grant'|'reserve'|'commit'|'release'|'expire'|'admin_correction'|'revoke';
export type Entry=Readonly<{revision:number;kind:Kind;ref:string;delta:number;
 at:number;policy_version:number;reason_code:string}>;
export type Wallet=Readonly<{scope:Scope;revision:number;balance:number;overdraft_used:number;
 registration_granted:boolean;first_task_granted:boolean;revoked:boolean;
 holds:readonly Hold[];journal:readonly Entry[]}>;
/** Real AI-1 / AI-4 trusted server port REQUIRED; never accept a client-supplied port. */
export type TrustedAuthority=Readonly<{
 authorizePolicy:(p:Policy)=>Promise<boolean>;
 verifyMemberActive:(scope:Scope)=>Promise<boolean>;
 verifyRegistrationGrant:(scope:Scope)=>Promise<boolean>;
 verifyTaskRequest:(scope:Scope,ref:string,app:string,type:string)=>Promise<boolean>;
 verifyTaskOutcome:(scope:Scope,ref:string,result:'success'|'failure')=>Promise<boolean>;
 verifyFirstEligibleTask:(scope:Scope,ref:string)=>Promise<boolean>;
 verifyAdminStepUp:(scope:Scope,ref:string,reason:string)=>Promise<boolean>;
 verifyDeletion:(scope:Scope)=>Promise<boolean>;
}>;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const REASON=/^[A-Z][A-Z0-9_]{2,63}$/;
const id=(s:unknown):s is string=>typeof s==='string'&&ID.test(s);
const num=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const fail=(reason:string):never=>{throw new Error('AI3_BATTERY_'+reason)};
function scopeOk(s:Scope){if(s?.brand_id!=='starry'||!id(s.member_ref))fail('SCOPE_DENIED')}
function policyOk(p:Policy){
 if(p?.brand_id!=='starry'||!num(p.version)||p.version===0||
  !num(p.registration_grant)||!num(p.first_task_grant)||!num(p.max_debt)||
  !num(p.max_task_cost)||p.max_task_cost===0||!Array.isArray(p.rates)||
  p.rates.length===0)fail('POLICY_DENIED');
 const seen=new Set<string>();
 for(const r of p.rates){
  if(!id(r.app_id)||!id(r.task_type)||!num(r.price)||r.price===0||
   r.price>p.max_task_cost||!num(r.version)||r.version===0)fail('RATE_DENIED');
  const key=r.app_id+'|'+r.task_type;
  if(seen.has(key))fail('DUPLICATE_RATE');
  seen.add(key);
 }
}
function walletOk(w:Wallet,p:Policy){
 scopeOk(w?.scope);
 if(!num(w.revision)||!Number.isSafeInteger(w.balance)||!num(w.overdraft_used)||
  w.overdraft_used>2||!Array.isArray(w.holds)||!Array.isArray(w.journal)||
  typeof w.revoked!=='boolean'||typeof w.registration_granted!=='boolean'||
  typeof w.first_task_granted!=='boolean'||(w.first_task_granted&&!w.registration_granted)||
  w.balance < -p.max_debt)fail('STATE_DENIED');
}
function transition(w:Wallet,p:Policy,at:number,kind:Kind,ref:string,delta:number,reason:string,
 change:Partial<Wallet>={}):Wallet{
 if(!num(at)||!id(ref)||!REASON.test(reason)||!Number.isSafeInteger(delta)||
  !Number.isSafeInteger(w.balance+delta)||w.revision===Number.MAX_SAFE_INTEGER)fail('INPUT_DENIED');
 const balance=w.balance+delta;
 if(balance < -p.max_debt)fail('DEBT_CAP');
 const overdraft_used=balance>=0?0:(change.overdraft_used??w.overdraft_used);
 const journal=[...w.journal,Object.freeze({revision:w.revision+1,kind,ref,delta,at,
  policy_version:p.version,reason_code:reason})];
 return Object.freeze({...w,...change,revision:w.revision+1,balance,overdraft_used,
  journal:Object.freeze(journal),holds:Object.freeze([...(change.holds??w.holds)])});
}
async function authorized(w:Wallet,p:Policy,a:TrustedAuthority){
 policyOk(p);walletOk(w,p);
 if(w.revoked)fail('REVOKED');
 if(!a||typeof a.authorizePolicy!=='function'||await a.authorizePolicy(p)!==true)
  fail('AUTHORITY_DENIED');
 if(typeof a.verifyMemberActive!=='function'||await a.verifyMemberActive(w.scope)!==true)
  fail('MEMBER_AUTH_DENIED');
}
export function newWallet(scope:Scope):Wallet{
 scopeOk(scope);
 return Object.freeze({scope:Object.freeze({...scope}),revision:0,balance:0,overdraft_used:0,
  registration_granted:false,first_task_granted:false,revoked:false,
  holds:Object.freeze([]),journal:Object.freeze([])});
}
/** Q90/109: X before first task; X/Y quantities NOT owner-approved yet. */
export async function registrationGrant(w:Wallet,p:Policy,a:TrustedAuthority,at:number):Promise<Wallet>{
 await authorized(w,p,a);
 if(w.registration_granted)return w;
 if(!num(at)||typeof a.verifyRegistrationGrant!=='function'||
  await a.verifyRegistrationGrant(w.scope)!==true)fail('REGISTRATION_GATE');
 return transition(w,p,at,'registration_grant','initial_registration',
  p.registration_grant,'REGISTER_ONCE',{registration_granted:true});
}
/** Q99/91: one price per trusted App/task; all Starry Apps share this wallet. */
export async function reserveTask(w:Wallet,p:Policy,a:TrustedAuthority,
 task:Readonly<{task_ref:string;app_id:string;task_type:string}>,at:number):Promise<Wallet>{
 await authorized(w,p,a);
 if(!w.registration_granted)fail('BOOTSTRAP_REQUIRED');
 if(!num(at)||!id(task?.task_ref)||!id(task?.app_id)||!id(task?.task_type))
  fail('TASK_DENIED');
 const old=w.holds.find(x=>x.task_ref===task.task_ref);
 if(old){
  if(old.app_id===task.app_id&&old.task_type===task.task_type&&old.status==='held')return w;
  fail('TASK_CONFLICT');
 }
 const r=p.rates.find(x=>x.app_id===task.app_id&&x.task_type===task.task_type);
 if(!r)throw new Error('AI3_BATTERY_UNAPPROVED_TASK_RATE');
 if(typeof a.verifyTaskRequest!=='function'||
  await a.verifyTaskRequest(w.scope,task.task_ref,task.app_id,task.task_type)!==true)
  fail('TASK_AUTHORITY_DENIED');
 if(!Number.isSafeInteger(at+RESERVATION_TTL_MS))fail('TIME_OVERFLOW');
 const overdraft=w.balance-r.price<0;
 if(overdraft&&(w.overdraft_used>=OVERDRAFT_MAX_USES||
  w.balance-r.price < -p.max_debt))fail('OVERDRAFT_DENIED');
 const hold:Hold=Object.freeze({task_ref:task.task_ref,app_id:task.app_id,
  task_type:task.task_type,price:r.price,rate_version:r.version,
  policy_version:p.version,created_at:at,expires_at:at+RESERVATION_TTL_MS,status:'held'});
 return transition(w,p,at,'reserve',task.task_ref,-r.price,'TASK_RESERVE',{
  overdraft_used:w.overdraft_used+(overdraft?1:0),holds:[...w.holds,hold]});
}
/** Q101: at exact 3-minute boundary success cannot commit; one release only. */
export async function finishTask(w:Wallet,p:Policy,a:TrustedAuthority,
 ref:string,result:'success'|'failure',at:number):Promise<Wallet>{
 await authorized(w,p,a);
 if(!num(at)||!id(ref)||!['success','failure'].includes(result))fail('TASK_DENIED');
 const hold=w.holds.find(h=>h.task_ref===ref);
 if(!hold)throw new Error('AI3_BATTERY_MISSING_HOLD');
 if(hold.status!=='held'){
  if(hold.status==='committed'&&result==='success')return w;
  if(hold.status==='released'&&result==='failure')return w;
  fail('STALE_OR_CONFLICTING_RESULT');
 }
 if(at>=hold.expires_at)
  return transition(w,p,at,'expire',ref,hold.price,'TTL_EXPIRED',{
   holds:w.holds.map(h=>h.task_ref===ref?{...h,status:'expired' as const}:h)});
 if(typeof a.verifyTaskOutcome!=='function'||
  await a.verifyTaskOutcome(w.scope,ref,result)!==true)fail('OUTCOME_AUTHORITY_DENIED');
 let updated=transition(w,p,at,result==='success'?'commit':'release',ref,
  result==='success'?0:hold.price,result==='success'?'TASK_SUCCEEDED':'TASK_FAILED',{
   holds:w.holds.map(h=>h.task_ref===ref?{...h,status:result==='success'?'committed' as const:'released' as const}:h)});
 if(result==='success'&&!w.first_task_granted){
  if(typeof a.verifyFirstEligibleTask!=='function'||
   await a.verifyFirstEligibleTask(w.scope,ref)!==true)fail('FIRST_TASK_AUTHORITY_REQUIRED');
  updated=transition(updated,p,at,'first_task_grant',ref,p.first_task_grant,
   'FIRST_ELIGIBLE_COMPLETION',{first_task_granted:true});
 }
 return updated;
}
export async function expireTask(w:Wallet,p:Policy,a:TrustedAuthority,ref:string,at:number):Promise<Wallet>{
 await authorized(w,p,a);
 const h=w.holds.find(x=>x.task_ref===ref);
 if(!num(at)||!h)throw new Error('AI3_BATTERY_MISSING_HOLD');
 if(h.status!=='held')return w;
 if(at<h.expires_at)fail('NOT_EXPIRED');
 return transition(w,p,at,'expire',ref,h.price,'TTL_EXPIRED',{
  holds:w.holds.map(x=>x.task_ref===ref?{...x,status:'expired' as const}:x)});
}
/** Q112: only additive correction journal with fresh server Step-up, not history UPDATE. */
export async function adminCorrect(w:Wallet,p:Policy,a:TrustedAuthority,
 change:Readonly<{ref:string;delta:number;reason_code:string}>,at:number):Promise<Wallet>{
 await authorized(w,p,a);
 if(!id(change?.ref)||!REASON.test(change?.reason_code)||
  !Number.isSafeInteger(change?.delta)||change.delta===0||!num(at))fail('ADMIN_DENIED');
 const previous=w.journal.find(e=>e.kind==='admin_correction'&&e.ref===change.ref);
 if(previous){
  if(previous.delta===change.delta&&previous.reason_code===change.reason_code)return w;
  fail('ADMIN_IDEMPOTENCY_CONFLICT');
 }
 if(Math.abs(change.delta)>p.max_task_cost||
  (change.delta<0&&w.balance+change.delta<0))fail('ADMIN_LIMIT_DENIED');
 if(typeof a.verifyAdminStepUp!=='function'||
  await a.verifyAdminStepUp(w.scope,change.ref,change.reason_code)!==true)
  fail('ADMIN_AUTHORITY_DENIED');
 return transition(w,p,at,'admin_correction',change.ref,change.delta,change.reason_code);
}
/** Q88/119: no OAuth identifiers stored here; legal anti-regrant is AI-1 Gate. */
export async function revokeDeleted(w:Wallet,p:Policy,a:TrustedAuthority,at:number):Promise<Wallet>{
 policyOk(p);walletOk(w,p);
 if(w.revoked)return w;
 if(!num(at)||!a||typeof a.verifyDeletion!=='function'||
  await a.verifyDeletion(w.scope)!==true)fail('DELETION_AUTHORITY_DENIED');
 return transition(w,p,at,'revoke','deleted_account',-w.balance,'ACCOUNT_DELETED',{
  revoked:true,holds:w.holds.map(x=>x.status==='held'?{...x,status:'revoked' as const}:x)});
}
