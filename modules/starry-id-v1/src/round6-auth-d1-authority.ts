/**
 * AI-1 Round6: fixed-SQL Starry Identity D1 authority for OFFLINE callbacks.
 * This is a server-only port (no Worker/API route). Never accept a caller's
 * user_id, status, provider flags, JWT claims, or cross-brand DB bindings.
 */
import type {TrustedScope,Provider} from './index.ts';
import {createStarryD1Port} from './d1-ports.ts';
import type {D1Database} from './d1-ports.ts';
import type {CallbackAttempt,CallbackDependencies,CallbackMember} from './round5-oidc-gate.ts';

export type SecureVerifierStore=Readonly<{
 // Backend-secret verifier store. No OAuth PKCE verifier in D1, HTTP, logs.
 readOnceCandidate:(state:string)=>Promise<string|null>;
}>;
const id=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(x);
const state=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9_-]{32,256}$/.test(x);
const epoch=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const allowProvider=(p:unknown):p is Provider=>p==='apple'||p==='google';

export function createOfflineStarryD1AuthAuthority(deps:Readonly<{
 enabled?:boolean;db:D1Database;scope:TrustedScope;
 provider:Provider;clientId:string;verifierStore:SecureVerifierStore;
}>) {
 const scope=Object.freeze({...deps.scope});
 if(scope.brand_id!=='starry'||!id(scope.app_id)||
   !['development','staging'].includes(scope.environment)||
   !allowProvider(deps.provider)||!id(deps.clientId))throw Error('D1_AUTH_SCOPE_DENIED');
 const enabled=deps.enabled===true;
 const scoped=createStarryD1Port(deps.db,scope);
 return Object.freeze({
  async readAttempt(stateKey:string):Promise<CallbackAttempt|null>{
   if(!enabled||!state(stateKey))return null;
   const meta=await scoped.readOAuthAttemptMeta(stateKey);
   if(!meta||meta.provider!==deps.provider||meta.client_id!==deps.clientId||
      meta.app_id!==scope.app_id||meta.environment!==scope.environment||
      meta.consumed_at!==null)return null;
   const secret=await deps.verifierStore.readOnceCandidate(stateKey);
   if(typeof secret!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(secret))return null;
   return Object.freeze({
    state:meta.state,provider:meta.provider,app_id:meta.app_id,
    environment:meta.environment,client_id:meta.client_id,
    code_challenge:meta.code_challenge,nonce:meta.nonce,
    code_verifier:secret,expires_at:meta.expires_at,consumed_at:meta.consumed_at,
   });
  },
  async consumeAttemptCAS(request:Parameters<CallbackDependencies['consumeAttemptCAS']>[0]):Promise<boolean>{
   if(!enabled||!state(request.state)||request.provider!==deps.provider||
      request.clientId!==deps.clientId||request.appId!==scope.app_id||
      request.environment!==scope.environment||!epoch(request.now))return false;
   return scoped.consumeOAuthAttemptCAS(request.state,deps.provider,deps.clientId,request.now);
  },
  async readLinkedExistingMember(provider:Provider,subject:string):Promise<CallbackMember|null>{
   if(!enabled||provider!==deps.provider||!id(subject))return null;
   // Fixed SQL. An email match is never an Identity association.
   const row=await deps.db.prepare(
    "SELECT m.s_user_id,m.status,m.auth_version FROM starry_identities i "+
    "JOIN starry_members m ON m.s_user_id=i.s_user_id "+
    "WHERE i.provider=? AND i.subject=? AND m.status='active' LIMIT 1"
   ).bind(provider,subject).first<CallbackMember>();
   if(!row||!id(row.s_user_id)||row.status!=='active'||
     !Number.isSafeInteger(row.auth_version)||row.auth_version<1)return null;
   return Object.freeze({s_user_id:row.s_user_id,status:'active',auth_version:row.auth_version});
  },
  /** Extra guard; NEVER substitutes for createServerIdentityResolver principal. */
  async isCurrentSession(details:Readonly<{
   provider:Provider;subject:string;s_user_id:string;session_id:string;
   auth_version:number;now:number;
  }>):Promise<boolean>{
   if(!enabled||details.provider!==deps.provider||!id(details.subject)||
     !id(details.s_user_id)||!id(details.session_id)||!epoch(details.now)||
     !Number.isSafeInteger(details.auth_version)||details.auth_version<1)return false;
   const row=await deps.db.prepare(
    "SELECT 1 AS allowed FROM starry_sessions s "+
    "JOIN starry_members m ON m.s_user_id=s.s_user_id "+
    "JOIN starry_identities i ON i.s_user_id=m.s_user_id "+
    "WHERE s.session_id=? AND s.s_user_id=? AND s.app_id=? AND s.environment=? "+
    "AND s.auth_version=? AND s.expires_at>? AND s.revoked_at IS NULL "+
    "AND m.status='active' AND m.auth_version=s.auth_version "+
    "AND i.provider=? AND i.subject=? LIMIT 1"
   ).bind(details.session_id,details.s_user_id,scope.app_id,scope.environment,
     details.auth_version,details.now,details.provider,details.subject).first<{allowed:number}>();
   return row?.allowed===1;
  },
 });
}
