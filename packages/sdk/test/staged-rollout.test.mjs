import test from 'node:test';
import assert from 'node:assert/strict';
import * as publicSdk from '../src/index.ts';
import {STARRY_ROLLOUT_DRAFT_VERSION,getOfflineRolloutPreview} from '../src/staged-rollout.preview.ts';
test('rollout preview has version but cannot be imported through public SDK',()=>{
 assert.equal(STARRY_ROLLOUT_DRAFT_VERSION,'starry-rollout.v0-draft');
 const p=getOfflineRolloutPreview();
 assert.equal(p.member_service,'starry-id');
 assert.equal(p.standalone_store_app,false);
 assert.equal(p.ads_enabled,false);
 assert.equal(p.cross_brand_sync,false);
 assert.equal(p.deployment,'blocked');
 assert.deepEqual(p.gates,{identity:'blocked',battery:'blocked',billing:'blocked'});
 assert.equal('getOfflineRolloutPreview' in publicSdk,false);
 assert.equal('STARRY_ROLLOUT_DRAFT_VERSION' in publicSdk,false);
});
