import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createM1OAuthVerifierCustody,M1_PKCE_SEALED_FORMAT} from '../src/m1-oauth-verifier-custody.ts';
const bind={state:'a'.repeat(43),provider:'google',clientId:'test-client.apps.googleusercontent.com',appId:'starry-id',environment:'staging',expiresAt:1793000180};
const verifier='v'.repeat(43);
async function fixture(){
 const key=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 let known=true;
 const port=createM1OAuthVerifierCustody({activeKey:async()=>({kid:'key-1',key}),findKey:async kid=>known&&kid==='key-1'?key:null});
 return {port,key,retire(){known=false}};
}
test('AES-256-GCM versioned, nonextractable PKCE custody roundtrips without plaintext persistence',async()=>{
 const f=await fixture(),a=await f.port.seal(verifier,bind),b=await f.port.seal(verifier,bind);
 assert.ok(a.startsWith(M1_PKCE_SEALED_FORMAT+'.key-1.'));
 assert.notEqual(a,b);assert.equal(a.includes(verifier),false);
 assert.equal(await f.port.open(a,bind),verifier);
 assert.equal(await f.port.open(b,bind),verifier);
 assert.equal(await webcrypto.subtle.exportKey('raw',f.key).then(()=>true,()=>false),false);
});
test('ciphertext tamper and cross-state/provider/client/app/env/expiry binding always deny',async()=>{
 const f=await fixture(),cipher=await f.port.seal(verifier,bind);
 for(const changes of [{state:'z'.repeat(43)},{provider:'apple'},{clientId:'different'},
  {appId:'another'},{environment:'development'},{expiresAt:bind.expiresAt+1}]){
  assert.equal(await f.port.open(cipher,{...bind,...changes}),null);
 }
 const parts=cipher.split('.');parts[3]=(parts[3].startsWith('A')?'B':'A')+parts[3].slice(1);
 assert.equal(await f.port.open(parts.join('.'),bind),null);
});
test('unknown/retired key-id, malformed cipher and plaintext deny',async()=>{
 const f=await fixture(),cipher=await f.port.seal(verifier,bind);
 assert.equal(await f.port.open(verifier,bind),null);
 assert.equal(await f.port.open('m1gcm1.fake.AAA.AAA',bind),null);
 f.retire();assert.equal(await f.port.open(cipher,bind),null);
});
test('extractable or wrong algorithm key refused and no stored value returned',async()=>{
 const unsafe=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
 const port=createM1OAuthVerifierCustody({activeKey:async()=>({kid:'bad',key:unsafe}),findKey:async()=>unsafe});
 assert.equal(await port.seal(verifier,bind),null);
 const f=await fixture(),cipher=await f.port.seal(verifier,bind);
 assert.equal(await port.open(cipher,bind),null);
});
test('invalid verifier/short IV/KMS failures fail closed and reveal no material',async()=>{
 const f=await fixture();assert.equal(await f.port.seal('short',bind),null);
 const port=createM1OAuthVerifierCustody({activeKey:async()=>{throw Error('KMS_SECRET');},findKey:async()=>null});
 assert.equal(await port.seal(verifier,bind),null);
 const badIv=createM1OAuthVerifierCustody({activeKey:async()=>({kid:'key-1',key:f.key}),findKey:async()=>f.key,randomBytes:()=>new Uint8Array(11)});
 assert.equal(await badIv.seal(verifier,bind),null);
});
