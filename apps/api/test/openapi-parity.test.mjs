import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleRequest} from '../src/index.ts';
const yaml=readFileSync(new URL('../openapi.yaml',import.meta.url),'utf8');
test('OpenAPI 3.1 has exactly the one implemented public liveness path',async()=>{
 assert.match(yaml,/^openapi: 3\.1\.0$/m);
 const pathBlock=yaml.split(/^paths:\s*$/m)[1]?.split(/^components:\s*$/m)[0]??'';
 const paths=Array.from(pathBlock.matchAll(/^  (\/[^\s:]+):\s*$/gm),x=>x[1]);
 assert.deepEqual(paths,['/v1/health']);
 assert.equal(handleRequest(new Request('https://api.example.invalid'+paths[0]),{STARRY_ENVIRONMENT:'development',STARRY_APP_ID:'starry-id'}).status,200);
});
test('no fictional OAuth, profile, Billing, admin or H-Global route is published',()=>{
 for(const name of ['/v1/auth','/v1/profile','/v1/billing','/v1/admin','/v1/hglobal']){
  assert.equal(yaml.includes(name),false,name);
 }
});
