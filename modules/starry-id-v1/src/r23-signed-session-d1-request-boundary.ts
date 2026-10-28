/**
 * AI-1 R23: real WebCrypto-signed Bearer -> current Auth D1 verified principal.
 * NOT a deployed Worker route, issuer, token mint, or public AuthClient.
 * Safe for isolated/offline DEV/STAGING composition only until legal/live Gate.
 */
import {createVerifiedSignedSession} from './session-crypto.ts';
import {createStarryD1Port} from './d1-ports.ts';
import {createServerIdentityResolver} from './index.ts';
import type {TrustedPrincipal,TrustedScope} from './index.ts';
import type {D1Database} from './d1-ports.ts';

export const R23_HTTP_AUTH_LIVE_ENABLED=false as const;
export const R23_HTTP_AUTH_PRODUCTION_APPROVED=false as const;
export const R23_HTTP_AUTH_CONTRACT='starry.auth.request-boundary.r23-offline' as const;
const validApp=(id:unknown):id is string=>
 typeof id==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(id);
const validNow=(v:unknown):v is number=>
 typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const BEARER=/^Bearer (v1\.[A-Za-z0-9_-]{1,4000}\.[A-Za-z0-9_-]{43})$/;
const own=(v:unknown):v is Request=>
 v instanceof Request;
export function createOfflineStarryRequestAuthBoundary(deps:Readonly<{
 enabled?:boolean;
 serverScope:TrustedScope;
 expectedOrigin:string;
 authDb:D1Database;
 /** AI-4 must later bind this to an approved managed server key ring. */
 getVerificationKey:(kid:string)=>Promise<CryptoKey|null>;
}>) {
 const s=deps.serverScope;
 // A dev/staging-only executable bridge; NEVER self-authorizes Production.
 if(!s||s.brand_id!=='starry'||!validApp(s.app_id)||
  (s.environment!=='development'&&s.environment!=='staging')||
  !deps.authDb||typeof deps.authDb.prepare!=='function'||
  typeof deps.getVerificationKey!=='function')
  throw Error('R23_AUTH_BOUNDARY_SCOPE_OR_PORT_DENIED');
 const origin=new URL(deps.expectedOrigin);
 if(origin.protocol!=='https:'||origin.username||origin.password||
  origin.search||origin.hash||origin.pathname!=='/'||
  origin.toString()!==origin.origin+'/')
  throw Error('R23_AUTH_BOUNDARY_ORIGIN_DENIED');
 const scope=Object.freeze({...s});
 const permittedOrigin=origin.origin;
 const db=createStarryD1Port(deps.authDb,scope);
 const signatureVerifier=createVerifiedSignedSession({
  scope,getKey:deps.getVerificationKey
 });
 const enabled=deps.enabled===true;
 return Object.freeze({
  contract:R23_HTTP_AUTH_CONTRACT,
  /** Returns sealed server principal ONLY; no HTTP success response or PII. */
  async authenticate(request:unknown,serverNow:unknown):Promise<TrustedPrincipal|null>{
   if(!enabled||!validNow(serverNow)||!own(request))return null;
   try{
    const url=new URL(request.url);
    if(url.origin!==permittedOrigin||url.search||url.hash||
     (request.method!=='GET'&&request.method!=='POST')||
     request.headers.has('cookie')||
     request.headers.has('proxy-authorization')||
     request.headers.has('x-forwarded-authorization'))return null;
    const header=request.headers.get('authorization');
    if(!header||header.length>8192)return null;
    const bearer=BEARER.exec(header);
    if(!bearer)return null;
    // Bind verifier to trusted time and actual server-owned scope,
    // then immediately read current Member+Session+Provider link in D1.
    const resolve=createServerIdentityResolver({
     trusted_scope:scope,
     verify_oidc_or_session:opaque=>signatureVerifier(opaque,serverNow),
     read_member:db.readMember,
     read_session:db.readSession,
     identity_matches:db.identityMatches
    });
    return await resolve(bearer[1],serverNow);
   }catch{return null;} // including real database/auth key ring outage.
  }
 });
}
