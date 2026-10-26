import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRound6Inputs,verifyRound6Guard} from '../test-support/round6-governance.mjs';
const original=loadRound6Inputs();
const mutate=(field,changed)=>({...original,[field]:changed});
const policyChange=(section,key,value)=>({...original,policy:{...original.policy,
 [section]:{...original.policy[section],[key]:value}}});
test('round6 source API/SDK version, AI4 ownership and G00-G10 BLOCKED',()=>{
 assert.deepEqual(verifyRound6Guard(original),{public_route:'/v1/health',sdk_version:'0.1.0',release:'BLOCKED'});
});
test('round6 fails closed on unapproved HTTP Member/OpenAPI and SDK exports',()=>{
 assert.throws(()=>verifyRound6Guard(mutate('openapi',original.openapi+'\n  /v1/member/self:\n    get:\n')),/OPENAPI_COMPAT/);
 assert.throws(()=>verifyRound6Guard(mutate('worker',original.worker+"\n// /v1/member/self")),/WORKER_EXPOSURE/);
 assert.throws(()=>verifyRound6Guard(mutate('sdk',original.sdk+"\nexport const makeAdminClient=()=>{};")),/SDK_EXPORT/);
 assert.throws(()=>verifyRound6Guard(policyChange('public_api','openapi_version','1.0.0')),/LIVE_API_FLAG/);
 assert.throws(()=>verifyRound6Guard(policyChange('public_api','release_authorized',true)),/LIVE_API_FLAG/);
});
test('round6 rejects unauthorized AI5, cross-brand, P05 approval, Gate and cloud switch',()=>{
 assert.throws(()=>verifyRound6Guard(policyChange('owner','proposed_ai5_activated',true)),/OWNER/);
 assert.throws(()=>verifyRound6Guard(policyChange('scope','brand_id','hglobal')),/SCOPE/);
 assert.throws(()=>verifyRound6Guard(policyChange('events','p05_publishable',true)),/P05_PUBLICATION/);
 const p={...original.policy,gates:{...original.policy.gates,G06:'PASS'}};
 assert.throws(()=>verifyRound6Guard({...original,policy:p}),/GATES/);
 assert.throws(()=>verifyRound6Guard(policyChange('devices','automated_per_pr_eas_build',true)),/DEVICES_AND_CLOUD/);
 assert.throws(()=>verifyRound6Guard({...original,policy:{...original.policy,no_live_bindings:false}}),/DEVICES_AND_CLOUD/);
});
test('round6 rejects mobile Auth enabling and code P05 promotion',()=>{
 assert.throws(()=>verifyRound6Guard(mutate('mobile',original.mobile.replace('memberAuthEnabled:false','memberAuthEnabled:true'))),/MOBILE_AUTH_DISABLED/);
 assert.throws(()=>verifyRound6Guard(mutate('candidate',original.candidate.replace('export const PUBLISHABLE=false','export const PUBLISHABLE=true'))),/P05_PUBLICATION/);
});
