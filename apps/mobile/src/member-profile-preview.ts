/**
 * Strictly DEVELOPMENT-only in-memory member profile UI fixture.
 *
 * This is NOT a Google/Starry login, server account, session or D1 database.
 * Never writes storage, uses fetch, or contains real member identity/PII.
 * Each screen instance owns one disposable synthetic five-field profile.
 */
import type {M1StagingSelf,M1SelfPatch} from
 '../../../packages/sdk/src/m1-staging-self-client.ts';
import type {MemberProfilePort} from './member-profile-screen.tsx';

export type MemberProfilePreview=MemberProfilePort&Readonly<{
 failNext:(kind:'UNAVAILABLE'|'UNAUTHORIZED'|'CONFLICT')=>void;
}>;

const INITIAL:M1StagingSelf=Object.freeze({
 s_user_id:'starry-preview-member',
 display_name:'示範會員',
 directory_opt_in:false,
 display_name_public:false,
 profile_revision:1,
});
function validate(input:unknown):M1SelfPatch{
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.getPrototypeOf(input)!==Object.prototype)
  throw Error('STARRY_SELF_FIELDS_DENIED');
 const fields=Reflect.ownKeys(input);
 if(fields.length<1||fields.length>3||
    fields.some(k=>typeof k!=='string'||
      !['display_name','directory_opt_in','display_name_public'].includes(k)))
  throw Error('STARRY_SELF_FIELDS_DENIED');
 const descriptors=Object.getOwnPropertyDescriptors(input);
 const sanitized:Record<string,string|boolean|null>={};
 for(const [k,descriptor] of Object.entries(descriptors)){
  if(!Object.hasOwn(descriptor,'value'))throw Error('STARRY_SELF_FIELDS_DENIED');
  const v:unknown=descriptor.value;
  if(k==='display_name'){
   if(v!==null&&(typeof v!=='string'||v.length<1||v.length>80||
      v.trim()!==v||Array.from(v).some(ch=>
       ch.charCodeAt(0)<32||ch.charCodeAt(0)===127)))
    throw Error('STARRY_SELF_FIELDS_DENIED');
   sanitized[k]=v;
  }else{
   if(typeof v!=='boolean')throw Error('STARRY_SELF_FIELDS_DENIED');
   sanitized[k]=v;
  }
 }
 return Object.freeze(sanitized as M1SelfPatch);
}

export function createMemberProfilePreview():MemberProfilePreview{
 let active=true;
 let profile:M1StagingSelf=INITIAL;
 let fail:'UNAVAILABLE'|'UNAUTHORIZED'|'CONFLICT'|null=null;
 function requireActive(operation:'read'|'write'|'logout'){
  if(!active)throw Error('STARRY_SELF_SESSION_REQUIRED');
  const value=fail;
  if(value===null||value==='CONFLICT'&&operation!=='write')return;
  fail=null;
  if(value==='UNAUTHORIZED'){
   active=false;
   throw Error('STARRY_SELF_UNAUTHORIZED');
  }
  if(value==='UNAVAILABLE')throw Error('STARRY_SELF_UNAVAILABLE');
  // Simulate another device changing a version before our CAS write.
  profile=Object.freeze({...profile,profile_revision:profile.profile_revision+1});
  throw Error('STARRY_SELF_CONFLICT');
 }
 return Object.freeze({
  failNext(kind:'UNAVAILABLE'|'UNAUTHORIZED'|'CONFLICT'){
   if(!['UNAVAILABLE','UNAUTHORIZED','CONFLICT'].includes(kind))
    throw Error('STARRY_PREVIEW_SIMULATION_DENIED');
   fail=kind;
  },
  async getSelf():Promise<M1StagingSelf>{
   requireActive('read');
   return profile;
  },
  async patchSelfForUser(id:string,revision:number,patch:M1SelfPatch):
   Promise<M1StagingSelf>{
   requireActive('write');
   if(id!==profile.s_user_id)throw Error('STARRY_SELF_IDENTITY_CHANGED');
   if(!Number.isSafeInteger(revision)||revision<1)
    throw Error('STARRY_SELF_REVISION_REQUIRED');
   if(revision!==profile.profile_revision)throw Error('STARRY_SELF_CONFLICT');
   const valid=validate(patch);
   profile=Object.freeze({...profile,...valid,
    profile_revision:profile.profile_revision+1});
   return profile;
  },
  async logout():Promise<void>{
   requireActive('logout');
   active=false;fail=null;profile=INITIAL;
  },
 });
}
