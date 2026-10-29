/**
 * M1 / AI-1 — isolated server-side OIDC callback -> durable Starry Session.
 * No HTTP route, no provider URL/fetch, no default runtime binding, no login
 * simulation in production. Real issuer/nonce/JWKS/PKCE verification is owned by
 * the existing createVerifiedOidcCallback; no email/name account linking.
 */
import {createVerifiedOidcCallback, verifyPkceS256} from './oidc-crypto.ts';
import type {OAuthAttempt, PinnedOidcProvider, TrustedOAuthBackend} from './oidc-crypto.ts';
import {signServerSession} from './session-crypto.ts';
import type {SessionSigningKey} from './session-crypto.ts';
import type {D1Database, D1Result} from './d1-ports.ts';
import type {TrustedScope} from './index.ts';
import {createLocalOnlyVNextTypedSelfProfileHandler} from './w3-local-vnext-typed-self-profile.ts';

export const M1_AUTH_LIVE_ENABLED = false as const;
export const M1_AUTH_CONTRACT = 'starry.ai1.m1.oauth-session.local-v1' as const;
type Statement = ReturnType<D1Database['prepare']>;
export type M1WriteDatabase = D1Database & Readonly<{
  /** On a single authoritative SQLite/D1 instance. No cross-D1 atomicity. */
  batch: (statements: Statement[]) => Promise<D1Result[]>;
}>;
type Scope = TrustedScope & {environment: 'development'|'staging'};
type Exchange = TrustedOAuthBackend['exchangeCode'];
type Result = Readonly<{status:'issued'; bearer:string; s_user_id:string; expires_at:number}>;
type Dependencies = Readonly<{
  enabled?:boolean;
  serverScope:Scope;
  expectedOrigin:string;
  authDb:M1WriteDatabase;
  provider:PinnedOidcProvider;
  exchangeCode:Exchange;
  /** Key provider must be server-owned, non-extractable, rotated, never HTTP. */
  activeKey:()=>Promise<SessionSigningKey>;
  getVerificationKey:(kid:string)=>Promise<CryptoKey|null>;
  now:()=>number;
  /** CSPRNG; local tests may inject deterministic generator. */
  randomBytes?:(n:number)=>Uint8Array;
}>;
const id=/^[A-Za-z0-9._:-]{1,180}$/;
const statePattern=/^[A-Za-z0-9_-]{32,256}$/;
const attemptSelect='SELECT state,provider,client_id,code_verifier,code_challenge,nonce,app_id,environment,expires_at,consumed_at FROM starry_m1_oauth_attempts WHERE state=? AND provider=? AND app_id=? AND environment=?';
const attemptConsume='UPDATE starry_m1_oauth_attempts SET consumed_at=? WHERE state=? AND provider=? AND app_id=? AND environment=? AND client_id=? AND consumed_at IS NULL AND expires_at>?';
const identitySelect='SELECT m.s_user_id,m.auth_version FROM starry_identities i JOIN starry_members m ON m.s_user_id=i.s_user_id WHERE i.provider=? AND i.subject=? AND m.status=\'active\'';
const insertSession='INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) SELECT ?,m.s_user_id,?,?,m.auth_version,?,? FROM starry_members m WHERE m.s_user_id=? AND m.status=\'active\' AND m.auth_version=? AND EXISTS (SELECT 1 FROM starry_identities i WHERE i.s_user_id=m.s_user_id AND i.provider=? AND i.subject=?)';
const validTime=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
function secureBytes(n:number):Uint8Array {
  const bytes=new Uint8Array(n);crypto.getRandomValues(bytes);return bytes;
}
function hex(bytes:Uint8Array):string {
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
function validKey(v:SessionSigningKey):boolean {
  return !!v&&id.test(v.kid)&&v.key instanceof CryptoKey&&
    v.key.extractable===false&&v.key.algorithm.name==='HMAC'&&
    v.key.usages.includes('sign')&&v.key.usages.includes('verify');
}
/**
 * The only writer for this local M1 slice. D1 batch must be a transaction.
 * No upsert member, no provider-subject alias and no unapproved registration.
 */
export function createM1LocalAuthSessionCore(deps:Dependencies) {
  const scope=Object.freeze({...deps.serverScope});
  if(scope.brand_id!=='starry'||scope.app_id!=='starry-id'||
    !['development','staging'].includes(scope.environment)||
    !deps.authDb||typeof deps.authDb.prepare!=='function'||typeof deps.authDb.batch!=='function'||
    typeof deps.exchangeCode!=='function'||typeof deps.activeKey!=='function'||
    typeof deps.now!=='function'||typeof deps.getVerificationKey!=='function'||
    !deps.provider||!id.test(deps.provider.clientId)||
    !['google','apple'].includes(deps.provider.provider)||
    (deps.provider.provider==='apple'&&deps.provider.issuer!=='https://appleid.apple.com')||
    (deps.provider.provider==='google'&&!['https://accounts.google.com','accounts.google.com'].includes(deps.provider.issuer)))
    throw Error('M1_AUTH_CONFIGURATION_DENIED');
  const enabled=deps.enabled===true;
  const origin=new URL(deps.expectedOrigin);
  if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash||
    origin.username||origin.password||origin.toString()!==origin.origin+'/')
    throw Error('M1_AUTH_ORIGIN_DENIED');
  const self=createLocalOnlyVNextTypedSelfProfileHandler({
    enabled,serverScope:scope,expectedOrigin:origin.origin,
    authDb:deps.authDb,getVerificationKey:deps.getVerificationKey,now:deps.now,
  });
  const port:TrustedOAuthBackend={
    async readAttempt(state:string):Promise<OAuthAttempt|null>{
      if(!statePattern.test(state))return null;
      const r=await deps.authDb.prepare(attemptSelect).bind(state,deps.provider.provider,scope.app_id,scope.environment).first<{
        state:string;provider:'apple'|'google';client_id:string;code_verifier:string;code_challenge:string;
        nonce:string;app_id:string;environment:Scope['environment'];expires_at:number;consumed_at:number|null;
      }>();
      if(!r||r.state!==state||r.provider!==deps.provider.provider||
        r.client_id!==deps.provider.clientId||r.app_id!==scope.app_id||
        r.environment!==scope.environment||!validTime(r.expires_at)||
        (r.consumed_at!==null&&!validTime(r.consumed_at)))return null;
      return {state:r.state,provider:r.provider,clientId:r.client_id,
        codeVerifier:r.code_verifier,codeChallenge:r.code_challenge,nonce:r.nonce,
        appId:r.app_id,environment:r.environment,expiresAt:r.expires_at,consumedAt:r.consumed_at};
    },
    async consumeAttemptCAS(state,provider,now){
      const r=await deps.authDb.prepare(attemptConsume).bind(now,state,provider,scope.app_id,
        scope.environment,deps.provider.clientId,now).run();
      return r.success!==false&&r.meta?.changes===1;
    },
    exchangeCode:deps.exchangeCode,
  };
  const callback=createVerifiedOidcCallback({
    config:deps.provider,appId:scope.app_id,environment:scope.environment,backend:port,
  });
  return Object.freeze({
    contract:M1_AUTH_CONTRACT,local_only:true as const,live_enabled:M1_AUTH_LIVE_ENABLED,
    async issueFromVerifiedCallback(input:unknown):Promise<Result|null>{
      if(!enabled)return null;
      const now=deps.now();
      if(!validTime(now))return null;
      // The callback validates exact code/state, PKCE, nonce and *real RS256*
      // token against injected pinned JWKS; a fake subject cannot bypass it.
      const verified=await callback(input,now);
      if(!verified||verified.provider!==deps.provider.provider||
        verified.issuer!==deps.provider.issuer||verified.audience!==deps.provider.clientId||
        !id.test(verified.providerSubject))return null;
      const row=await deps.authDb.prepare(identitySelect)
        .bind(verified.provider,verified.providerSubject)
        .first<{s_user_id:string;auth_version:number}>();
      if(!row||!id.test(row.s_user_id)||!Number.isSafeInteger(row.auth_version)||row.auth_version<1)return null;
      const key=await deps.activeKey();
      if(!validKey(key))return null;
      const random=deps.randomBytes??secureBytes;
      const entropy=random(32);
      if(!(entropy instanceof Uint8Array)||entropy.length!==32)return null;
      const sessionId='m1-'+hex(entropy);
      const refresh=random(32);
      if(!(refresh instanceof Uint8Array)||refresh.length!==32)return null;
      const refreshDigest=new Uint8Array(await crypto.subtle.digest('SHA-256',refresh));
      const expiry=now+300;
      // Sign first, then commit. Never return an uncommitted bearer.
      const claims={...scope,provider:verified.provider,provider_subject:verified.providerSubject,
        s_user_id:row.s_user_id,session_id:sessionId,auth_version:row.auth_version,
        issued_at:now,expires_at:expiry,key_id:key.kid};
      const bearer=await signServerSession(claims,scope,now,key);
      // The INSERT SELECT repeats the identity, status, version and scope
      // fence at the actual write, preventing stale pre-read issuance.
      const commit=await deps.authDb.prepare(insertSession).bind(
        sessionId,row.s_user_id,scope.app_id,scope.environment,refreshDigest.length===32?hex(refreshDigest):'',
        expiry,row.s_user_id,row.auth_version,verified.provider,verified.providerSubject,
      ).run();
      if(commit.success===false||commit.meta?.changes!==1)return null;
      return Object.freeze({status:'issued' as const,bearer,s_user_id:row.s_user_id,expires_at:expiry});
    },
    /** Already-verified bearer is passed to unchanged W3 for final Auth fence. */
    readSelf(request:Request):Promise<Response>{return self.handle(request);},
  });
}
