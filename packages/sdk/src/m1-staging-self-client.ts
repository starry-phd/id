/**
 * AI-4 M1 — versioned, explicitly opt-in self-profile SDK candidate.
 * Not exported from public packages/sdk/src/index.ts and NOT wired to any App.
 * The server remains the sole identity authority; this client never issues a Session.
 */
export const M1_STAGING_SELF_SDK_LIVE = false as const;
export const M1_STAGING_SELF_CONTRACT = 'starry.ai4.m1.staging-self-sdk.v1' as const;
/** Exact five-field profile DTO is tiny; never buffer arbitrary upstream data. */
export const M1_MAX_SELF_RESPONSE_BYTES = 4096 as const;
export type M1StagingSelf = Readonly<{
  s_user_id:string;display_name:string|null;directory_opt_in:boolean;
  display_name_public:boolean;profile_revision:number;
}>;
export type M1StagingSelfConfig = Readonly<{
  enabled?:boolean;
  baseUrl:string;
  appId:'starry-id';
  /** Auth Owner-supplied volatile, valid session; SDK never stores or refreshes it. */
  getSessionBearer:()=>Promise<string|null>;
  fetchImpl?:typeof fetch;
}>;
async function parseBoundedJson(response:Response):Promise<unknown> {
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d{1,8}$/.test(declared)||
     Number(declared)>M1_MAX_SELF_RESPONSE_BYTES))
    throw Error('STARRY_SELF_RESPONSE_INVALID');
  if(!response.body)throw Error('STARRY_SELF_RESPONSE_INVALID');
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>M1_MAX_SELF_RESPONSE_BYTES) {
        await reader.cancel();
        throw Error('STARRY_SELF_RESPONSE_INVALID');
      }
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}
  catch{throw Error('STARRY_SELF_RESPONSE_INVALID');}
}
function project(value:unknown):M1StagingSelf {
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw Error('STARRY_SELF_RESPONSE_INVALID');
  const x=value as Record<string,unknown>;
  if(Object.keys(x).sort().join('|')!==
    ['s_user_id','display_name','directory_opt_in','display_name_public','profile_revision'].sort().join('|')||
     typeof x.s_user_id!=='string'||!/^[A-Za-z0-9._:-]{1,180}$/.test(x.s_user_id)||
     (x.display_name!==null&&(typeof x.display_name!=='string'||x.display_name.length>80||x.display_name.length===0))||
     typeof x.directory_opt_in!=='boolean'||typeof x.display_name_public!=='boolean'||
     typeof x.profile_revision!=='number'||!Number.isSafeInteger(x.profile_revision)||x.profile_revision<1||
     x.profile_revision>=Number.MAX_SAFE_INTEGER)
    throw Error('STARRY_SELF_RESPONSE_INVALID');
  return Object.freeze(x as M1StagingSelf);
}
export function createM1StagingSelfClient(config:M1StagingSelfConfig) {
 const url=new URL(config.baseUrl);
 if(config.appId!=='starry-id'||url.protocol!=='https:'||url.username||url.password||
    url.pathname!=='/'||url.search||url.hash||url.toString()!==url.origin+'/'||
    typeof config.getSessionBearer!=='function')throw Error('STARRY_SELF_CONFIG_DENIED');
 const enabled=config.enabled===true;
 const endpoint=new URL('/v1/starry-id/members/me',url).toString();
 const transport=config.fetchImpl??fetch;
 const readBearer=config.getSessionBearer;
 return Object.freeze({
  contract:M1_STAGING_SELF_CONTRACT,
  source_only:true as const,
  live_enabled:M1_STAGING_SELF_SDK_LIVE,
  async getSelf():Promise<M1StagingSelf>{
   if(!enabled)throw Error('STARRY_SELF_DISABLED');
   // The Auth Owner's credential supplier may fail; do not leak its
   // exception, token, provider details or stack to the App.
   let bearer:string|null;
   try{bearer=await readBearer();}
   catch{throw Error('STARRY_SELF_SESSION_REQUIRED');}
   if(!bearer||!/^[A-Za-z0-9._~-]{16,4096}$/.test(bearer))
     throw Error('STARRY_SELF_SESSION_REQUIRED');
   try {
    const response=await transport(endpoint,{method:'GET',
      credentials:'omit',redirect:'error',cache:'no-store',
      headers:{accept:'application/json',authorization:'Bearer '+bearer},
    });
    // A test transport (or a future proxy) must not silently follow
    // redirects, substitute another endpoint or accept cacheable PII.
    if(response.redirected||(response.url!==''&&response.url!==endpoint))
      throw Error('STARRY_SELF_RESPONSE_INVALID');
    if(response.status===401||response.status===403)throw Error('STARRY_SELF_UNAUTHORIZED');
    if(response.status!==200)throw Error('STARRY_SELF_UNAVAILABLE');
    if(!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i
         .test(response.headers.get('content-type')??''))
      throw Error('STARRY_SELF_RESPONSE_INVALID');
    const cache=(response.headers.get('cache-control')??'').toLowerCase()
      .split(',').map(v=>v.trim());
    if(!cache.includes('no-store'))throw Error('STARRY_SELF_RESPONSE_INVALID');
    return project(await parseBoundedJson(response));
   }catch(e) {
    // Do not echo tokens, provider/SQL errors or raw response body to the App.
    if(e instanceof Error&&['STARRY_SELF_UNAUTHORIZED','STARRY_SELF_RESPONSE_INVALID'].includes(e.message))
      throw e;
    throw Error('STARRY_SELF_UNAVAILABLE');
   }
  },
 });
}
