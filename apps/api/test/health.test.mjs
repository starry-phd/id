import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../src/index.ts';
const env={STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'};
const request=(url,method='GET')=>new Request(url,{method});
test('liveness is minimal and Starry-only',async()=>{const r=handleRequest(request('https://test.invalid/v1/health'),env);assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'ok',brand_id:'starry',app_id:'starry-id',environment:'staging',service:'id-api',kind:'liveness-only'});assert.equal(r.headers.get('cache-control'),'no-store')});
test('fails closed for wrong app, environment and methods',async()=>{assert.equal(handleRequest(request('https://test.invalid/v1/health'),{...env,STARRY_APP_ID:'other-app'}).status,403);assert.equal(handleRequest(request('https://test.invalid/v1/health'),{...env,STARRY_ENVIRONMENT:'production'}).status,503);assert.equal(handleRequest(request('https://test.invalid/v1/health','POST'),env).status,405)});
test('no invented management routes',async()=>{assert.equal(handleRequest(request('https://test.invalid/v1/admin/users'),env).status,404)});
