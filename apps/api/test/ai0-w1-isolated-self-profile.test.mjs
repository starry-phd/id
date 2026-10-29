import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import {webcrypto as crypto} from 'node:crypto';
import {signServerSession} from '../../../modules/starry-id-v1/src/session-crypto.ts';
import {createIsolatedSelfProfileHandler, SELF_PROFILE_PATH, SELF_PROFILE_LIVE_ENABLED}
  from '../../../packages/integration/src/ai0-w1-isolated-self-profile.ts';

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
test('AI0 isolated handler defaults OFF and rejects production/foreign app/brand configuration',async()=>{
  const x=await setup();try {
    assert.equal(SELF_PROFILE_LIVE_ENABLED,false);
    const off=createIsolatedSelfProfileHandler(x.config);
    assert.equal((await off.handle(x.req())).status,503);
    assert.equal(x.state.reads,0);
    for(const change of [{environment:'production'},{brand_id:'hglobal'},{app_id:'other'}])
      assert.throws(()=>createIsolatedSelfProfileHandler({...x.config,serverScope:{...scope,...change}}));
  }finally{x.close();}
});
test('actual signed bearer and SQLite return only the six own-profile fields',async()=>{
  const x=await setup();try {
    x.state.extra=true;
    const r=await x.handler.handle(x.req());
    assert.equal(r.status,200);
    assert.equal(r.headers.get('cache-control'),'no-store');
    assert.equal(r.headers.get('x-content-type-options'),'nosniff');
    const data=await r.json();
    assert.deepEqual(data,{s_user_id:'u1',display_name:'Own profile',directory_opt_in:false,
      display_name_public:false,profile_revision:1});
    assert.equal(JSON.stringify(data).includes('PRIVATE_SECRET'),false);
    assert.equal(x.state.reads,4);
  }finally{x.close();}
});
test('query-selected member, route aliases, wrong hosts and mutation methods perform no DB reads',async()=>{
  const x=await setup();try {
    for(const [request,status] of [
      [x.req(SELF_PROFILE_PATH+'?s_user_id=u2'),400],
      [x.req('/v1/member/self'),404],
      [x.req('/v1/starry-id/members/u2'),404],
      [new Request('https://foreign.example'+SELF_PROFILE_PATH),404],
      [x.req(SELF_PROFILE_PATH,{},'PATCH'),405],
    ]) assert.equal((await x.handler.handle(request)).status,status);
    assert.equal(x.state.reads,0);
    assert.equal((await x.handler.handle(x.req(SELF_PROFILE_PATH,{},'POST'))).headers.get('allow'),'GET');
  }finally{x.close();}
});
test('unsigned, tampered, cookies and forged client identity cannot read a profile',async()=>{
  const x=await setup();try {
    for(const headers of [
      {authorization:''},{authorization:'Bearer forged'},
      {authorization:'Bearer '+x.token.slice(0,-2)+'xy'},
      {cookie:'session=old'},{'x-forwarded-authorization':'Bearer '+x.token},
    ]) assert.equal((await x.handler.handle(x.req(SELF_PROFILE_PATH,headers))).status,401);
    assert.equal(x.state.reads,0);
  }finally{x.close();}
});
test('real revocation, member suspension/version bump or unlink denies the next request',async()=>{
  for(const sql of [
    "UPDATE starry_sessions SET revoked_at=1793000000 WHERE session_id='s1'",
    "UPDATE starry_members SET status='suspended' WHERE s_user_id='u1'",
    "UPDATE starry_members SET status='deleted' WHERE s_user_id='u1'",
    "UPDATE starry_members SET auth_version=4 WHERE s_user_id='u1'",
    "DELETE FROM starry_identities WHERE s_user_id='u1'",
  ]) {
    const x=await setup();try {
      assert.equal((await x.handler.handle(x.req())).status,200);
      x.db.exec(sql);
      assert.equal((await x.handler.handle(x.req())).status,401);
    }finally{x.close();}
  }
});
test('revoke, unlink, delete or version changes between authentication and final profile snapshot deny disclosure',async()=>{
  for(const sql of [
    "UPDATE starry_sessions SET revoked_at=1793000000 WHERE session_id='s1'",
    "UPDATE starry_members SET status='deleted' WHERE s_user_id='u1'",
    "UPDATE starry_members SET auth_version=4 WHERE s_user_id='u1'",
  ]) {
    const x=await setup();try {
      x.state.snapshotHook=()=>x.db.exec(sql);
      const r=await x.handler.handle(x.req());
      assert.equal(r.status,403);
      assert.equal((await r.text()).includes('Own profile'),false);
    }finally{x.close();}
  }
});
test('clock rollback, request expiry and slow dependency deny profile output',async()=>{
  for(const shift of [-1,6,301]) {
    const x=await setup();try {
      x.state.keyHook=()=>{x.state.clock=now+shift;};
      const r=await x.handler.handle(x.req());
      assert.equal(r.status,401);
      assert.equal((await r.text()).includes('Own profile'),false);
    }finally{x.close();}
  }
});
test('invalid clock and storage failure remain generic with no exception or private row disclosure',async()=>{
  const x=await setup();try {
    x.state.clock=NaN;
    assert.equal((await x.handler.handle(x.req())).status,503);
    x.state.clock=now;
    x.state.dbFailure=true;
    const r=await x.handler.handle(x.req());
    assert.equal(r.status,401);
    assert.equal((await r.text()).includes('PRIVATE_SQL'),false);
    x.state.dbFailure=false;
    // Failure on the final snapshot is a service error; SQL details stay private.
    x.state.snapshotHook=()=>{throw new Error('PRIVATE_FINAL_SNAPSHOT');};
    const r2=await x.handler.handle(x.req());
    assert.equal(r2.status,503);
    assert.deepEqual(await r2.json(),{error:{code:'SERVICE_UNAVAILABLE'}});
  }finally{x.close();}
});
