/**
 * M1 single React Native app-lifecycle root, SOURCE-ONLY and default OFF.
 *
 * Owns exactly ONE volatile Starry Session Auth owner for browser start,
 * OS cold-start/foreground Universal Links, profile and deletion receipts.
 * App unmount disposes its native URL listener and clears pending Session.
 *
 * A real Expo root MUST NOT import/enable this until isolated Staging Worker,
 * Access, official Google OAuth, App Links/AASA/assetlinks, real Secrets,
 * costs/rollback, signed device and independent security gates are proved.
 * This file is not registered by Expo Router, public API or Wrangler.
 */
import {createM1MobileSessionAuthOwner} from './m1-session-auth-owner.ts';
import type {M1MobileSessionAuthOwnerConfig} from './m1-session-auth-owner.ts';
import {createM1NativeLinkReceiver} from './m1-native-link-receiver.ts';
import type {M1NativeLinkReceiverConfig} from './m1-native-link-receiver.ts';
import {M2DeletionClientError} from
 '../../../packages/sdk/src/m2-local-deletion-request-client.ts';

export const M1_NATIVE_SESSION_ROOT_LIVE=false as const;
export const M1_NATIVE_SESSION_ROOT_CONTRACT=
 'starry.ai0.m1.single-native-session-root.v1' as const;

export type M1NativeSessionRootConfig=M1MobileSessionAuthOwnerConfig&
 Pick<M1NativeLinkReceiverConfig,'linking'|'onStatus'>;

