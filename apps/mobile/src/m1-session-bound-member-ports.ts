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
 createM2DeletionRequestClient,
} from '../../../packages/sdk/src/m2-local-deletion-request-client.ts';

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
  deletion:createM2DeletionRequestClient({
   enabled,appId:'starry-id',environment:'staging',
   baseUrl,getSessionBearer,fetchImpl,
  }),
 });
}
