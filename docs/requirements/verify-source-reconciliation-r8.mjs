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
assert.equal(matrix.source_clause_reconciled_count,0,'source text extraction must not masquerade as approved per-clause semantics');
assert.equal(matrix.source_master_section_presence_checked,128,'all 128 master sections must be inspected');
assert.equal(matrix.source_master_document_id,'1o9luZIfaeMVBVT5XWD4fSiFHtG3F-viqNbsjmtoq_Cw');
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
 assert.equal(e.source_clause_review,'master_section_read_dev_A_to_I_crosscheck_pending');
 assert.equal(e.source_master_flags?.master_section_present,true,`missing master section ${e.source_id}`);
 assert.equal(e.source_master_flags?.master_purpose_present,true,`missing purpose ${e.source_id}`);
 for(const flag of ['master_constraint_present','master_legacy_conflict_present','master_manual_checkbox_present','index_title_differs_from_master'])
   assert.equal(typeof e.source_master_flags[flag],'boolean',`invalid flag ${e.source_id} ${flag}`);
 assert.equal(e.release_acceptance,'blocked_real_environment_or_requirements_gate');
 assert.notEqual(e.decision_class,'release_approved');
 if(e.decision_class==='hglobal_paused')assert.equal(e.brand_scope,'hglobal_paused');
}
const counts={};
for(const row of matrix.entries)counts[row.decision_class]=(counts[row.decision_class]||0)+1;
console.log('128/128 source headings and master document sections inspected once; DEV-A–I clause-level adjudication and Release Gates remain BLOCKED.');
console.log(JSON.stringify(counts));
