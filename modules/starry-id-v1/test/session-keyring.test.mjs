import test from 'node:test';
import assert from 'node:assert/strict';
import {createStarryServerSessionKeyring} from '../src/session-keyring.ts';
import {createVerifiedSignedSession} from '../src/session-crypto.ts';
const now=1793000000,scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
const claims={brand_id:'starry',app_id:'starry-id',environment:'staging',provider:'apple',
 provider_subject:'provider-sub',s_user_id:'s1',session_id:'sess-1',auth_version:1,
 key_id:'old',issued_at:now,expires_at:now+120};
async function keys(){
 return Promise.all([0,1].map(()=>crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify'])));
}
test('active key signs, previous key verifies until approved grace; expired kid denied',async()=>{
 const [oldKey,newKey]=await keys();let clock=now;
 const old=createStarryServerSessionKeyring(scope,[{
  kid:'old',key:oldKey,notBefore:now-10,signUntil:now+10,verifyUntil:now+130,
 }],'old',()=>clock);
 const token=await old.issue(claims);
 const rotated=createStarryServerSessionKeyring(scope,[
  {kid:'old',key:oldKey,notBefore:now-10,signUntil:now+10,verifyUntil:now+130},
  {kid:'new',key:newKey,notBefore:now+10,signUntil:now+500,verifyUntil:now+600},
 ],'new',()=>clock);
 const verified=createVerifiedSignedSession({scope,getKey:kid=>rotated.verifyKey(kid)});
 clock=now+20;
 assert.equal((await verified(token,clock)).s_user_id,'s1');
 await assert.rejects(old.issue({...claims,issued_at:clock}),/KEYRING_SIGN_DENIED/);
 clock=now+131;
 assert.equal(await rotated.verifyKey('old'),null);
 assert.equal(await verified(token,clock),null);
});
test('new key signs only after activation and never accepts forged foreign scope',async()=>{
 const [key]=await keys();let clock=now;
 const ring=createStarryServerSessionKeyring(scope,[{
  kid:'new',key,notBefore:now+10,signUntil:now+100,verifyUntil:now+120
 }],'new',()=>clock);
 await assert.rejects(ring.issue({...claims,key_id:'new'}),/KEYRING_SIGN_DENIED/);
 clock=now+20;
 const token=await ring.issue({...claims,key_id:'new',issued_at:clock,expires_at:now+100});
 const verify=createVerifiedSignedSession({scope,getKey:kid=>ring.verifyKey(kid)});
 assert.ok(await verify(token,clock));
 const other=createVerifiedSignedSession({scope:{...scope,app_id:'foreign'},getKey:kid=>ring.verifyKey(kid)});
 assert.equal(await other(token,clock),null);
});
test('reject HGlobal, production, duplicate key periods and extractable key',async()=>{
 const [key]=await keys();
 const p={kid:'k',key,notBefore:now-10,signUntil:now+50,verifyUntil:now+120};
 assert.throws(()=>createStarryServerSessionKeyring({...scope,brand_id:'hglobal'},[p],'k',()=>now),/KEYRING_SCOPE_DENIED/);
 assert.throws(()=>createStarryServerSessionKeyring({...scope,environment:'production'},[p],'k',()=>now),/KEYRING_SCOPE_DENIED/);
 assert.throws(()=>createStarryServerSessionKeyring(scope,[p,p],'k',()=>now),/KEYRING_POLICY_DENIED/);
 const extractable=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},true,['sign','verify']);
 assert.throws(()=>createStarryServerSessionKeyring(scope,[{...p,key:extractable}],'k',()=>now),/KEYRING_POLICY_DENIED/);
});
