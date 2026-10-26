import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineStarryD1AuthAuthority} from '../src/round6-auth-d1-authority.ts';
import {createOfflineStarryOidcCallbackGate} from '../src/round5-oidc-gate.ts';
import {createTrustedProviderJwksCache} from '../src/jwks-cache.ts';
import {bytesToBase64url} from '../src/oidc-crypto.ts';

const now=1793000000,scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const state='A'.repeat(40),verifier='v'.repeat(43),nonce='opaque-nonce-roundsix-server-12345';
async function hashed(){
 const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
 return bytesToBase64url(new Uint8Array(h));
}
function fakeDb(challenge,options={}){
 const calls=[];
 const db={prepare(sql){
  const b={bind(...args){
   calls.push({sql,args});
   return {first:async()=>{
     if(sql.includes('FROM starry_oauth_attempts'))return {
      state,provider:'apple',app_id:'starry-id',environment:'staging',
      client_id:'phd.starry.id',code_challenge:challenge,nonce,expires_at:now+60,
      consumed_at:null,
     };
     if(sql.includes('FROM starry_identities i'))return options.member??{
      s_user_id:'s1',status:'active',auth_version:2,
     };
     if(sql.includes('SELECT 1 AS allowed'))return options.activeSession===false?null:{allowed:1};
     throw Error('Unexpected SQL '+sql);
    },run:async()=>({success:true,meta:{changes:options.casChanges??1}})};
  }};
  return b;
 }};
 return {db,calls};
}
test('off-by-default D1 authority does NOT read secret or D1',async()=>{
 const f=fakeDb(await hashed());let reads=0;
 const a=createOfflineStarryD1AuthAuthority({db:f.db,scope,provider:'apple',clientId:'phd.starry.id',
  verifierStore:{readOnceCandidate:async()=>{reads++;return verifier;}}});
 assert.equal(await a.readAttempt(state),null);
 assert.equal(await a.consumeAttemptCAS({state,provider:'apple',clientId:'phd.starry.id',
   appId:'starry-id',environment:'staging',now}),false);
 assert.equal(await a.readLinkedExistingMember('apple','subject'),null);
 assert.equal(await a.isCurrentSession({provider:'apple',subject:'subject',s_user_id:'s1',
   session_id:'sid',auth_version:2,now}),false);
 assert.equal(reads,0);assert.equal(f.calls.length,0);
});
test('active linked member and scoped current Session require immutable subject, app, env and version',async()=>{
 const f=fakeDb(await hashed());
 const a=createOfflineStarryD1AuthAuthority({enabled:true,db:f.db,scope,
  provider:'apple',clientId:'phd.starry.id',verifierStore:{readOnceCandidate:async()=>verifier}});
 assert.equal((await a.readLinkedExistingMember('apple','subject')).s_user_id,'s1');
 assert.equal(await a.readLinkedExistingMember('google','subject'),null);
 assert.equal(await a.readLinkedExistingMember('apple','x@domain.test'),null);
 const allowed=await a.isCurrentSession({provider:'apple',subject:'subject',s_user_id:'s1',
   session_id:'sid',auth_version:2,now});
 assert.equal(allowed,true);
 assert.equal(f.calls.filter(x=>x.sql.includes('SELECT 1 AS allowed')).length,1);
 const query=f.calls.at(-1);
 for(const must of ["s.app_id=?", "s.environment=?", "s.revoked_at IS NULL",
  "m.status='active'","m.auth_version=s.auth_version","i.provider=?","i.subject=?"])
  assert.ok(query.sql.includes(must),must);
 assert.deepEqual(query.args,['sid','s1','starry-id','staging',2,now,'apple','subject']);
 assert.equal(await a.isCurrentSession({provider:'google',subject:'subject',s_user_id:'s1',
   session_id:'sid',auth_version:2,now}),false);
 assert.equal(await a.isCurrentSession({provider:'apple',subject:'subject',s_user_id:'s1',
   session_id:'sid',auth_version:0,now}),false);
});
test('callback-scoped state reads backend PKCE verifier and CAS consumes only pinned provider/client/app',async()=>{
 const f=fakeDb(await hashed());
 const a=createOfflineStarryD1AuthAuthority({enabled:true,db:f.db,scope,
  provider:'apple',clientId:'phd.starry.id',verifierStore:{readOnceCandidate:async()=>verifier}});
 const tx=await a.readAttempt(state);
 assert.equal(tx.code_verifier,verifier);
 assert.equal(tx.code_challenge,await hashed());
 assert.equal(await a.consumeAttemptCAS({state,provider:'google',clientId:'phd.starry.id',
   appId:'starry-id',environment:'staging',now}),false);
 assert.equal(await a.consumeAttemptCAS({state,provider:'apple',clientId:'phd.starry.id',
   appId:'starry-id',environment:'production',now}),false);
 assert.equal(await a.consumeAttemptCAS({state,provider:'apple',clientId:'phd.starry.id',
   appId:'starry-id',environment:'staging',now}),true);
 assert.ok(f.calls.some(x=>x.sql.includes('consumed_at IS NULL AND expires_at>?')));
 const denied=createOfflineStarryD1AuthAuthority({enabled:true,db:fakeDb(await hashed(),{casChanges:0}).db,scope,
   provider:'apple',clientId:'phd.starry.id',verifierStore:{readOnceCandidate:async()=>verifier}});
 assert.equal(await denied.consumeAttemptCAS({state,provider:'apple',clientId:'phd.starry.id',
   appId:'starry-id',environment:'staging',now}),false);
});
test('cross-brand, production and malformed scope denied before DB use',async()=>{
 const f=fakeDb(await hashed());
 for(const s of [{...scope,brand_id:'hglobal'},{...scope,environment:'production'},{...scope,app_id:'x/other'}])
  assert.throws(()=>createOfflineStarryD1AuthAuthority({enabled:true,db:f.db,scope:s,
   provider:'apple',clientId:'phd.starry.id',verifierStore:{readOnceCandidate:async()=>verifier}}),
  /D1_AUTH_SCOPE_DENIED/);
 assert.equal(f.calls.length,0);
});
test('end-to-end D1 boundary → WebCrypto RSA callback → existing-member result, with fake trusted server ports ONLY',async()=>{
 const f=fakeDb(await hashed());let consumed=false;
 const kp=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const pub={...await crypto.subtle.exportKey('jwk',kp.publicKey),kid:'key-r6',alg:'RS256',use:'sig'};
 const jwks=createTrustedProviderJwksCache([{provider:'apple',issuer:'https://appleid.apple.com',
  clientId:'phd.starry.id'}],async()=>({status:200,body:{keys:[pub]},maxAgeSeconds:60}));
 const a=createOfflineStarryD1AuthAuthority({enabled:true,db:f.db,scope,
  provider:'apple',clientId:'phd.starry.id',verifierStore:{readOnceCandidate:async()=>verifier}});
 const core=createOfflineStarryOidcCallbackGate({enabled:true,scope,provider:'apple',
  clientId:'phd.starry.id',jwks,
  readAttempt:a.readAttempt,
  consumeAttemptCAS:async x=>{if(consumed)return false;consumed=true;return a.consumeAttemptCAS(x);},
  readLinkedExistingMember:a.readLinkedExistingMember,
  exchangeCode:async()=>{
   const h=bytesToBase64url(new TextEncoder().encode(JSON.stringify({alg:'RS256',kid:'key-r6'})));
   const p=bytesToBase64url(new TextEncoder().encode(JSON.stringify({
    iss:'https://appleid.apple.com',aud:'phd.starry.id',
    sub:'verified-sub',nonce,iat:now-2,exp:now+60,
   })));
   const data=h+'.'+p;
   const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',kp.privateKey,new TextEncoder().encode(data));
   return {idToken:data+'.'+bytesToBase64url(new Uint8Array(sig))};
  },
 });
 const v=await core.handle({state,code:'offline-auth-code'},now);
 assert.equal(v.s_user_id,'s1');assert.equal(v.brand_id,'starry');
 assert.equal(await core.handle({state,code:'offline-auth-code'},now),null); // replay
 const blockedDb=createOfflineStarryD1AuthAuthority({enabled:true,db:fakeDb(await hashed(),{
  member:{s_user_id:'s1',status:'suspended',auth_version:3}}).db,scope,
  provider:'apple',clientId:'phd.starry.id',verifierStore:{readOnceCandidate:async()=>verifier}});
 assert.equal(await blockedDb.readLinkedExistingMember('apple','verified-sub'),null);
});
