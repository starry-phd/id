/**
 * AI-4 Member SDK preview. NOT exported from packages/sdk/src/index.ts or
 * wired to mobile login; callable only by trusted offline integration tests.
 * Never constructs auth from client-provided verified flags or stores tokens.
 */
export type PreviewSelfProfile=Readonly<{
 s_user_id:string;display_name:string|null;directory_opt_in:boolean;
 display_name_public:boolean;profile_revision:number;
}>;
export type OpaqueSessionProvider=()=>Promise<string|null>;
const PATH='/v1/member/self';
const keys=['directory_opt_in','display_name','display_name_public','profile_revision','s_user_id'];
export function createMemberPreviewSdk(baseUrl:string,session:OpaqueSessionProvider,fetchImpl:typeof fetch=fetch){
 const root=new URL(baseUrl);
 if(root.username||root.password||root.search||root.hash||root.pathname!=='/')
  throw new Error('INVALID_API_ORIGIN');
 if(root.protocol!=='https:'&&!(root.protocol==='http:'&&['localhost','127.0.0.1'].includes(root.hostname)))
  throw new Error('INSECURE_API_ORIGIN');
 const endpoint=new URL(PATH,root).toString();
 return Object.freeze({
  async readSelf():Promise<PreviewSelfProfile>{
   const bearer=await session();
   if(typeof bearer!=='string'||!/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(bearer))
    throw new Error('VERIFIED_SESSION_REQUIRED');
   const r=await fetchImpl(endpoint,{method:'GET',redirect:'error',credentials:'omit',
    headers:{authorization:'Bearer '+bearer,accept:'application/json'}});
   if(!r.ok)throw new Error('STARRY_MEMBER_NOT_AVAILABLE');
   const v:unknown=await r.json();
   if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)
    throw new Error('INVALID_MEMBER_PROJECTION');
   const p=v as Record<string,unknown>;
   if(Object.keys(p).sort().join('|')!==keys.join('|')
    ||typeof p.s_user_id!=='string'||p.s_user_id.length<1
    ||(p.display_name!==null&&(typeof p.display_name!=='string'||p.display_name.length>80))
    ||typeof p.directory_opt_in!=='boolean'||typeof p.display_name_public!=='boolean'
    ||!Number.isSafeInteger(p.profile_revision)||(p.profile_revision as number)<0)
    throw new Error('INVALID_MEMBER_PROJECTION');
   return Object.freeze(p) as PreviewSelfProfile;
  },
 });
}
