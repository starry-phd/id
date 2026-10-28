/**
 * AI-1 Wave1 Round-001: Q2=A, trusted Starry ID before Store purchase.
 * Real signed Session + current Auth D1 checks are delegated to the existing
 * R23 boundary; no purchase endpoint, Store SDK, receipt, entitlement or writer.
 * Development/staging ONLY; even a verified identity cannot open real Store.
 */
import {createOfflineStarryRequestAuthBoundary} from './r23-signed-session-d1-request-boundary.ts';
import {isTrustedPrincipal} from './index.ts';
import type {TrustedScope} from './index.ts';
import type {D1Database} from './d1-ports.ts';

export const WAVE1_PURCHASE_AUTH_SCHEMA='starry.auth.purchase-entry.w1.v1-offline' as const;
export const WAVE1_PURCHASE_AUTH_LIVE_ENABLED=false as const;
export type PurchaseEntryStatus='guest_browsing'|'login_required'|
 'cancelled_to_original_flow'|'identity_verified_only'|'blocked';
export type PurchaseEntryReason='OFFLINE_DISABLED'|'INVALID_FLOW_SCOPE'|
 'LOGIN_BEFORE_STORE'|'LOGIN_CANCELLED'|'IDENTITY_VERIFIED_NOT_STORE_APPROVED'|null;
export type PurchaseFlowIntent=Readonly<{
 brand_id:'starry';app_id:string;environment:'development'|'staging';flow_ref:string;
}>;
export type PurchaseEntryView=Readonly<{
 schema_version:typeof WAVE1_PURCHASE_AUTH_SCHEMA;
 status:PurchaseEntryStatus;reason:PurchaseEntryReason;
 flow_ref:string|null;
 guest_free_browse_allowed:boolean;login_required_before_store:boolean;
 ui_only:true;verified_live:false;
 may_open_store:false;may_purchase:false;may_grant_entitlement:false;
 may_transfer_store_transaction:false;may_restore:false;may_charge:false;
}>;
/** Server-only, short-lived internal identity binding. Never serialize to UI. */
export type PurchaseServerIdentity=Readonly<{
 brand_id:'starry';app_id:string;environment:'development'|'staging';
 starryUserId:string;auth_version:number;session_id:string;
 checked_at:number;expires_at:number;scope:'purchase_identity_only';
}>;
const evidence=new WeakMap<object,PurchaseServerIdentity&{flow_ref:string}>();
const ID=/^[A-Za-z0-9._:-]{1,180}$/;
const REF=/^[A-Za-z0-9_-]{32,96}$/;
function exactRecord(raw:unknown,fields:readonly string[]):Record<string,unknown>|null{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const p=Object.getPrototypeOf(raw);
  if(p!==Object.prototype&&p!==null)return null;
  const keys=Reflect.ownKeys(raw);
  if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)))return null;
  const out:Record<string,unknown>=Object.create(null);
  for(const k of fields){
   const d=Object.getOwnPropertyDescriptor(raw,k);
   if(!d?.enumerable||!('value' in d))return null;
   out[k]=d.value;
  }
  return out;
 }catch{return null;}
}
const finiteTime=(x:unknown):x is number=>
 typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
