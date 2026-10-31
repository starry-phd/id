/**
 * M1 / AI-1 — isolated server-side OIDC callback -> durable Starry Session.
 * No HTTP route, no provider URL/fetch, no default runtime binding, no login
 * simulation in production. Real issuer/nonce/JWKS/PKCE verification is owned by
 * the existing createVerifiedOidcCallback; no email/name account linking.
 */
import {bytesToBase64url,createVerifiedOidcCallback} from './oidc-crypto.ts';
import type {OAuthAttempt, PinnedOidcProvider, TrustedOAuthBackend} from './oidc-crypto.ts';
import {signServerSession} from './session-crypto.ts';
import type {SessionSigningKey} from './session-crypto.ts';
import type {D1Database,D1Prepared,D1Result} from './d1-ports.ts';
import type {TrustedScope} from './index.ts';
import {createLocalOnlyVNextTypedSelfProfileHandler} from './w3-local-vnext-typed-self-profile.ts';
import type {M1VerifierBinding,M1VerifierCustody} from './m1-oauth-verifier-custody.ts';

export const M1_AUTH_LIVE_ENABLED = false as const;
export const M1_AUTH_CONTRACT = 'starry.ai1.m1.oauth-session.local-v1' as const;
export type M1WriteDatabase = D1Database & Readonly<{
  /** D1 batch commits all statements atomically or rolls back every statement on SQL error. */
  batch:(statements:D1Prepared[])=>Promise<D1Result[]>;
}>;
type Scope = TrustedScope & {environment: 'development'|'staging'};
type Exchange = TrustedOAuthBackend['exchangeCode'];
type Result = Readonly<{status:'issued'; bearer:string; s_user_id:string; expires_at:number; handoff_code?:string; handoff_expires_at?:number}>;
type Dependencies = Readonly<{
  enabled?:boolean;
  serverScope:Scope;
  expectedOrigin:string;
  authDb:M1WriteDatabase;
  provider:PinnedOidcProvider;
  exchangeCode:Exchange;
  /** Server-owned source of fresh official Google JWKS; no untrusted URLs. */
  getGoogleJwksProvider?:()=>Promise<PinnedOidcProvider|null>;
  /**
   * Server-owned, invitation-only Google signed subjects for staging pilots.
   * Exact verified OIDC sub only, never unverified email/name/client user_id.
   * If required, absent/empty/malformed invites are configuration errors.
   */
  allowedGoogleTestSubjects?:readonly string[];
  requireGoogleTestAllowlist?:boolean;
  /** Optional one-time app handoff; allowed only for sealed, invite-only staging Auth. */
  sessionHandoffEnabled?:boolean;
  /** Optional for backward-compatible local fixtures; REQUIRED for approved remote wiring. */
  verifierCustody?:M1VerifierCustody;
  requireSealedVerifier?:boolean;
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
const newMember='INSERT INTO starry_members(s_user_id,status,auth_version,profile_revision,display_name,directory_opt_in,display_name_public,created_at,updated_at) VALUES(?,\'active\',1,1,NULL,0,0,?,?)';
const newIdentity='INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)';
const auditIntent='INSERT INTO starry_m1_audit_intents(event_id,source_operation_id,event_type,brand_id,app_id,environment,s_user_id,created_at) SELECT ?,?,?,\'starry\',?,?,s_user_id,? FROM starry_sessions WHERE session_id=?';
const insertSession=`INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) SELECT ?,m.s_user_id,?,?,m.auth_version,?,? FROM starry_members m WHERE m.s_user_id=? AND m.status='active' AND m.auth_version=? AND EXISTS (SELECT 1 FROM starry_identities i WHERE i.s_user_id=m.s_user_id AND i.provider=? AND i.subject=?)`;
const insertSessionHandoff='INSERT INTO starry_m1_session_handoffs(handoff_hash,session_id,provider,provider_subject,app_id,environment,created_at,expires_at,consumed_at) SELECT ?,s.session_id,?,?,?,?,?,?,NULL FROM starry_sessions s JOIN starry_members m ON m.s_user_id=s.s_user_id JOIN starry_identities i ON i.provider=? AND i.subject=? AND i.s_user_id=s.s_user_id WHERE s.session_id=? AND s.app_id=? AND s.environment=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.auth_version=m.auth_version AND m.status=\'active\'';
const consumeSessionHandoff='UPDATE starry_m1_session_handoffs AS h SET consumed_at=? WHERE h.handoff_hash=? AND h.app_id=? AND h.environment=? AND h.consumed_at IS NULL AND h.expires_at>? AND EXISTS (SELECT 1 FROM starry_sessions s JOIN starry_members m ON m.s_user_id=s.s_user_id JOIN starry_identities i ON i.provider=h.provider AND i.subject=h.provider_subject AND i.s_user_id=s.s_user_id WHERE s.session_id=h.session_id AND s.app_id=h.app_id AND s.environment=h.environment AND s.revoked_at IS NULL AND s.expires_at>? AND s.auth_version=m.auth_version AND m.status=\'active\')';
const readConsumedSessionHandoff='SELECT s.session_id,s.s_user_id,s.auth_version,s.app_id,s.environment,s.expires_at,h.provider,h.provider_subject FROM starry_m1_session_handoffs h JOIN starry_sessions s ON s.session_id=h.session_id AND s.app_id=h.app_id AND s.environment=h.environment JOIN starry_members m ON m.s_user_id=s.s_user_id JOIN starry_identities i ON i.provider=h.provider AND i.subject=h.provider_subject AND i.s_user_id=s.s_user_id WHERE h.handoff_hash=? AND h.consumed_at=? AND h.app_id=? AND h.environment=? AND h.expires_at>? AND s.revoked_at IS NULL AND s.expires_at>? AND s.auth_version=m.auth_version AND m.status=\'active\'';
const validTime=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
function secureBytes(n:number):Uint8Array {
  const bytes=new Uint8Array(n);crypto.getRandomValues(bytes);return bytes;
}
function hex(bytes:Uint8Array):string {
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
function validKey(v:unknown):v is SessionSigningKey {
  if(!v||typeof v!=='object')return false;
  const candidate=v as Partial<SessionSigningKey>;
  return typeof candidate.kid==='string'&&id.test(candidate.kid)&&
    candidate.key instanceof CryptoKey&&candidate.key.extractable===false&&
    candidate.key.algorithm.name==='HMAC'&&candidate.key.usages.includes('sign')&&
    candidate.key.usages.includes('verify');
}
/**
 * Existing-member M1 issuance uses a guarded single-statement atomic INSERT.
 * First-login multi-table registration/audit is separately gated below.
 */
export function createM1LocalAuthSessionCore(deps:Dependencies) {
  const scope=Object.freeze({...deps.serverScope});
  // Snapshot trusted provider metadata, including individual JWKS records.
  // A caller changing its DI object after an await cannot move our issuer.
  const allowedInput=deps.allowedGoogleTestSubjects;
  const requireAllowlist=deps.requireGoogleTestAllowlist===true;
  // Copy primitives BEFORE any async callback. Later DI mutations cannot
  // silently expand pilot access; the set is private to this Auth instance.
  const allowedSubjects=Array.isArray(allowedInput)?[...allowedInput]:null;
  if((allowedInput!==undefined&&allowedSubjects===null)||
    (deps.requireGoogleTestAllowlist!==undefined&&
      typeof deps.requireGoogleTestAllowlist!=='boolean')||
    ((requireAllowlist||allowedSubjects!==null)&&
      (!allowedSubjects||allowedSubjects.length<1||allowedSubjects.length>32||
       allowedSubjects.some(x=>typeof x!=='string'||!id.test(x))||
       new Set(allowedSubjects).size!==allowedSubjects.length)))
    throw Error('M1_AUTH_TEST_ALLOWLIST_DENIED');
  const pilotAllowedSubjects=allowedSubjects===null?null:new Set(allowedSubjects);
  if(deps.sessionHandoffEnabled!==undefined&&typeof deps.sessionHandoffEnabled!=='boolean')
    throw Error('M1_AUTH_HANDOFF_CONFIGURATION_DENIED');
  const sessionHandoffEnabled=deps.sessionHandoffEnabled===true;
  const provider=deps.provider&&Object.freeze({
    provider:deps.provider.provider,clientId:deps.provider.clientId,
    issuer:deps.provider.issuer,
    jwks:Object.freeze((Array.isArray(deps.provider.jwks)?deps.provider.jwks:[])
      .map(j=>Object.freeze({...j,key_ops:j.key_ops?[...j.key_ops]:undefined}))),
  }) as PinnedOidcProvider;
  if(scope.brand_id!=='starry'||scope.app_id!=='starry-id'||
    !['development','staging'].includes(scope.environment)||
    !deps.authDb||typeof deps.authDb.prepare!=='function'||typeof deps.authDb.batch!=='function'||
    typeof deps.exchangeCode!=='function'||typeof deps.activeKey!=='function'||
    typeof deps.now!=='function'||typeof deps.getVerificationKey!=='function'||
    (deps.getGoogleJwksProvider!==undefined&&
      (typeof deps.getGoogleJwksProvider!=='function'||provider?.provider!=='google'))||
    (deps.verifierCustody!==undefined &&
      (typeof deps.verifierCustody.seal!=='function'||typeof deps.verifierCustody.open!=='function'))||
    (deps.requireSealedVerifier===true&&!deps.verifierCustody)||
    !provider||!id.test(provider.clientId)||
    !['google','apple'].includes(provider.provider)||
    (provider.provider==='apple'&&provider.issuer!=='https://appleid.apple.com')||
    (provider.provider==='google'&&!['https://accounts.google.com','accounts.google.com'].includes(provider.issuer)))
    throw Error('M1_AUTH_CONFIGURATION_DENIED');
  const enabled=deps.enabled===true;
  if(sessionHandoffEnabled&&enabled&&(
    scope.environment!=='staging'||!deps.getGoogleJwksProvider||
    !deps.verifierCustody||deps.requireSealedVerifier!==true||!pilotAllowedSubjects))
    throw Error('M1_AUTH_HANDOFF_CONFIGURATION_DENIED');
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
      const r=await deps.authDb.prepare(attemptSelect).bind(state,provider.provider,scope.app_id,scope.environment).first<{
        state:string;provider:'apple'|'google';client_id:string;code_verifier:string;code_challenge:string;
        nonce:string;app_id:string;environment:Scope['environment'];expires_at:number;consumed_at:number|null;
      }>();
      if(!r||r.state!==state||r.provider!==provider.provider||
        r.client_id!==provider.clientId||r.app_id!==scope.app_id||
        r.environment!==scope.environment||!validTime(r.expires_at)||
        (r.consumed_at!==null&&!validTime(r.consumed_at)))return null;
      // AES-GCM AAD binds exact state/provider/client/app/env/expiry; a DB row
      // mutation or removed key fails closed before consuming OAuth state.
      const binding:M1VerifierBinding={state:r.state,provider:r.provider,
        clientId:r.client_id,appId:r.app_id,environment:r.environment,expiresAt:r.expires_at};
      const verifier=deps.verifierCustody?
        await deps.verifierCustody.open(r.code_verifier,binding):r.code_verifier;
      if(typeof verifier!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))return null;
      return {state:r.state,provider:r.provider,clientId:r.client_id,
        codeVerifier:verifier,codeChallenge:r.code_challenge,nonce:r.nonce,
        appId:r.app_id,environment:r.environment,expiresAt:r.expires_at,consumedAt:r.consumed_at};
    },
    async consumeAttemptCAS(state,callbackProvider,now){
      const r=await deps.authDb.prepare(attemptConsume).bind(now,state,callbackProvider,scope.app_id,
        scope.environment,provider.clientId,now).run();
      return r.success!==false&&r.meta?.changes===1;
    },
    exchangeCode:deps.exchangeCode,
  };
  // The original OIDC callback checks persisted OAuth state/scope/PKCE
  // BEFORE it invokes the trusted Google JWKS reader. No duplicate Auth.
  const callback=createVerifiedOidcCallback({
    config:provider,appId:scope.app_id,environment:scope.environment,
    backend:port,getVerificationProvider:deps.getGoogleJwksProvider,
  });
  return Object.freeze({
    contract:M1_AUTH_CONTRACT,local_only:true as const,live_enabled:M1_AUTH_LIVE_ENABLED,
    async beginOAuthAttempt():Promise<Readonly<{state:string;codeChallenge:string;nonce:string;provider:string}>|null>{
      if(!enabled)return null;
      try {
        const now=deps.now();if(!validTime(now))return null;
        const random=deps.randomBytes??secureBytes;
        const bytes=Array.from({length:3},()=>random(32));
        if(bytes.some(b=>!(b instanceof Uint8Array)||b.length!==32))return null;
        const state=bytesToBase64url(bytes[0]);
        const verifier=bytesToBase64url(bytes[1]);
        const nonce=bytesToBase64url(bytes[2]);
        const challenge=bytesToBase64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
        const issuedAt=deps.now();if(!validTime(issuedAt)||issuedAt<now||issuedAt>now+30)return null;
        const expiresAt=issuedAt+180;
        const binding:M1VerifierBinding={state,provider:provider.provider,
          clientId:provider.clientId,appId:scope.app_id,environment:scope.environment,expiresAt};
        const storedVerifier=deps.verifierCustody?
          await deps.verifierCustody.seal(verifier,binding):verifier;
        if(typeof storedVerifier!=='string'||storedVerifier.length<43||storedVerifier.length>512)return null;
        const afterSeal=deps.now();
        if(!validTime(afterSeal)||afterSeal<issuedAt||afterSeal>issuedAt+30)return null;
        const written=await deps.authDb.prepare('INSERT INTO starry_m1_oauth_attempts(state,provider,client_id,code_verifier,code_challenge,nonce,app_id,environment,expires_at,consumed_at) VALUES(?,?,?,?,?,?,?,?,?,NULL)')
          .bind(state,provider.provider,provider.clientId,storedVerifier,challenge,nonce,scope.app_id,scope.environment,expiresAt).run();
        if(written.success===false||written.meta?.changes!==1)return null;
        return Object.freeze({state,codeChallenge:challenge,nonce,provider:provider.provider});
      }catch{return null;}
    },
    async issueFromVerifiedCallback(input:unknown):Promise<Result|null>{
      if(!enabled)return null;
      try {
      const now=deps.now();
      if(!validTime(now))return null;
      // The callback validates exact code/state, PKCE, nonce and *real RS256*
      // token against injected pinned JWKS; a fake subject cannot bypass it.
      const verified=await callback(input,now);
      if(!verified||verified.provider!==provider.provider||
        verified.issuer!==provider.issuer||verified.audience!==provider.clientId||
        !id.test(verified.providerSubject))return null;
      // Signed Google subject is the ONLY invitation authority. An uninvited
      // valid Google account may not read existing membership, register a
      // new private member, issue a Session or write an issuance audit.
      // OAuth state has already been consumed by the original one-time CAS.
      if(pilotAllowedSubjects&&!pilotAllowedSubjects.has(verified.providerSubject))
        return null;
      const known=await deps.authDb.prepare(identitySelect)
        .bind(verified.provider,verified.providerSubject)
        .first<{s_user_id:string;auth_version:number}>();
      if(known&&(!id.test(known.s_user_id)||!Number.isSafeInteger(known.auth_version)||known.auth_version<1))return null;
      const random=deps.randomBytes??secureBytes;
      const memberEntropy=known?null:random(24);
      if(!known&&(!(memberEntropy instanceof Uint8Array)||memberEntropy.length!==24))return null;
      const row=known??{s_user_id:'su-'+hex(memberEntropy!),auth_version:1};
      const suppliedKey=await deps.activeKey();
      const key=suppliedKey&&Object.freeze({kid:suppliedKey.kid,key:suppliedKey.key});
      if(!validKey(key))return null;
      const entropy=random(32);
      if(!(entropy instanceof Uint8Array)||entropy.length!==32)return null;
      const sessionId='m1-'+hex(entropy);
      const refresh=random(32);
      if(!(refresh instanceof Uint8Array)||refresh.length!==32)return null;
      const handoffEntropy=sessionHandoffEnabled?random(32):null;
      if(sessionHandoffEnabled&&(!(handoffEntropy instanceof Uint8Array)||handoffEntropy.length!==32))return null;
      const handoffCode=handoffEntropy?bytesToBase64url(handoffEntropy):null;
      let handoffHash:string|null=null;
      if(handoffEntropy){
        const handoffBuffer=new ArrayBuffer(handoffEntropy.byteLength);
        new Uint8Array(handoffBuffer).set(handoffEntropy);
        handoffHash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',handoffBuffer)));
      }
      const refreshBuffer=new ArrayBuffer(refresh.length);
      new Uint8Array(refreshBuffer).set(refresh);
      const refreshDigest=new Uint8Array(await crypto.subtle.digest('SHA-256',refreshBuffer));
      const committedAt=deps.now();
      if(!validTime(committedAt)||committedAt<now||committedAt>now+30)return null;
      const expiry=committedAt+300;
      // Sign first, then commit. Never return an uncommitted bearer.
      const claims={...scope,provider:verified.provider,provider_subject:verified.providerSubject,
        s_user_id:row.s_user_id,session_id:sessionId,auth_version:row.auth_version,
        issued_at:committedAt,expires_at:expiry,key_id:key.kid};
      const bearer=await signServerSession(claims,scope,committedAt,key);
      const atWrite=deps.now();
      if(!validTime(atWrite)||atWrite<committedAt||atWrite>now+30||atWrite>=expiry)return null;
      const handoffExpiry=sessionHandoffEnabled?Math.min(expiry,atWrite+60):null;
      // The INSERT SELECT repeats the identity, status, version and scope
      // fence at the actual write, preventing stale pre-read issuance.
      const statements:D1Prepared[]=[];
      if(!known){
        statements.push(deps.authDb.prepare(newMember).bind(row.s_user_id,atWrite,atWrite));
        statements.push(deps.authDb.prepare(newIdentity).bind(verified.provider,verified.providerSubject,row.s_user_id));
      }
      statements.push(deps.authDb.prepare(insertSession).bind(
        sessionId,scope.app_id,scope.environment,hex(refreshDigest),
        expiry,row.s_user_id,row.auth_version,verified.provider,verified.providerSubject,
      ));
      if(sessionHandoffEnabled){
        statements.push(deps.authDb.prepare(insertSessionHandoff).bind(
          handoffHash!,verified.provider,verified.providerSubject,scope.app_id,
          scope.environment,atWrite,handoffExpiry!,verified.provider,
          verified.providerSubject,sessionId,scope.app_id,scope.environment,atWrite,
        ));
      }
      statements.push(deps.authDb.prepare(auditIntent).bind(
        sessionId+':session',sessionId,'session_issued',scope.app_id,scope.environment,atWrite,sessionId,
      ));
      if(!known)statements.push(deps.authDb.prepare(auditIntent).bind(
        sessionId+':member',sessionId,'member_registered',scope.app_id,scope.environment,atWrite,sessionId,
      ));
      // A single authoritative SQLite/D1 batch is transactional: UNIQUE/FK
      // collision at ANY statement rolls back the member, link, session, audit.
      const committed=await deps.authDb.batch(statements);
      if(committed.length!==statements.length||committed.some(v=>v.success===false||v.meta?.changes!==1))
        return null;
      return Object.freeze(sessionHandoffEnabled?{
        status:'issued' as const,bearer,s_user_id:row.s_user_id,expires_at:expiry,
        handoff_code:handoffCode!,handoff_expires_at:handoffExpiry!,
      }:{status:'issued' as const,bearer,s_user_id:row.s_user_id,expires_at:expiry});
      } catch { return null; } // Never emit raw SQL / KMS / token error details.
    },
    /** Consume a one-time hash-only app handoff and re-sign only the still-current D1 Session. */
    async redeemSessionHandoff(input:unknown):Promise<Result|null>{
      if(!enabled||!sessionHandoffEnabled||typeof input!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(input))return null;
      try{
        const now=deps.now();if(!validTime(now))return null;
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));
        const hash=hex(new Uint8Array(digest));
        const consumed=await deps.authDb.prepare(consumeSessionHandoff).bind(
          now,hash,scope.app_id,scope.environment,now,now,
        ).run();
        if(consumed.success===false||consumed.meta?.changes!==1)return null;
        const row=await deps.authDb.prepare(readConsumedSessionHandoff).bind(
          hash,now,scope.app_id,scope.environment,now,now,
        ).first<{
          session_id:string;s_user_id:string;auth_version:number;app_id:string;
          environment:string;expires_at:number;provider:'google'|'apple';provider_subject:string;
        }>();
        if(!row||!id.test(row.session_id)||!id.test(row.s_user_id)||
          !Number.isSafeInteger(row.auth_version)||row.auth_version<1||
          row.app_id!==scope.app_id||row.environment!==scope.environment||
          !validTime(row.expires_at)||row.expires_at<=now||
          !['google','apple'].includes(row.provider)||!id.test(row.provider_subject))return null;
        const suppliedKey=await deps.activeKey();
        const key=suppliedKey&&Object.freeze({kid:suppliedKey.kid,key:suppliedKey.key});
        if(!validKey(key))return null;
        const claims={...scope,provider:row.provider,provider_subject:row.provider_subject,
          s_user_id:row.s_user_id,session_id:row.session_id,auth_version:row.auth_version,
          issued_at:now,expires_at:row.expires_at,key_id:key.kid};
        const bearer=await signServerSession(claims,scope,now,key);
        return Object.freeze({status:'issued' as const,bearer,
          s_user_id:row.s_user_id,expires_at:row.expires_at});
      }catch{return null;}
    },
    /** Already-verified bearer is passed to unchanged W3 for final Auth fence. */
    readSelf(request:Request):Promise<Response>{return self.handle(request);},
  });
}
