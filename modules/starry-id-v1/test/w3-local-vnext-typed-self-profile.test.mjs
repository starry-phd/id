import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {signServerSession} from '../src/session-crypto.ts';
import {
  createLocalOnlyVNextTypedSelfProfileHandler,
  W3_LOCAL_VNEXT_LIVE_ENABLED,
} from '../src/w3-local-vnext-typed-self-profile.ts';

const clock=1793000000;
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const origin='https://id.starry.example';
async function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(readFileSync(new URL('../schema/001_starry_identity.DRAFT.sql',import.meta.url),'utf8'));
  const keys=new Map(),tokens=new Map();
  for(const n of [1,2]){
    const id='u'+n,sid='sess'+n;
    sql.prepare('INSERT INTO starry_members VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id,'active',3,1,'Member '+n,0,0,clock,clock);
    sql.prepare('INSERT INTO starry_identities(provider,subject,s_user_id) VALUES(?,?,?)')
      .run('apple','sub-'+n,id);
    sql.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES(?,?,?,?,?,?,?)')
      .run(sid,id,'starry-id','staging',3,String(n).repeat(64),clock+300);
    const key=await webcrypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
    keys.set('kid-'+n,key);
    tokens.set(n,await signServerSession({
      ...scope,provider:'apple',provider_subject:'sub-'+n,s_user_id:id,
      session_id:sid,auth_version:3,expires_at:clock+300,issued_at:clock,key_id:'kid-'+n,
    },scope,clock,{kid:'kid-'+n,key}));
  }
  const state={reads:0,authReads:0,finalReads:0,keyReads:0,
    throwKey:null,nullKey:null,throwDb:null,throwStage:null,onFinal:null,afterFirstAuth:null};
  const db={prepare(query){
    assert.match(query,/^SELECT\s/);
    state.reads++;
    if(query.includes('FROM starry_members m JOIN starry_sessions s')) state.finalReads++;
    else state.authReads++;
    if(state.throwStage==='prepare')throw Error('PRIVATE_SQL_ERROR');
    return {bind(...params){
      if(state.throwStage==='bind')throw Error('PRIVATE_SQL_ERROR');
      return {first:async()=>{
        await Promise.resolve();
        if(state.throwStage==='first' ||
          (state.throwDb && params.includes(state.throwDb)))throw Error('PRIVATE_SQL_ERROR');
        if(query.includes('FROM starry_members m JOIN starry_sessions s') && state.onFinal)
          await state.onFinal();
        const result=sql.prepare(query).get(...params)??null;
        if(state.afterFirstAuth && state.authReads===3 && state.finalReads===0)
          await state.afterFirstAuth();
        return result;
      }};
    }};
  }};
  const deps={serverScope:scope,expectedOrigin:origin,authDb:db,now:()=>clock,
    getVerificationKey:async kid=>{
      state.keyReads++;
      await Promise.resolve();
      if(kid===state.throwKey)throw Error('PRIVATE_KMS_SECRET');
      if(kid===state.nullKey)return null;
      return keys.get(kid)??null;
    }};
  const request=(n=1,opts={})=>new Request(opts.url??origin+'/v1/starry-id/members/me',{
    method:opts.method??'GET',
    headers:{authorization:'Bearer '+(opts.token??tokens.get(n)),...(opts.headers??{})},
  });
  return {sql,keys,tokens,state,deps,request,close:()=>sql.close()};
}
const err=async r=>(await r.json()).error.code;

