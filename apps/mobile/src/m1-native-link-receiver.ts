/**
 * Starry ID M1 NATIVE Universal/App Link receiver, SOURCE-ONLY and DEFAULT OFF.
 *
 * Inject the real React Native Linking object from an independently reviewed
 * Expo root AFTER Apple AASA, Android assetlinks, SDK Auth owner and remote
 * Staging gates are verified. This module NEVER registers a route by itself.
 *
 * Native URL events cover already-open apps; getInitialURL covers cold starts.
 * Both enter the original memory-only Session Auth owner (not a second Auth).
 * Invalid/foreign links are ignored without writing a Session or logging URL.
 *
 * References: https://reactnative.dev/docs/linking
 * https://docs.expo.dev/linking/into-your-app/
 */
import {parseM1SessionHandoffReturnUrl} from
 '../../../packages/sdk/src/m1-session-handoff-client.ts';
import type {createM1MobileSessionAuthOwner} from
 './m1-session-auth-owner.ts';

export const M1_NATIVE_LINK_RECEIVER_LIVE=false as const;
type Owner=Pick<ReturnType<typeof createM1MobileSessionAuthOwner>,
 'acceptReturnUrl'|'clearSession'>;
type LinkingPort=Readonly<{
 addEventListener:(kind:'url',callback:(event:{url:string})=>void)=>
  Readonly<{remove:()=>void}>;
 getInitialURL:()=>Promise<string|null>;
}>;
type Status=Readonly<
 {type:'authenticated';expires_at:number}|
 {type:'failed'}
>;
export type M1NativeLinkReceiverConfig=Readonly<{
 enabled?:boolean;
 appId:'starry-id';environment:'staging';
 appReturnUri:string;
 owner:Owner;
 linking:LinkingPort;
 /** UI-only status, never the handoff fragment or bearer. */
 onStatus?:(result:Status)=>void;
 /** Fired synchronously for one freshly accepted, valid URL BEFORE Auth changes. */
 onHandoffStart?:()=>void;
}>;
export function createM1NativeLinkReceiver(config:M1NativeLinkReceiverConfig){
 if(!config||config.appId!=='starry-id'||config.environment!=='staging'||
    (config.enabled!==undefined&&typeof config.enabled!=='boolean')||
    !config.owner||typeof config.owner.acceptReturnUrl!=='function'||
    typeof config.owner.clearSession!=='function'||
    !config.linking||typeof config.linking.addEventListener!=='function'||
    typeof config.linking.getInitialURL!=='function'||
    (config.onStatus!==undefined&&typeof config.onStatus!=='function')||
    (config.onHandoffStart!==undefined&&typeof config.onHandoffStart!=='function'))
  throw Error('M1_NATIVE_LINK_CONFIG_DENIED');
 let returnUrl:URL;
 try{returnUrl=new URL(config.appReturnUri);}
 catch{throw Error('M1_NATIVE_LINK_CONFIG_DENIED');}
 if(returnUrl.href!==config.appReturnUri||returnUrl.protocol!=='https:'||
    returnUrl.username||returnUrl.password||returnUrl.pathname==='/'||
    returnUrl.search||returnUrl.hash)
  throw Error('M1_NATIVE_LINK_CONFIG_DENIED');
 const expected=returnUrl.href;
 const owner=config.owner;
 const linking=config.linking;
 const notify=config.onStatus;
 const onHandoffStart=config.onHandoffStart;
 const enabled=config.enabled===true;
 let active=false;
 let epoch=0;
 let listener:Readonly<{remove:()=>void}>|null=null;
 let seen=new Set<string>();
 let foregroundSeen=false;
 let currentResult=0;
 function safeStatus(status:Status){
  try{notify?.(status);}catch{/* UI callback is not an Auth authority. */}
 }
 /** Only exact HTTPS pin and one-time opaque code are forwarded. */
 function acceptLink(raw:unknown,serial:number,foreground=false):boolean{
  if(!active||serial!==epoch||typeof raw!=='string')return false;
  let code:string;
  try{code=parseM1SessionHandoffReturnUrl(raw,expected);}
  catch{return false;}
  if(seen.has(code))return true;
  if(seen.size>=64)seen.clear(); // bounded ephemeral duplicate suppression
  seen.add(code);
  if(foreground)foregroundSeen=true;
  // Clear already-rendered A before accepting B (including network errors).
  // The callback is UI-only: never hand it a URL, code, bearer or identity.
  try{onHandoffStart?.();}catch{/* no UI callback can change Auth authority */}
  const token=++currentResult;
  // No unhandled rejection, no return URL/body/token emitted to UI.
  void owner.acceptReturnUrl(raw).then(reply=>{
   if(active&&serial===epoch&&token===currentResult){
    if(!reply||!Number.isSafeInteger(reply.expires_at))
     safeStatus({type:'failed'});
    else safeStatus({type:'authenticated',expires_at:reply.expires_at});
   }
  }).catch(()=>{
   if(active&&serial===epoch&&token===currentResult)
    safeStatus({type:'failed'});
  });
  return true;
 }
 return Object.freeze({
  contract:'starry.ai0.m1.react-native-universal-link-receiver.v1' as const,
  source_only:true as const,live_enabled:M1_NATIVE_LINK_RECEIVER_LIVE,
  start():void{
   if(!enabled)throw Error('M1_NATIVE_LINK_DISABLED');
   if(active)throw Error('M1_NATIVE_LINK_ALREADY_RUNNING');
   active=true;seen=new Set<string>();foregroundSeen=false;
   const serial=++epoch;
   try{
    // Install the live event listener BEFORE reading any cold-start link.
    listener=linking.addEventListener('url',event=>{
     acceptLink(event?.url,serial,true);
    });
    if(!listener||typeof listener.remove!=='function')
     throw Error('M1_NATIVE_LINK_REGISTER_DENIED');
   }catch{
    active=false;listener=null;
    throw Error('M1_NATIVE_LINK_REGISTER_DENIED');
   }
   // A late initial URL can never overwrite a newer foreground return.
   void Promise.resolve().then(()=>linking.getInitialURL())
    .then(initial=>{
     if(active&&serial===epoch&&!foregroundSeen&&initial)
      acceptLink(initial,serial);
    }).catch(()=>{/* URL discovery is not an Auth authority. */});
  },
  /** Disposing a root revokes the volatile owner, including a pending POST. */
  stop():void{
   if(!active)return;
   active=false;epoch++;currentResult++;
   try{listener?.remove();}catch{/* already removed */}
   listener=null;seen.clear();foregroundSeen=false;
   owner.clearSession();
  },
 });
}
