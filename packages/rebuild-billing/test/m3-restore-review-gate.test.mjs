import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createOfflineStoreNamespaceBuilder} from '../src/trusted-store-namespace.ts';
import {createOfflineM3RestoreReviewGate} from '../src/m3-restore-review-gate.ts';

const scope=Object.freeze({brandId:'starry',appId:'starry.app.a',starryEnvironment:'staging'});
const config=Object.freeze({...scope,provider:'apple',
  officialStoreApp:'example.unapproved.test.app',storeVerificationEnvironment:'sandbox',
  providerAuthority:'test-only-store-authority'});
const verified=()=>createOfflineStoreNamespaceBuilder(config,{
  async readOfficialVerifiedScope(){return {
    provider:config.provider,officialStoreApp:config.officialStoreApp,
    storeVerificationEnvironment:config.storeVerificationEnvironment,
    providerAuthority:config.providerAuthority,
  };},
});
const member=()=>({memberId:'member-A',appId:scope.appId,
  starryEnvironment:scope.starryEnvironment,status:'active',authVersion:1});
const purchase=()=>({receiptTransactionRef:'receipt-1',
  originalTransactionRef:'original-1',providerEventRef:'paid-1',state:'valid'});
async function setup(options={}) {
  const ns=verified();
  const p=purchase();
  const keys=await ns.build(p.receiptTransactionRef,p.originalTransactionRef,p.providerEventRef);
  let m=options.member===undefined?member():options.member;
  let first=options.claim===undefined?
    {namespace:keys.namespace,originalLineageIdentity:keys.originalLineageIdentity,
      ownerMemberId:'member-A'}:options.claim;
  let evidence=options.purchase===undefined?p:options.purchase;
  let memberReads=0,claimReads=0,purchaseReads=0;
  const ports={
    async readCurrentMember(){memberReads++;return typeof m==='function'?m():m;},
    async readVerifiedPurchaseCandidate(){purchaseReads++;return evidence;},
    async readOriginalFirstClaim(){claimReads++;return typeof first==='function'?first():first;},
  };
  const gate=createOfflineM3RestoreReviewGate(
    options.scope??scope,options.builder??ns, options.ports??ports,options.enabled??true);
  return {gate,keys,
    setMember(v){m=v;},setClaim(v){first=v;},setPurchase(v){evidence=v;},
    counts:()=>({memberReads,claimReads,purchaseReads})};
}

