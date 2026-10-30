/**
 * AI-1 M2 receipt E2E on real Miniflare5/workerd local D1 SQLite authority.
 * Test-only bundle routes do not exist in the app Worker or live staging.
 * Signing key created inside isolated workerd, NEVER exposed by this test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath,URL} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {
 M2_DELETE_REQUEST_PATH,M2_DELETE_CONFIRM_PATH,M2_DELETE_STATUS_PATH,
 FIRST_CONFIRMATION,SECOND_CONFIRMATION,
} from '../src/m2-local-deletion-request.ts';

const origin='https://local.starry.invalid';
const NOW=1793000000;
const dbId='98765432-aaaa-4bbb-8ccc-123456789abc';
const schemas=[
 '../schema/001_starry_identity.DRAFT.sql',
 '../schema/002_m1_local_oauth_attempts.DRAFT.sql',
 '../schema/003_m2_local_member_self_mutations.DRAFT.sql',
 '../schema/004_m2_local_deletion_request_receipt.DRAFT.sql',
];
function workerSource(){
 const scope={brand_id:'starry',app_id:'starry-id',environment:'staging'};
 return [
  "import {createM2LocalDeletionRequestHandler} from './m2-local-deletion-request.ts';",
  "import {signServerSession} from './session-crypto.ts';",
  "const NOW="+JSON.stringify(NOW)+";",
  "const origin="+JSON.stringify(origin)+";",
  "const scope="+JSON.stringify(scope)+";",
  "let instance=null;",
  "async function initialize(env){",
  " const key=await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);",
  " const handler=createM2LocalDeletionRequestHandler({",
  "  enabled:true,serverScope:scope,expectedOrigin:origin,authDb:env.AUTH_DB,",
  "  getVerificationKey:async kid=>kid==='fixture-hmac'?key:null,now:()=>NOW,",
  " });",
  " return {key,handler};",
  "}",
  "async function current(env){return await (instance??=(initialize(env)));}",
  "export default {async fetch(req,env){",
  " const u=new URL(req.url);",
  " const app=await current(env);",
  " // THIS synthetic driver is bundled dynamically by this test ONLY.",
  " if(req.method==='POST'&&u.pathname==='/__fixture/create-member-session'){",
  "  const member=u.searchParams.get('member')||'u1';",
  "  if(member!=='u1'&&member!=='u2')return new Response(null,{status:404});",
  "  const session=member==='u1'?'session-1':'session-2';",
  "  const sub=member==='u1'?'subject-1':'subject-2';",
  "  const bearer=await signServerSession({...scope,provider:'google',",
  "   provider_subject:sub,s_user_id:member,session_id:session,auth_version:3,",
  "   issued_at:NOW,expires_at:NOW+300,key_id:'fixture-hmac'},",
  "   scope,NOW,{kid:'fixture-hmac',key:app.key});",
  "  return Response.json({bearer},{headers:{'cache-control':'no-store'}});",
  " }",
  " const local=new Request(req.url,req);",
  " local.headers.delete('host');",
  " return app.handler.handle(local);",
  "}};",
 ].join('\n');
}
async function withD1(callback){
 const bundle=await build({
  stdin:{contents:workerSource(),
   resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),
   sourcefile:'ai1-m2-receipt-local-workerd-fixture.ts',loader:'ts'},
  bundle:true,platform:'browser',format:'esm',target:'es2022',
  write:false,logLevel:'silent',
 });
 const mf=new Miniflare({workers:[{config:{
  name:'ai1-delete-receipt-local-only',
  compatibilityDate:'2026-10-24',
  manifest:{mainModule:'index.js',modules:{
   'index.js':{type:'esm',contents:bundle.outputFiles[0].text},
  }},env:{AUTH_DB:{type:'d1',id:dbId}},
 }}]});
 try{
  const db=await mf.getD1Database('AUTH_DB');
  for(const path of schemas){
   const sql=readFileSync(new URL(path,import.meta.url),'utf8')
    .replace(/^\s*--[^\n]*$/gm,'').trim();
   // D1.exec cannot run comment-only lines, and each trigger's BEGIN..END
   // must remain a single statement despite internal ';'.
   const statements=sql.split(/;\s*(?=PRAGMA|CREATE|$)/gi)
    .map(v=>v.trim()).filter(Boolean);
   for(const statement of statements){
    if(/^PRAGMA foreign_keys\s*=\s*ON/i.test(statement))continue;
    await db.exec(statement.replace(/\s*\n\s*/g,' '));
   }
  }
  for(const [member,sub,session] of [
   ['u1','subject-1','session-1'],['u2','subject-2','session-2'],
  ]){
   await db.prepare('INSERT INTO starry_members VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(member,'active',3,1,'Fixture private name',0,0,NOW,NOW).run();
   await db.prepare('INSERT INTO starry_identities VALUES(?,?,?)')
    .bind('google',sub,member).run();
   await db.prepare('INSERT INTO starry_sessions(session_id,s_user_id,app_id,environment,auth_version,refresh_hash,expires_at) VALUES(?,?,?,?,?,?,?)')
    .bind(session,member,'starry-id','staging',3,'hash-'+session.padEnd(60,'r'),NOW+300).run();
  }
  await callback({mf,db});
 }finally{await mf.dispose();}
}
const dispatch=(mf,path,init={})=>mf.dispatchFetch(origin+path,init);
async function issue(mf,member='u1'){
 const response=await dispatch(mf,'/__fixture/create-member-session?member='+member,{method:'POST'});
 assert.equal(response.status,200);
 const value=await response.json();
 assert.match(value.bearer,/^v1\./);
 return value.bearer;
}
function authorized(token,method='GET',body){
 return {method,
  headers:{
   authorization:'Bearer '+token,
   ...(body?{'content-type':'application/json'}:{}),
  },
  ...(body?{body:JSON.stringify(body)}:{}),
 };
}

