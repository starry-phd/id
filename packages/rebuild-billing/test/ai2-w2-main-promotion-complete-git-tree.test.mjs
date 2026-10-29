/**
 * AI-2 W2/P0 MAIN-PROMOTION REVIEW: one-time source-only recursive Git tree check.
 * This test makes a READ-ONLY fetch of exactly the PUBLIC GitHub source refs on
 * this specific review PR only. NO Store/RC API, D1, Queue, migration, grant,
 * deploy, service secrets or paid resources. Other branches/local runs SKIP.
 *
 * Safety: this is NOT a release gate. GitHub main/target ref drift FAILS
 * instead of silently comparing a later commit or a truncated 300-file API.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const MAIN='8be31efb3dfba66755f297b315593e33cdacfe39';
const W2='6ae5c2bc5cbf71db715e7e70b18833c4cd6f8a79';
const REVIEW_BRANCH='ai2/w2-main-promotion-billing-source-audit-20261029';
const enabled=process.env.GITHUB_ACTIONS==='true'
  &&process.env.GITHUB_EVENT_NAME==='pull_request'
  &&process.env.GITHUB_REPOSITORY==='starry-phd/id'
  &&process.env.GITHUB_HEAD_REF===REVIEW_BRANCH;

function git(args,encoding='utf8'){
  return execFileSync('git',args,{
    encoding,timeout:90000,maxBuffer:32*1024*1024,
    stdio:['ignore','pipe','pipe'],
  });
}
function readRecursiveTree(commit){
  const raw=git(['ls-tree','-r','-z','--full-tree',commit],'buffer');
  const out=new Map();
  for(const item of raw.toString('utf8').split('\0')){
    if(!item)continue;
    const tab=item.indexOf('\t');
    assert.ok(tab>0,'GIT_TREE_MALFORMED_RECORD');
    const meta=/^([0-7]{6}) (blob|commit) ([0-9a-f]{40})$/.exec(item.slice(0,tab));
    assert.ok(meta,'GIT_TREE_MALFORMED_SHA_OR_MODE');
    const path=item.slice(tab+1);
    assert.ok(path&&!out.has(path),'GIT_TREE_DUPLICATE_OR_EMPTY_PATH');
    out.set(path,Object.freeze({mode:meta[1],type:meta[2],sha:meta[3]}));
  }
  return out;
}
function manifest(entries){
  return [...entries].sort(([a],[b])=>a<b?-1:a>b?1:0)
    .map(([path,e])=>[path,e.mode,e.type,e.sha].join('\t')).join('\n');
}
test('W2 promotion: full recursive Git-tree blob SHA audit (not 300-file compare API)',{
  skip:enabled?false:'Review-branch GitHub Actions only; local and all other PRs skip without network',
},()=>{
  const remote=git(['remote','get-url','origin']).trim();
  assert.match(remote, /^(?:https:\/\/github\.com\/|git@github\.com:)starry-phd\/id(?:\.git)?$/,
    'PUBLIC_GITHUB_REPOSITORY_REQUIRED');
  // Only GitHub source read; shallow exact refs, no credentials, no Store traffic.
  git(['-c','credential.helper=','fetch','--no-tags','--depth=1','origin',
    '+refs/heads/main:refs/remotes/origin/main',
    '+refs/heads/ai0/w2-four-owner-integrated-20261029:refs/remotes/origin/ai0-w2-source']);
  const actualMain=git(['rev-parse','refs/remotes/origin/main']).trim();
  const actualW2=git(['rev-parse','refs/remotes/origin/ai0-w2-source']).trim();
  assert.equal(actualMain,MAIN,'MAIN_SHA_CHANGED_REVIEW_STALE');
  assert.equal(actualW2,W2,'W2_SHA_CHANGED_REVIEW_STALE');
  assert.equal(git(['cat-file','-t',MAIN]).trim(),'commit');
  assert.equal(git(['cat-file','-t',W2]).trim(),'commit');

  const a=readRecursiveTree(MAIN),b=readRecursiveTree(W2);
  const added=[],removed=[],modified=[],unchanged=[];
  for(const [path,entry] of b){
    const old=a.get(path);
    if(!old){added.push(path);continue;}
    if(old.sha===entry.sha&&old.mode===entry.mode&&old.type===entry.type)
      unchanged.push(path);
    else modified.push(path);
  }
  for(const path of a.keys())if(!b.has(path))removed.push(path);
  const treeShaMain=git(['rev-parse',MAIN+'^{tree}']).trim();
  const treeShaW2=git(['rev-parse',W2+'^{tree}']).trim();
  const digest=x=>createHash('sha256').update(manifest(x)).digest('hex');
  const summary={
    main_commit:MAIN,w2_commit:W2,main_root_tree_sha:treeShaMain,
    w2_root_tree_sha:treeShaW2,main_files:a.size,w2_files:b.size,
    added:added.length,removed:removed.length,modified:modified.length,
    identical_blob_sha_and_mode:unchanged.length,
    main_manifest_sha256:digest(a),w2_manifest_sha256:digest(b),
    api_compare_first_300_NOT_USED:true,
  };
  console.log('AI2_FULL_RECURSIVE_TREE_SUMMARY '+JSON.stringify(summary));
  console.log('AI2_FULL_RECURSIVE_TREE_CHANGED_PATHS '+JSON.stringify({
    added,removed,modified,
  }));
  // Complete 846-entry path / mode / type / object-SHA record, in GitHub logs;
  // not merely a filename count, root-tree SHA or a compare-API preview.
  const records=[...b].sort(([p],[q])=>p<q?-1:p>q?1:0)
    .map(([path,e])=>({path,mode:e.mode,type:e.type,blob_sha:e.sha}));
  for(let i=0;i<records.length;i+=100){
    console.log('AI2_FULL_RECURSIVE_TREE_BLOB_MANIFEST_'+
      String(Math.floor(i/100)+1).padStart(2,'0')+' '+JSON.stringify(records.slice(i,i+100)));
  }
  assert.equal(a.size,18,'EXPECTED_MAIN_18_OBJECTS');
  assert.equal(b.size,846,'EXPECTED_W2_846_OBJECTS');
  assert.equal(added.length,828,'EXPECTED_828_ADDED');
  assert.equal(removed.length,0,'NO_OLD_FILES_REMOVED');
  assert.equal(modified.length,0,'NO_OLD_BLOB_SHA_OR_MODE_CHANGED');
  assert.equal(unchanged.length,a.size,'ALL_MAIN_FILES_BYTE_AND_MODE_PRESERVED');
});
