import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath,URL} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

// Actual LOCAL workerd isolate with deny-only Auth-owned ports.
// This does not prove official Google OAuth/real D1/Cloudflare staging.
const origin='https://local-member-workerd.invalid';
const bearer='Bearer v1.'+'a'.repeat(48)+'.'+'b'.repeat(43);
async function withIsolate(enabled,callback){
 const source=[
  "import {createM1LocalMemberPlatformBridge} from './m1-local-member-platform-bridge.ts';",
  "const no=()=>new Response(JSON.stringify({error:{code:'IDENTITY_DENIED'}}),{status:401,headers:{'cache-control':'no-store'}});",
  "const handler=createM1LocalMemberPlatformBridge({",
  " enabled:"+JSON.stringify(enabled)+",",
  " scope:{brand_id:'starry',app_id:'starry-id',environment:'staging'},",
  " expectedOrigin:"+JSON.stringify(origin)+",",
  " readPort:{async handle(){return no();}},mutationPort:{async handle(){return no();}},",
  "});",
  "export default {fetch(req){const local=new Request(req.url,req);",
  // Only strip Miniflare 5 internal local proxy Host; the real handler
  // still rejects untrusted Host in its own constructor and Node tests.
  "local.headers.delete('host');return handler.handle(local);}};",
 ].join('\n');
 const bundle=await build({stdin:{
  contents:source,resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),
  sourcefile:'m1-member-bridge-workerd-entry.ts',loader:'ts',
 },bundle:true,platform:'browser',format:'esm',target:'es2022',
 write:false,logLevel:'silent'});
 const mf=new Miniflare({workers:[{config:{
  name:'m1-local-member-bridge-fixture',compatibilityDate:'2026-10-01',
  manifest:{mainModule:'index.js',modules:{
   'index.js':{type:'esm',contents:bundle.outputFiles[0].text},
  }},env:{},
 }}]});
 try{await callback(mf);}finally{await mf.dispose();}
}
test('M1 bridge workerd remains disabled by default despite valid-looking bearer',async()=>{
 await withIsolate(false,async mf=>{
  for(const [path,opts] of [
   ['/v1/starry-id/members/me',{headers:{authorization:bearer}}],
   ['/v1/starry-id/members/me',{method:'PATCH',headers:{
    authorization:bearer,'content-type':'application/json','if-match':'"rev-1"'},body:'{}'}],
   ['/v1/starry-id/sessions/logout',{method:'POST',headers:{authorization:bearer}}],
  ]){
   const r=await mf.dispatchFetch(origin+path,opts);
   assert.equal(r.status,503,path);
   assert.deepEqual(await r.json(),{error:{code:'FEATURE_DISABLED'}});
  }
 });
});
test('M1 workerd explicit local routing cannot bypass deny-only Auth ports or expose user data',async()=>{
 await withIsolate(true,async mf=>{
  for(const [path,opts,expected] of [
   ['/v1/starry-id/members/me',{headers:{authorization:bearer}},401],
   ['/v1/starry-id/members/me',{method:'PATCH',headers:{
    authorization:bearer,'content-type':'application/json','if-match':'"rev-1"'},body:'{}'},401],
   ['/v1/starry-id/sessions/logout',{method:'POST',headers:{authorization:bearer}},401],
   ['/v1/starry-id/members/me',{},401],
   ['/v1/starry-id/members/me?x=1',{headers:{authorization:bearer}},400],
   ['/v1/admin',{headers:{authorization:bearer}},404],
   ['/v1/starry-id/sessions/logout',{method:'GET',headers:{authorization:bearer}},405],
  ]){
   const r=await mf.dispatchFetch(origin+path,opts);
   assert.equal(r.status,expected,path);
   assert.equal(r.headers.get('cache-control'),'no-store');
   assert.doesNotMatch(await r.text(),/s_user_id|code_verifier|PRIVATE_SQL|display_name/i);
  }
 });
});
