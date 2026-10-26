/**
 * AI-4 Round4 OFFLINE-ONLY composition. NOT imported by apps/api/src/index.ts.
 * Real AI-1 WebCrypto verifier + AI-1 D1-shaped prepared reads + AI-1 principal.
 * Test fixture DB and ephemeral signing keys are supplied by integration tests.
 * No true Google/Apple JWKS, provider callback, D1 binding or remote calls here.
 */
import {createVerifiedSignedSession} from '../../../modules/starry-id-v1/src/session-crypto.ts';
import {createStarryD1Port} from '../../../modules/starry-id-v1/src/d1-ports.ts';
import {createMemberReadContract} from '../src/member-contract.ts';
import type {D1Database} from '../../../modules/starry-id-v1/src/d1-ports.ts';
import type {TrustedScope} from '../../../modules/starry-id-v1/src/index.ts';

export type OfflineMemberWorkerPorts=Readonly<{
 scope:TrustedScope;
 db:D1Database;
 nowSeconds:()=>number;
 resolveServerSessionKey:(kid:string)=>Promise<CryptoKey|null>;
}>;
export function createOfflineRound4MemberWorker(ports:OfflineMemberWorkerPorts) {
 const scope=Object.freeze({...ports.scope});
 if(scope.brand_id!=='starry'||scope.app_id!=='starry-id'
    ||(scope.environment!=='staging'&&scope.environment!=='development'))
   throw new Error('OFFLINE_BRAND_SCOPE_DENIED');
 const d1=createStarryD1Port(ports.db,scope);
 const verify=createVerifiedSignedSession({scope,getKey:ports.resolveServerSessionKey});
 return createMemberReadContract({
  trusted_scope:scope,nowSeconds:ports.nowSeconds,
  verify_oidc_or_session:async opaque=>{
   if(!(opaque instanceof Request))return null;
   const authorization=opaque.headers.get('authorization');
   if(!authorization?.startsWith('Bearer '))return null;
   return verify(authorization.slice(7),ports.nowSeconds());
  },
  read_member:d1.readMember,read_session:d1.readSession,identity_matches:d1.identityMatches,
 });
}
