import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {webcrypto as crypto} from 'node:crypto';
import {signServerSession} from '../../../modules/starry-id-v1/src/session-crypto.ts';
import {createIsolatedSelfProfileHandler, SELF_PROFILE_PATH}
 from '../../../packages/integration/src/ai0-w1-isolated-self-profile.ts';
import {createIsolatedSelfProfileClient, SELF_PROFILE_CLIENT_PATH}
 from '../../../packages/integration/src/ai0-w1-isolated-self-profile-client.ts';
const now = 1793000000;
const scope = {brand_id:'starry',app_id:'starry-id',environment:'staging'};
const origin = 'https://id.starry.example';
async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('../../../modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
  for (const [id,name] of [['u1','Own profile'],['u2','Other member private']]) {
    db.prepare("INSERT INTO starry_members VALUES(?,'active',3,1,?,0,0,?,?)").run(id,name,now,now);
  }
  db.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)').run('apple','apple-sub','u1');
  db.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES(?,?,?,?,?,?,?)')
    .run('s1','u1','starry-id','staging',3,'a'.repeat(64),now+300);
  const state = {reads:0, snapshotHook:null, keyHook:null, dbFailure:false, clock:now, extra:false};
  const port = {prepare(sql) {
    assert.match(sql,/^SELECT /);
    return {bind(...args) {return {first:async()=>{
      state.reads++;
      if (state.dbFailure) throw new Error('PRIVATE_SQL_TOKEN_SECRET');
      if (sql.startsWith('SELECT m.s_user_id') && state.snapshotHook) state.snapshotHook();
      const row = db.prepare(sql).get(...args) ?? null;
      return row && state.extra ? {...row, oauth_email:'private@example.invalid',refresh_hash:'PRIVATE_SECRET'} : row;
    }}}};
  }};
  const key = await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
  const claims = {...scope,provider:'apple',provider_subject:'apple-sub',s_user_id:'u1',session_id:'s1',
    auth_version:3,expires_at:now+300,issued_at:now,key_id:'local-kid'};
  const token = await signServerSession(claims,scope,now,{kid:'local-kid',key});
  const config = {serverScope:scope,expectedOrigin:origin,authDb:port,
    getVerificationKey:async kid=>{if(state.keyHook) state.keyHook();return kid==='local-kid'?key:null;},
    now:()=>state.clock};
  const handler = createIsolatedSelfProfileHandler({...config,enabled:true});
  const req = (path=SELF_PROFILE_PATH,headers={},method='GET') => new Request(origin+path,
    {method,headers:{authorization:'Bearer '+token,...headers}});
  return {db,state,key,claims,token,config,handler,req,close:()=>db.close()};
}