test('real workerd+D1 first/second confirmation, persisted pending+atomic audit, no false physical deletion',async()=>{
 await withD1(async({mf,db})=>{
  const token=await issue(mf);
  const none=await dispatch(mf,M2_DELETE_STATUS_PATH,authorized(token));
  assert.equal(none.status,404);
  const first=await dispatch(mf,M2_DELETE_REQUEST_PATH,
   authorized(token,'POST',{confirmation:FIRST_CONFIRMATION}));
  assert.equal(first.status,202);
  const receipt=await first.json();
  assert.equal(receipt.status,'awaiting_second_confirmation');
  assert.equal(receipt.physical_erasure_completed,false);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM starry_m2_deletion_request_audit').first()).n,1);
  const second=await dispatch(mf,M2_DELETE_CONFIRM_PATH,
   authorized(token,'POST',{confirmation:SECOND_CONFIRMATION,request_id:receipt.request_id}));
  assert.equal(second.status,202);
  const confirmed=await second.json();
  assert.equal(confirmed.status,'pending_processing');
  assert.equal(confirmed.second_confirmed_at,NOW);
  assert.equal(confirmed.execution_authorized,false);
  const fetched=await dispatch(mf,M2_DELETE_STATUS_PATH,authorized(token));
  assert.equal(fetched.status,200);
  assert.equal((await fetched.json()).status,'pending_processing');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM starry_m2_deletion_requests').first()).n,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM starry_m2_deletion_request_audit').first()).n,2);
  assert.equal((await db.prepare("SELECT status FROM starry_members WHERE s_user_id='u1'").first()).status,'active');
  assert.equal((await db.prepare("SELECT revoked_at FROM starry_sessions WHERE session_id='session-1'").first()).revoked_at,null);
  assert.equal((await db.prepare("SELECT display_name FROM starry_members WHERE s_user_id='u1'").first()).display_name,'Fixture private name');
  const retries=await dispatch(mf,M2_DELETE_CONFIRM_PATH,
   authorized(token,'POST',{confirmation:SECOND_CONFIRMATION,request_id:receipt.request_id}));
  assert.equal(retries.status,202);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM starry_m2_deletion_request_audit').first()).n,2);
 });
});

test('real workerd+D1 concurrency/other-user/session revocation and audit failure never creates extra active requests',async()=>{
 await withD1(async({mf,db})=>{
  const token=await issue(mf,'u1'),other=await issue(mf,'u2');
  const first=await Promise.all(Array.from({length:8},
   ()=>dispatch(mf,M2_DELETE_REQUEST_PATH,authorized(token,'POST',{confirmation:FIRST_CONFIRMATION}))));
  assert.ok(first.every(r=>r.status===202));
  const ids=await Promise.all(first.map(async r=>(await r.json()).request_id));
  assert.equal(new Set(ids).size,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM starry_m2_deletion_requests').first()).n,1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM starry_m2_deletion_request_audit').first()).n,1);
  const wrong=await dispatch(mf,M2_DELETE_CONFIRM_PATH,authorized(other,'POST',{
   confirmation:SECOND_CONFIRMATION,request_id:ids[0],
  }));
  assert.equal(wrong.status,404);
  assert.equal((await dispatch(mf,M2_DELETE_STATUS_PATH,authorized(other))).status,404);
  await db.prepare("UPDATE starry_sessions SET revoked_at=? WHERE session_id='session-1'")
   .bind(NOW).run();
  assert.equal((await dispatch(mf,M2_DELETE_CONFIRM_PATH,authorized(token,'POST',{
   confirmation:SECOND_CONFIRMATION,request_id:ids[0],
  }))).status,401);
  assert.equal((await db.prepare('SELECT status FROM starry_m2_deletion_requests').first()).status,
   'awaiting_second_confirmation');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM starry_m2_deletion_request_audit').first()).n,1);
 });
});

test('real workerd D1 audit trigger aborts confirmation after source UPDATE and keeps awaiting state',async()=>{
 await withD1(async({mf,db})=>{
  const token=await issue(mf);
  const first=await (await dispatch(mf,M2_DELETE_REQUEST_PATH,
   authorized(token,'POST',{confirmation:FIRST_CONFIRMATION}))).json();
  await db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON starry_m2_deletion_request_audit BEGIN SELECT RAISE(ABORT,'PRIVATE_AUDIT_DENIAL'); END");
  const second=await dispatch(mf,M2_DELETE_CONFIRM_PATH,authorized(token,'POST',{
   confirmation:SECOND_CONFIRMATION,request_id:first.request_id,
  }));
  assert.equal(second.status,503);
  assert.equal((await db.prepare('SELECT status FROM starry_m2_deletion_requests').first()).status,
   'awaiting_second_confirmation');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM starry_m2_deletion_request_audit').first()).n,1);
  assert.equal((await second.text()).includes('PRIVATE_'),false);
 });
});
