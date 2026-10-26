export interface Env { STARRY_ENVIRONMENT: string; STARRY_APP_ID: string }
const json = (payload: object, status = 200) => new Response(JSON.stringify(payload), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
export function handleRequest(request: Request, env: Env): Response {
  const url = new URL(request.url);
  if (env.STARRY_ENVIRONMENT !== 'development' && env.STARRY_ENVIRONMENT !== 'staging') return json({error:{code:'ENVIRONMENT_DISABLED',message:'Not enabled'}},503);
  if (env.STARRY_APP_ID !== 'starry-id') return json({error:{code:'APP_SCOPE_DENIED',message:'Invalid application scope'}},403);
  if (request.method !== 'GET') return json({error:{code:'METHOD_NOT_ALLOWED',message:'Method not allowed'}},405);
  if (url.pathname === '/v1/health') return json({status:'ok',brand_id:'starry',app_id:'starry-id',environment:env.STARRY_ENVIRONMENT,service:'id-api',kind:'liveness-only'});
  return json({error:{code:'NOT_FOUND',message:'Resource not found'}},404);
}
export default {fetch(request:Request,env:Env):Response{return handleRequest(request,env)}};