/** Explicit lifetime: start once, then stop permanently on App root unmount. */
export function createM1NativeSessionRoot(config:M1NativeSessionRootConfig){
 if(!config||config.appId!=='starry-id'||config.environment!=='staging'||
   (config.enabled!==undefined&&typeof config.enabled!=='boolean')||
   (config.enabled===true&&typeof config.openLoginBrowser!=='function'))
  throw Error('M1_NATIVE_ROOT_CONFIG_DENIED');
 const enabled=config.enabled===true;
 const owner=createM1MobileSessionAuthOwner({
  enabled:config.enabled,appId:'starry-id',environment:'staging',
  baseUrl:config.baseUrl,appReturnUri:config.appReturnUri,
  fetchImpl:config.fetchImpl,
  openLoginBrowser:config.openLoginBrowser,now:config.now,
 });
 const receiver=createM1NativeLinkReceiver({
  enabled:config.enabled,appId:'starry-id',environment:'staging',
  appReturnUri:config.appReturnUri,
  owner,linking:config.linking,onStatus:config.onStatus,
 });
 let started=false;
 let closed=false;
 const active=()=>started&&!closed;
 // A result from the old member must never reach the new screen after an OS
 // link, another browser login, logout, or root unmount. Credentials stay
 // private to this closure and never become a UI-facing property.
 const selected=async():Promise<string>=>{
  if(!active())throw Error('STARRY_SELF_SESSION_REQUIRED');
  let bearer:string|null;
  try{bearer=await owner.getSessionBearer();}
  catch{throw Error('STARRY_SELF_SESSION_REQUIRED');}
  if(!active()||!bearer)throw Error('STARRY_SELF_SESSION_REQUIRED');
  return bearer;
 };
 const sameMember=async(bearer:string):Promise<void>=>{
  const current=await selected();
  if(current!==bearer)throw Error('STARRY_SELF_IDENTITY_CHANGED');
 };
 const profileOperation=async <T>(run:()=>Promise<T>):Promise<T>=>{
  if(!enabled)return run(); // Preserve the original explicit OFF error.
  const bearer=await selected();
  // Verify even if the HTTP request failed: a late failure must not override
  // a new member's screen with the old request's status.
  const result=await run().then(
   value=>({ok:true as const,value}),
   error=>({ok:false as const,error}),
  );
  await sameMember(bearer);
  if(!result.ok)throw result.error;
  return result.value;
 };
 const deletionOperation=async <T>(
  run:()=>Promise<T>,createdForSession:string,
 ):Promise<T>=>{
  let bearer:string;
  try{bearer=await selected();}
  catch{throw new M2DeletionClientError('SESSION_REQUIRED');}
  // Cached screen ports belong to the original Session, not merely the
  // member ID. A fresh B Session may belong to the SAME member.
  if(bearer!==createdForSession)
   throw new M2DeletionClientError('UNAUTHORIZED');
  const result=await run().then(
   value=>({ok:true as const,value}),
   error=>({ok:false as const,error}),
  );
  let current:string;
  try{current=await selected();}
  catch{throw new M2DeletionClientError('SESSION_REQUIRED');}
  if(current!==bearer)throw new M2DeletionClientError('UNAUTHORIZED');
  if(!result.ok)throw result.error;
  return result.value;
 };
 const profile=Object.freeze({
  // Deliberately OMIT unfenced patchSelf: UI may mutate only the confirmed
  // member id via the existing server CAS + preflight owner check.
  getSelf:()=>profileOperation(()=>owner.profile.getSelf()),
  patchSelfForUser:(userId:string,revision:number,
   patch:Parameters<typeof owner.profile.patchSelfForUser>[2])=>
   profileOperation(()=>owner.profile.patchSelfForUser(userId,revision,patch)),
  async logout():Promise<void>{
   if(!enabled)return owner.profile.logout();
   if(!active())throw Error('STARRY_SELF_SESSION_REQUIRED');
   await owner.profile.logout();
   if(!active())throw Error('STARRY_SELF_SESSION_REQUIRED');
  },
 });
 return Object.freeze({
  contract:M1_NATIVE_SESSION_ROOT_CONTRACT,
  source_only:true as const,
  live_enabled:M1_NATIVE_SESSION_ROOT_LIVE,
  /** No native listener, network, or browser launch in disabled mode. */
  start():void{
   if(!enabled)throw Error('M1_NATIVE_ROOT_DISABLED');
   if(closed||started)throw Error('M1_NATIVE_ROOT_ALREADY_STARTED');
   try{receiver.start();started=true;}
   catch{
    owner.clearSession();
    throw Error('M1_NATIVE_ROOT_START_FAILED');
   }
  },
  /** Idempotent root unmount. No resurrection or reuse of the old Auth owner. */
  stop():void{
   if(closed)return;
   closed=true;
   if(started)receiver.stop();
   else owner.clearSession();
   started=false;
  },
  async startGoogleLogin(){
   if(!active())throw Error('M1_NATIVE_ROOT_INACTIVE');
   return owner.startGoogleLogin();
  },
  /** Only the already-Auth-owned scoped member SDK ports reach the UI. */
  profile,
  deletionForUser(expectedUserId:string){
   if(!active())throw Error('M1_NATIVE_ROOT_INACTIVE');
   const port=owner.deletionForUser(expectedUserId);
   // Capture the one Auth Session as the UI obtains this owner-bound port.
   // selected() starts its read immediately; a resolved null represents an
   // unauthenticated screen, and never becomes an unhandled rejection.
   // No token is returned from this root or persisted on the device.
   const originalSession=selected().then(token=>token,()=>null);
   const forOriginalSession=async <T>(
    send:()=>Promise<T>,
   ):Promise<T>=>{
    const bearer=await originalSession;
    if(!bearer)throw new M2DeletionClientError('SESSION_REQUIRED');
    return deletionOperation(send,bearer);
   };
   return Object.freeze({
    getStatus:()=>forOriginalSession(()=>port.getStatus()),
    requestDeletion:()=>forOriginalSession(()=>port.requestDeletion()),
    confirmDeletion:(id:string)=>forOriginalSession(
     ()=>port.confirmDeletion(id)),
   });
  },
  sessionExpiresAt():number|null{
   return active()?owner.sessionExpiresAt():null;
  },
  // Intentionally no bearer/getSessionBearer, no second Auth or storage.
 });
}
