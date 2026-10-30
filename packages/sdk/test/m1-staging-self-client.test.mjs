import test from 'node:test';
import assert from 'node:assert/strict';
import {createM1StagingSelfClient,M1_STAGING_SELF_SDK_LIVE}
 from '../src/m1-staging-self-client.ts';
const origin='https://staging.starry.invalid';
const dto={s_user_id:'su-123',display_name:'Testing Only',
 directory_opt_in:false,display_name_public:false,profile_revision:2};
const make=(overrides={})=>{
 let count=0,request;
 const c=createM1StagingSelfClient({
  baseUrl:origin,appId:'starry-id',
  getSessionBearer:async()=> 'a'.repeat(48),
  fetchImpl:async(url,init)=>{
   count++;request={url,init};
   return new Response(JSON.stringify(dto),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
  },...overrides,
 });
 return {client:c,count:()=>count,request:()=>request};
};
test('M1 SDK is source-only and off by default; no token or HTTP read',async()=>{
 const {client,count}=make();
 assert.equal(M1_STAGING_SELF_SDK_LIVE,false);
 assert.equal(client.live_enabled,false);
 await assert.rejects(client.getSelf(),/STARRY_SELF_DISABLED/);
 assert.equal(count(),0);
});
test('M1 SDK explicit local fixture: exact five fields, HTTPS origin, no cookies/redirect',async()=>{
 const {client,count,request}=make({enabled:true});
 assert.deepEqual(await client.getSelf(),dto);
 assert.equal(count(),1);
 assert.equal(request().url,origin+'/v1/starry-id/members/me');
 assert.equal(request().init.credentials,'omit');
 assert.equal(request().init.redirect,'error');
 assert.equal(request().init.cache,'no-store');
 assert.equal(request().init.headers.authorization,'Bearer '+'a'.repeat(48));
});
test('M1 SDK no bearer, foreign base, HTTP, userinfo, path/query always fail closed',async()=>{
 for(const input of [
  {baseUrl:'http://staging.starry.invalid'},
  {baseUrl:'https://bad:secret@staging.starry.invalid'},
  {baseUrl:origin+'/other'},
  {baseUrl:origin+'?x=1'},
  {appId:'echo-starry'},
 ])assert.throws(()=>make(input));
 for(const bearer of [null,'short','Bearer '+ 'a'.repeat(48)]){
  const {client,count}=make({enabled:true,getSessionBearer:async()=>bearer});
  await assert.rejects(client.getSelf(),/STARRY_SELF_SESSION_REQUIRED/);
  assert.equal(count(),0);
 }
});
test('M1 SDK refuses raw invalid/error/extra-field responses without leaking secrets',async()=>{
 for(const response of [
  new Response('SQL secret token',{status:500}),
  new Response(JSON.stringify({...dto,email:'test@example.invalid'}),{status:200,headers:{'content-type':'application/json'}}),
  new Response(JSON.stringify({...dto,directory_opt_in:1}),{status:200,headers:{'content-type':'application/json'}}),
  new Response(JSON.stringify(dto),{status:200,headers:{'content-type':'text/html'}}),
  new Response('token leaked',{status:401}),
  new Response('db error',{status:403}),
 ]) {
  const {client}=make({enabled:true,fetchImpl:async()=>response});
  await assert.rejects(client.getSelf(),error=>{
   assert.match(error.message,/^STARRY_SELF_/);
   assert.doesNotMatch(error.message,/token|SQL|email|db error/i);
   return true;
  });
 }
});


test('M1 SDK sanitizes exceptions from Auth credential supplier without fetching',async()=>{
 const {client,count}=make({enabled:true,getSessionBearer:async()=>{throw Error('PRIVATE_SESSION_AND_PROVIDER_TOKEN');}});
 await assert.rejects(client.getSelf(),e=>{
  assert.equal(e.message,'STARRY_SELF_SESSION_REQUIRED');
  return true;
 });
 assert.equal(count(),0);
});
test('M1 SDK rejects redirected, wrong final origin, cacheable or ambiguous content-type responses',async()=>{
 for(const alter of [
  r=>Object.defineProperty(r,'redirected',{value:true}),
  r=>Object.defineProperty(r,'url',{value:'https://other.invalid/v1/starry-id/members/me'}),
  r=>r.headers.set('cache-control','public, max-age=60'),
  r=>r.headers.set('cache-control','no-cache'),
  r=>r.headers.set('content-type','application/jsonp'),
  r=>r.headers.set('content-type','application/json; charset=iso-8859-1'),
 ]) {
  const r=new Response(JSON.stringify(dto),{status:200,headers:{
   'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  alter(r);
  const {client}=make({enabled:true,fetchImpl:async()=>r});
  await assert.rejects(client.getSelf(),/STARRY_SELF_RESPONSE_INVALID/);
 }
});
test('M1 SDK rejects oversized, malformed-UTF8 and out-of-range five-field payloads',async()=>{
 const headers={'content-type':'application/json','cache-control':'no-store'};
 const cases=[
  new Response(JSON.stringify(dto),{status:200,headers:{...headers,'content-length':'4097'}}),
  new Response(new Uint8Array([0xff,0xfe,0xfd]),{status:200,headers}),
  new Response(JSON.stringify({...dto,profile_revision:Number.MAX_SAFE_INTEGER}),{status:200,headers}),
  new Response(JSON.stringify({...dto,extra_field:'private'}),{status:200,headers}),
 ];
 for(const response of cases) {
  const {client}=make({enabled:true,fetchImpl:async()=>response});
  await assert.rejects(client.getSelf(),/STARRY_SELF_RESPONSE_INVALID/);
 }
 let cancelled=false;
 const stream=new ReadableStream({
  start(c){c.enqueue(new Uint8Array(4097));},
  cancel(){cancelled=true;},
 });
 const {client}=make({enabled:true,fetchImpl:async()=>
  new Response(stream,{status:200,headers})});
 await assert.rejects(client.getSelf(),/STARRY_SELF_RESPONSE_INVALID/);
 assert.equal(cancelled,true);
});
test('M1 SDK accepts exact contract UTF-8 response with no-store, no redirect',async()=>{
 const {client}=make({enabled:true,fetchImpl:async()=>
  new Response(JSON.stringify(dto),{status:200,headers:{
   'content-type':'application/json; charset=utf-8',
   'cache-control':'private, no-store',
  }})});
 assert.deepEqual(await client.getSelf(),dto);
});


test('M1 scoped SDK defaults OFF for PATCH and logout without reading token or network',async()=>{
 let reads=0,requests=0;
 const client=createM1StagingSelfClient({
  enabled:false,baseUrl:origin,appId:'starry-id',
  getSessionBearer:async()=>{reads++;return 'a'.repeat(48);},
  fetchImpl:async()=>{requests++;throw Error('SHOULD_NOT_FETCH');},
 });
 await assert.rejects(client.patchSelf(1,{display_name:'Safe'}),/STARRY_SELF_DISABLED/);
 await assert.rejects(client.logout(),/STARRY_SELF_DISABLED/);
 assert.equal(reads,0);assert.equal(requests,0);
});

test('M1 scoped SDK sends exact CAS PATCH and zero-body single-session logout to original Starry routes',async()=>{
 const calls=[];
 const client=createM1StagingSelfClient({
  enabled:true,baseUrl:origin,appId:'starry-id',
  getSessionBearer:async()=> 'a'.repeat(48),
  fetchImpl:async(url,init)=>{
   calls.push({url,init});
   if(init.method==='PATCH')
    return new Response(JSON.stringify({...dto,display_name:'Changed',profile_revision:3}),{
     status:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'},
    });
   return new Response(null,{status:204,headers:{'cache-control':'no-store'}});
  },
 });
 const patched=await client.patchSelf(2,{display_name:'Changed'});
 assert.equal(patched.display_name,'Changed');
 assert.equal(patched.profile_revision,3);
 await client.logout();
 assert.equal(calls.length,2);
 const patch=calls[0],logout=calls[1];
 assert.equal(patch.url,origin+'/v1/starry-id/members/me');
 assert.equal(patch.init.method,'PATCH');
 assert.equal(patch.init.credentials,'omit');
 assert.equal(patch.init.redirect,'error');
 assert.equal(patch.init.cache,'no-store');
 assert.equal(patch.init.headers['if-match'],'"rev-2"');
 assert.equal(patch.init.headers.authorization,'Bearer '+'a'.repeat(48));
 assert.deepEqual(JSON.parse(patch.init.body),{display_name:'Changed'});
 assert.equal(logout.url,origin+'/v1/starry-id/sessions/logout');
 assert.equal(logout.init.method,'POST');
 assert.equal(logout.init.credentials,'omit');
 assert.equal(logout.init.redirect,'error');
 assert.equal(logout.init.cache,'no-store');
 assert.equal(logout.init.headers.authorization,'Bearer '+'a'.repeat(48));
 assert.equal('body' in logout.init,false);
 assert.equal('cookie' in logout.init.headers,false);
});

test('M1 SDK rejects illegal PATCH fields, getters, arrays and invalid revision BEFORE credential or network',async()=>{
 let credentialReads=0,requests=0,accessed=0;
 const client=createM1StagingSelfClient({
  enabled:true,baseUrl:origin,appId:'starry-id',
  getSessionBearer:async()=>{credentialReads++;return 'a'.repeat(48);},
  fetchImpl:async()=>{requests++;throw Error('NOT_ALLOWED');},
 });
 for(const version of [0,-1,0.5,NaN,Number.MAX_SAFE_INTEGER]) {
  await assert.rejects(client.patchSelf(version,{display_name:'Valid'}),/STARRY_SELF_REVISION_REQUIRED/);
 }
 const getter={get display_name(){accessed++;return 'Should Not Run';}};
 for(const value of [{},{s_user_id:'foreign'},{role:'admin'},
  {display_name:' x '},{display_name:''},{display_name:'a'.repeat(81)},
  {directory_opt_in:'true'},{display_name_public:1},[1],getter,
  Object.create(null),Object.assign(Object.create(null),{display_name:'Fake'}),
 ])await assert.rejects(client.patchSelf(2,value),/STARRY_SELF_FIELDS_DENIED/);
 assert.equal(accessed,0);
 assert.equal(credentialReads,0);
 assert.equal(requests,0);
});

test('M1 SDK PATCH/logout require session and do not fetch for empty or failing credentials',async()=>{
 for(const bearer of [null,'short','Bearer '+ 'a'.repeat(48)]){
  let requests=0;
  const client=createM1StagingSelfClient({
   enabled:true,baseUrl:origin,appId:'starry-id',
   getSessionBearer:async()=>bearer,
   fetchImpl:async()=>{requests++;throw Error('PRIVATE_TOKEN');},
  });
  await assert.rejects(client.patchSelf(2,{display_name:'Valid'}),/STARRY_SELF_SESSION_REQUIRED/);
  await assert.rejects(client.logout(),/STARRY_SELF_SESSION_REQUIRED/);
  assert.equal(requests,0);
 }
});

test('M1 SDK normalizes server CAS errors without leaking any upstream private text',async()=>{
 for(const [status,code] of [
  [400,'STARRY_SELF_FIELDS_DENIED'],[401,'STARRY_SELF_UNAUTHORIZED'],
  [403,'STARRY_SELF_UNAUTHORIZED'],[409,'STARRY_SELF_CONFLICT'],
  [428,'STARRY_SELF_REVISION_REQUIRED'],[415,'STARRY_SELF_FIELDS_DENIED'],
  [503,'STARRY_SELF_UNAVAILABLE'],
 ]){
  const client=createM1StagingSelfClient({
   enabled:true,baseUrl:origin,appId:'starry-id',
   getSessionBearer:async()=> 'a'.repeat(48),
   fetchImpl:async()=>new Response('PRIVATE_PROVIDER_EMAIL_OR_SQL',{
    status,headers:{'content-type':'text/plain'},
   }),
  });
  await assert.rejects(client.patchSelf(2,{directory_opt_in:true}),e=>{
   assert.equal(e.message,code);
   assert.doesNotMatch(e.message,/PRIVATE|PROVIDER|EMAIL|SQL/);
   return true;
  });
 }
});

test('M1 SDK fails closed on invalid PATCH response, stale/forged revision and payload scope',async()=>{
 for(const reply of [
  new Response(JSON.stringify({...dto,profile_revision:2}),{status:200,headers:{
   'content-type':'application/json','cache-control':'no-store',
  }}),
  new Response(JSON.stringify({...dto,profile_revision:4}),{status:200,headers:{
   'content-type':'application/json','cache-control':'no-store',
  }}),
  new Response(JSON.stringify({...dto,email:'PRIVATE'}),{status:200,headers:{
   'content-type':'application/json','cache-control':'no-store',
  }}),
  new Response(JSON.stringify({...dto,profile_revision:3}),{status:200,headers:{
   'content-type':'application/json','cache-control':'public',
  }}),
  new Response('x'.repeat(4097),{status:200,headers:{
   'content-type':'application/json','cache-control':'no-store',
  }}),
 ]){
  const client=createM1StagingSelfClient({
   enabled:true,baseUrl:origin,appId:'starry-id',
   getSessionBearer:async()=> 'a'.repeat(48),
   fetchImpl:async()=>reply,
  });
  await assert.rejects(client.patchSelf(2,{display_name:'Only'}),/STARRY_SELF_RESPONSE_INVALID/);
 }
});

test('M1 SDK rejects forged logout body/redirect and errors without mutating local session',async()=>{
 for(const reply of [
  new Response('PRIVATE_SQL',{status:500}),
  new Response(JSON.stringify({ok:true}),{status:200}),
  new Response(null,{status:204,headers:{'cache-control':'public'}}),
  Object.defineProperty(new Response(null,{status:204,headers:{'cache-control':'no-store'}}),
   'body',{value:new ReadableStream()}),
 ]){
  const client=createM1StagingSelfClient({
   enabled:true,baseUrl:origin,appId:'starry-id',
   getSessionBearer:async()=> 'a'.repeat(48),
   fetchImpl:async()=>reply,
  });
  await assert.rejects(client.logout(),e=>{
   assert.match(e.message,/^STARRY_SELF_(?:UNAVAILABLE|RESPONSE_INVALID)$/);
   assert.doesNotMatch(e.message,/PRIVATE|SQL/);
   return true;
  });
 }
 const redirected=new Response(null,{status:204,headers:{'cache-control':'no-store'}});
 Object.defineProperty(redirected,'url',{value:'https://foreign.invalid/v1/starry-id/sessions/logout'});
 const client=createM1StagingSelfClient({
  enabled:true,baseUrl:origin,appId:'starry-id',
  getSessionBearer:async()=> 'a'.repeat(48),
  fetchImpl:async()=>redirected,
 });
 await assert.rejects(client.logout(),/STARRY_SELF_RESPONSE_INVALID/);
});

test('owner-fenced mobile CAS fails closed BEFORE Auth on missing/forged member identity or invalid fields',async()=>{
 let reads=0,requests=0;
 const client=createM1StagingSelfClient({
  enabled:true,baseUrl:origin,appId:'starry-id',
  getSessionBearer:async()=>{reads++;return 'a'.repeat(48);},
  fetchImpl:async()=>{requests++;throw Error('PRIVATE_NETWORK');},
 });
 for(const userId of ['',null,undefined,'wrong user','b'.repeat(181)]){
  await assert.rejects(client.patchSelfForUser(userId,2,{display_name:'Safe'}),
   /STARRY_SELF_IDENTITY_CHANGED/);
 }
 await assert.rejects(client.patchSelfForUser(dto.s_user_id,0,{display_name:'Safe'}),
  /STARRY_SELF_REVISION_REQUIRED/);
 await assert.rejects(client.patchSelfForUser(dto.s_user_id,2,{role:'admin'}),
  /STARRY_SELF_FIELDS_DENIED/);
 assert.equal(reads,0);assert.equal(requests,0);
 const off=make({enabled:false});
 await assert.rejects(off.client.patchSelfForUser(dto.s_user_id,2,{display_name:'Safe'}),
  /STARRY_SELF_DISABLED/);
 assert.equal(off.count(),0);
});

test('owner-fenced CAS rejects foreign current signed member or stale revision BEFORE any PATCH',async()=>{
 for(const [current,expectedCode] of [
  [{...dto,s_user_id:'su-other'},'STARRY_SELF_IDENTITY_CHANGED'],
  [{...dto,profile_revision:3},'STARRY_SELF_CONFLICT'],
 ]){
  let reads=0;
  const calls=[];
  const client=createM1StagingSelfClient({
   enabled:true,baseUrl:origin,appId:'starry-id',
   getSessionBearer:async()=>{reads++;return 'a'.repeat(48);},
   fetchImpl:async(url,init)=>{
    calls.push({url,init});
    assert.equal(init.method,'GET','must never PATCH foreign or stale row');
    return new Response(JSON.stringify(current),{
     status:200,headers:{'content-type':'application/json','cache-control':'no-store'},
    });
   },
  });
  await assert.rejects(client.patchSelfForUser(dto.s_user_id,2,{display_name:'Wrong Person'}),
   e=>e.message===expectedCode);
  assert.equal(reads,1);
  assert.equal(calls.length,1);
  assert.equal(calls[0].init.headers.authorization,'Bearer '+'a'.repeat(48));
 }
});

test('owner-fenced GET and CAS PATCH use the exact SAME captured bearer, even if Auth owner later rotates',async()=>{
 let reads=0;
 const calls=[];
 const client=createM1StagingSelfClient({
  enabled:true,baseUrl:origin,appId:'starry-id',
  getSessionBearer:async()=>{reads++;return reads===1?'a'.repeat(48):'b'.repeat(48);},
  fetchImpl:async(url,init)=>{
   calls.push({url,init});
   return new Response(JSON.stringify(init.method==='GET'?dto:{
    ...dto,display_name:'Safe Change',profile_revision:3,
   }),{status:200,headers:{
    'content-type':'application/json','cache-control':'no-store',
   }});
  },
 });
 const changed=await client.patchSelfForUser(dto.s_user_id,2,{display_name:'Safe Change'});
 assert.equal(changed.display_name,'Safe Change');
 assert.equal(changed.profile_revision,3);
 assert.equal(reads,1,'credential supplier must be read only once per fenced mutation');
 assert.deepEqual(calls.map(x=>x.init.method),['GET','PATCH']);
 assert.equal(calls[0].init.headers.authorization,calls[1].init.headers.authorization);
 assert.equal(calls[1].init.headers['if-match'],'"rev-2"');
 assert.equal(calls[0].init.credentials,'omit');
 assert.equal(calls[0].init.redirect,'error');
 assert.equal(calls[0].init.cache,'no-store');
});

test('owner-fenced preflight denies unauthorized and tainted GET before writing',async()=>{
 for(const response of [
  new Response('PRIVATE_SQL_ERROR',{status:401}),
  new Response(JSON.stringify(dto),{status:200,headers:{
   'content-type':'application/json','cache-control':'public, max-age=60',
  }}),
  new Response(JSON.stringify({...dto,email:'private@example.invalid'}),{
   status:200,headers:{'content-type':'application/json','cache-control':'no-store'},
  }),
 ]){
  let calls=0;
  const client=createM1StagingSelfClient({
   enabled:true,baseUrl:origin,appId:'starry-id',
   getSessionBearer:async()=> 'a'.repeat(48),
   fetchImpl:async(url,init)=>{calls++;assert.equal(init.method,'GET');return response;},
  });
  await assert.rejects(client.patchSelfForUser(dto.s_user_id,2,{display_name:'Wrong'}),
   e=>{
    assert.match(e.message,/^STARRY_SELF_(UNAUTHORIZED|RESPONSE_INVALID)$/);
    assert.doesNotMatch(e.message,/PRIVATE|SQL|email|Bearer/i);
    return true;
   });
  assert.equal(calls,1);
 }
});
