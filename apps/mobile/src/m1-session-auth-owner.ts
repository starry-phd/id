/**
 * AI-0/AI-4 mobile Auth owner composition.
 *
 * One volatile Session source is shared by the one-time callback exchange,
 * profile and deletion-request SDK ports. No second Auth, persistence, refresh,
 * public route or live-enable switch is introduced.
 */
import {createM1SessionHandoffClient} from '../../../packages/sdk/src/m1-session-handoff-client.ts';
import {createM1SessionBoundMemberPorts} from './m1-session-bound-member-ports.ts';
import {createM1MobileBrowserLoginLauncher} from './m1-staging-google-login-launcher.ts';

export const M1_MOBILE_SESSION_AUTH_OWNER_LIVE=false as const;
export type M1MobileSessionAuthOwnerConfig=Readonly<{
 enabled?:boolean;
 appId:'starry-id';
 environment:'staging';
 baseUrl:string;
 appReturnUri:string;
 fetchImpl?:typeof fetch;
 /** Explicit reviewed system-browser port; absent means login start is OFF. */
 openLoginBrowser?:(startUri:string,returnUri:string)=>Promise<
  Readonly<{type:'success'|'cancel'|'dismiss'|'error';url?:string}>>;
 now?:()=>number;
}>;
export function createM1MobileSessionAuthOwner(config:M1MobileSessionAuthOwnerConfig){
 if(!config||config.appId!=='starry-id'||config.environment!=='staging')
  throw Error('M1_MOBILE_AUTH_OWNER_SCOPE_DENIED');
 const handoff=createM1SessionHandoffClient({
  enabled:config.enabled,appId:config.appId,baseUrl:config.baseUrl,
  appReturnUri:config.appReturnUri,fetchImpl:config.fetchImpl,now:config.now,
 });
 const launcher=createM1MobileBrowserLoginLauncher({
  enabled:config.enabled,appId:config.appId,environment:config.environment,
  baseUrl:config.baseUrl,appReturnUri:config.appReturnUri,
  openLoginBrowser:config.openLoginBrowser,
  acceptReturnUrl:handoff.acceptReturnUrl,
  clearSession,
 });
 // A server-confirmed logout must also cancel an in-flight browser attempt.
 const clearSession=()=>launcher.cancelPendingLogin();
 const ports=createM1SessionBoundMemberPorts({
  enabled:config.enabled,appId:config.appId,environment:config.environment,
  baseUrl:config.baseUrl,fetchImpl:config.fetchImpl,
  getSessionBearer:handoff.getSessionBearer,
  clearSession:handoff.clearSession,
 });
 return Object.freeze({
  contract:'starry.ai0.m1.mobile-session-auth-owner.v1' as const,
  source_only:true as const,
  live_enabled:M1_MOBILE_SESSION_AUTH_OWNER_LIVE,
  acceptReturnUrl:handoff.acceptReturnUrl,
  startGoogleLogin:launcher.startGoogleLogin,
  getSessionBearer:handoff.getSessionBearer,
  sessionExpiresAt:handoff.sessionExpiresAt,
  clearSession,
  profile:ports.profile,
  deletionForUser:ports.deletionForUser,
 });
}
