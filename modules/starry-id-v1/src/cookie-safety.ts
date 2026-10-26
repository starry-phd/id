/** AI-1 Round4: security policy for cookie-based Starry Sessions.
 * AI-4 owns HTTP handlers; this helper never authenticates a principal.
 * Unsafe cookie actions require trusted Origin + server-verified CSRF proof.
 */
const SESSION_COOKIE='__Host-starry_session';
const originAllowed=(v:unknown,expected:string):boolean=>{
 try{
   if(typeof v!=='string'||v!==expected||v.length>300)return false;
   const u=new URL(v);
   return u.protocol==='https:' && u.origin===v && !u.username&&!u.password;
 }catch{return false;}
};
export function createHostOnlySessionCookie(token:string,seconds=900):string{
 if(typeof token!=='string'||token.length>8192||
   !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)||
   !Number.isSafeInteger(seconds)||seconds<1||seconds>900)
   throw Error('COOKIE_DENIED');
 return SESSION_COOKIE+'='+token+
   '; Path=/; Max-Age='+seconds+'; Secure; HttpOnly; SameSite=Strict';
}
export function clearHostOnlySessionCookie():string{
 return SESSION_COOKIE+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict';
}
export type CookieMutationContext=Readonly<{
  method:string;originHeader:string|null;fetchSiteHeader:string|null;
  csrfHeader:string|null;expectedOrigin:string;
}>;
export async function authorizeCookieMutation(
  ctx:CookieMutationContext,
  backendVerifyCsrf:(token:string)=>Promise<boolean>,
):Promise<boolean>{
 if(!['POST','PUT','PATCH','DELETE'].includes(ctx.method)||!originAllowed(ctx.expectedOrigin,ctx.expectedOrigin)||
   !originAllowed(ctx.originHeader,ctx.expectedOrigin)||
   ctx.fetchSiteHeader!=='same-origin' ||
   typeof ctx.csrfHeader!=='string'||!(/^[A-Za-z0-9_-]{32,256}$/).test(ctx.csrfHeader))
   return false;
 try{return await backendVerifyCsrf(ctx.csrfHeader)===true;}catch{return false;}
}
