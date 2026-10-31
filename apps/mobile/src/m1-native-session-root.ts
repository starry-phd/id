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

/** React Native AppState 'change' observer, injected from an approved Expo
 * root: no new global state, navigation listener or independent Auth owner. */
export type M1NativeAppStatePort=Readonly<{
 addEventListener:(kind:'change',listener:(nextState:string)=>void)=>
  Readonly<{remove:()=>void}>;
}>;
export type M1NativeSessionRootConfig=M1MobileSessionAuthOwnerConfig&
 Pick<M1NativeLinkReceiverConfig,'linking'|'onStatus'>&
 Readonly<{appState:M1NativeAppStatePort}>;

/** Explicit lifetime: start once, then stop permanently on App root unmount. */
export function createM1NativeSessionRoot(config:M1NativeSessionRootConfig){
 if(!config||config.appId!=='starry-id'||config.environment!=='staging'||
   (config.enabled!==undefined&&typeof config.enabled!=='boolean')||
   (config.enabled===true&&typeof config.openLoginBrowser!=='function')||
   (config.enabled===true&&(!config.appState||
    typeof config.appState.addEventListener!=='function')))
  throw Error('M1_NATIVE_ROOT_CONFIG_DENIED');
 const enabled=config.enabled===true;
 // A stable, token-free revision stream for a mounted member screen.
 // Every Auth owner switch invalidates its previously rendered profile even
 // when the member screen's scoped SDK port object stays referentially equal.
 let revision=0;
 const revisionListeners=new Set<()=>void>();
 const advanceRevision=()=>{
  revision++;
  for(const callback of revisionListeners){
   try{callback();}catch{/* observation is not Auth authority */}
  }
 };
 const owner=createM1MobileSessionAuthOwner({
  enabled:config.enabled,appId:'starry-id',environment:'staging',
  baseUrl:config.baseUrl,appReturnUri:config.appReturnUri,
  fetchImpl:config.fetchImpl,
  openLoginBrowser:config.openLoginBrowser,now:config.now,
 });
 let started=false;
 let closed=false;
 const active=()=>started&&!closed;
 let appStateSubscription:Readonly<{remove:()=>void}>|null=null;
 let expiryTimer:ReturnType<typeof setTimeout>|null=null;
 const cancelExpiry=()=>{
  if(expiryTimer!==null)clearTimeout(expiryTimer);
  expiryTimer=null;
 };
 // The Auth SDK clears expired credentials only when read; a mounted UI can
 // otherwise continue displaying an old name indefinitely without another
 // request. Schedule a token-free revision at the actual Session deadline.
 const scheduleExpiry=()=>{
  cancelExpiry();
  if(!active())return;
  const expiresAt=owner.sessionExpiresAt();
  if(expiresAt===null)return;
  let now:number;
  try{now=(config.now??(()=>Math.floor(Date.now()/1000)))();}
  catch{owner.clearSession();advanceRevision();return;}
  if(!Number.isSafeInteger(now)||now<0){
   owner.clearSession();advanceRevision();return;
  }
  const millis=Math.min(Math.max(1,(expiresAt-now)*1000),2147483647);
  try{
   const timer=setTimeout(()=>{
    expiryTimer=null;
    if(!active())return;
    if(owner.sessionExpiresAt()===null){
     // The owner has purged the expired credential. The same Auth-owned
     // React profile port must now hide its previously loaded member.
     advanceRevision();
    }else scheduleExpiry(); // Clock skew, long expiry, or suspended timer.
   },millis);
   expiryTimer=timer;
   // Native setTimeout handles are numbers; Node timers are objects.
   // Inspect as unknown so TypeScript does not assume an object is impossible.
   const nodeTimer:unknown=timer;
   if(nodeTimer!==null&&typeof nodeTimer==='object'&&
      'unref' in nodeTimer&&typeof nodeTimer.unref==='function')
    nodeTimer.unref();
  }catch{
   // If a platform cannot schedule expiry, never continue with a credential
   // that might remain displayed beyond its deadline.
   owner.clearSession();advanceRevision();
  }
 };
 // JS timers may be delayed while iOS/Android suspends the app. The
 // foreground event is a second deadline check; it never performs a GET,
 // emits a bearer, restores an expired Session or claims background execution.
 const checkForegroundExpiry=()=>{
  if(!active()||expiryTimer===null)return;
  if(owner.sessionExpiresAt()===null){
   cancelExpiry();
   advanceRevision();
  }else scheduleExpiry();
 };
 const receiver=createM1NativeLinkReceiver({
  enabled:config.enabled,appId:'starry-id',environment:'staging',
  appReturnUri:config.appReturnUri,
  owner,linking:config.linking,
  onHandoffStart:()=>{cancelExpiry();advanceRevision();},
  onStatus:status=>{
   // A failed exchange was already hidden before its async network request.
   if(status.type==='authenticated'){
    advanceRevision();scheduleExpiry();
   }
   try{config.onStatus?.(status);}catch{/* UI callback is not Auth */}
  },
 });
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
 const profileOperation=async <T>(
  run:(bearer:string)=>Promise<T>,expectedRevision?:number,
 ):Promise<T>=>{
  if(!enabled)return run(''); // Preserve the original explicit OFF error.
  if(expectedRevision!==undefined&&revision!==expectedRevision)
   throw Error('STARRY_SELF_IDENTITY_CHANGED');
  const bearer=await selected();
  // Reject a stale render generation BEFORE creating any network request.
  if(expectedRevision!==undefined&&revision!==expectedRevision)
   throw Error('STARRY_SELF_IDENTITY_CHANGED');
  // Verify even if the HTTP request failed: a late failure must not override
  // a new member's screen with the old request's status.
  const result=await run(bearer).then(
   value=>({ok:true as const,value}),
   error=>({ok:false as const,error}),
  );
  await sameMember(bearer);
  if(expectedRevision!==undefined&&revision!==expectedRevision)
   throw Error('STARRY_SELF_IDENTITY_CHANGED');
  if(!result.ok)throw result.error;
  return result.value;
 };
 const deletionOperation=async <T>(
  run:()=>Promise<T>,createdForSession:string,renderRevision:number,
 ):Promise<T>=>{
  if(!active())throw new M2DeletionClientError('SESSION_REQUIRED');
  if(revision!==renderRevision)throw new M2DeletionClientError('UNAUTHORIZED');
  let bearer:string;
  try{bearer=await selected();}
  catch{throw new M2DeletionClientError('SESSION_REQUIRED');}
  // The same member may own two different signed Sessions. A stale screen
  // cannot borrow either the newer bearer or the newer display generation.
  if(bearer!==createdForSession||revision!==renderRevision)
   throw new M2DeletionClientError('UNAUTHORIZED');
  const result=await run().then(
   value=>({ok:true as const,value}),
   error=>({ok:false as const,error}),
  );
  let current:string;
  try{current=await selected();}
  catch{throw new M2DeletionClientError('SESSION_REQUIRED');}
  if(current!==bearer||revision!==renderRevision)
   throw new M2DeletionClientError('UNAUTHORIZED');
  if(!result.ok)throw result.error;
  return result.value;
 };
 const subscribeRevision=(listener:()=>void)=>{
  if(typeof listener!=='function'||closed)return ()=>{};
  revisionListeners.add(listener);
  return ()=>{revisionListeners.delete(listener);};
 };
 const profile=Object.freeze({
  /** The already-Auth-owned UI port carries its own token-free revision
   * subscription. Screens need no separate global Auth state or bearer. */
  getSessionRevision:()=>revision,
  subscribeSessionRevision:subscribeRevision,
  // Deliberately OMIT unfenced patchSelf: UI may mutate only the confirmed
  // member id via the existing server CAS + preflight owner check.
  getSelf:()=>profileOperation(()=>owner.profile.getSelf()),
  patchSelfForUser:(userId:string,profileRevision:number,
   patch:Parameters<typeof owner.profile.patchSelfForUser>[2],
   expectedSessionRevision?:number)=>{
   if(!enabled)return owner.profile.patchSelfForUser(
    userId,profileRevision,patch);
   // The screen must carry the token-free Session revision of the profile
   // it actually rendered; a stale same-member callback cannot borrow B.
   if(typeof expectedSessionRevision!=='number'||
      !Number.isSafeInteger(expectedSessionRevision)||
      expectedSessionRevision!==revision)
    return Promise.reject(Error('STARRY_SELF_IDENTITY_CHANGED'));
   return profileOperation(
    bearer=>owner.profile.patchSelfForCapturedSession(
     userId,profileRevision,patch,bearer),
    expectedSessionRevision);
  },
  async logout():Promise<void>{
   if(!enabled)return owner.profile.logout();
   if(!active())throw Error('STARRY_SELF_SESSION_REQUIRED');
   try{await owner.profile.logout();}
   finally{
    // Whether success or an ambiguous lost 204, the old UI must re-check
    // the only Auth owner before showing any member again.
    if(active()){
     advanceRevision();
     scheduleExpiry(); // A failed/ambiguous revoke may leave a live owner.
    }
   }
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
   try{
    // Require an actual native foreground listener before accepting any
    // Auth handoff. Otherwise a paused JS timer may leave old PII visible.
    const subscription=config.appState.addEventListener('change',state=>{
     if(state==='active')checkForegroundExpiry();
    });
    if(!subscription||typeof subscription.remove!=='function')
     throw Error('M1_NATIVE_ROOT_APPSTATE_REGISTER_DENIED');
    appStateSubscription=subscription;
    receiver.start();started=true;
   }catch{
    try{appStateSubscription?.remove();}catch{/* UI cleanup cannot authorize */}
    appStateSubscription=null;
    // Receiver may have started before its registration failed; never leave
    // an OS URL listener attached to an inactive or partially mounted root.
    try{receiver.stop();}catch{/* fail closed regardless */}
    cancelExpiry();
    owner.clearSession();
    throw Error('M1_NATIVE_ROOT_START_FAILED');
   }
  },
  /** Idempotent root unmount. No resurrection or reuse of the old Auth owner. */
  stop():void{
   if(closed)return;
   closed=true;
   cancelExpiry();
   try{appStateSubscription?.remove();}catch{/* already removed */}
   appStateSubscription=null;
   // Hide any displayed private profile synchronously before the owner is
   // disposed. Late subscriber exceptions must never stop the teardown.
   advanceRevision();
   if(started)receiver.stop();
   else owner.clearSession();
   started=false;
   revisionListeners.clear();
  },
  async startGoogleLogin(){
   if(!active())throw Error('M1_NATIVE_ROOT_INACTIVE');
   // A browser switch clears the old bearer BEFORE the browser is opened.
   // The UI must stop rendering A before B's remote OAuth can resolve.
   cancelExpiry();advanceRevision();
   const outcome=await owner.startGoogleLogin();
   if(active()&&outcome.status==='authenticated'){
    advanceRevision();scheduleExpiry();
   }
   return outcome;
  },
  /** useSyncExternalStore-compatible, no tokens/PII exposed to UI. */
  sessionRevision:()=>revision,
  subscribeSessionRevision:subscribeRevision,
  /** Only the already-Auth-owned scoped member SDK ports reach the UI. */
  profile,
  deletionForUser(expectedUserId:string,displayedSessionRevision?:number){
   if(!active())throw Error('M1_NATIVE_ROOT_INACTIVE');
   // A stale A screen may ask for a NEW deletion port after B signs in;
   // capturing the current B bearer here is not proof A authorized deletion.
   // Require the token-free Auth revision that the screen actually rendered.
   if(!Number.isSafeInteger(displayedSessionRevision)||
      displayedSessionRevision!==revision)
    throw new M2DeletionClientError('UNAUTHORIZED');
   const renderRevision=revision;
   const port=owner.deletionForUser(expectedUserId);
   // Capture the one Auth Session as the UI obtains this owner-bound port.
   // selected() starts its read immediately; a resolved null represents an
   // unauthenticated screen, and never becomes an unhandled rejection.
   // No token is returned from this root or persisted on the device.
   const originalSession=selected().then(token=>token,()=>null);
   const forOriginalSession=async <T>(
    send:()=>Promise<T>,
   ):Promise<T>=>{
    if(!active())throw new M2DeletionClientError('SESSION_REQUIRED');
    if(revision!==renderRevision)
     throw new M2DeletionClientError('UNAUTHORIZED');
    const bearer=await originalSession;
    if(!active())throw new M2DeletionClientError('SESSION_REQUIRED');
    if(revision!==renderRevision)
     throw new M2DeletionClientError('UNAUTHORIZED');
    if(!bearer)throw new M2DeletionClientError('SESSION_REQUIRED');
    return deletionOperation(send,bearer,renderRevision);
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
