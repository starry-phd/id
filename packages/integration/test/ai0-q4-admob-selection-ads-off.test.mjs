import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const current=JSON.parse(readFileSync(new URL('../../../docs/operations/ai0-q4-admob-owner-approved.v1.json',import.meta.url),'utf8'));
const old=JSON.parse(readFileSync(new URL('../../../docs/operations/ai0-owner-approved-wave1-decisions.v1.json',import.meta.url),'utf8'));
test('latest owner decision Q4=A supersedes earlier Q4=D vendor-pending historical record',()=>{
 assert.equal(old.Q4.choice,'D');
 assert.equal(current.supersedes.prior_Q4,'D');
 assert.equal(current.current.Q4,'A');
 assert.equal(current.current.provider,'Google AdMob Mediation');
 assert.equal(current.current.provider_key,'google-admob-mediation');
 assert.equal(current.current.selection_approved,true);
});
test('provider selection is NOT SDK installation, ad serving, Store, expense or Production approval',()=>{
 for(const key of ['ads_enabled','sdk_install_authorized','sdk_initialized','ad_requests_authorized',
  'ad_unit_creation_authorized','admob_account_creation_authorized',
  'payments_or_paid_resources_authorized','production_change_authorized',
  'app_store_submission_authorized'])
  assert.equal(current.current[key],false,key);
 assert.equal(current.current.activation_requires_separate_owner_approval,true);
 assert.equal(current.unchanged.battery_permanently_free,true);
 assert.equal(current.unchanged.release_gates_blocked,11);
 assert.equal(current.unchanged.main_merge_authorized,false);
});
test('all other five-question decisions and deferred private repo unchanged',()=>{
 for(const k of ['Q1','Q2','Q3','Q5']) assert.equal(current.unchanged[k],old[k].choice);
 assert.match(current.scope,/Q5=B/);
});
