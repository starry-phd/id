/**
 * TEST-ONLY Worker-shaped route adapter; NOT imported or exported by deployed src/index.ts.
 * Depends on real AI-1 WeakSet principal issuance + current member/session lookup.
 * No true provider verifier, D1, OAuth, IAP, or deployed member/admin routes.
 */
import {createServerIdentityResolver,readSelf,requireMemberAdmin} from '../../../modules/starry-id-v1/src/index.ts';
import type {ServerIdentityDependencies,Session,AdminGrant} from '../../../modules/starry-id-v1/src/index.ts';
import {verifiedBillingIdentity} from '../../../packages/integration/src/rebuild-bridge.ts';

export type SecureContractPorts=ServerIdentityDependencies & Readonly<{
 now:()=>number;
 read_admin_grant:(s_user_id:string)=>Promise<AdminGrant|null>;
 lookup_account_binding:(s_user_id:string)=>string|null;
}>;
function json(payload:object,status=200):Response{
 return new Response(JSON.stringify(payload),{status,headers:{
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
/** Factory exists strictly in test-support, never as the Cloudflare Worker entrypoint. */
export function createSecureContractWorker(ports:SecureContractPorts){
 if(ports.trusted_scope.brand_id!=='starry'||ports.trusted_scope.app_id!=='starry-id'
  ||!['development','staging'].includes(ports.trusted_scope.environment))
  throw new Error('AI4_UNAPPROVED_SCOPE');
 const resolver=createServerIdentityResolver(ports);
 const paths=['/__contract/member/self','/__contract/admin/check','/__contract/billing/check'];
 return async function handleContract(request:Request):Promise<Response>{
  const url=new URL(request.url);
  if(!paths.includes(url.pathname))return json({error:{code:'NOT_FOUND'}},404);
  if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED'}},405);
  if(url.search||request.headers.get('cookie'))return json({error:{code:'UNTRUSTED_INPUT'}},400);
  try{
   const now=ports.now();
   const p=await resolver(request,now);
   if(!p)return json({error:{code:'UNAUTHENTICATED'}},401);
   const member=await ports.read_member(p.s_user_id);
   if(!member)return json({error:{code:'FORBIDDEN'}},403);
   if(url.pathname==='/__contract/member/self'){
    return json(readSelf(p,ports.trusted_scope,member,now));
   }
   if(url.pathname==='/__contract/billing/check'){
    const identity=verifiedBillingIdentity(p,ports.trusted_scope,now,ports.lookup_account_binding);
    return json({test_only:true,sandbox_planner:true,
      user_id:identity.userId,app_id:identity.appId,purchase_performed:false});
   }
   const session:Session|null=await ports.read_session(p.session_id);
   const grant=await ports.read_admin_grant(p.s_user_id);
   if(!session)return json({error:{code:'FORBIDDEN'}},403);
   requireMemberAdmin(p,ports.trusted_scope,session,grant,'suspend',now);
   return json({test_only:true,permission:'member:suspend',operation_performed:false});
  }catch{
   // Do not expose raw private member/provider/token exception details.
   return json({error:{code:'FORBIDDEN'}},403);
  }
 };
}
