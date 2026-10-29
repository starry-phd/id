import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root=new URL('../../../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('packages/rebuild-ai3/docs/MAIN-PROMOTION-AI3-SIDE-EFFECT-REVIEW.v1.json',root),'utf8'));
const content=(p)=>readFileSync(new URL(p,root),'utf8');
const blob=(p)=>{const b=readFileSync(new URL(p,root));return createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');};

test('AI3 promotion 01: tree and main preserved/source pins',()=>{
 const b=manifest.baseline;
 assert.equal(b.main_blob_count,18);
 assert.equal(b.promotion_blob_count,846);
 assert.equal(b.added_blob_count,828);
 assert.equal(b.modified_blob_count,0);
 assert.equal(b.deleted_blob_count,0);
 assert.equal(b.main_identical_sha_count,18);
 assert.equal(b.main_tree_truncated,false);
 assert.equal(b.promotion_tree_truncated,false);
 assert.equal(Object.keys(manifest.main_unchanged_blobs).length,18);
 assert.equal(Object.keys(manifest.ai3_30_source_blobs).length,30);
 assert.equal(Object.keys(manifest.ai3_10_sql_draft_blobs).length,10);
 for(const [p,sha] of Object.entries(manifest.main_unchanged_blobs)) assert.equal(blob(p),sha,p);
});
test('AI3 promotion 02: protected public Worker entry has no AI3 queue/runtime import',()=>{
 const p='apps/api/src/index.ts';
 assert.equal(blob(p),manifest.entry.find(x=>x.path===p).sha);
 const c=content(p);
 assert.match(c,/export default/);
 assert.match(c,/\/v1\/health/);
 assert.doesNotMatch(c,/(?:import|require\(|import\().*(?:rebuild-ai3|queue-consumer|queue-transport)/);
 assert.doesNotMatch(c,/\bqueue\s*\(/);
 assert.doesNotMatch(c,/\bmsg\.ack\s*\(/);
 const w=content('apps/api/wrangler.toml');
 assert.match(w,/main\s*=\s*"src\/index.ts"/);
 assert.match(w,/workers_dev\s*=\s*false/);
 assert.doesNotMatch(w,/\[\[d1_databases\]\]|\[\[queues\.|\[env\.production\]/);
});
test('AI3 promotion 03: Queue/DB adapters are dangerous if wired, not protected by decorative flags',()=>{
 for(const p of ['queue-transport.ts','queue-consumer.ts','d1-audit-adapter.ts','auth-deletion-battery-consumer.ts','auth-deletion-battery-bridge.ts','battery-settlement-d1.ts','anonymous-appeals.ts']){
  const file='packages/rebuild-ai3/src/'+p;
  assert.equal(blob(file),manifest.ai3_30_source_blobs[file],file);
 }
 assert.match(content('packages/rebuild-ai3/src/queue-transport.ts'),/msg\.ack\(\)/);
 assert.match(content('packages/rebuild-ai3/src/queue-consumer.ts'),/ack_safe:/);
 assert.match(content('packages/rebuild-ai3/src/d1-audit-adapter.ts'),/await db\.batch\(/);
 assert.match(content('packages/rebuild-ai3/src/auth-deletion-battery-consumer.ts'),/enabled=deps\.enabled===true/);
 assert.match(content('packages/rebuild-ai3/src/auth-deletion-battery-consumer.ts'),/BATTERY_DELETE_SQL\.apply/);
 assert.match(content('packages/rebuild-ai3/src/battery-settlement-d1.ts'),/db\.batch\(/);
 assert.match(content('packages/rebuild-ai3/src/anonymous-appeals.ts'),/store\.atomicCreate\(/);
});
test('AI3 promotion 04: blocked release manifest and Q115 not Q104/Q119 auto purge',()=>{
 const file='docs/release-readiness/release-readiness.v0.json';
 assert.equal(blob(file),manifest.entry.find(x=>x.path===file).sha);
 const r=JSON.parse(content(file));
 assert.equal(r.gates.length,11);
 for(const g of r.gates){assert.equal(g.status,'blocked');assert.deepEqual(g.evidence,[]);assert.equal(g.verified_by,null);assert.equal(g.approval_record_url,null)}
 assert.equal(r.release_authorization.granted,false);
 assert.equal(r.deployment_automation.enabled,false);
 assert.equal(r.deployment_automation.can_auto_deploy,false);
 const r15=content('packages/rebuild-ai3/src/audit-retention.ts');
 assert.match(r15,/AUTOMATED_AUDIT_PURGE_ENABLED=false/);
 assert.match(r15,/purge_permitted:false/);
 const rec=content('packages/rebuild-ai3/src/recovery-guard.ts');
 assert.match(rec,/RESTORE_MUTATION_ALLOWED\s*=\s*false/);
 assert.match(rec,/may_restore:false/);
});
test('AI3 promotion 05: main workflow has conditional staging deploy; production lacks release-readiness guard',()=>{
 const stage=content('.github/workflows/starry-ci.yml');
 const prod=content('.github/workflows/starry-production.yml');
 assert.match(stage,/STARRY_STAGING_ENABLED/);
 assert.match(stage,/github\.ref == 'refs\/heads\/main'/);
 assert.match(stage,/wrangler deploy --config apps\/api\/wrangler.toml --env staging/);
 assert.match(prod,/workflow_dispatch/);
 assert.match(prod,/STARRY_PRODUCTION_ENABLED/);
 assert.match(prod,/wrangler deploy --config apps\/api\/wrangler.toml --env production/);
 assert.doesNotMatch(prod,/check-release-readiness\.mjs|--assert-blocked/);
 assert.equal(manifest.merge_deploy.ai3_runtime_activation,'DENY');
 assert.equal(manifest.flags.may_owner_merge,false);
 assert.equal(manifest.flags.may_owner_deploy,false);
});
