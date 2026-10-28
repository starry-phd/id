import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {webcrypto as crypto} from 'node:crypto';
import {signServerSession} from '../../../modules/starry-id-v1/src/session-crypto.ts';
import {createOfflineStarryRequestAuthBoundary} from '../../../modules/starry-id-v1/src/r23-signed-session-d1-request-boundary.ts';
import {handleRequest as actualWorkerHandler} from '../src/index.ts';
import {createR24OfflineStagingSessionProbe,R24_G08_ROUTE,R24_G08_CONTRACT,
 R24_G08_LIVE_ROUTE_ENABLED,R24_G08_PRODUCTION_ENABLED,
 R24_G08_STAGING_DEPLOY_AUTHORIZED} from '../src/r24-offline-staging-auth-http-smoke.ts';

const now=1793000000;
const origin='https://auth.starry.invalid';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
async function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(readFileSync(new URL('../../../modules/starry-id-v1/schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
 db.prepare("INSERT INTO starry_members VALUES('offline-u1','active',3,1,'SECRET MEMBER NAME',0,0,?,?)").run(now,now);
 db.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
  .run('apple','offline-apple-sub','offline-u1');
 db.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at,step_up_method,step_up_verified_at,step_up_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run('offline-session','offline-u1','starry-id','staging',3,'a'.repeat(64),now+300,null,null,null);
 const track={reads:0,updates:0,failDb:false,failKey:false,now};
 const readOnly={
  prepare(sql){
   if(!sql.startsWith('SELECT '))throw Error('G08 READ ONLY');
   track.reads++;
   return {bind(...values){return {first:async()=>{
    if(track.failDb)throw Error('D1 staged outage');
    return db.prepare(sql).get(...values)??null;
   }};}};
  }
 };
 const key=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},
  false,['sign','verify']);
 const token=await signServerSession({
  brand_id:'starry',app_id:'starry-id',environment:'staging',
  provider:'apple',provider_subject:'offline-apple-sub',s_user_id:'offline-u1',
  session_id:'offline-session',auth_version:3,
  expires_at:now+300,issued_at:now,key_id:'test-kid'
 },scope,now,{kid:'test-kid',key});
 const boundary=createOfflineStarryRequestAuthBoundary({
  enabled:true,serverScope:scope,expectedOrigin:origin,
  authDb:readOnly,getVerificationKey:async kid=>{
   if(track.failKey)throw Error('key unavailable');
   return kid==='test-kid'?key:null;
  }
 });
 const probe=createR24OfflineStagingSessionProbe({
  enabledForOfflineHarness:true,trustedScope:scope,
  syntheticOrigin:origin,serverNow:()=>track.now,boundary
 });
 const request=(override={})=>new Request(override.url??origin+R24_G08_ROUTE,{
  method:override.method??'GET',
  headers:{authorization:override.authorization??'Bearer '+token,...override.headers}
 });
 return {db,track,probe,boundary,token,key,request,close(){db.close();}};
}
const assertSafe=async response=>{
 assert.equal(response.headers.get('access-control-allow-origin'),null);
 assert.equal(response.headers.get('cache-control'),'no-store, private');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 assert.equal(response.headers.get('vary'),'authorization');
 const text=await response.text();
 for(const sensitive of ['SECRET MEMBER NAME','offline-u1','offline-session',
  'offline-apple-sub','test-kid','auth_version','session_id','display_name'])
  assert.ok(!text.includes(sensitive),sensitive);
 return text;
};
test('R24 offline staging adapter is NOT wired to the actual Worker entrypoint',async()=>{
 assert.equal(R24_G08_LIVE_ROUTE_ENABLED,false);
 assert.equal(R24_G08_PRODUCTION_ENABLED,false);
 assert.equal(R24_G08_STAGING_DEPLOY_AUTHORIZED,false);
 const res=actualWorkerHandler(new Request(origin+R24_G08_ROUTE),
  {STARRY_ENVIRONMENT:'staging',STARRY_APP_ID:'starry-id'});
 assert.equal(res.status,404);
 assert.equal(res.headers.get('cache-control'),'no-store');
 assert.equal((await res.json()).error.code,'NOT_FOUND');
});
test('real AI-1 signed HMAC Bearer + Member/Session/Identity SQLite SELECT yields bodyless 204 ONLY offline',async()=>{
 const x=await fixture();try{
  assert.equal(x.probe.contract,R24_G08_CONTRACT);
  assert.equal(x.probe.live,false);assert.equal(x.probe.publishable,false);
  assert.equal(x.probe.may_deploy,false);assert.equal(x.probe.may_read_real_d1,false);
  const r=await x.probe.handle(x.request());
  assert.equal(r.status,204);assert.equal(await assertSafe(r),'');
  assert.equal(x.track.reads,3);
 }finally{x.close();}
});
test('recheck signed Session on every HTTP request: physical SQLite revocation denies subsequent request',async()=>{
 const x=await fixture();try{
  assert.equal((await x.probe.handle(x.request())).status,204);
  x.db.prepare("UPDATE starry_sessions SET revoked_at=? WHERE session_id='offline-session'").run(now);
  const r=await x.probe.handle(x.request());
  assert.equal(r.status,401);await assertSafe(r);
  assert.equal(x.track.reads,6);
 }finally{x.close();}
});
test('current member status deleted/suspended or auth version bump denies old signed Bearer',async()=>{
 for(const sql of ["UPDATE starry_members SET status='suspended'",
  "UPDATE starry_members SET status='deleted'",
  "UPDATE starry_members SET auth_version=4"]){
  const x=await fixture();try{
   x.db.exec(sql);const r=await x.probe.handle(x.request());
   assert.equal(r.status,401);await assertSafe(r);
  }finally{x.close();}
 }
});
test('tampered signature, missing bearer and rotated/missing signing key are never accepted',async()=>{
 const x=await fixture();try{
  const corrupted=x.token.slice(0,-2)+(x.token.endsWith('aa')?'bb':'aa');
  for(const authorization of ['Bearer '+corrupted,'Basic '+x.token,'Bearer bogus','']){
   const r=await x.probe.handle(x.request({authorization}));
   assert.equal(r.status,401);await assertSafe(r);
  }
  x.track.failKey=true;
  const r=await x.probe.handle(x.request());
  assert.equal(r.status,401);await assertSafe(r);
 }finally{x.close();}
});
test('malformed guest requests, foreign host, query injection and unsafe verbs fail before DB',async()=>{
 const x=await fixture();try{
  const attempts=[
   x.request({url:'https://evil.invalid'+R24_G08_ROUTE}),
   x.request({url:origin+R24_G08_ROUTE+'?token=stolen'}),
   x.request({url:origin+'/v1/members'}),
   x.request({url:origin+R24_G08_ROUTE+'/extra'}),
   x.request({method:'POST'}),
   x.request({method:'DELETE'}),
   x.request({headers:{cookie:'starry_legacy=1'}}),
   x.request({headers:{'x-forwarded-authorization':'Bearer old'}}),
   x.request({headers:{'proxy-authorization':'Bearer old'}})
  ];
  for(const request of attempts){
   const r=await x.probe.handle(request);
   assert.ok([401,404,405].includes(r.status));
   await assertSafe(r);
  }
  assert.equal(x.track.reads,0);
 }finally{x.close();}
});
test('bad/stale clock cannot turn a legitimate token into a published success',async()=>{
 const x=await fixture();try{
  for(const t of [Number.NaN,-1,1.1]){
   x.track.now=t;const r=await x.probe.handle(x.request());
   assert.equal(r.status,503);await assertSafe(r);
  }
  x.track.now=now+301;
  const r=await x.probe.handle(x.request());assert.equal(r.status,401);await assertSafe(r);
 }finally{x.close();}
});
test('staging D1 read outage never emits identity or grants any rights',async()=>{
 const x=await fixture();try{
  x.track.failDb=true;
  const r=await x.probe.handle(x.request());
  assert.equal(r.status,401);await assertSafe(r);
 }finally{x.close();}
});
test('constructor refuses production/foreign brand/wrong App and real public hosts',async()=>{
 const x=await fixture();try{
  const common={enabledForOfflineHarness:true,trustedScope:scope,
   syntheticOrigin:origin,serverNow:()=>now,boundary:x.boundary};
  for(const override of [
   {enabledForOfflineHarness:false},
   {trustedScope:{...scope,environment:'production'}},
   {trustedScope:{...scope,brand_id:'hglobal'}},
   {trustedScope:{...scope,app_id:'another-app'}},
   {syntheticOrigin:'https://id.starry.phd/'},
   {syntheticOrigin:'http://auth.starry.invalid/'},
   {syntheticOrigin:'https://auth.starry.invalid/private'},
   {syntheticOrigin:'https://auth.starry.invalid/?session=1'},
   {syntheticOrigin:'https://id.starry.invalid:8443/'}
  ])assert.throws(()=>createR24OfflineStagingSessionProbe({...common,...override}));
 }finally{x.close();}
});
test('forged plain-object principal returned from fake boundary cannot bypass AI-1 sealed provenance',async()=>{
 const x=await fixture();try{
  const fake=createR24OfflineStagingSessionProbe({
   enabledForOfflineHarness:true,trustedScope:scope,syntheticOrigin:origin,
   serverNow:()=>now,boundary:{contract:x.boundary.contract,
    authenticate:async()=>({
     brand_id:'starry',app_id:'starry-id',environment:'staging',
     checked_at:now,expires_at:now+300
    })}
  });
  const r=await fake.handle(x.request());
  assert.equal(r.status,401);await assertSafe(r);
 }finally{x.close();}
});
test('non-Request input and thrown auth port do not expose backend/internal errors',async()=>{
 const x=await fixture();try{
  assert.equal((await x.probe.handle({url:origin+R24_G08_ROUTE})).status,404);
  const b=createR24OfflineStagingSessionProbe({
   enabledForOfflineHarness:true,trustedScope:scope,syntheticOrigin:origin,
   serverNow:()=>now,boundary:{contract:x.boundary.contract,
    authenticate:async()=>{throw Error('SECRET KEYSTORE FAIL')}}
  });
  const r=await b.handle(x.request());
  assert.equal(r.status,503);await assertSafe(r);
 }finally{x.close();}
});
