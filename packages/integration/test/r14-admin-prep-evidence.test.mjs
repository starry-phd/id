import test from 'node:test';
import assert from 'node:assert/strict';
import {loadJson,checkAdminPrepEvidence} from '../../../docs/operations/verify-r14-admin-prep.mjs';
const source=loadJson('docs/operations/r14-admin-prep-evidence.v0.json');
const release=loadJson('docs/release-readiness/release-readiness.v0.json');
const clone=x=>JSON.parse(JSON.stringify(x));
const reject=(fn,r=release)=>{
 const x=clone(source);fn(x);
 const result=checkAdminPrepEvidence(x,r);
 assert.equal(result.ok,false,JSON.stringify(result));
};
test('P01–P10: all source files exist and none is misrepresented as a completed admin feature',()=>{
 const result=checkAdminPrepEvidence(source,release);
 assert.equal(result.ok,true,result.errors.join('; '));
 assert.equal(result.p_count,10);
 assert.equal(result.release_approved,false);
});
test('reject fake first-wave acceptance',()=>reject(x=>{x.components[0].wave1_accepted=true}));
test('reject fake second-wave UI authorization',()=>reject(x=>{x.wave2_ui_development_authorized=true}));
test('reject false approval of 60 admin capabilities',()=>reject(x=>{x.sixty_capabilities_approved=true}));
test('reject false admin.starry.phd authorization',()=>reject(x=>{x.admin_domain_approved=true}));
test('reject H-Global mixing',()=>reject(x=>{x.brand_id='hglobal'}));
test('reject missing P10',()=>reject(x=>{x.components.pop()}));
test('reject duplicated P05',()=>reject(x=>{x.components[7].id='P05'}));
test('reject nonexistent evidence file and path traversal',()=>{
 reject(x=>{x.components[0].local_evidence=['docs/operations/NONEXISTENT-APP-PREP.json']});
 reject(x=>{x.components[0].local_evidence=['docs/../secret.env']});
});
test('reject fake staging evidence',()=>reject(x=>{x.components[8].actual_staging_evidence='mock://fake'}));
test('reject fake owner approval',()=>reject(x=>{x.components[4].owner_approval_url='https://example.test/approval'}));
test('reject official Gate unlock',()=>{
 const copy=clone(release);copy.gates.find(g=>g.id==='G00-SSOT').status='approved';
 assert.equal(checkAdminPrepEvidence(source,copy).ok,false);
});
test('reject unknown source grade',()=>reject(x=>{x.evidence_grade='live_staging_verified'}));
