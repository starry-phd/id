/**
 * Starry M1 mobile DI seam: ONE existing, Auth-owned volatile Session for
 * profile + deletion-request (receipt only). Source-only: never wired to a
 * public Expo route, never stores credentials or creates a second Auth.
 *
 * The remote OAuth/Worker/D1/Access/cost gates must be independently verified
 * before a trusted application root may supply this port with enabled=true.
 */
import {
 createM1StagingSelfClient,
} from '../../../packages/sdk/src/m1-staging-self-client.ts';
import {
 createM2DeletionRequestClient,M2DeletionClientError,
} from '../../../packages/sdk/src/m2-local-deletion-request-client.ts';
import type {M2DeletionPort} from '../../../packages/sdk/src/m2-local-deletion-request-client.ts';

export const M1_MEMBER_PORTS_LIVE_ENABLED=false as const;
export type M1MemberPortsConfig=Readonly<{
 enabled?:boolean;
 appId:'starry-id';
 environment:'staging';
 baseUrl:string;
 /** Existing Auth owner; never a display component or a test token. */
 getSessionBearer:()=>Promise<string|null>;
 fetchImpl?:typeof fetch;
}>;

export function createM1SessionBoundMemberPorts(config:M1MemberPortsConfig){
 if(!config||config.appId!=='starry-id'||config.environment!=='staging'||
   typeof config.getSessionBearer!=='function')
  throw Error('M1_MEMBER_PORTS_SCOPE_DENIED');
 let origin:URL;
 try{origin=new URL(config.baseUrl);}
 catch{throw Error('M1_MEMBER_PORTS_ORIGIN_DENIED');}
 if(origin.protocol!=='https:'||origin.username||origin.password||
    origin.pathname!=='/'||origin.search||origin.hash||
    origin.href!==origin.origin+'/')
  throw Error('M1_MEMBER_PORTS_ORIGIN_DENIED');

 // Snapshot immutable authority and transport once. Both SDKs fetch the
 // SAME signed Session from the SAME Auth owner for every request. There is
 // intentionally no bearer caching, refresh, SecureStore or cookie fallback.
 const getSessionBearer=config.getSessionBearer;
 const fetchImpl=config.fetchImpl;
 const enabled=config.enabled===true;
 const baseUrl=origin.href;
 return Object.freeze({
  source_only:true as const,
  live_enabled:M1_MEMBER_PORTS_LIVE_ENABLED,
  profile:createM1StagingSelfClient({
   enabled,appId:'starry-id',baseUrl,getSessionBearer,fetchImpl,
  }),
  // There is intentionally NO un-fenced deletion port in this mobile DI.
  // A stale screen must never submit a request under a newly signed-in user.
  deletionForUser(expectedUserId:string):M2DeletionPort{
   // Capture the screen owner's immutable identity, not a mutable DI getter.
   // This id must come from the existing signed-Session getSelf() response.
   if(typeof expectedUserId!=='string'||
      !/^[A-Za-z0-9._:-]{1,180}$/.test(expectedUserId))
    throw new M2DeletionClientError('UNAUTHORIZED');
   const withOwner=async <T>(send:(port:M2DeletionPort)=>Promise<T>):Promise<T>=>{
    if(!enabled)throw new M2DeletionClientError('DISABLED');
    let bearer:string|null;
    try{bearer=await getSessionBearer();}
    catch{throw new M2DeletionClientError('SESSION_REQUIRED');}
    if(!bearer)throw new M2DeletionClientError('SESSION_REQUIRED');
    // Both preflight and deletion mutation use this one volatile bearer.
    // No token is persisted, refreshed, copied to a component, or re-read
    // from Auth midway through the operation.
    const sameBearer=async()=>bearer;
    try{
     const self=await createM1StagingSelfClient({
      enabled:true,appId:'starry-id',baseUrl,
      getSessionBearer:sameBearer,fetchImpl,
     }).getSelf();
     if(self.s_user_id!==expectedUserId)
      throw new M2DeletionClientError('UNAUTHORIZED');
    }catch(error){
     if(error instanceof M2DeletionClientError)throw error;
     const code=error instanceof Error?error.message:'';
     throw new M2DeletionClientError(
      code==='STARRY_SELF_UNAUTHORIZED'?'UNAUTHORIZED':
      code==='STARRY_SELF_SESSION_REQUIRED'?'SESSION_REQUIRED':
      code==='STARRY_SELF_RESPONSE_INVALID'?'INVALID_RESPONSE':'UNAVAILABLE');
    }
    const current=createM2DeletionRequestClient({
     enabled:true,appId:'starry-id',environment:'staging',baseUrl,
     getSessionBearer:sameBearer,fetchImpl,
    });
    return send(current);
   };
   return Object.freeze({
    getStatus:()=>withOwner(port=>port.getStatus()),
    requestDeletion:()=>withOwner(port=>port.requestDeletion()),
    confirmDeletion:(requestId:string)=>withOwner(port=>port.confirmDeletion(requestId)),
   });
  },
 });
}
