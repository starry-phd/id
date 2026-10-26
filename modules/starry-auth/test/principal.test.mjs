import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STARRY_PRINCIPAL_CONTRACT_VERSION, createTrustedPrincipalResolver,
  isTrustedStarryPrincipal, billingIdentityAdapter, billingRefundReviewAdapter, auditReadActorAdapter,
} from '../src/principal.ts';

// All cryptographic verification here is deliberately a MOCK. No real login is claimed.
const now = 1780000000;
const scope = {brand_id: 'starry', app_id: 'starry-id', environment: 'staging'};
const verified = {brand_id: 'starry', app_id: 'starry-id', environment: 'staging',
  s_user_id: 'u1', session_id: 'sess1', auth_version: 7, expires_at: now + 800};
const member = {s_user_id: 'u1', status: 'active', auth_version: 7};
const session = {s_user_id: 'u1', session_id: 'sess1', app_id: 'starry-id', environment: 'staging',
  auth_version: 7, expires_at: now + 800, revoked_at: null,
  step_up_at: now - 80, step_up_until: now + 220};
const grant = (permission, resource, action) => ({
  s_user_id: 'u1', brand_id: 'starry', app_id: 'starry-id', environment: 'staging',
  permission, resource, action, expires_at: now + 500, revoked_at: null,
});
const grants = [
  grant('billing:refund:review', 'billing', 'refund'),
  grant('audit:read', 'audit', 'read'),
];
function fixture(overrides = {}) {
  const values = {
    authResult: verified, member, session, grants, trustedScope: scope, ...overrides,
  };
  const resolve = createTrustedPrincipalResolver({
    trustedScope: values.trustedScope,
    auth: {verifyAfterOidcOrSession: async request =>
      request === 'cryptographically-verified-server-test-evidence' ? values.authResult : null},
    records: {
      loadMember: async () => values.member,
      loadSession: async () => values.session,
      loadGrants: async () => values.grants,
    },
  });
  return (request = 'cryptographically-verified-server-test-evidence') => resolve(request, now);
}
test('versioned opaque principal only from verified backend evidence and current records', async () => {
  assert.equal(STARRY_PRINCIPAL_CONTRACT_VERSION, '0.2.0-draft');
  const p = await fixture()();
  assert.equal(isTrustedStarryPrincipal(p), true);
  assert.equal(p.s_user_id, 'u1');
  assert.deepEqual(p.admin_scopes, ['billing:refund:review', 'audit:read']);
  assert.equal(p.step_up.source, 'verified-backend-session');
  assert.equal(Object.isFrozen(p), true);
  assert.equal(Object.isFrozen(p.admin_scopes), true);
  assert.equal(await fixture()({adminVerified: true, s_user_id: 'u1', scopes: ['billing:refund:review']}), null);
});
test('forged client principal, booleans and JSON round-trip are never trusted', async () => {
  const p = await fixture()();
  for (const forged of [{...p}, JSON.parse(JSON.stringify(p)),
    {adminVerified: true, brand_id:'starry', s_user_id:'u1', admin_scopes:['billing:refund:review']}]) {
    assert.equal(isTrustedStarryPrincipal(forged), false);
    assert.throws(() => billingRefundReviewAdapter(forged, scope, now, 'sandbox'), /AUTH_PRINCIPAL_DENIED/);
    assert.throws(() => auditReadActorAdapter(forged, scope, now), /AUTH_PRINCIPAL_DENIED/);
  }
});
test('Billing adapter keeps Worker runtime environment separate from store sandbox', async () => {
  const p = await fixture()();
  assert.deepEqual(billingIdentityAdapter(p, scope, now, 'sandbox'), {
    brandId:'starry', appId:'starry-id', runtimeEnvironment:'staging',
    storeEnvironment:'sandbox', userId:'u1', authVersion:7, sessionId:'sess1',
  });
  const r = billingRefundReviewAdapter(p, scope, now, 'sandbox');
  assert.deepEqual(r, {brandId:'starry', environment:'sandbox', appIds:['starry-id'],
    scopes:['billing:refund:review'], stepUpAt: new Date((now-80)*1000).toISOString()});
  assert.throws(() => billingIdentityAdapter(p, scope, now, 'production'), /STORE_ENVIRONMENT_DENIED/);
  assert.throws(() => billingRefundReviewAdapter(p, scope, now, 'production'), /STORE_ENVIRONMENT_DENIED/);
});
test('Audit actor proof comes from exact audit grant, not a client adminVerified flag', async () => {
  const p = await fixture()();
  assert.deepEqual(auditReadActorAdapter(p, scope, now), {
    actor_kind:'user', actor_id:'u1', permission:'audit:read', action:'audit:read',
  });
  for (const g of [[], [grant('audit:read','billing','read')],
    [grant('audit:read','audit','write')]]) {
    const restricted = await fixture({grants:g})();
    assert.throws(() => auditReadActorAdapter(restricted, scope, now), /ADMIN_SCOPE_DENIED/);
  }
});
test('revoked/expired session, suspended/deleted members, stale auth version fail closed', async () => {
  for (const change of [{revoked_at:now}, {expires_at:now}, {auth_version:8}]) {
    assert.equal(await fixture({session:{...session,...change}})(),null);
  }
  for (const status of ['suspended','deleted']) {
    assert.equal(await fixture({member:{...member,status}})(),null);
  }
  assert.equal(await fixture({authResult:{...verified,auth_version:8}})(),null);
});
test('cross-brand, cross-app, cross-environment and revoked or wrong-action grant refuse refund review', async () => {
  for (const [key,value] of [
    ['brand_id','hglobal'],['app_id','other-app'],['environment','production'],
    ['resource','member'],['action','read'],['permission','audit:read'],
    ['revoked_at',now],['s_user_id','u2'],['expires_at',now],
  ]) {
    const p=await fixture({grants:[{...grants[0],[key]:value}]})();
    assert.throws(()=>billingRefundReviewAdapter(p,scope,now,'sandbox'),/ADMIN_SCOPE_DENIED/);
  }
  const p=await fixture()();
  for (const other of [{...scope,app_id:'other'}, {...scope,environment:'production'},
    {...scope,brand_id:'hglobal'}]) {
    assert.throws(()=>billingRefundReviewAdapter(p,other,now,'sandbox'),/AUTH_PRINCIPAL_DENIED/);
  }
});
test('refund step-up must be present, persisted, recent <= 5 min, and unexpired', async () => {
  for (const change of [
    {step_up_at:null},{step_up_at:now-301},{step_up_at:now+1},
    {step_up_until:now},{step_up_until:null},
  ]) {
    const p = await fixture({session:{...session,...change}})();
    assert.equal(p.admin_scopes.includes('billing:refund:review'),false);
    assert.throws(()=>billingRefundReviewAdapter(p,scope,now,'sandbox'),/ADMIN_SCOPE_DENIED/);
  }
  const p=await fixture()();
  assert.throws(()=>billingRefundReviewAdapter(p,scope,now+301,'sandbox'),
    /AUTH_PRINCIPAL_DENIED|STEP_UP_REQUIRED/);
});
test('missing authenticated principal or stale/mismatched server scope fails closed', async () => {
  assert.equal(await fixture()({s_user_id:'u1', adminVerified:true}),null);
  assert.equal(await fixture({authResult:{...verified,brand_id:'hglobal'}})(),null);
  assert.equal(await fixture({authResult:{...verified,app_id:'other-app'}})(),null);
  assert.equal(await fixture({authResult:{...verified,environment:'production'}})(),null);
  const p=await fixture()();
  assert.throws(()=>billingIdentityAdapter(p,scope,now+61,'sandbox'),/AUTH_PRINCIPAL_DENIED/);
  assert.throws(()=>billingRefundReviewAdapter(p,scope,now+61,'sandbox'),/AUTH_PRINCIPAL_DENIED/);
});
