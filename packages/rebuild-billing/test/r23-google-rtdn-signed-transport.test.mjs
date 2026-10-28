import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createOfflineGoogleRtdnTransportCheck,
 R23_GOOGLE_RTDN_LIVE,R23_GOOGLE_RTDN_CONTRACT}
 from '../src/r23-google-rtdn-signed-transport.ts';

const keys=generateKeyPairSync('rsa',{modulusLength:2048,
 publicKeyEncoding:{type:'spki',format:'pem'},
 privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const foreign=generateKeyPairSync('rsa',{modulusLength:2048,
 publicKeyEncoding:{type:'spki',format:'pem'},
 privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const NOW=1793100000;
const scope={brand_id:'starry',environment:'staging',app_id:'starry.synthetic',
 package_name:'com.starry.synthetic',
 pubsub_subscription:'projects/test-proj/subscriptions/play-notification'};
const base={enabled:true,scope,audience:'https://staging.invalid/play/rtdn',
 service_account_email:'push@test-proj.iam.gserviceaccount.com',
 kid:'test-kid',offlinePublicKeyPem:keys.publicKey,nowSeconds:NOW};
const claims={iss:'https://accounts.google.com',
 aud:base.audience,email:base.service_account_email,
 email_verified:true,sub:'123456789012345678',iat:NOW-100,exp:NOW+1000};
const event={version:'1.0',packageName:scope.package_name,
 eventTimeMillis:String(NOW*1000),
 subscriptionNotification:{version:'1.0',notificationType:4,
 purchaseToken:'synthetic-test-receipt-only'}};
const wrap=(rt=event,subscription=scope.pubsub_subscription)=>JSON.stringify({
 subscription,message:{messageId:'1234567890123',
  data:Buffer.from(JSON.stringify(rt)).toString('base64')}
});
const token=(c=claims,h={alg:'RS256',kid:'test-kid',typ:'JWT'},
 secret=keys.privateKey)=>{
 const head=Buffer.from(JSON.stringify(h)).toString('base64url');
 const payload=Buffer.from(JSON.stringify(c)).toString('base64url');
 const signature=sign('RSA-SHA256',Buffer.from(head+'.'+payload),secret)
  .toString('base64url');
 return [head,payload,signature].join('.');
};
const req=(opts={})=>({authorization:'Bearer '+token(),
 pushJsonText:wrap(),...opts});
const make=(config={})=>createOfflineGoogleRtdnTransportCheck({...base,...config});
function deny(o){
 assert.equal(o.contract,R23_GOOGLE_RTDN_CONTRACT);
 assert.equal(o.google_jwks_live_verified,false);
 assert.equal(o.google_play_purchase_verified,false);
 assert.equal(o.member_binding_approved,false);
 assert.equal(o.durable_dedupe_committed,false);
 for(const k of ['store_entitlement_active','can_ack_pubsub','can_grant',
  'can_restore','can_remove_ads','may_publish','live'])
  assert.equal(o[k],false,k);
 const s=JSON.stringify(o);
 for(const raw of ['synthetic-test-receipt-only','push@test-proj',
  '1234567890123','PRIVATE_KEY'])assert.ok(!s.includes(raw));
}
test('default OFF: no live action',async()=>{
 const o=await make({enabled:false}).inspect(req());deny(o);
 assert.equal(R23_GOOGLE_RTDN_LIVE,false);assert.equal(o.state,'blocked');
});
test('real ephemeral RSA signature verification remains transport-only',async()=>{
 const o=await make().inspect(req());deny(o);
 assert.equal(o.state,'signature_checked_offline_only');
 assert.equal(o.local_signature_valid,true);
 assert.equal(o.notification_kind,'subscription');
});
test('forged RSA signature, cross-key, altered JWT fail',async()=>{
 const parts=token().split('.');
 const bad=[
  [...parts.slice(0,2),parts[2].slice(0,-4)+'AAAA'].join('.'),
  token(claims,undefined,foreign.privateKey),
  'garbage.payload.signature'
 ];
 for(const jwt of bad){
  const o=await make().inspect(req({authorization:'Bearer '+jwt}));
  deny(o);assert.equal(o.state,'blocked');
 }
});
test('alg confusion, unknown kid, forbidden external JWK URL denied',async()=>{
 const headers=[{alg:'none',kid:'test-kid'},
  {alg:'HS256',kid:'test-kid'},
  {alg:'RS256',kid:'other'},
  {alg:'RS256',kid:'test-kid',jku:'https://evil.invalid'}];
 for(const h of headers){
  const o=await make().inspect(req({authorization:'Bearer '+token(claims,h)}));
  deny(o);assert.equal(o.state,'blocked');
 }
});
test('signed issuer/email/audience/sub/verified-flag attacks fail',async()=>{
 for(const override of [
  {iss:'https://other.invalid'},
  {email:'stranger@test-proj.iam.gserviceaccount.com'},
  {email_verified:false},
  {aud:'https://staging.invalid/elsewhere'},
  {sub:'not-numeric'}
 ]){
  const o=await make().inspect(req({authorization:'Bearer '+token({...claims,...override})}));
  deny(o);assert.equal(o.state,'blocked');
  assert.equal(o.reason,'OIDC_CLAIMS_WRONG_OR_EXPIRED');
 }
});
test('expired, far future and impossible signed time claims fail',async()=>{
 for(const override of [{exp:NOW-1},{iat:NOW+120},
  {exp:NOW+7200},{iat:NOW-100,exp:NOW-1}]){
  const o=await make().inspect(req({authorization:'Bearer '+token({...claims,...override})}));
  deny(o);assert.equal(o.state,'blocked');
 }
});
test('wrong App/package and foreign subscription denied',async()=>{
 for(const [eventBody,subscription] of [
  [{...event,packageName:'com.starry.other'},scope.pubsub_subscription],
  [event,'projects/test-proj/subscriptions/foreign'],
 ]){
  const o=await make().inspect(req({pushJsonText:wrap(eventBody,subscription)}));
  deny(o);assert.equal(o.state,'blocked');
 }
});
test('malformed data and multiple RTDN kinds rejected',async()=>{
 for(const rt of [
  {...event,version:'2.0'},
  {...event,eventTimeMillis:'yesterday'},
  {...event,testNotification:{version:'1.0'}},
  {...event,subscriptionNotification:{...event.subscriptionNotification,purchaseToken:''}},
 ]){
  const o=await make().inspect(req({pushJsonText:wrap(rt)}));
  deny(o);assert.equal(o.state,'blocked');
 }
 for(const raw of ['not-json','{}',JSON.stringify({subscription:scope.pubsub_subscription,
   message:{data:'!!!',messageId:'abc'}})]){
  const o=await make().inspect(req({pushJsonText:raw}));
  deny(o);assert.equal(o.state,'blocked');
 }
});
test('refund, revoke, hold, expired RTDN do not grant or ACK',async()=>{
 for(const notificationType of [3,5,12,13,20]){
  const rt={...event,subscriptionNotification:{
   ...event.subscriptionNotification,notificationType}};
  const o=await make().inspect(req({pushJsonText:wrap(rt)}));deny(o);
  assert.equal(o.state,'signature_checked_offline_only');
  assert.equal(o.notification_kind,'subscription');
 }
});
test('one-time notification synthetic paid item never buys Battery',async()=>{
 const rt={...event,subscriptionNotification:undefined,
  oneTimeProductNotification:{version:'1.0',notificationType:1,
   purchaseToken:'synthetic-opaque',sku:'starry.battery.X'}};
 const bad=await make().inspect(req({pushJsonText:wrap(rt)}));deny(bad);
 assert.equal(bad.state,'blocked');
 const other={...rt,oneTimeProductNotification:{
  ...rt.oneTimeProductNotification,sku:'synthetic.product'}};
 const o=await make().inspect(req({pushJsonText:wrap(other)}));deny(o);
 assert.equal(o.notification_kind,'one_time');
});
test('voided purchases and official TEST notifications never authorize',async()=>{
 const rt={...event,subscriptionNotification:undefined,
  voidedPurchaseNotification:{purchaseToken:'synthetic-opaque',
   orderId:'fake-order',productType:1,refundType:1}};
 const v=await make().inspect(req({pushJsonText:wrap(rt)}));deny(v);
 assert.equal(v.notification_kind,'voided');
 const t=await make().inspect(req({pushJsonText:wrap({...event,
  subscriptionNotification:undefined,testNotification:{version:'1.0'}})}));
 deny(t);assert.equal(t.notification_kind,'test');
});
test('replay remains pending durable D1 dedupe and never ACKs',async()=>{
 const f=make(),input=req();
 const a=await f.inspect(input),b=await f.inspect(input);
 deny(a);deny(b);assert.deepEqual(a,b);
 assert.equal(a.can_ack_pubsub,false);
});
test('wrong brand/production/unsafe URL/key rejected at config',async()=>{
 for(const patch of [
  {scope:{...scope,brand_id:'hglobal'}},
  {scope:{...scope,environment:'production'}},
  {kid:''},
  {audience:'http://plain.invalid/rt'},
  {offlinePublicKeyPem:'bad'},
  {nowSeconds:0}
 ])assert.throws(()=>make(patch));
});
test('hostile accessor, missing bearer and invalid payload fail closed',async()=>{
 const evil=Object.defineProperty({},'authorization',{
  get(){throw Error('hostile');}
 });
 for(const input of [evil,null,[],{authorization:'abc',
  pushJsonText:wrap()},{authorization:'Bearer a.b.c',pushJsonText:'{}'}]){
  const o=await make().inspect(input);deny(o);
  assert.equal(o.state,'blocked');
 }
});
