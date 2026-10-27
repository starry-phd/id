import test from 'node:test';
import assert from 'node:assert/strict';
import {auditEchoFirstAppRebuild,readEchoFirstAppInputs} from '../../../docs/product/verify-echo-starry-first-app-map.mjs';
const x=readEchoFirstAppInputs();
const audit=(p,rel=x.release,portfolio=x.portfolio,ux=x.ux,expo=x.expo)=>
 auditEchoFirstAppRebuild(p,rel,portfolio,ux,expo);
const edit=fn=>{const p=structuredClone(x.plan);fn(p);return p;};
test('Echo first App 40 traceable proposed features, frozen legacy blobs and 11 official BLOCKED release Gates',()=>{
 const a=audit(x.plan);assert.equal(a.ok,true,a.errors.join(' | '));
 assert.equal(a.catalogue_count,40);
 assert.equal(a.official_release_gates_blocked,11);
 assert.equal(a.first_app_named,'繁星回聲');
 assert.equal(a.actual_echo_native_app_built,false);
 assert.equal(a.official_mvp_approved,false);
});
test('Echo selection is real but MVP, bundle IDs, native build and Store remain unapproved',()=>{
 for(const fn of [
 p=>p.authoritative_selection.first_starry_app_name='Generic AI',
 p=>p.authoritative_selection.official_mvp_scope_approved=true,
 p=>p.authoritative_selection.official_store_ids_approved=true,
 p=>p.authoritative_selection.app_built=true,
 p=>p.authoritative_selection.existing_generic_consumer_a_is_the_echo_app=true,
 p=>p.implementation_design.ui_routes_created=true,
 p=>p.implementation_design.android_ios_real_device_tested=true
 ])assert.equal(audit(edit(fn)).ok,false);
});
test('wrong legacy GitHub source path or Git Blob pin is rejected; do not invent source audit',()=>{
 for(const fn of [
 p=>p.source_snapshot.legacy_commit_sha='a'.repeat(40),
 p=>p.source_snapshot.captured_legacy_file_blob_shas['src/App.tsx']='f'.repeat(40),
 p=>p.catalogue.features[0].legacy_paths[0]='src/UNVERIFIED.ts',
 p=>p.catalogue.features[1].selected_for_official_mvp=true,
 p=>p.catalogue.features[2].review_status='accepted',
 p=>p.catalogue.full_legacy_code_review_complete=true
 ])assert.equal(audit(edit(fn)).ok,false);
});
test('no migration, deploy, live D1/R2, Store, EAS, paid Battery or main merge without approval',()=>{
 for(const field of Object.keys(x.plan.no_permission))
 assert.equal(audit(edit(p=>p.no_permission[field]=true)).ok,false,field);
});
test('product record cannot override official release Gate or old historical candidate UX unilaterally',()=>{
 const r=structuredClone(x.release);r.gates[0].status='verified';
 assert.equal(audit(x.plan,r).ok,false);
 const ux=structuredClone(x.ux);ux.candidate.approved=true;
 assert.equal(audit(x.plan,x.release,x.portfolio,ux).ok,false);
 const app=structuredClone(x.expo);app.expo.slug='echo-starry';
 assert.equal(audit(x.plan,x.release,x.portfolio,x.ux,app).ok,false);
});
test('feature matrix remains a proposal until explicit MVP product review',()=>{
 for(const fn of [
 p=>p.catalogue.features.pop(),
 p=>p.catalogue.features[3].phase='done',
 p=>p.catalogue.selected_official_mvp_feature_count=1,
 p=>p.decisions_pending=[],
 p=>p.implementation_design.privacy_and_copyright_review_pending=false
 ])assert.equal(audit(edit(fn)).ok,false);
});
