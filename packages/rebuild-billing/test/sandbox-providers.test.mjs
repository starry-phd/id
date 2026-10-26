import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyAppleSandboxSignedTransaction,verifyAppleSandboxNotificationV2,
  createAppleSandboxStorePort,verifyGoogleSandboxRtdn,createGoogleSandboxRtdnStorePort,
} from '../src/sandbox-providers.ts';
import {planSandboxPurchase} from '../src/index.ts';
import {createServerIdentityResolver} from '../../../modules/starry-id-v1/src/index.ts';
import {webcrypto} from 'node:crypto';

const now='2026-10-26T09:00:00.000Z';
const nowMs=Date.parse(now),nowSeconds=Math.floor(nowMs/1000);
const registry={brandId:'starry',appId:'starry.test',environment:'staging',storeEnvironment:'sandbox',
  store:'apple',storeAppId:'phd.starry.test',catalog:{'test.monthly':'subscription'}};
const googleRegistry={...registry,store:'google',storeAppId:'phd.starry.google'};
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
async function sign(header,payload,key,algo){
  const signing=enc(header)+'.'+enc(payload);
  const sig=await webcrypto.subtle.sign(algo,key,new TextEncoder().encode(signing));
  return signing+'.'+Buffer.from(sig).toString('base64url');
}
async function appleFixtures(){
  const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const header={alg:'ES256',x5c:['fixture-leaf','fixture-CA','fixture-root']};
  const trust={trustedAppleLeafKey:async()=>keys.publicKey};
  const tx={environment:'Sandbox',bundleId:registry.storeAppId,productId:'test.monthly',
    originalTransactionId:'orig_123',transactionId:'tx_123',appAccountToken:'binding_001',
    signedDate:nowMs,purchaseDate:nowMs-3600000,expiresDate:nowMs+2500000000};
  const signedTx=await sign(header,tx,keys.privateKey,{name:'ECDSA',hash:'SHA-256'});
  const wrap=async(type,changes={})=>{
    const signedTransactionInfo=await sign(header,{...tx,...(changes.tx??{})},keys.privateKey,
      {name:'ECDSA',hash:'SHA-256'});
    const renewal=await sign(header,{environment:'Sandbox',originalTransactionId:tx.originalTransactionId,
      autoRenewProductId:tx.productId,...changes.renewal},keys.privateKey,{name:'ECDSA',hash:'SHA-256'});
    const event={notificationType:type,notificationUUID:'notification-1',signedDate:nowMs,
      data:{environment:'Sandbox',bundleId:registry.storeAppId,signedTransactionInfo,signedRenewalInfo:renewal,...changes.data}};
    return {signedPayload:await sign(header,event,keys.privateKey,{name:'ECDSA',hash:'SHA-256'})};
  };
  return {keys,header,trust,tx,signedTx,wrap};
}
async function googleFixtures(){
  const keys=await webcrypto.subtle.generateKey({
    name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const h={alg:'RS256',kid:'fixture-key'};
  const claims={iss:'https://accounts.google.com',aud:'https://server.example.test/rtdn',
    email:'pubsub-push@fixture.iam.gserviceaccount.com',email_verified:true,iat:nowSeconds-30,exp:nowSeconds+300};
  const response={packageName:googleRegistry.storeAppId,testPurchase:{},
    subscriptionState:'SUBSCRIPTION_STATE_ACTIVE',startTime:'2026-10-26T08:00:00Z',
    lineItems:[{productId:'test.monthly',expiryTime:'2026-11-26T08:00:00Z'}],
    externalAccountIdentifiers:{obfuscatedExternalAccountId:'binding_001'},latestOrderId:'order_123'};
  const rtdn={version:'1.0',packageName:googleRegistry.storeAppId,eventTimeMillis:String(nowMs),
    subscriptionNotification:{version:'1.0',subscriptionId:'test.monthly',purchaseToken:'RAW_SENSITIVE_TOKEN',notificationType:2}};
  const delivery=async(mod={})=>{
    const claimsChanged={...claims,...mod.claims};
    const headerChanged={...h,...mod.header};
    const jwt=await sign(headerChanged,claimsChanged,keys.privateKey,{name:'RSASSA-PKCS1-v1_5'});
    const message=mod.payload??{...rtdn};
    const body={subscription:'projects/fixture/subscriptions/starry',
      message:{messageId:'message-001',publishTime:now,data:Buffer.from(JSON.stringify(message)).toString('base64')}};
    return {authorization:'Bearer '+jwt,body:{...body,...mod.body}};
  };
  const calls={n:0,token:null};
  const trust={
    expectedAudience:claims.aud,expectedServiceAccount:claims.email,
    expectedSubscription:'projects/fixture/subscriptions/starry',
    resolveGoogleOidcKey:async kid=>{assert.equal(kid,'fixture-key');return keys.publicKey},
    querySubscriptionV2:async(pack,token)=>{calls.n++;calls.token=token;assert.equal(pack,googleRegistry.storeAppId);return response},
    opaquePurchaseTokenRef:async()=> 'opaque_purchase_123',
  };
  return {keys,h,claims,response,rtdn,delivery,trust,calls};
}

test('Apple ES256 signed transaction verified with server-only fixture anchor',async()=>{
  const f=await appleFixtures();
  const s=await verifyAppleSandboxSignedTransaction(f.signedTx,registry,f.trust);
  assert.equal(s.state,'PAID');assert.equal(s.sku,'test.monthly');
  assert.equal(s.storeEnvironment,'sandbox');assert.equal(s.accountBinding,'binding_001');
  assert.equal(s.transactionId,'tx_123');
});
test('Apple V2 verifies both signed outer notification, nested transaction and renewal',async()=>{
  const f=await appleFixtures();
  for(const [kind,expected] of [['DID_RENEW','RENEWED'],['REFUND','REFUNDED'],['EXPIRED','EXPIRED']]){
    const s=await verifyAppleSandboxNotificationV2(await f.wrap(kind),registry,f.trust);
    assert.equal(s.state,expected);assert.equal(s.providerEventId,'apple_n_notification-1');
  }
});
test('Apple rejects unsigned, altered and invalid JWS; no fallback',async()=>{
  const f=await appleFixtures();
  await assert.rejects(verifyAppleSandboxSignedTransaction('abc.def.ghi',registry,f.trust));
  const parts=f.signedTx.split('.');
  const modified={...f.tx,appAccountToken:'attacker'};
  await assert.rejects(verifyAppleSandboxSignedTransaction(parts[0]+'.'+enc(modified)+'.'+parts[2],registry,f.trust),/JWS_SIGNATURE_DENIED/);
  await assert.rejects(verifyAppleSandboxSignedTransaction(await sign({alg:'none'},f.tx,f.keys.privateKey,{name:'ECDSA',hash:'SHA-256'}),registry,f.trust),/JWS_HEADER_DENIED/);
  await assert.rejects(verifyAppleSandboxSignedTransaction(await sign({alg:'ES256',jku:'https://evil.com',x5c:['a','b']},f.tx,f.keys.privateKey,{name:'ECDSA',hash:'SHA-256'}),registry,f.trust),/JWS_HEADER_DENIED/);
});
test('Apple rejects wrong package, store Production, unapproved SKU and account binding',async()=>{
  const f=await appleFixtures();
  for(const changed of [{environment:'Production'},{bundleId:'fake.bundle'},{productId:'battery_paid'},{appAccountToken:'bad binding'}]){
    const jwt=await sign(f.header,{...f.tx,...changed},f.keys.privateKey,{name:'ECDSA',hash:'SHA-256'});
    await assert.rejects(verifyAppleSandboxSignedTransaction(jwt,registry,f.trust));
  }
  await assert.rejects(verifyAppleSandboxSignedTransaction(f.signedTx,{...registry,storeEnvironment:'production'},f.trust),/STORE_SANDBOX_ONLY/);
});
test('Apple V2 rejects invalid nested signed payload, signed renewal and unapproved event type',async()=>{
  const f=await appleFixtures();
  await assert.rejects(verifyAppleSandboxNotificationV2(await f.wrap('CONSUMPTION_REQUEST'),registry,f.trust),/APPLE_NOTIFICATION_DENIED/);
  await assert.rejects(verifyAppleSandboxNotificationV2(await f.wrap('DID_RENEW',{tx:{bundleId:'alien'}}),registry,f.trust),/APPLE_SCOPE_DENIED/);
  await assert.rejects(verifyAppleSandboxNotificationV2(await f.wrap('DID_RENEW',{renewal:{originalTransactionId:'alien'}}),registry,f.trust),/APPLE_RENEWAL_DENIED/);
});
test('Apple signed revocation can never issue paid entitlement',async()=>{
  const f=await appleFixtures();const jws=await sign(f.header,{...f.tx,revocationDate:nowMs},f.keys.privateKey,{name:'ECDSA',hash:'SHA-256'});
  assert.equal((await verifyAppleSandboxSignedTransaction(jws,registry,f.trust)).state,'REVOKED');
});
test('Google RTDN: cryptographically verifies signed Google-style push JWT then re-queries backend Play API',async()=>{
  const f=await googleFixtures();
  const s=await verifyGoogleSandboxRtdn(await f.delivery(),googleRegistry,f.trust,nowSeconds);
  assert.equal(s.state,'PAID');assert.equal(s.kind,'subscription');assert.equal(f.calls.n,1);
  assert.equal(s.originalTransactionId,'opaque_purchase_123');
  assert.equal(s.accountBinding,'binding_001');
  assert.equal(JSON.stringify(s).includes(f.calls.token),false);
});
test('Google JWT wrong issuer/audience/service identity/expiry rejects before Play API call',async()=>{
  const cases=[{iss:'https://attacker.test'},{aud:'https://attacker.test'},{email:'attacker@fake.test'},
    {email_verified:false},{exp:nowSeconds-1},{iat:nowSeconds+120}];
  for(const claims of cases) {
    const f=await googleFixtures();
    await assert.rejects(verifyGoogleSandboxRtdn(await f.delivery({claims}),googleRegistry,f.trust,nowSeconds),/GOOGLE_OIDC_DENIED/);
    assert.equal(f.calls.n,0);
  }
});
test('Google forged JWT/signature and missing push Bearer token reject',async()=>{
  const f=await googleFixtures();
  const original=await f.delivery();
  await assert.rejects(verifyGoogleSandboxRtdn({...original,authorization:'Bearer invalid'},googleRegistry,f.trust,nowSeconds));
  await assert.rejects(verifyGoogleSandboxRtdn({...original,authorization:''},googleRegistry,f.trust,nowSeconds),/GOOGLE_OIDC_REQUIRED/);
  const jwt=original.authorization.slice(7),parts=jwt.split('.');
  await assert.rejects(verifyGoogleSandboxRtdn({...original,authorization:'Bearer '+parts[0]+'.'+enc({...f.claims,aud:'evil'})+'.'+parts[2]},googleRegistry,f.trust,nowSeconds),/JWS_SIGNATURE_DENIED/);
});
test('Google RTDN package/notification source/expired store/production/mismatched SKU denied',async()=>{
  const wrong=[{packageName:'fake.package'},{subscriptionNotification:{subscriptionId:'battery.paid',purchaseToken:'a',notificationType:2}},{oneTimeProductNotification:{}}],
    f=await googleFixtures();
  for(const payload of wrong)
    await assert.rejects(verifyGoogleSandboxRtdn(await f.delivery({payload:{...f.rtdn,...payload}}),googleRegistry,f.trust,nowSeconds));
  await assert.rejects(verifyGoogleSandboxRtdn(await f.delivery({body:{subscription:'bad/subscription'}}),googleRegistry,f.trust,nowSeconds),/GOOGLE_PUBSUB_SCOPE_DENIED/);
  await assert.rejects(verifyGoogleSandboxRtdn(await f.delivery(),{...googleRegistry,environment:'production'},f.trust,nowSeconds),/STORE_SANDBOX_ONLY/);
  const bad={...f.trust,querySubscriptionV2:async()=>({...f.response,testPurchase:undefined})};
  await assert.rejects(verifyGoogleSandboxRtdn(await f.delivery(),googleRegistry,bad,nowSeconds),/GOOGLE_SANDBOX_ONLY/);
});
test('Google verified current Play state governs rights; RTDN type cannot override',async()=>{
  const f=await googleFixtures();
  for(const [providerState,expected] of [
    ['SUBSCRIPTION_STATE_IN_GRACE_PERIOD','GRACE_PERIOD'],['SUBSCRIPTION_STATE_ON_HOLD','ON_HOLD'],
    ['SUBSCRIPTION_STATE_EXPIRED','EXPIRED']]){
    const t={...f.trust,querySubscriptionV2:async()=>({...f.response,subscriptionState:providerState})};
    const s=await verifyGoogleSandboxRtdn(await f.delivery(),googleRegistry,t,nowSeconds);
    assert.equal(s.state,expected);
  }
});
test('Google must not store raw purchase token as permanent owner key',async()=>{
  const f=await googleFixtures();
  const t={...f.trust,opaquePurchaseTokenRef:async token=>token};
  await assert.rejects(verifyGoogleSandboxRtdn(await f.delivery(),googleRegistry,t,nowSeconds),/GOOGLE_OPAQUE_REF_DENIED/);
});
test('Async Apple verified snapshot integrates with AI-1 WeakSet Billing plan without HTTP identity/paid claim',async()=>{
  const f=await appleFixtures();
  const resolver=createServerIdentityResolver({
    trusted_scope:{brand_id:'starry',app_id:'starry.test',environment:'staging'},
    verify_oidc_or_session:async()=>({brand_id:'starry',app_id:'starry.test',environment:'staging',
      provider:'apple',provider_subject:'stable-sub',s_user_id:'s_001',session_id:'ses_001',
      auth_version:1,expires_at:nowSeconds+3600}),
    read_member:async()=>({s_user_id:'s_001',status:'active',auth_version:1,profile_revision:1,display_name:null,
      directory_opt_in:false,display_name_public:false}),
    read_session:async()=>({s_user_id:'s_001',session_id:'ses_001',app_id:'starry.test',environment:'staging',
      auth_version:1,revoked_at:null,expires_at:nowSeconds+3600,step_up_method:null,
      step_up_verified_at:null,step_up_expires_at:null}),
    identity_matches:async()=>true,
  });
  const p=await resolver({serverAuth:'synthetic'},nowSeconds);
  const ports={
    registry,
    auth:{
      resolveTrustedPrincipal:async()=>p,
      accountBindingFor:async()=> 'binding_001',
      opaqueActorRefFor:async()=> 'a_opaque_001',
    },
    store:createAppleSandboxStorePort(registry,f.trust),
    ledger:{
      ownerForOriginalTransaction:()=>null,
      latestEntitlement:()=>null,
      existingEvent:()=>null,
    },
  };
  const plan=await planSandboxPurchase({store:'apple',evidence:f.signedTx},ports,now);
  assert.equal(plan.disposition,'new');assert.equal(plan.entitlement.right,'active');
  assert.equal(plan.owner.userId,'s_001');assert.equal(plan.p05.actor_ref,'a_opaque_001');
  await assert.rejects(planSandboxPurchase({store:'apple',evidence:f.signedTx,paid:true},ports,now),/CLIENT_CLAIMS_DENIED/);
});
test('Async Google authenticated push + Play API current state integrates with Billing plan',async()=>{
  const f=await googleFixtures();
  const d=await f.delivery();const store=createGoogleSandboxRtdnStorePort(googleRegistry,f.trust,d,nowSeconds);
  const principal=await createServerIdentityResolver({
    trusted_scope:{brand_id:'starry',app_id:'starry.test',environment:'staging'},
    verify_oidc_or_session:async()=>({brand_id:'starry',app_id:'starry.test',environment:'staging',provider:'google',
      provider_subject:'stable-sub',s_user_id:'s_001',session_id:'ses_001',auth_version:1,expires_at:nowSeconds+3600}),
    read_member:async()=>({s_user_id:'s_001',status:'active',auth_version:1,profile_revision:1,
      display_name:null,directory_opt_in:false,display_name_public:false}),
    read_session:async()=>({s_user_id:'s_001',session_id:'ses_001',app_id:'starry.test',environment:'staging',
      auth_version:1,revoked_at:null,expires_at:nowSeconds+3600,step_up_method:null,
      step_up_verified_at:null,step_up_expires_at:null}),
    identity_matches:async()=>true,
  })({serverAuth:'synthetic'},nowSeconds);
  const ports={registry:googleRegistry,store,auth:{
    resolveTrustedPrincipal:async()=>principal,accountBindingFor:async()=> 'binding_001',
    opaqueActorRefFor:async()=> 'a_opaque_001'},
    ledger:{ownerForOriginalTransaction:()=>null,latestEntitlement:()=>null,existingEvent:()=>null},
  };
  const plan=await planSandboxPurchase({store:'google',evidence:'backend-rtdn'},ports,now);
  assert.equal(plan.entitlement.right,'active');
  await assert.rejects(planSandboxPurchase({store:'google',evidence:'RAW_SENSITIVE_TOKEN'},ports,now),/GOOGLE_RTDN_ROUTE_DENIED/);
});
