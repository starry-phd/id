import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {
  compareS211RestoreProposals,S211_RESTORE_ATOMIC_ADMISSION,
  S211_RESTORE_REVIEW_LIVE_ENABLED,
} from '../src/m3-s211-restore-policy-review.ts';

const manual=0,self=1;
const plans=metadata=>compareS211RestoreProposals(metadata).proposals;
const covered=codes=>Object.fromEntries(codes.map(key=>[key,'externally_checked']));

test('S2-11 returns distinguishable manual-review and conditional self-service evidence plans',()=>{
  const result=compareS211RestoreProposals({});
  const [m,s]=result.proposals;
  assert.equal(result.schema,'starry-m3-s211-review-v1');
  assert.equal(result.brand,'starry');
  assert.equal(m.path,'manual_review');
  assert.equal(s.path,'conditional_self_service');
  assert.ok(m.required_evidence.includes('independent_reviewer_separation'));
  assert.ok(m.required_evidence.includes('secure_case_and_requester_consent'));
  assert.ok(!s.required_evidence.includes('independent_reviewer_separation'));
  assert.ok(s.required_evidence.includes('one_time_authenticated_binding'));
  assert.ok(s.required_evidence.includes('replay_limit_and_cooldown'));
  assert.ok(!m.required_evidence.includes('one_time_authenticated_binding'));
  assert.ok(m.required_evidence.includes('same_transaction_claim_entitlement_outbox'));
  assert.ok(s.required_evidence.includes('same_transaction_claim_entitlement_outbox'));
});

test('manual and self-service have separate unresolved evidence, same immutable shared trust fence',()=>{
  const empty=plans({});
  const manualOnly=covered(empty[manual].required_evidence);
  const [m,s]=plans(manualOnly);
  assert.equal(m.evidence_metadata_complete,true);
  assert.equal(m.missing_or_unverified.length,0);
  assert.equal(s.evidence_metadata_complete,false);
  assert.deepEqual(s.missing_or_unverified.map(g=>g.code),[
    'fresh_official_purchase_challenge',
    'one_time_authenticated_binding',
    'replay_limit_and_cooldown',
    'risk_escalation_to_human',
    'atomic_one_winner_transfer_protocol',
  ]);
  const selfOnly=covered(empty[self].required_evidence);
  const [m2,s2]=plans(selfOnly);
  assert.equal(s2.evidence_metadata_complete,true);
  assert.deepEqual(m2.missing_or_unverified.map(g=>g.code),[
    'secure_case_and_requester_consent',
    'independent_reviewer_separation',
    'second_approver_high_risk',
    'audited_appeal_and_recovery',
  ]);
});

test('provider receipt alone cannot cover first claim, refund freshness, deletion or atomic outbox',()=>{
  const [m,s]=plans({
    official_store_lineage:'externally_checked',
    revenuecat_project_member_mapping:'externally_checked',
  });
  for(const p of [m,s]){
    assert.equal(p.evidence_metadata_complete,false);
    for(const key of [
      'store_purchase_lifecycle_freshness',
      'original_first_claim_conflicts',
      'deleted_identity_tombstone',
      'lawful_minimal_retention',
      'independent_rollback_witness',
      'same_transaction_claim_entitlement_outbox',
      'durable_inbox_before_webhook_ack',
    ])assert.ok(p.missing_or_unverified.some(g=>g.code===key),key);
  }
});

test('even all self-reported externally_checked fields never confer authority or write capability',()=>{
  const all=new Set([
    ...plans({})[manual].required_evidence,
    ...plans({})[self].required_evidence,
  ]);
  const inputs=covered([...all]);
  const result=compareS211RestoreProposals(inputs);
  for(const p of result.proposals){
    assert.equal(p.evidence_metadata_complete,true);
    assert.equal(p.policy_selected,false);
    assert.equal(p.may_grant,false);
    assert.equal(p.may_transfer,false);
    assert.equal(p.may_call_restore_purchases,false);
    assert.equal(p.may_write_billing,false);
  }
  assert.equal(result.evidence_is_untrusted_metadata,true);
  assert.equal(result.external_ownership_verified,false);
  assert.equal(result.atomic_writer_authorized,false);
  assert.equal(result.release_authorized,false);
  assert.equal(S211_RESTORE_REVIEW_LIVE_ENABLED,false);
  assert.equal('authorize' in result,false);
  assert.equal('execute' in result,false);
});

