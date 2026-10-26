import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarrySessionPersistence,hashServerRefreshSecret} from '../src/session-persistence.ts';
import {createHostOnlySessionCookie,clearHostOnlySessionCookie,authorizeCookieMutation} from '../src/cookie-safety.ts';
const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'},now=1793000000;
const hash='a'.repeat(64),hash2='b'.repeat(64);
function db(changes=1){
 const calls=[];
 return {calls,database:{prepare(sql){const s={bind(...args){calls.push({sql,args});return s;},
  run:async()=>({success:true,meta:{changes}}),first:async()=>null};return s;}}};
}
test('persist active existing provider subject only with prepared INSERT SELECT',async()=>{
 const d=db(),p=createStarrySessionPersistence(d.database,scope);
 assert.equal(await p.createForExistingMember({s_user_id:'s1',provider:'apple',provider_subject:'apple-sub',
  session_id:'sid',refresh_hash:hash,auth_version:2,expires_at:now+3600,now}),true);
 assert.ok(d.calls[0].sql.includes("JOIN starry_identities i"));
 assert.ok(d.calls[0].sql.includes("m.status='active'"));
 assert.ok(!d.calls[0].sql.includes('email'));
 assert.deepEqual(d.calls[0].args,['sid','starry-id','staging',hash,now+3600,'s1',2,'apple','apple-sub']);
 assert.equal(await createStarrySessionPersistence(db(0).database,scope).createForExistingMember({
  s_user_id:'s1',provider:'apple',provider_subject:'apple-sub',
  session_id:'sid',refresh_hash:hash,auth_version:2,expires_at:now+3600,now}),false);
});
test('reject client role/hash, bad scope, overlong refresh, replay hash and stale version',async()=>{
 const d=db(),p=createStarrySessionPersistence(d.database,scope);
 for(const args of [
  {provider:'hglobal'},{s_user_id:'x@y'},{refresh_hash:'client-token'},
  {expires_at:now+40*86400},{auth_version:0},
 ]) {
  const x={s_user_id:'s1',provider:'apple',provider_subject:'sub',
   session_id:'sid',refresh_hash:hash,auth_version:2,expires_at:now+3600,now,...args};
  assert.equal(await p.createForExistingMember(x),false);
 }
 assert.equal(d.calls.length,0);
 assert.throws(()=>createStarrySessionPersistence(d.database,{...scope,brand_id:'hglobal'}),/SESSION_DB_SCOPE_DENIED/);
});
test('refresh CAS validates current hash, version, session/app/runtime, revoked and expiry',async()=>{
 const d=db(),p=createStarrySessionPersistence(d.database,scope);
 const args={s_user_id:'s1',session_id:'sid',auth_version:2,previous_hash:hash,
  next_hash:hash2,expires_at:now+3600,now};
 assert.equal(await p.rotateRefreshCAS(args),true);
 assert.ok(d.calls[0].sql.includes('AND revoked_at IS NULL AND expires_at>?'));
 assert.ok(d.calls[0].sql.includes("m.status='active'"));
 assert.deepEqual(d.calls[0].args,[hash2,now+3600,'sid','s1','starry-id','staging',2,hash,now]);
 assert.equal(await p.rotateRefreshCAS({...args,next_hash:hash}),false);
 assert.equal(await createStarrySessionPersistence(db(0).database,scope).rotateRefreshCAS(args),false);
});
test('bump member auth version CAS rejects duplicate and stale state',async()=>{
 const d=db(),p=createStarrySessionPersistence(d.database,scope);
 assert.equal(await p.bumpMemberVersionCAS('s1',3,now),true);
 assert.ok(d.calls[0].sql.includes('auth_version=auth_version+1'));
 assert.equal(await createStarrySessionPersistence(db(0).database,scope).bumpMemberVersionCAS('s1',3,now),false);
 assert.equal(await p.bumpMemberVersionCAS('s1',Number.MAX_SAFE_INTEGER,now),false);
});
test('refresh hash is SHA-256 of high entropy server-only raw bytes',async()=>{
 const s=new Uint8Array(32);crypto.getRandomValues(s);
 const h=await hashServerRefreshSecret(s);
 assert.match(h,/^[a-f0-9]{64}$/);
 await assert.rejects(()=>hashServerRefreshSecret(new Uint8Array(16)),/REFRESH_SECRET_DENIED/);
});
test('host-only secure cookie; no insecure/fixed session or excessive TTL',()=>{
 const tok='v1.'+'a'.repeat(48)+'.'+'b'.repeat(43);
 const value=createHostOnlySessionCookie(tok);
 assert.match(value,/__Host-starry_session=/);
 for(const key of ['Secure','HttpOnly','SameSite=Strict','Path=/','Max-Age=900'])assert.ok(value.includes(key));
 assert.match(clearHostOnlySessionCookie(),/Max-Age=0/);
 assert.throws(()=>createHostOnlySessionCookie('client-verified=true'),/COOKIE_DENIED/);
 assert.throws(()=>createHostOnlySessionCookie(tok,3600),/COOKIE_DENIED/);
});
test('cookie writes deny forged cross-site origin, missing CSRF, wrong method, false proof',async()=>{
 const cfg={method:'POST',originHeader:'https://id.starry.test',fetchSiteHeader:'same-origin',
   csrfHeader:'x'.repeat(32),expectedOrigin:'https://id.starry.test'};
 let calls=0;const backend=async()=>{calls++;return true};
 assert.equal(await authorizeCookieMutation(cfg,backend),true);
 for(const change of [
  {originHeader:'https://evil.test'},{fetchSiteHeader:'cross-site'},
  {csrfHeader:'client'}, {method:'GET'}, {expectedOrigin:'http://id.starry.test'},
 ])assert.equal(await authorizeCookieMutation({...cfg,...change},backend),false);
 assert.equal(calls,1);
 assert.equal(await authorizeCookieMutation(cfg,async()=>false),false);
});
