/**
 * Source-only, single Starry M1 Staging Auth COMPOSITION ENTRY.
 *
 * This removes the dangerous manual wiring seam between approved candidate
 * Worker Secret custody, signed Cloudflare Access tester admission and
 * original Google OAuth/D1/Session/Member HTTP ports. No public Worker route,
 * Worker secret provisioning, migration or deployment is performed.
 *
 * IMPORTANT: source configuration alone cannot verify remote Access is
 * actually enforced, a Starry-only D1 exists, billing/rollback/reviewer gates,
 * HTTPS app association, real Google OAuth or mobile device enrollment.
 */
import {createM1SingleAuthHttpComposition} from './m1-single-auth-http-composition.ts';
import {createM1CloudflareAccessAdmission} from './m1-cloudflare-access-admission.ts';
import {createM1StagingWorkerSecretKeyring} from
 './m1-staging-worker-secret-keyring.ts';
import type {M1StagingWorkerKeyMaterial} from
 './m1-staging-worker-secret-keyring.ts';

export const M1_STAGING_SECURE_AUTH_COMPOSITION_LIVE=false as const;
type Base=Parameters<typeof createM1SingleAuthHttpComposition>[0];
export type M1StagingSecureAuthInput=Omit<Base,
 'enabled'|'activeKey'|'getVerificationKey'|'verifierCustody'|
 'authStartAdmission'|'sessionHandoffEnabled'> & Readonly<{
  /** Explicitly selected by an independently approved, NOT-YET-LIVE root. */
  enabled?:boolean;
  /** Server-injected Worker Secret values; never request, JS bundle or Expo. */
  keyMaterial:M1StagingWorkerKeyMaterial;
}>;
/**
 * One owned factory; callers may no longer manually swap Auth keys, PKCE
 * custody or use the old injected synthetic admission callback.
 */
export async function createM1StagingSecureAuthComposition(
 input:M1StagingSecureAuthInput,
){
 if(!input||input.enabled!==true||
   input.serverScope?.brand_id!=='starry'||
   input.serverScope?.app_id!=='starry-id'||
   input.serverScope?.environment!=='staging'||
   !input.authDb||typeof input.authDb.prepare!=='function'||
   typeof input.authDb.batch!=='function'||
   input.googleProvider?.provider!=='google'||
   !input.googleJwksSource||
   typeof input.googleJwksSource.getProvider!=='function'||
   !Array.isArray(input.allowedGoogleTestSubjects)||
   input.allowedGoogleTestSubjects.length<1||
   !input.appReturnUri||
   !input.cloudflareAccessAdmission||
   input.cloudflareAccessAdmission.enabled!==true||
   input.cloudflareAccessAdmission.environment!=='staging'||
   // Even a runtime object cast to this TS Omit must NEVER substitute
   // arbitrary Auth, keyring or synthetic admission callbacks.
   ['activeKey','getVerificationKey','verifierCustody','authStartAdmission']
    .some(key=>Object.hasOwn(input,key)))
  throw Error('M1_STAGING_SECURE_COMPOSITION_DENIED');
 // Validate Access issuer/AUD/testers BEFORE opening any Worker key material.
 // Factory only checks server config; it does NOT fetch or verify remote Access.
 createM1CloudflareAccessAdmission(input.cloudflareAccessAdmission);
 const {keyMaterial,...owned}=input;
 const keyring=await createM1StagingWorkerSecretKeyring({
  enabled:true,appId:'starry-id',environment:'staging',
  material:keyMaterial,
 });
 const auth=createM1SingleAuthHttpComposition({
  ...owned,enabled:true,sessionHandoffEnabled:true,
  activeKey:keyring.activeKey,
  getVerificationKey:keyring.getVerificationKey,
  verifierCustody:keyring.verifierCustody,
 });
 return Object.freeze({
  ...auth,
  contract:'starry.ai0.m1.staging-access-keyring-single-auth.v1' as const,
  source_only:true as const,
  local_only:true as const,
  live_enabled:M1_STAGING_SECURE_AUTH_COMPOSITION_LIVE,
  public_worker_route_registered:false as const,
 });
}
