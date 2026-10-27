import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const parse=(p)=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const source=parse('./original-inventory.v0.json');
const matrix=parse('./source-reconciliation-r8.v0.json');
const states=new Set(['partially_approved_details_pending','owner_approved_release_blocked',
  'superseded_by_latest','candidate_no_owner_approval','hglobal_paused',
  'deferred_from_first_release','ai_proposal_gate_pending']);
const owner=/^AI-[0-4](?:\+AI-[0-4](?:\/[0-4])*)?$/;
assert.equal(source.entries.length,128,'original must have 128 headings');
assert.equal(matrix.entries.length,128,'mapped headings must be exactly 128');
assert.equal(matrix.release_gate,'BLOCKED','no silent release');
assert.equal(matrix.source_clause_reconciled_count,0,'heading annotation must not masquerade as full-clause reconciliation');
const sourceId=source.entries.map(r=>r.id);
const mapId=matrix.entries.map(r=>r.source_id);
assert.deepEqual(mapId,sourceId,'one-to-one source order; no skipped or invented headings');
assert.equal(new Set(mapId).size,128,'no duplicates');
for(let i=0;i<128;i++){
 const e=matrix.entries[i],s=source.entries[i];
 assert.equal(e.source_title,s.title,`title mismatch ${s.id}`);
 assert.equal(e.section,s.section,`section mismatch ${s.id}`);
 assert.ok(states.has(e.decision_class),`bad status ${s.id}`);
 assert.ok(typeof e.owner==='string'&&e.owner.startsWith('AI-'),`owner ${s.id}`);
 assert.ok(Array.isArray(e.candidate_feature_ids)&&e.candidate_feature_ids.length>0,`feature ${s.id}`);
 assert.ok(Array.isArray(e.decision_refs),`refs ${s.id}`);
 assert.ok(Array.isArray(e.evidence_prs),`evidence ${s.id}`);
 assert.ok(e.evidence_prs.every(s=>/^https:\/\/github\.com\/starry-phd\/id\/pull\/\d+$/.test(s)),`evidence links ${e.source_id}`);
 assert.equal(e.source_clause_review,'heading_classified_full_clause_pending');
 assert.equal(e.release_acceptance,'blocked_real_environment_or_requirements_gate');
 assert.notEqual(e.decision_class,'release_approved');
 if(e.decision_class==='hglobal_paused')assert.equal(e.brand_scope,'hglobal_paused');
}
const counts={};
for(const row of matrix.entries)counts[row.decision_class]=(counts[row.decision_class]||0)+1;
console.log('128/128 heading indexes mapped once; ALL full-clause review and Release Gates remain BLOCKED.');
console.log(JSON.stringify(counts));
