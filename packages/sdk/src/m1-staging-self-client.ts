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

/** Same three-field CAS input contract as the original M2 server mutation. */
export type M1SelfPatch=Readonly<Partial<Pick<M1StagingSelf,
  'display_name'|'directory_opt_in'|'display_name_public'>>>;
function validateSelfPatch(input:unknown):M1SelfPatch{
 if(!input||typeof input!=='object'||Array.isArray(input))
  throw Error('STARRY_SELF_FIELDS_DENIED');
 let descriptions:Record<string,PropertyDescriptor>;
 try{
  if(Object.getPrototypeOf(input)!==Object.prototype)
   throw Error('STARRY_SELF_FIELDS_DENIED');
  const keys=Reflect.ownKeys(input);
  if(keys.length<1||keys.length>3||keys.some(k=>typeof k!=='string'||
   !['display_name','directory_opt_in','display_name_public'].includes(k)))
   throw Error('STARRY_SELF_FIELDS_DENIED');
  descriptions=Object.getOwnPropertyDescriptors(input);
  if(Object.values(descriptions).some(d=>!Object.hasOwn(d,'value')))
   throw Error('STARRY_SELF_FIELDS_DENIED');
 }catch{throw Error('STARRY_SELF_FIELDS_DENIED');}
 const result:Record<string,string|boolean|null>={};
 for(const [key,{value}] of Object.entries(descriptions)){
  if(key==='display_name'){
   if(value!==null&&(typeof value!=='string'||value.trim()!==value||
       value.length<1||value.length>80||/[\x00-\x1F\x7F]/.test(value)))
    throw Error('STARRY_SELF_FIELDS_DENIED');
   result[key]=value;
  }else{
   if(typeof value!=='boolean')throw Error('STARRY_SELF_FIELDS_DENIED');
   result[key]=value;
  }
 }
 return Object.freeze(result as M1SelfPatch);
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
 const logoutEndpoint=new URL('/v1/starry-id/sessions/logout',url).toString();
 async function currentBearer():Promise<string>{
  let token:string|null;
  try{token=await readBearer();}
  catch{throw Error('STARRY_SELF_SESSION_REQUIRED');}
  if(!token||!/^[A-Za-z0-9._~-]{16,4096}$/.test(token))
   throw Error('STARRY_SELF_SESSION_REQUIRED');
  return token;
 }
 function checkResponse(res:Response,endpoint:string):void{
  if(!(res instanceof Response)||res.redirected||
     (res.url!==''&&res.url!==endpoint))
   throw Error('STARRY_SELF_RESPONSE_INVALID');
 }
 function requireNoStore(res:Response):void{
  if(!(res.headers.get('cache-control')??'').toLowerCase()
      .split(',').some(x=>x.trim()==='no-store'))
   throw Error('STARRY_SELF_RESPONSE_INVALID');
 }
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
  /**
   * Strict server-side CAS. A profile revision is mandatory; identity/roles
   * cannot be patched. Never sends credentials/cookies or follows redirects.
   */
  async patchSelf(expectedRevision:number,input:M1SelfPatch):Promise<M1StagingSelf>{
   if(!enabled)throw Error('STARRY_SELF_DISABLED');
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||
      expectedRevision>=Number.MAX_SAFE_INTEGER)
    throw Error('STARRY_SELF_REVISION_REQUIRED');
   const patch=validateSelfPatch(input);
   const token=await currentBearer();
   try{
    const response=await transport(endpoint,{
     method:'PATCH',credentials:'omit',redirect:'error',cache:'no-store',
     headers:{
      accept:'application/json','content-type':'application/json',
      authorization:'Bearer '+token,
      'if-match':'"rev-'+expectedRevision+'"',
     },
     body:JSON.stringify(patch),
    });
    checkResponse(response,endpoint);
    if(response.status===401||response.status===403)
     throw Error('STARRY_SELF_UNAUTHORIZED');
    if(response.status===409)throw Error('STARRY_SELF_CONFLICT');
    if(response.status===428)throw Error('STARRY_SELF_REVISION_REQUIRED');
    if(response.status===400||response.status===415)
     throw Error('STARRY_SELF_FIELDS_DENIED');
    if(response.status!==200)throw Error('STARRY_SELF_UNAVAILABLE');
    if(!/^application\\/json(?:\\s*;\\s*charset\\s*=\\s*utf-8)?\\s*$/i
        .test(response.headers.get('content-type')??''))
     throw Error('STARRY_SELF_RESPONSE_INVALID');
    requireNoStore(response);
    const dto=project(await parseBoundedJson(response));
    if(dto.profile_revision!==expectedRevision+1)
     throw Error('STARRY_SELF_RESPONSE_INVALID');
    return dto;
   }catch(e){
    if(e instanceof Error&&[
     'STARRY_SELF_UNAUTHORIZED','STARRY_SELF_CONFLICT',
     'STARRY_SELF_REVISION_REQUIRED','STARRY_SELF_FIELDS_DENIED',
     'STARRY_SELF_RESPONSE_INVALID',
    ].includes(e.message))throw e;
    throw Error('STARRY_SELF_UNAVAILABLE');
   }
  },
  /** Server revokes precisely this signed Session. No token/body is exposed. */
  async logout():Promise<void>{
   if(!enabled)throw Error('STARRY_SELF_DISABLED');
   const token=await currentBearer();
   try{
    const response=await transport(logoutEndpoint,{
     method:'POST',credentials:'omit',redirect:'error',cache:'no-store',
     headers:{accept:'application/json',authorization:'Bearer '+token},
    });
    checkResponse(response,logoutEndpoint);
    if(response.status===401||response.status===403)
     throw Error('STARRY_SELF_UNAUTHORIZED');
    if(response.status!==204)throw Error('STARRY_SELF_UNAVAILABLE');
    if(response.body!==null)throw Error('STARRY_SELF_RESPONSE_INVALID');
    requireNoStore(response);
   }catch(e){
    if(e instanceof Error&&[
     'STARRY_SELF_UNAUTHORIZED','STARRY_SELF_RESPONSE_INVALID',
    ].includes(e.message))throw e;
    throw Error('STARRY_SELF_UNAVAILABLE');
   }
  },
 });
}