test('default OFF, no key or SQLite access, and cannot configure production/foreign/HTTP',async()=>{
  const f=await fixture();try{
    assert.equal(W3_LOCAL_VNEXT_LIVE_ENABLED,false);
    const h=createLocalOnlyVNextTypedSelfProfileHandler(f.deps);
    assert.equal(h.deployed,false);assert.equal(h.public_worker_route_registered,false);
    assert.equal(await err(await h.handle(f.request())),'FEATURE_DISABLED');
    assert.equal(f.state.reads,0);assert.equal(f.state.keyReads,0);
    for(const change of [
      {serverScope:{...scope,environment:'production'}},
      {serverScope:{...scope,brand_id:'hglobal'}},
      {serverScope:{...scope,app_id:'other'}},
      {expectedOrigin:'http://id.starry.example'},
      {expectedOrigin:origin+'/inner'},
    ])assert.throws(()=>createLocalOnlyVNextTypedSelfProfileHandler({...f.deps,...change,enabled:true}));
  }finally{f.close();}
});
test('real HMAC/SQLite delegates to original final fence, precise five-field 200, quantified reads',async()=>{
  const f=await fixture();try{
    const h=createLocalOnlyVNextTypedSelfProfileHandler({...f.deps,enabled:true});
    const r=await h.handle(f.request());
    assert.equal(r.status,200);
    assert.equal(r.headers.get('cache-control'),'no-store');
    assert.deepEqual(await r.json(),{
      s_user_id:'u1',display_name:'Member 1',directory_opt_in:false,
      display_name_public:false,profile_revision:1,
    });
    // W2 three current reads + original #244 three current reads + one final
    // snapshot query; original additionally verifies HMAC again.
    assert.equal(f.state.authReads,6);
    assert.equal(f.state.finalReads,1);
    assert.equal(f.state.reads,7);
    assert.equal(f.state.keyReads,3); // W2 auth, original auth, original evidence
  }finally{f.close();}
});
test('alias, wrong method, query, foreign origin/host rejected before key/DB',async()=>{
  const f=await fixture();try{
    const h=createLocalOnlyVNextTypedSelfProfileHandler({...f.deps,enabled:true});
    const cases=[
      [f.request(1,{url:origin+'/v1/member/self'}),404,'NOT_FOUND'],
      [f.request(1,{method:'PUT'}),405,'METHOD_NOT_ALLOWED'],
      [f.request(1,{url:origin+'/v1/starry-id/members/me?member=u2'}),400,'REQUEST_DENIED'],
      [f.request(1,{url:'https://untrusted.example/v1/starry-id/members/me'}),404,'NOT_FOUND'],
      [f.request(1,{headers:{origin:'https://untrusted.example'}}),404,'NOT_FOUND'],
      [f.request(1,{headers:{cookie:'sid=not-accepted'}}),401,'IDENTITY_DENIED'],
    ];
    for(const [req,status,code] of cases){
      const r=await h.handle(req);
      assert.equal(r.status,status);assert.equal(await err(r),code);
      assert.equal(r.headers.get('cache-control'),'no-store');
      if(status===405)assert.equal(r.headers.get('allow'),'GET');
    }
    assert.equal(f.state.reads,0);assert.equal(f.state.keyReads,0);
  }finally{f.close();}
});
test('unknown kid null =>401, key throw =>503, without private reflection/retry',async()=>{
  const f=await fixture();try{
    const h=createLocalOnlyVNextTypedSelfProfileHandler({...f.deps,enabled:true});
    f.state.nullKey='kid-1';
    assert.equal(await err(await h.handle(f.request())),'IDENTITY_DENIED');
    f.state.nullKey=null;f.state.throwKey='kid-1';
    const r=await h.handle(f.request());
    assert.equal(r.status,503);
    assert.equal(await err(r),'SERVICE_UNAVAILABLE');
    assert.equal(f.state.keyReads,2);
    assert.equal(f.state.reads,0);
  }finally{f.close();}
});
test('prepare/bind/first port faults =>503 without SQL/secret disclosure',async()=>{
  for(const stage of ['prepare','bind','first']){
    const f=await fixture();try{
      f.state.throwStage=stage;
      const h=createLocalOnlyVNextTypedSelfProfileHandler({...f.deps,enabled:true});
      const r=await h.handle(f.request());
      assert.equal(r.status,503,stage);
      const body=await r.text();
      assert.equal(JSON.parse(body).error.code,'SERVICE_UNAVAILABLE');
      assert.doesNotMatch(body,/PRIVATE|SELECT|kid-|Bearer/);
    }finally{f.close();}
  }
});
test('parallel good and failing key/SQLite requests do not contaminate one another',async()=>{
  for(const failure of ['throwKey','throwDb']){
    const f=await fixture();try{
      f.state[failure]=failure==='throwKey'?'kid-2':'sess2';
      const h=createLocalOnlyVNextTypedSelfProfileHandler({...f.deps,enabled:true});
      const [a,b]=await Promise.all([h.handle(f.request(1)),h.handle(f.request(2))]);
      assert.equal(a.status,200,failure);
      assert.equal((await a.json()).s_user_id,'u1');
      assert.equal(b.status,503,failure);
      assert.equal(await err(b),'SERVICE_UNAVAILABLE');
    }finally{f.close();}
  }
});
test('revoke/delete/unlink after W2 precheck cannot pass original re-auth/final fence',async()=>{
  for(const mutation of [
    "UPDATE starry_sessions SET revoked_at=1793000000 WHERE session_id='sess1'",
    "UPDATE starry_members SET status='deleted' WHERE s_user_id='u1'",
    "DELETE FROM starry_identities WHERE s_user_id='u1'",
  ]){
    const f=await fixture();try{
      let executed=false;
      // After three W2 Auth reads and before original handler begins.
      f.state.afterFirstAuth=async()=>{
        if(!executed){executed=true;f.sql.exec(mutation);}
      };
      const h=createLocalOnlyVNextTypedSelfProfileHandler({...f.deps,enabled:true});
      const r=await h.handle(f.request());
      assert.equal(executed,true);
      assert.notEqual(r.status,200,mutation);
      assert.equal(r.status,401,mutation);
      assert.equal(await err(r),'IDENTITY_DENIED');
      assert.equal(f.state.finalReads,0);
    }finally{f.close();}
  }
});
test('revoke during original final SELECT window returns current record denied',async()=>{
  const f=await fixture();try{
    let done=false;
    f.state.onFinal=async()=>{
      if(!done){done=true;f.sql.exec("UPDATE starry_sessions SET revoked_at=1793000000 WHERE session_id='sess1'");}
    };
    const h=createLocalOnlyVNextTypedSelfProfileHandler({...f.deps,enabled:true});
    const r=await h.handle(f.request());
    assert.equal(done,true);assert.equal(r.status,403);
    assert.equal(await err(r),'CURRENT_RECORD_DENIED');
    assert.equal(f.state.finalReads,1);
  }finally{f.close();}
});