test('OFF by default: no underlying port I/O and no grant/transfer methods',async()=>{
  let calls=0;
  const ports={readCurrentMember:async()=>{calls++;return member()},
    readVerifiedPurchaseCandidate:async()=>{calls++;return purchase()},
    readOriginalFirstClaim:async()=>{calls++;return null}};
  const gate=createOfflineM3RestoreReviewGate(scope,verified(),ports);
  assert.deepEqual(await gate.assess(),{decision:'hold',reason:'disabled',
    local_only:true,may_grant:false,may_transfer:false});
  assert.equal(calls,0);assert.equal(gate.live_enabled,false);
  assert.equal('grant' in gate,false);assert.equal('transfer' in gate,false);
});
test('same member valid purchase only requires reconciliation; NEVER authorizes grant',async()=>{
  const {gate,counts}=await setup();
  const r=await gate.assess();
  assert.equal(r.decision,'same_member_review');
  assert.equal(r.reason,'same_member_needs_reconciliation');
  assert.equal(r.may_grant,false);assert.equal(r.may_transfer,false);
  assert.equal(Object.isFrozen(r),true);
  assert.deepEqual(counts(),{memberReads:2,claimReads:1,purchaseReads:1});
});
test('deleted original owner claimed by new member: HOLD without auto alias or leaked owner',async()=>{
  const {gate}=await setup({member:{...member(),memberId:'member-B'}});
  const r=await gate.assess();
  assert.deepEqual(r,{decision:'hold',reason:'ownership_conflict',
    local_only:true,may_grant:false,may_transfer:false});
  assert.equal(JSON.stringify(r).includes('member-A'),false);
});
test('missing first claim or mismatched scope/lineage never initiates new original claim',async()=>{
  assert.equal((await (await setup({claim:null})).gate.assess()).reason,'original_claim_unavailable');
  for(const claim of [
    {namespace:'other',originalLineageIdentity:'x',ownerMemberId:'member-A'},
    {namespace:'other',originalLineageIdentity:'other',ownerMemberId:'member-B'},
    {namespace:'x',originalLineageIdentity:'x',ownerMemberId:''},
  ])assert.equal((await (await setup({claim})).gate.assess()).reason,'claim_scope_denied');
});
test('refund/revoke/expiry and unknown evidence never reach first-claim lookup',async()=>{
  for(const state of ['refunded','revoked','expired','unknown']){
    const {gate,counts}=await setup({purchase:{...purchase(),state}});
    assert.equal((await gate.assess()).reason,'purchase_not_valid');
    assert.equal(counts().claimReads,0);
  }
  const {gate}=await setup({purchase:null});
  assert.equal((await gate.assess()).reason,'evidence_unavailable');
});
test('wrong account status/App/environment and unverified member deny before purchase',async()=>{
  for(const m of [null,{...member(),status:'deleted'},{...member(),status:'suspended'},
    {...member(),appId:'other.app'},{...member(),starryEnvironment:'development'},
    {...member(),authVersion:0}]){
    const {gate,counts}=await setup({member:m});
    assert.equal((await gate.assess()).reason,'identity_denied');
    assert.equal(counts().purchaseReads,0);
  }
  for(const bad of [{brandId:'hglobal'},{starryEnvironment:'production'},
    {appId:''},{appId:'other app'}])
    await assert.rejects(async()=>setup({scope:{...scope,...bad}}),/M3_RESTORE_SCOPE_DENIED/);
});
test('mutable original server scope cannot be changed after constructor/await',async()=>{
  const original={...scope};
  const {gate}=await setup({scope:original});
  original.brandId='hglobal';original.starryEnvironment='production';original.appId='other';
  assert.equal((await gate.assess()).decision,'same_member_review');
});
test('authenticated member revoked or swapped across await cannot use stale snapshot',async()=>{
  let release;
  const waiting=new Promise(resolve=>{release=resolve});
  let current=member();
  const keyGate=verified();
  const keys=await keyGate.build('receipt-1','original-1','paid-1');
  const gate=createOfflineM3RestoreReviewGate(scope,keyGate,{
    async readCurrentMember(){return current},
    async readVerifiedPurchaseCandidate(){return purchase()},
    async readOriginalFirstClaim(){await waiting;return {
      namespace:keys.namespace,originalLineageIdentity:keys.originalLineageIdentity,
      ownerMemberId:'member-A'};},
  },true);
  const inflight=gate.assess();
  // Permit async continuation to reach the deferred first-claim port.
  await new Promise(resolve=>setImmediate(resolve));
  current={...member(),status:'deleted',authVersion:2};
  release();
  assert.equal((await inflight).reason,'identity_denied');
});
test('dirty/extra/getter objects fail closed without reading attacker getter',async()=>{
  let reads=0;
  const contaminated={...purchase()};
  Object.defineProperty(contaminated,'state',{enumerable:true,get(){reads++;return 'valid'}});
  const {gate}=await setup({purchase:contaminated});
  assert.equal((await gate.assess()).reason,'evidence_unavailable');
  assert.equal(reads,0);
  const extra={...member(),s_user_id:'claimed-user-from-client'};
  assert.equal((await (await setup({member:extra})).gate.assess()).reason,'identity_denied');
});
test('provider errors, corrupted transaction refs and wrong original claim fail closed',async()=>{
  const {gate}=await setup({purchase:{...purchase(),originalTransactionRef:'tx '}});
  assert.equal((await gate.assess()).reason,'evidence_unavailable');
  const {gate:broken}=await setup({ports:{
    readCurrentMember:async()=>member(),
    readVerifiedPurchaseCandidate:async()=>{throw Error('PROVIDER_DOWN_SECRET')},
    readOriginalFirstClaim:async()=>{throw Error('SHOULD_NOT_RUN')},
  }});
  const r=await broken.assess();
  assert.equal(r.reason,'evidence_unavailable');
  assert.equal(JSON.stringify(r).includes('SECRET'),false);
});
test('new M3 gate compiles under strict TypeScript without shared CI edits',()=>{
  execFileSync(process.execPath,[
    'node_modules/typescript/bin/tsc','--noEmit','--strict','--target','ES2022',
    '--module','ESNext','--moduleResolution','Bundler','--skipLibCheck',
    '--allowImportingTsExtensions','packages/rebuild-billing/src/m3-restore-review-gate.ts',
  ],{stdio:'pipe',timeout:25000});
});

test('new M3 source passes isolated TypeScript-aware ESLint without modifying shared config',async()=>{
  const {ESLint}=await import('eslint');
  const tsParser=(await import('@typescript-eslint/parser')).default;
  const tsPlugin=(await import('@typescript-eslint/eslint-plugin')).default;
  const eslint=new ESLint({
    overrideConfigFile:true,
    overrideConfig:[{
      files:['**/*.ts'],
      languageOptions:{parser:tsParser,parserOptions:{ecmaVersion:'latest',sourceType:'module'}},
      plugins:{'@typescript-eslint':tsPlugin},
      rules:{'no-undef':'off','no-unused-vars':'off',
        '@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_'}]},
    }],
  });
  const results=await eslint.lintFiles(['packages/rebuild-billing/src/m3-restore-review-gate.ts']);
  assert.equal(results.length,1);
  assert.equal(results[0].errorCount,0,JSON.stringify(results[0].messages));
  assert.equal(results[0].warningCount,0,JSON.stringify(results[0].messages));
});