function view(status:PurchaseEntryStatus,reason:PurchaseEntryReason,flow_ref:string|null):
 PurchaseEntryView{
 return Object.freeze({schema_version:WAVE1_PURCHASE_AUTH_SCHEMA,
  status,reason,flow_ref,guest_free_browse_allowed:status==='guest_browsing',
  login_required_before_store:status==='login_required',
  ui_only:true as const,verified_live:false as const,
  may_open_store:false as const,may_purchase:false as const,
  may_grant_entitlement:false as const,may_transfer_store_transaction:false as const,
  may_restore:false as const,may_charge:false as const});
}
export function createOfflineStarryPurchaseEntryGate(deps:Readonly<{
 enabled?:boolean;serverScope:TrustedScope;expectedOrigin:string;
 authDb:D1Database;getVerificationKey:(kid:string)=>Promise<CryptoKey|null>;
}>) {
 const s=deps.serverScope;
 if(!s||s.brand_id!=='starry'||!ID.test(s.app_id)||
  (s.environment!=='development'&&s.environment!=='staging'))
  throw Error('W1_PURCHASE_SCOPE_DENIED');
 const scope=Object.freeze({...s});
 const boundary=createOfflineStarryRequestAuthBoundary({
  enabled:deps.enabled===true,serverScope:scope,
  expectedOrigin:deps.expectedOrigin,authDb:deps.authDb,
  getVerificationKey:deps.getVerificationKey
 });
 const enabled=deps.enabled===true;
 const intent=(raw:unknown):PurchaseFlowIntent|null=>{
  const x=exactRecord(raw,['brand_id','app_id','environment','flow_ref']);
  if(!x||x.brand_id!=='starry'||x.app_id!==scope.app_id||
   x.environment!==scope.environment||
   typeof x.flow_ref!=='string'||!REF.test(x.flow_ref))return null;
  return Object.freeze({brand_id:'starry',app_id:scope.app_id,
   environment:scope.environment as 'development'|'staging',
   flow_ref:x.flow_ref});
 };
 const checked=(raw:unknown):PurchaseEntryView|PurchaseFlowIntent=>{
  if(!enabled)return view('blocked','OFFLINE_DISABLED',null);
  return intent(raw)??view('blocked','INVALID_FLOW_SCOPE',null);
 };
 const denied=(v:PurchaseEntryView|PurchaseFlowIntent):v is PurchaseEntryView=>
  'status' in v;
 const proof=(v:unknown,claim:PurchaseFlowIntent,now:number):
  (PurchaseServerIdentity&{flow_ref:string})|null=>{
  if(!v||typeof v!=='object'||!evidence.has(v)||!finiteTime(now))return null;
  const p=evidence.get(v);
  if(!p||p.app_id!==claim.app_id||p.brand_id!==claim.brand_id||
   p.environment!==claim.environment||p.flow_ref!==claim.flow_ref||
   p.checked_at>now||now-p.checked_at>5||p.expires_at<=now)return null;
  return p;
 };
 return Object.freeze({
  contract:WAVE1_PURCHASE_AUTH_SCHEMA,
  /** Public free content is accessible without Session reads. */
  guestBrowse(rawIntent:unknown):PurchaseEntryView{
   const x=checked(rawIntent);
   return denied(x)?x:view('guest_browsing',null,x.flow_ref);
  },
  /** Anonymous purchase tap takes user to Starry ID login; not Store. */
  async beforeStore(request:unknown,rawIntent:unknown,now:unknown):Promise<PurchaseEntryView>{
   const x=checked(rawIntent);
   if(denied(x))return x;
   if(!finiteTime(now))return view('blocked','INVALID_FLOW_SCOPE',null);
   try{
    // Only original R23 signed-Bearer → D1 Member/Session/provider-subject
    // resolves a sealed principal. UI isLoggedIn/AuthClient state is ignored.
    const p=await boundary.authenticate(request,now);
    if(!p||!isTrustedPrincipal(p))
     return view('login_required','LOGIN_BEFORE_STORE',x.flow_ref);
    const result=view('identity_verified_only',
     'IDENTITY_VERIFIED_NOT_STORE_APPROVED',x.flow_ref);
    evidence.set(result,Object.freeze({
     brand_id:'starry',app_id:x.app_id,environment:x.environment,
     starryUserId:p.s_user_id,session_id:p.session_id,
     auth_version:p.auth_version,checked_at:now,
     expires_at:p.expires_at,scope:'purchase_identity_only' as const,
     flow_ref:x.flow_ref
    }));
    return result;
   }catch{return view('login_required','LOGIN_BEFORE_STORE',x.flow_ref);}
  },
  /** User cancelling Starry ID login returns to original flow, no Store. */
  cancelLogin(rawIntent:unknown):PurchaseEntryView{
   const x=checked(rawIntent);
   return denied(x)?x:view('cancelled_to_original_flow','LOGIN_CANCELLED',x.flow_ref);
  },
  /** Caller must request a FRESH signed bearer after login, not reuse UI state. */
  async resumeAfterLogin(request:unknown,rawIntent:unknown,now:unknown):
   Promise<PurchaseEntryView>{
   return this.beforeStore(request,rawIntent,now);
  },
  /** Only privileged server code may extract mapping, never client JSON.
   * Five-second snapshot is NOT authorization to transact; AI-2 must revalidate
   * current Session/member and own Store + Billing gates before any operation.
   */
  readServerIdentity(result:unknown,rawIntent:unknown,now:unknown):
   PurchaseServerIdentity|null{
   const x=intent(rawIntent);
   if(!enabled||!x)return null;
   const p=proof(result,x,now as number);
   if(!p)return null;
   const {flow_ref:_opaque,...serverOnly}=p;
   return Object.freeze(serverOnly);
  },
  /** Disallow a switch to another Starry account during return-from-login. */
  sameVerifiedMember(previous:unknown,next:unknown,rawIntent:unknown,now:unknown):boolean{
   const x=intent(rawIntent);
   if(!enabled||!x)return false;
   const a=proof(previous,x,now as number),b=proof(next,x,now as number);
   return !!a&&!!b&&a.starryUserId===b.starryUserId;
  }
 });
}
