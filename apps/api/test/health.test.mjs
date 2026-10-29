import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../src/index.ts';
const env={STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'};
const req=(path,method='GET')=>new Request('https://api.example.invalid'+path,{method});
test('Starry /v1/health answers with liveness only and no private member data',async()=>{
 const res=handleRequest(req('/v1/health'),env);
 assert.equal(res.status,200);
 assert.deepEqual(await res.json(),{status:'ok',brand_id:'starry',app_id:'starry-id',environment:'staging',service:'id-api',kind:'liveness-only'});
 assert.equal(res.headers.get('cache-control'),'no-store');
});
test('rejects wrong brand/app, undeployed production environment and unsafe verbs',()=>{
 assert.equal(handleRequest(req('/v1/health'),{...env,STARRY_APP_ID:'hglobal-id'}).status,403);
 assert.equal(handleRequest(req('/v1/health'),{...env,STARRY_ENVIRONMENT:'production'}).status,503);
 for(const method of ['POST','PUT','DELETE','PATCH'])assert.equal(handleRequest(req('/v1/health',method),env).status,405);
});
test('member login/session/profile, admin, billing and cross-brand endpoints are NOT served',()=>{
 for(const path of ['/v1/members','/v1/auth/login','/v1/sessions','/v1/profile','/v1/admin/users','/v1/billing','/v1/hglobal/sync']) {
  assert.equal(handleRequest(req(path),env).status,404,path);
 }
});
test('GET not-found cannot reveal arbitrary route state',async()=>{
 const res=handleRequest(req('/v1/not-a-real-resource'),env);
 assert.equal(res.status,404);assert.equal((await res.json()).error.code,'NOT_FOUND');
});
