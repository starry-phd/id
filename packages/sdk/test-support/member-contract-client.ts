/** TEST-ONLY SDK for the undeloyed protected Worker contract. NOT a public export. */
export interface ContractSelfProfile {
 readonly s_user_id:string;readonly display_name:string|null;
 readonly directory_opt_in:boolean;readonly display_name_public:boolean;
 readonly profile_revision:number;
}
export function createTestMemberContractClient(origin:string,fetchImpl:typeof fetch=fetch){
 const u=new URL(origin);
 if(u.username||u.password||u.search||u.hash)throw new Error('INVALID_API_ORIGIN');
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))
  throw new Error('INSECURE_API_ORIGIN');
 const url=new URL('/__contract/member/self',u).toString();
 return Object.freeze({
  async self(signedSession:string):Promise<ContractSelfProfile>{
   if(typeof signedSession!=='string'||!/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(signedSession))
    throw new Error('INVALID_TEST_SESSION');
   const response=await fetchImpl(url,{method:'GET',credentials:'omit',
     redirect:'error',headers:{authorization:'Bearer '+signedSession,accept:'application/json'}});
   if(!response.ok)throw new Error('STARRY_MEMBER_CONTRACT_DENIED');
   const data:unknown=await response.json();
   if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('INVALID_PROFILE_RESPONSE');
   const p=data as Record<string,unknown>;
   if(Object.keys(p).sort().join('|')!=='directory_opt_in|display_name|display_name_public|profile_revision|s_user_id'
     ||typeof p.s_user_id!=='string'||p.s_user_id.length===0
     ||(p.display_name!==null&&typeof p.display_name!=='string')
     ||typeof p.directory_opt_in!=='boolean'||typeof p.display_name_public!=='boolean'
     ||!Number.isSafeInteger(p.profile_revision)||(p.profile_revision as number)<0)
    throw new Error('INVALID_PROFILE_RESPONSE');
   return p as unknown as ContractSelfProfile;
  },
 });
}