test('untrusted metadata cannot smuggle approved policy, claimed grant or getters',()=>{
  for(const input of [null,[],{approved:true},{may_grant:true},
    {official_store_lineage:true},{official_store_lineage:'yes'},
    Object.create({official_store_lineage:'externally_checked'}),
    {[Symbol('flag')]:'externally_checked'},
  ])assert.throws(()=>compareS211RestoreProposals(input),/S211_REVIEW_METADATA_DENIED/);
  let touches=0;
  const accessor={};
  Object.defineProperty(accessor,'official_store_lineage',{
    enumerable:true,get(){touches++;throw Error('would leak secret');},
  });
  assert.throws(()=>compareS211RestoreProposals(accessor),/S211_REVIEW_METADATA_DENIED/);
  assert.equal(touches,0);
});

test('snapshot of caller review metadata remains independent after mutation',()=>{
  const input={official_store_lineage:'proposed'};
  const old=compareS211RestoreProposals(input);
  input.official_store_lineage='externally_checked';
  const latest=compareS211RestoreProposals(input);
  assert.deepEqual(old.proposals[manual].missing_or_unverified.find(x=>x.code==='official_store_lineage'),
    {code:'official_store_lineage',claimed:'proposed'});
  assert.ok(!latest.proposals[manual].missing_or_unverified.some(x=>x.code==='official_store_lineage'));
  assert.equal(Object.isFrozen(old),true);
  assert.equal(Object.isFrozen(old.proposals),true);
  assert.equal(Object.isFrozen(old.proposals[manual].missing_or_unverified),true);
  assert.equal(Object.isFrozen(old.proposals[manual].missing_or_unverified[0]),true);
});

test('atomic commit/outbox admission checklist keeps separate dedupe identities and safe cross-D1 stance',()=>{
  const rows=S211_RESTORE_ATOMIC_ADMISSION.join(' ');
  assert.match(rows,/ONE physical Billing transaction/);
  assert.match(rows,/inbox before acknowledging/);
  assert.match(rows,/original purchase first-claim/);
  assert.match(rows,/cross-D1 boundaries/);
  assert.match(rows,/outbox dispatcher/);
  assert.match(rows,/refund\/revoke\/chargeback/);
  assert.equal(Object.isFrozen(S211_RESTORE_ATOMIC_ADMISSION),true);
  assert.equal('commit' in compareS211RestoreProposals({}),false);
});

test('new decision-review TS source passes strict typecheck without shared CI changes',()=>{
  execFileSync(process.execPath,[
    'node_modules/typescript/bin/tsc','--noEmit','--strict','--target','ES2022',
    '--module','ESNext','--moduleResolution','Bundler','--skipLibCheck',
    '--allowImportingTsExtensions',
    'packages/rebuild-billing/src/m3-s211-restore-policy-review.ts',
  ],{stdio:'pipe',timeout:30000});
});

test('new source passes TypeScript-aware lint without editing platform eslint config',async()=>{
  const {ESLint}=await import('eslint');
  const parser=(await import('@typescript-eslint/parser')).default;
  const plugin=(await import('@typescript-eslint/eslint-plugin')).default;
  const eslint=new ESLint({
    overrideConfigFile:true,overrideConfig:[{
      files:['**/*.ts'],
      languageOptions:{parser,parserOptions:{ecmaVersion:'latest',sourceType:'module'}},
      plugins:{'@typescript-eslint':plugin},
      rules:{'no-undef':'off','no-unused-vars':'off',
        '@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_'}]},
    }],
  });
  const results=await eslint.lintFiles([
    'packages/rebuild-billing/src/m3-s211-restore-policy-review.ts',
  ]);
  assert.equal(results.length,1);
  assert.equal(results[0].errorCount,0,JSON.stringify(results[0].messages));
  assert.equal(results[0].warningCount,0,JSON.stringify(results[0].messages));
});
