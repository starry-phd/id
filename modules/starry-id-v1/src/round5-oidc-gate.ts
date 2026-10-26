/**
 * AI-1 Round 5: OFF BY DEFAULT Starry-only OAuth callback orchestrator.
 * No outbound HTTP or Cloudflare binding. This never creates a live user,
 * session, or TrustedPrincipal. Only Worker-injected server authorities may
 * provide state, code exchange, JWKS, and current member/identity records.
 */
import {verifyPkceS256,verifySignedOidcIdToken} from './oidc-crypto.ts';
import type {OidcProvider,VerifiedProviderSubject} from './oidc-crypto.ts';
import type {TrustedScope} from './index.ts';
import type {createTrustedProviderJwksCache} from './jwks-cache.ts';

export type CallbackAttempt = Readonly<{
  state:string;provider:OidcProvider;app_id:string;
  environment:TrustedScope['environment'];client_id:string;
  nonce:string;code_challenge:string;code_verifier:string;
  expires_at:number;consumed_at:number|null;
}>;
export type CallbackMember = Readonly<{
  s_user_id:string;status:'active'|'suspended'|'deleted';auth_version:number;
}>;
export type ServerVerifiedExistingMember = Readonly<{
  brand_id:'starry';app_id:string;environment:TrustedScope['environment'];
  provider:OidcProvider;provider_subject:string;s_user_id:string;
  auth_version:number;checked_at:number;
}>;
export type CallbackDependencies = Readonly<{
  enabled?:boolean; // false unless a trusted server config explicitly enables OFFLINE testing
  scope:TrustedScope;
  provider:OidcProvider;clientId:string;
  jwks:ReturnType<typeof createTrustedProviderJwksCache>;
  readAttempt:(state:string)=>Promise<CallbackAttempt|null>;
  consumeAttemptCAS:(data:Readonly<{
    state:string;provider:OidcProvider;clientId:string;
    appId:string;environment:TrustedScope['environment'];now:number;
  }>)=>Promise<boolean>;
  exchangeCode:(params:Readonly<{
    provider:OidcProvider;clientId:string;code:string;verifier:string;
  }>)=>Promise<{idToken:string}|null>;
  // This port MUST look up immutable (provider,sub) in Starry's OWN D1 and
  // read the authoritative current member. Never auto-link by email.
  readLinkedExistingMember:(provider:OidcProvider,subject:string)=>Promise<CallbackMember|null>;
}>;
const issued=new WeakSet<object>();
export function isServerVerifiedExistingMember(v:unknown):v is ServerVerifiedExistingMember {
  return typeof v==='object'&&v!==null&&issued.has(v);
}
const stableId=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(x);
const natural=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const stateId=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(x);
function fieldsExactly(v:unknown,keys:readonly string[]):v is Record<string,unknown> {
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 try{
  if(Object.getPrototypeOf(v)!==Object.prototype)return false;
  const d=Object.getOwnPropertyDescriptors(v);
  return Reflect.ownKeys(v).length===keys.length
    &&keys.every(k=>Object.hasOwn(d,k)&&'value' in d[k]&&d[k].enumerable)
    &&Reflect.ownKeys(v).every(k=>typeof k==='string'&&keys.includes(k));
 }catch{return false;}
}
/** Untrusted header is used for key SELECTION only, NEVER as a trust claim. */
function extractKidFromUntrustedIdToken(token:unknown):string|null {
 if(typeof token!=='string'||token.length>16000)return null;
 const parts=token.split('.');
 if(parts.length!==3||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))return null;
 try{
  const p=parts[0];
  const raw=atob(p.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-p.length%4)%4));
  if(raw.length>1024)return null;
  const h:unknown=JSON.parse(raw);
  if(!fieldsExactly(h,['kid','alg'])&&!fieldsExactly(h,['kid','alg','typ']))return null;
  if(h.alg!=='RS256'||!stableId(h.kid)||('typ' in h&&h.typ!=='JWT'))return null;
  return h.kid;
 }catch{return null;}
}
export function createOfflineStarryOidcCallbackGate(deps:CallbackDependencies) {
 const scope=Object.freeze({...deps.scope});
 if(scope.brand_id!=='starry'||!stableId(scope.app_id)||
   !['development','staging'].includes(scope.environment)||
   !['apple','google'].includes(deps.provider)||!stableId(deps.clientId))
   throw Error('OIDC_SCOPE_DENIED');
 const enabled=deps.enabled===true;
 return Object.freeze({
  async handle(input:unknown,now:number):Promise<ServerVerifiedExistingMember|null>{
   if(!enabled||!natural(now)||!fieldsExactly(input,['state','code']))return null;
   if(!stateId(input.state)||typeof input.code!=='string'||input.code.length<1||
     input.code.length>2048||/[\x00-\x1F\x7F]/.test(input.code))return null;
   try{
    const attempt=await deps.readAttempt(input.state);
    if(!attempt||attempt.state!==input.state||attempt.provider!==deps.provider||
      attempt.client_id!==deps.clientId||attempt.app_id!==scope.app_id||
      attempt.environment!==scope.environment||attempt.consumed_at!==null||
      !natural(attempt.expires_at)||attempt.expires_at<=now||
      !stateId(attempt.state)||typeof attempt.nonce!=='string'||
      attempt.nonce.length<16||attempt.nonce.length>256||
      !await verifyPkceS256(attempt.code_verifier,attempt.code_challenge))return null;
    // One winner; consume state BEFORE token exchange, including failed exchange.
    if(!await deps.consumeAttemptCAS(Object.freeze({
      state:attempt.state,provider:deps.provider,clientId:deps.clientId,
      appId:scope.app_id,environment:scope.environment,now,
    })))return null;
    const exchange=await deps.exchangeCode(Object.freeze({
      provider:deps.provider,clientId:deps.clientId,
      code:input.code,verifier:attempt.code_verifier,
    }));
    const kid=extractKidFromUntrustedIdToken(exchange?.idToken);
    if(!kid)return null;
    // Pinned Apple/Google URLs; unknown/rotated KID must fail closed.
    const pinned=await deps.jwks.keysFor(deps.provider,kid,now);
    if(!pinned||pinned.clientId!==deps.clientId||pinned.provider!==deps.provider)return null;
    const verified:VerifiedProviderSubject|null=await verifySignedOidcIdToken(exchange!.idToken,{
      issuer:pinned,nonce:attempt.nonce,now,
    });
    if(!verified||verified.provider!==deps.provider||!stableId(verified.providerSubject))return null;
    const member=await deps.readLinkedExistingMember(verified.provider,verified.providerSubject);
    if(!member||member.status!=='active'||!stableId(member.s_user_id)||
      !Number.isSafeInteger(member.auth_version)||member.auth_version<1)return null;
    const result=Object.freeze({
      brand_id:'starry' as const,app_id:scope.app_id,environment:scope.environment,
      provider:verified.provider,provider_subject:verified.providerSubject,
      s_user_id:member.s_user_id,auth_version:member.auth_version,checked_at:now,
    });
    issued.add(result);
    // The sealed result authorizes only the trusted session-creation adapter.
    // Actual Session creation must re-check CURRENT member+subject/version by D1 CAS.
    return result;
   }catch{return null;}
  },
 });
}