const doc = JSON.parse(readFileSync(new URL('../../../docs/contracts/AI0-W1-ISOLATED-SELF-PROFILE.openapi.json',import.meta.url),'utf8'));
const valid = {s_user_id:'u1',display_name:'Own profile',directory_opt_in:false,display_name_public:false,profile_revision:1};
const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
test('client→real signed handler→actual SQLite→strict client projection completes isolated round trip',async()=>{
 const x=await setup();try {
  let calls=0;
  const client=createIsolatedSelfProfileClient({enabled:true,origin,environment:'staging',getBearer:async()=>x.token,
    fetchImpl:async request=>{
      calls++;
      assert.equal(request.credentials,'omit');assert.equal(request.redirect,'error');
      assert.equal(request.cache,'no-store');assert.equal(request.url,origin+SELF_PROFILE_PATH);
      assert.equal(request.headers.has('cookie'),false);
      return x.handler.handle(request);
    }});
  assert.deepEqual(await client.readSelf(),{ok:true,profile:valid});
  assert.equal(calls,1);assert.equal(x.state.reads,4);
  x.db.exec("UPDATE starry_sessions SET revoked_at=1793000000 WHERE session_id='s1'");
  assert.deepEqual(await client.readSelf(),{ok:false,code:'AUTH_REQUIRED'});
 }finally{x.close();}
});
test('OpenAPI, isolated server and client agree on exact path, fields and revision without enabling release',()=>{
 assert.equal(SELF_PROFILE_CLIENT_PATH,SELF_PROFILE_PATH);
 assert.deepEqual(Object.keys(doc.paths),[SELF_PROFILE_PATH]);
 const shape=doc.components.schemas.SelfProfile;
 assert.deepEqual(shape.required.slice().sort(),Object.keys(valid).sort());
 assert.equal(shape.required.length,5);
 assert.equal(shape.additionalProperties,false);assert.equal(shape.properties.profile_revision.minimum,1);
 assert.equal(shape.properties.profile_revision.maximum,Number.MAX_SAFE_INTEGER-1);
 assert.deepEqual(doc.servers,[]);assert.equal(doc['x-starry-safety'].worker_registered,false);
 assert.equal(doc['x-starry-safety'].release_authorized,false);
});
test('disabled, missing and malformed bearer perform zero transport calls and disclose no credential',async()=>{
 let calls=0;
 const config={origin,environment:'staging',fetchImpl:async()=>{calls++;throw Error('SECRET');},getBearer:async()=>null};
 assert.deepEqual(await createIsolatedSelfProfileClient(config).readSelf(),{ok:false,code:'FEATURE_DISABLED'});
 for(const token of [null,'','Bearer x','v1.not-a-real-secret.signature'])
  assert.deepEqual(await createIsolatedSelfProfileClient({...config,enabled:true,getBearer:async()=>token}).readSelf(),{ok:false,code:'AUTH_REQUIRED'});
 assert.equal(calls,0);
});
test('unsafe origins and production environment cannot construct the integration client',()=>{
 const config={origin,environment:'staging',fetchImpl:async()=>new Response(),getBearer:async()=>null};
 for(const change of [{origin:'http://id.starry.example'},{origin:origin+'/private'},
   {origin:'https://user:pass@id.starry.example'},{origin:origin+'?token=secret'},{environment:'production'}])
  assert.throws(()=>createIsolatedSelfProfileClient({...config,...change}));
});
test('extra private fields, wrong types, zero revision, whitespace/control names and oversized body are rejected',async()=>{
 const x=await setup();try {
  for(const value of [
    {...valid,oauth_email:'private@example.invalid'},{...valid,directory_opt_in:1},
    {...valid,profile_revision:0},{...valid,profile_revision:Number.MAX_SAFE_INTEGER},
    {...valid,display_name:' leading'},{...valid,display_name:'bad'+String.fromCharCode(1)},
    {...valid,s_user_id:'../foreign'},[valid],null,
  ]) {
    const client=createIsolatedSelfProfileClient({origin,environment:'staging',enabled:true,getBearer:async()=>x.token,
      fetchImpl:async()=>new Response(JSON.stringify(value),{headers})});
    assert.deepEqual(await client.readSelf(),{ok:false,code:'PROTOCOL_DENIED'});
  }
  for(const body of ['not-json','x'.repeat(17000)]) {
    const client=createIsolatedSelfProfileClient({origin,environment:'staging',enabled:true,getBearer:async()=>x.token,
      fetchImpl:async()=>new Response(body,{headers})});
    assert.deepEqual(await client.readSelf(),{ok:false,code:'PROTOCOL_DENIED'});
  }
 }finally{x.close();}
});
test('wrong content/cache policy and redirects cannot be accepted as profile success',async()=>{
 const x=await setup();try {
  for(const response of [
    new Response(JSON.stringify(valid),{headers:{'content-type':'text/html','cache-control':'no-store'}}),
    new Response(JSON.stringify(valid),{headers:{'content-type':'application/json','cache-control':'public'}}),
    new Response(null,{status:302,headers:{location:'https://foreign.example'}}),
    new Response(null,{status:204}),
  ]) {
    const client=createIsolatedSelfProfileClient({origin,environment:'staging',enabled:true,getBearer:async()=>x.token,
      fetchImpl:async()=>response});
    assert.deepEqual(await client.readSelf(),{ok:false,code:'PROTOCOL_DENIED'});
  }
 }finally{x.close();}
});
test('HTTP denials and dependency failures yield bounded error codes without reflecting body or token',async()=>{
 const x=await setup();try {
  for(const [status,code] of [[401,'AUTH_REQUIRED'],[403,'CURRENT_RECORD_DENIED'],[503,'SERVICE_UNAVAILABLE']]) {
    const client=createIsolatedSelfProfileClient({origin,environment:'staging',enabled:true,getBearer:async()=>x.token,
      fetchImpl:async()=>new Response('PRIVATE_ERROR_TOKEN',{status})});
    assert.deepEqual(await client.readSelf(),{ok:false,code});
  }
  const client=createIsolatedSelfProfileClient({origin,environment:'staging',enabled:true,getBearer:async()=>{throw Error('PRIVATE_KEY');},
    fetchImpl:async()=>{throw Error('PRIVATE_NETWORK');}});
  assert.deepEqual(await client.readSelf(),{ok:false,code:'SERVICE_UNAVAILABLE'});
 }finally{x.close();}
});
