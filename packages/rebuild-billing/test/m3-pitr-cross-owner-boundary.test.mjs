/**
 * AI-2 / M3 x AI-3 / M2-M4: cross-owner contract regression only.
 * Synthetic evidence is NOT an independent PITR witness or official Store proof.
 * This test is intentionally outside AI-3's owned source/test files.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewOfflinePitrCandidate} from '../../rebuild-ai3/src/m2-offline-pitr-reconciliation.ts';
import {createOfflineStoreNamespaceBuilder} from '../src/trusted-store-namespace.ts';
import {createOfflineM3RestoreReviewGate} from '../src/m3-restore-review-gate.ts';

const MEMBER='member_0001';
const STORE_APP='test.unapproved.bundle';
const PROVIDER_AUTHORITY='offline-test-only-provider';
const member=({memberId=MEMBER,authVersion=8,status='active',appId='starry.app.a'}={})=>({
  memberId,appId,starryEnvironment:'staging',status,authVersion,
});
const centralMember=({status='active',authVersion=8,profilePresent=false,revokedAt=9}={})=>({
  member_ref:MEMBER,status,auth_version:authVersion,
  profile_present:profilePresent,
  sessions:[{session_ref:'session_001',auth_version:authVersion,revoked_at:revokedAt}],
});
const candidate=(m=centralMember(),generation=20)=>({
  brand_id:'starry',app_id:'starry-id',environment:'staging',
  snapshot_generation:generation,members:[m],
});
const witness=({deleted=false,minVersion=8,generation=20}={})=>({
  brand_id:'starry',app_id:'starry-id',environment:'staging',
  observed_generation:generation,
  records:[{member_ref:MEMBER,minimum_auth_version:minVersion,deleted}],
});
const scope=Object.freeze({brandId:'starry',appId:'starry.app.a',starryEnvironment:'staging'});
const purchase=(state='valid')=>({
  receiptTransactionRef:'receipt_01',
  originalTransactionRef:'original_01',
  providerEventRef:'event_01',
  state,
});
const storeBuilder=(appId='starry.app.a')=>{
  const config=Object.freeze({
    brandId:'starry',appId,starryEnvironment:'staging',provider:'apple',
    officialStoreApp:STORE_APP,storeVerificationEnvironment:'sandbox',
    providerAuthority:PROVIDER_AUTHORITY,
  });
  return createOfflineStoreNamespaceBuilder(config,{
    readOfficialVerifiedScope:async()=>({
      provider:config.provider,officialStoreApp:config.officialStoreApp,
      storeVerificationEnvironment:config.storeVerificationEnvironment,
      providerAuthority:config.providerAuthority,
    }),
  });
};
async function makeBilling({current=member(),storedClaimForApp='starry.app.a',
  purchaseState='valid',enabled=true,sourceMember,sourceClaim}={}){
  const namespace=storeBuilder();
  const authoritativeKeys=await storeBuilder(storedClaimForApp)
    .build('receipt_01','original_01','event_01');
  const counters={member:0,purchase:0,claim:0};
  const ports={
    async readCurrentMember(){
      counters.member++;
      return sourceMember===undefined?current:sourceMember;
    },
    async readVerifiedPurchaseCandidate(){
      counters.purchase++;
      return purchase(purchaseState);
    },
    async readOriginalFirstClaim(){
      counters.claim++;
      return sourceClaim===undefined?{
        namespace:authoritativeKeys.namespace,
        originalLineageIdentity:authoritativeKeys.originalLineageIdentity,
        ownerMemberId:MEMBER,
      }:sourceClaim;
    },
  };
  return {gate:createOfflineM3RestoreReviewGate(scope,namespace,ports,enabled),counters};
}
function neverGrant(pitr,billing){
  assert.equal(pitr.status,'quarantined_review_required');
  assert.equal(pitr.independent_witness_verified,false);
  assert.equal(pitr.may_restore,false);
  assert.equal(pitr.may_open_api,false);
  assert.equal(pitr.may_grant_battery,false);
  assert.equal(pitr.may_ack_queue,false);
  assert.equal(billing.may_grant,false);
  assert.equal(billing.may_transfer,false);
  assert.equal(billing.local_only,true);
}

test('PITR resurrection: even stale Auth+original claim matching cannot authorize Billing or data restore',async()=>{
  const pitr=reviewOfflinePitrCandidate(
    candidate(centralMember({status:'active',authVersion:2,
      profilePresent:true,revokedAt:null}),3),
    witness({deleted:true,minVersion:8,generation:20}),
  );
  assert.ok(pitr.risks.includes('DELETED_MEMBER_REAPPEARED'));
  assert.ok(pitr.risks.includes('DELETED_PROFILE_REAPPEARED'));
  assert.ok(pitr.risks.includes('SESSION_ACTIVE_AFTER_DELETION'));
  assert.ok(pitr.risks.includes('AUTH_VERSION_ROLLBACK'));
  const {gate}=await makeBilling({current:member({authVersion:2})});
  const bill=await gate.assess();
  // A locally restored Auth/first-claim row can look self-consistent to
  // Billing. This is NOT proof of non-deletion or a recovery permission.
  assert.equal(bill.reason,'same_member_needs_reconciliation');
  neverGrant(pitr,bill);
});

test('matching local witness without risks still cannot become trusted Store ownership evidence',async()=>{
  const pitr=reviewOfflinePitrCandidate(candidate(),witness());
  assert.deepEqual(pitr.risks,[]);
  const {gate}=await makeBilling();
  const bill=await gate.assess();
  assert.equal(bill.decision,'same_member_review');
  neverGrant(pitr,bill);
  // Neither reviewer contains a grant/commit/rebind API or independent proof.
  assert.equal('grant' in gate,false);
  assert.equal('transfer' in gate,false);
});

test('central identity witness cannot bridge App A Store first claim into App B',async()=>{
  const pitr=reviewOfflinePitrCandidate(candidate(),witness());
  const {gate}=await makeBilling({storedClaimForApp:'starry.app.b'});
  const bill=await gate.assess();
  assert.equal(bill.reason,'claim_scope_denied');
  neverGrant(pitr,bill);
});

test('synthetic PITR report itself cannot impersonate current member or Billing first claim',async()=>{
  const pitr=reviewOfflinePitrCandidate(candidate(),witness());
  const injectedMember=(await makeBilling({sourceMember:pitr})).gate;
  const injectedClaim=(await makeBilling({sourceClaim:pitr})).gate;
  const deniedMember=await injectedMember.assess();
  const deniedClaim=await injectedClaim.assess();
  assert.equal(deniedMember.reason,'identity_denied');
  assert.equal(deniedClaim.reason,'original_claim_unavailable');
  neverGrant(pitr,deniedMember);
  neverGrant(pitr,deniedClaim);
});

test('refund and re-registration after deleted witness remain blocked even when prior claim exists',async()=>{
  const pitr=reviewOfflinePitrCandidate(candidate(centralMember({
    status:'active',revokedAt:null,
  })),witness({deleted:true,minVersion:9,generation:22}));
  const refund=(await makeBilling({purchaseState:'refunded'})).gate;
  const newId=(await makeBilling({current:member({memberId:'member_0002'})})).gate;
  const refunded=await refund.assess();
  const conflicted=await newId.assess();
  assert.equal(refunded.reason,'purchase_not_valid');
  assert.equal(conflicted.reason,'ownership_conflict');
  neverGrant(pitr,refunded);
  neverGrant(pitr,conflicted);
});
