/**
 * AI-4 Round 3: protected Starry ID member read transport CONTRACT.
 * NOT imported by the deployed Worker index; until AI-1 provides a real
 * cryptographic verifier + authoritative D1 loaders, this cannot be enabled.
 * The only currently served live Worker route remains GET /v1/health.
 */
import {createServerIdentityResolver,readSelf} from '../../../modules/starry-id-v1/src/index.ts';
import type {ServerIdentityDependencies,TrustedScope} from '../../../modules/starry-id-v1/src/index.ts';

export type MemberRouteDependencies = ServerIdentityDependencies & Readonly<{
 nowSeconds:()=>number;
}>;
const response=(code:number,body:object)=>new Response(JSON.stringify(body),{
 status:code,headers:{'content-type':'application/json; charset=utf-8',
 'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}
});
const error=(status:number,code:string)=>response(status,{error:{code}});
const allowed=(scope:TrustedScope)=>scope.brand_id==='starry'&&scope.app_id==='starry-id'&&
 (scope.environment==='development'||scope.environment==='staging');

/** Dependency injection ONLY from trusted server composition, never from request payload. */
export function createMemberReadContract(deps:MemberRouteDependencies){
 if(!allowed(deps.trusted_scope))throw new Error('MEMBER_ROUTE_SCOPE_DENIED');
 const resolver=createServerIdentityResolver(deps);
 return async function memberRead(request:Request):Promise<Response>{
  const url=new URL(request.url);
  if(url.pathname!=='/v1/member/self')return error(404,'NOT_FOUND');
  if(request.method!=='GET')return error(405,'METHOD_NOT_ALLOWED');
  if(url.search||url.hash||request.headers.has('cookie')
   ||request.headers.has('x-admin-verified')||request.headers.has('x-user-id'))
   return error(400,'UNTRUSTED_REQUEST');
  const bearer=request.headers.get('authorization');
  if(!bearer||!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(bearer))
   return error(401,'UNAUTHENTICATED');
  try {
   const now=deps.nowSeconds();
   if(!Number.isSafeInteger(now)||now<0)return error(503,'VERIFIER_UNAVAILABLE');
   const principal=await resolver(request,now);
   if(!principal)return error(401,'UNAUTHENTICATED');
   // An additional authoritative member read after principal issuance prevents
   // returning a cached projection on a revoked/deleted current record.
   const member=await deps.read_member(principal.s_user_id);
   if(!member)return error(403,'MEMBER_DENIED');
   return response(200,readSelf(principal,deps.trusted_scope,member,now));
  }catch{
   // Never disclose provider, token, session or member details in errors.
   return error(403,'MEMBER_DENIED');
  }
 };
}
