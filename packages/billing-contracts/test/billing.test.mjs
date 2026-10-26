import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVerifiedEvent, assertRefundReviewAuthorized } from '../src/index.ts';

const scope={brandId:'starry',environment:'staging',storeEnvironment:'sandbox',appId:'starry.demo',store:'apple',
  storeAppId:'phd.starry.demo',userId:'s_test_user',accountBinding:'binding-1',
  evaluatedAt:'2026-10-26T08:00:00Z'};
const products=[{appId:scope.appId,store:scope.store,storeAppId:scope.storeAppId,
  productId:'test.monthly',kind:'subscription',entitlementKey:'demo.premium'}];
const event={verifiedBy:'apple-app-store-server-api',store:'apple',storeEnvironment:'sandbox',
  storeAppId:scope.storeAppId,appId:scope.appId,productId:'test.monthly',transactionId:'txn1',
  originalTransactionId:'original1',eventId:'event1',occurredAt:'2026-10-26T07:00:00Z',
  expiresAt:'2026-11-26T07:00:00Z',accountBinding:'binding-1',lifecycle:'PURCHASED'};
const initial=()=>applyVerifiedEvent(null,event,scope,products).projection;
const reject=(fn,re)=>assert.throws(fn,re);

test('verified sandbox purchase grants app-scoped entitlement',()=>{
  const r=applyVerifiedEvent(null,event,scope,products);
  assert.equal(r.applied,true);assert.equal(r.projection.entitlement,'active');
});
test('duplicate delivery is idempotent and unchanged',()=>{
  const p=initial();const r=applyVerifiedEvent(p,event,scope,products,true);
  assert.equal(r.reason,'duplicate');assert.strictEqual(r.projection,p);
});
test('new renewal wins over delayed old-period refund',()=>{
  const next=applyVerifiedEvent(initial(),{...event,eventId:'e2',transactionId:'txn2',
    occurredAt:'2026-10-27T07:00:00Z',expiresAt:'2026-12-27T07:00:00Z',lifecycle:'RENEWED'},scope,products);
  assert.equal(next.projection.entitlement,'active');
  const stale=applyVerifiedEvent(next.projection,{...event,eventId:'oldRefund',lifecycle:'REFUNDED'},scope,products);
  assert.equal(stale.reason,'stale');assert.strictEqual(stale.projection,next.projection);
});
test('verified refund revokes rights and is repeat-safe',()=>{
  const refund={...event,eventId:'r1',lifecycle:'REFUNDED',occurredAt:'2026-10-27T08:00:00Z'};
  const r=applyVerifiedEvent(initial(),refund,scope,products);
  assert.equal(r.projection.entitlement,'inactive');
  assert.equal(applyVerifiedEvent(r.projection,refund,scope,products,true).reason,'duplicate');
});
test('unknown grace, on-hold, expired and revoked state fail closed',()=>{
  for(const lifecycle of ['GRACE_PERIOD','ON_HOLD','EXPIRED','REVOKED']){
    const r=applyVerifiedEvent(initial(),{...event,lifecycle,eventId:lifecycle,
      occurredAt:'2026-10-27T08:00:00Z'},scope,products);
    assert.equal(r.projection.entitlement,'inactive');
  }
});
test('purchase with expired entitlement never activates',()=>{
  assert.equal(applyVerifiedEvent(null,{...event,expiresAt:'2026-10-20T00:00:00Z'},scope,products).projection.entitlement,'inactive');
});
test('cross-brand, production, store, app and package evidence rejected',()=>{
  reject(()=>applyVerifiedEvent(null,event,{...scope,brandId:'other'},products),/brand/);
  reject(()=>applyVerifiedEvent(null,event,{...scope,environment:'production'},products),/environment/);
  reject(()=>applyVerifiedEvent(null,{...event,storeEnvironment:'production'},scope,products),/environment/);
  reject(()=>applyVerifiedEvent(null,event,{...scope,storeEnvironment:'production'},products),/environment/);
  reject(()=>applyVerifiedEvent(null,{...event,store:'google'},scope,products),/store mismatch/);
  reject(()=>applyVerifiedEvent(null,{...event,appId:'other'},scope,products),/app mismatch/);
  reject(()=>applyVerifiedEvent(null,{...event,storeAppId:'foreign.bundle'},scope,products),/app mismatch/);
});
test('unverified marker, unknown SKU and free Battery SKU rejected',()=>{
  reject(()=>applyVerifiedEvent(null,{...event,verifiedBy:'client'},scope,products),/not provider verified/);
  reject(()=>applyVerifiedEvent(null,{...event,productId:'unknown'},scope,products),/unknown SKU/);
  reject(()=>applyVerifiedEvent(null,{...event,productId:'starry.battery'},scope,products),/Battery/);
});
test('cannot restore under another member or unbound account',()=>{
  reject(()=>applyVerifiedEvent(null,{...event,accountBinding:'foreign'},scope,products),/unbound/);
  reject(()=>applyVerifiedEvent(initial(),{...event,eventId:'e2',occurredAt:'2026-10-27T00:00:00Z'},
    {...scope,userId:'other-user'},products),/ownership/);
  reject(()=>applyVerifiedEvent(initial(),{...event,eventId:'e2',originalTransactionId:'foreign-original',
    occurredAt:'2026-10-27T00:00:00Z'},scope,products),/ownership/);
});
test('missing verified expiry and malformed timestamp rejected',()=>{
  reject(()=>applyVerifiedEvent(null,{...event,expiresAt:null},scope,products),/expiration/);
  reject(()=>applyVerifiedEvent(null,{...event,occurredAt:'nonsense'},scope,products),/timestamp/);
});
test('Google evidence accepted only with matching registered package',()=>{
  const s={...scope,store:'google',storeAppId:'phd.starry.android'};
  const e={...event,store:'google',storeAppId:s.storeAppId,verifiedBy:'google-play-developer-api'};
  assert.equal(applyVerifiedEvent(null,e,s,[{...products[0],store:'google',storeAppId:s.storeAppId}]).projection.entitlement,'active');
});
test('refund review needs Starry scope, app, reason, approval and recent step-up',()=>{
  const p={brandId:'starry',environment:'staging',storeEnvironment:'sandbox',appIds:['starry.demo'],
    scopes:['billing:refund:review'],stepUpAt:'2026-10-26T07:59:00Z'};
  const t={brandId:'starry',environment:'sandbox',appId:'starry.demo',reason:'case checked',approvalId:'review-1'};
  assert.doesNotThrow(()=>assertRefundReviewAuthorized(p,t,'2026-10-26T08:00:00Z'));
  reject(()=>assertRefundReviewAuthorized({...p,scopes:[]},t,'2026-10-26T08:00:00Z'),/scope/);
  reject(()=>assertRefundReviewAuthorized(p,{...t,brandId:'other'},'2026-10-26T08:00:00Z'),/brand/);
  reject(()=>assertRefundReviewAuthorized(p,{...t,appId:'other'},'2026-10-26T08:00:00Z'),/app scope/);
  reject(()=>assertRefundReviewAuthorized(p,{...t,reason:''},'2026-10-26T08:00:00Z'),/reason/);
  reject(()=>assertRefundReviewAuthorized(p,{...t,approvalId:''},'2026-10-26T08:00:00Z'),/approval/);
  reject(()=>assertRefundReviewAuthorized({...p,stepUpAt:null},t,'2026-10-26T08:00:00Z'),/step-up/);
  reject(()=>assertRefundReviewAuthorized(p,t,'2026-10-26T09:00:00Z'),/expired/);
  reject(()=>assertRefundReviewAuthorized({...p,environment:'production'},t,'2026-10-26T08:00:00Z'),/environment/);
});
