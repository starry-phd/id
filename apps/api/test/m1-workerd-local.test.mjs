import test from 'node:test';
import assert from 'node:assert/strict';
import {URL,fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

// Local workerd-only boundary tests: the injected Auth port deliberately DENIES.
// This is NOT AI-1's real signed OIDC→D1 end-to-end proof, or remote staging.
// Miniflare 5 injects a local 127.0.0.1 proxy Host into dispatchFetch.
// The isolate-only wrapper removes that proxy artifact; the real platform
// handler continues to reject spoofed Host headers (Node negatives cover it).
const origin='https://m1-isolate.invalid';
async function isolate(enabled,callback){
 const bundle=await build({
  stdin:{
   contents: [
    "import {createM1LocalSelfHttp} from './m1-local-self-http.ts';",
    "const handler=createM1LocalSelfHttp({",
    " enabled:"+JSON.stringify(enabled)+",",
    " scope:{brand_id:'starry',app_id:'starry-id',environment:'staging'},",
    " expectedOrigin:'"+origin+"',",
    " core:{async readSelf(){return new Response(JSON.stringify({error:{code:'IDENTITY_DENIED'}}),{status:401});}}",
    "});",
    "export default {fetch(req){const local=new Request(req.url,req);local.headers.delete('host');return handler.handle(local);}};",
   ].join('\n'),
   resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),
   sourcefile:'m1-workerd-local-entry.ts',loader:'ts',
  },
  bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,logLevel:'silent',
 });
 const mf=new Miniflare({workers:[{config:{
  name:'m1-local-denial-fixture',compatibilityDate:'2026-10-01',
  manifest:{mainModule:'index.js',modules:{
   'index.js':{type:'esm',contents:bundle.outputFiles[0].text},
  }},env:{},
 }}]});
 try{await callback(mf);}finally{await mf.dispose();}
}
test('M1 workerd: local staging candidate remains disabled unless explicitly injected',async()=>{
 await isolate(false,async mf=>{
  const r=await mf.dispatchFetch(origin+'/v1/starry-id/members/me',{headers:{
   authorization:'Bearer '+'a'.repeat(48),
  }});
  assert.equal(r.status,503);
  assert.deepEqual(await r.json(),{error:{code:'FEATURE_DISABLED'}});
 });
});
test('M1 workerd: explicit test port cannot bypass AI1 deny; unknown paths and no bearer never serve self DTO',async()=>{
 await isolate(true,async mf=>{
  const bearer={authorization:'Bearer '+'a'.repeat(48)};
  const denied=await mf.dispatchFetch(origin+'/v1/starry-id/members/me',{headers:bearer});
  assert.equal(denied.status,401);
  assert.deepEqual(await denied.json(),{error:{code:'IDENTITY_DENIED'}});
  for(const [path,opts,status] of [
    ['/v1/starry-id/members/me',{},401],
    ['/v1/starry-id/members/me?member=u1',{headers:bearer},400],
    ['/v1/admin',{headers:bearer},404],
    ['/v1/starry-id/members/me',{method:'POST',headers:bearer},405],
  ]){
   const r=await mf.dispatchFetch(origin+path,opts);
   assert.equal(r.status,status,path);
   assert.equal(r.headers.get('cache-control'),'no-store');
   assert.doesNotMatch(await r.text(),/s_user_id|display_name|code_verifier|PRIVATE_SQL/);
  }
 });
});
