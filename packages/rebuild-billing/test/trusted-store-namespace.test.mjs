import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfflineStoreNamespaceBuilder} from '../src/trusted-store-namespace.ts';

const config = Object.freeze({
  brandId:'starry',appId:'starry.app',starryEnvironment:'staging',
  provider:'apple',officialStoreApp:'example.unapproved.test.app',
  storeVerificationEnvironment:'sandbox',providerAuthority:'offline-authority-A',
});
const official = c => ({readOfficialVerifiedScope: async () => ({
  provider:c.provider,officialStoreApp:c.officialStoreApp,
  storeVerificationEnvironment:c.storeVerificationEnvironment,
  providerAuthority:c.providerAuthority,
})});
const builder = c => createOfflineStoreNamespaceBuilder(c,official(c));
const keys = (c=config, tx='tx', original='original', event='event') =>
  builder(c).build(tx,original,event);
const different = async (a,b,field) => assert.notEqual((await a)[field],(await b)[field]);

test('replay stable; versioned six-dimension trusted scope, separate provider receipt/lineage/event keys',async()=>{
  const a=await keys(); const b=await keys();
  assert.deepEqual(a,b);
  assert.equal(a.version,'starry-store-ns-v1');
  assert.notEqual(a.receiptIdentity,a.originalLineageIdentity);
  assert.notEqual(a.providerEventIdentity,a.receiptIdentity);
});
test('delimiter and Unicode cannot collide with adjacent dimensions',async()=>{
  await different(keys({...config,providerAuthority:'x:y',officialStoreApp:'z'}),
    keys({...config,providerAuthority:'x',officialStoreApp:'y:z'}),'namespace');
  await different(keys({...config,providerAuthority:'é'}),keys({...config,providerAuthority:'漢字'}),'namespace');
  await different(keys(config,'x:y','z'),keys(config,'x','y:z'),'receiptIdentity');
  await different(keys(config,'a','b:c'),keys(config,'a:b','c'),'originalLineageIdentity');
});
test('all six dimensions and provider each change the scope or receipt identity',async()=>{
  const changes=[
    {appId:'another.app'}, {starryEnvironment:'development'},
    {officialStoreApp:'another.official.app'},
    {providerAuthority:'different-official-authority'},
  ];
  for(const change of changes) await different(keys(config),keys({...config,...change}),'namespace');
  await different(keys(config),keys({...config,provider:'google'}),'receiptIdentity');
});
test('refund events on same receipt remain distinct, original first claim stable across member/session',async()=>{
  const paid=await keys(config,'receipt-1','original-1','paid-event');
  const refund1=await keys(config,'receipt-1','original-1','refund-event-1');
  const refund2=await keys(config,'receipt-1','original-1','refund-event-2');
  assert.equal(paid.receiptIdentity,refund1.receiptIdentity);
  assert.equal(refund1.receiptIdentity,refund2.receiptIdentity);
  assert.equal(paid.originalLineageIdentity,refund2.originalLineageIdentity);
  assert.notEqual(refund1.providerEventIdentity,refund2.providerEventIdentity);
  assert.deepEqual(Object.keys(paid).sort(),[
    'namespace','originalLineageIdentity','provider','providerEventIdentity','receiptIdentity','version'].sort());
  // No user/session is an input or an output.
});
test('no trust in fake official port scope; brand, runtime, verification env and authority fail closed',async()=>{
  for(const bad of [
    {brandId:'hglobal'}, {brandId:'unknown'}, {appId:''},
    {starryEnvironment:'production'}, {starryEnvironment:'sandbox'},
    {storeVerificationEnvironment:'production'}, {storeVerificationEnvironment:'development'},
    {provider:'stripe'}, {providerAuthority:''}, {officialStoreApp:' '},
    {appId:'starry.app '}, {providerAuthority:' authority'}, {providerAuthority:'authority '},
    {providerAuthority:'e\u0301'}, {providerAuthority:'\u0000'}, {providerAuthority:'\uD800'},
  ]) assert.throws(()=>builder({...config,...bad}),/STORE_NAMESPACE_CONFIG_DENIED/);
  for(const changed of [
    {provider:'google'}, {officialStoreApp:'another.app'},
    {storeVerificationEnvironment:'production'},{providerAuthority:'other'},
    {providerAuthority:''},{providerAuthority:' no'},{providerAuthority:'no '},
  ]) {
    const port=official({...config,...changed});
    await assert.rejects(createOfflineStoreNamespaceBuilder(config,port).build('tx','origin','event'),
      /STORE_NAMESPACE_(SCOPE_MISMATCH|VERIFICATION_DENIED)/);
  }
});
test('reject invalid references, including empty, Unicode non-NFC, whitespace and control characters',async()=>{
  for(const ref of ['', ' tx','tx ','e\u0301','x\n','\u0000','\uD800'])
    await assert.rejects(keys(config,ref),/STORE_NAMESPACE_REFERENCE_DENIED/);
  assert.notEqual((await keys(config,'é')).receiptIdentity,(await keys(config,'漢')).receiptIdentity);
});
test('cannot pass request claims into builder or obtain grant/write/live abilities',async()=>{
  assert.throws(()=>createOfflineStoreNamespaceBuilder(config,{}),/STORE_NAMESPACE_PORT_DENIED/);
  const out=await keys();
  assert.equal('grant' in out,false);
  assert.equal('commit' in out,false);
  assert.equal('paid' in out,false);
  assert.equal(Object.isFrozen(out),true);
});

test('constructor snapshot survives post-construction brand and runtime mutation',async()=>{
  const mutable={...config};
  const created=createOfflineStoreNamespaceBuilder(mutable,official(config));
  const before=await created.build('receipt','origin','event');
  mutable.brandId='hglobal';
  mutable.starryEnvironment='production';
  assert.deepEqual(await created.build('receipt','origin','event'),before);
  assert.equal((await created.build('receipt','origin','event')).namespace,
    (await keys(config,'receipt','origin','event')).namespace);
});
test('await boundary cannot change app or authority or split first-claim namespace',async()=>{
  const mutable={...config};
  let release;
  const pending=new Promise(resolve=>{release=resolve});
  const created=createOfflineStoreNamespaceBuilder(mutable,{
    async readOfficialVerifiedScope(){await pending;return official(config).readOfficialVerifiedScope();},
  });
  const inFlight=created.build('receipt','original','refund');
  mutable.appId='other.app';
  mutable.providerAuthority='another-authority';
  mutable.officialStoreApp='other.bundle';
  release();
  const settled=await inFlight;
  const expected=await keys(config,'receipt','original','refund');
  assert.equal(settled.originalLineageIdentity,expected.originalLineageIdentity);
  assert.deepEqual(settled,expected);
});
test('official scope is descriptor-snapshotted once; accessor scopes fail closed',async()=>{
  let reads=0;
  const accessor={...config};
  delete accessor.brandId;delete accessor.appId;delete accessor.starryEnvironment;
  Object.defineProperty(accessor,'providerAuthority',{enumerable:true,get(){reads++;return config.providerAuthority}});
  await assert.rejects(createOfflineStoreNamespaceBuilder(config,{
    readOfficialVerifiedScope:()=>accessor,
  }).build('tx','orig','event'),/STORE_NAMESPACE_VERIFICATION_DENIED/);
  assert.equal(reads,0);
  const server={...config};
  Object.defineProperty(server,'appId',{enumerable:true,get(){reads++;return config.appId}});
  assert.throws(()=>createOfflineStoreNamespaceBuilder(server,official(config)),/STORE_NAMESPACE_CONFIG_DENIED/);
  assert.equal(reads,0);
});
