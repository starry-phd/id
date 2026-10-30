import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createM1SessionBoundMemberPorts,M1_MEMBER_PORTS_LIVE_ENABLED,
} from '../src/m1-session-bound-member-ports.ts';
import {M2DeletionClientError} from '../../../packages/sdk/src/m2-local-deletion-request-client.ts';

const baseUrl='https://staging.starry.invalid';
const make=(extra={})=>createM1SessionBoundMemberPorts({
 appId:'starry-id',environment:'staging',baseUrl,
 getSessionBearer:async()=> 'a'.repeat(48),
 ...extra,
});

test('M1 source-only mobile ports are OFF without credential reads or HTTP',async()=>{
 let reads=0,network=0;
 const ports=make({
  getSessionBearer:async()=>{reads++;throw Error('PRIVATE_AUTH_OWNER');},
  fetchImpl:async()=>{network++;throw Error('PRIVATE_HTTP');},
 });
 assert.equal(ports.live_enabled,false);
 assert.equal(M1_MEMBER_PORTS_LIVE_ENABLED,false);
 assert.equal(ports.source_only,true);
 assert.equal(ports.profile.live_enabled,false);
 await assert.rejects(ports.profile.getSelf(),/STARRY_SELF_DISABLED/);
 await assert.rejects(ports.profile.patchSelf(1,{display_name:'Safe'}),/STARRY_SELF_DISABLED/);
 await assert.rejects(ports.profile.logout(),/STARRY_SELF_DISABLED/);
 await assert.rejects(ports.deletion.getStatus(),
  e=>e instanceof M2DeletionClientError&&e.code==='DISABLED');
 await assert.rejects(ports.deletion.requestDeletion(),
  e=>e instanceof M2DeletionClientError&&e.code==='DISABLED');
 assert.equal(reads,0);
 assert.equal(network,0);
});

test('M1 mobile port owner denies non-Starry or mutable origins before using credentials',()=>{
 for(const cfg of [
  {appId:'hglobal-id'}, {environment:'production'},
  {environment:'development'}, {baseUrl:'http://staging.starry.invalid'},
  {baseUrl:'https://guest:pw@staging.starry.invalid'},
  {baseUrl:baseUrl+'/v1'}, {baseUrl:baseUrl+'?session=secret'},
  {baseUrl:baseUrl+'#fragment'}, {getSessionBearer:null},
 ])assert.throws(()=>make(cfg),/M1_MEMBER_PORTS_(?:SCOPE|ORIGIN)_DENIED/);
});

test('M1 port owner pins the provided Auth callback once rather than trusting later DI mutation',async()=>{
 let original=0,forged=0;
 const config={
  enabled:true,appId:'starry-id',environment:'staging',baseUrl,
  getSessionBearer:async()=>{original++;return null;},
  fetchImpl:async()=>{forged++;throw Error('SHOULD_NOT_FETCH');},
 };
 const ports=createM1SessionBoundMemberPorts(config);
 config.getSessionBearer=async()=>{forged++;return 'a'.repeat(48);};
 await assert.rejects(ports.profile.getSelf(),/STARRY_SELF_SESSION_REQUIRED/);
 await assert.rejects(ports.deletion.getStatus(),
  e=>e instanceof M2DeletionClientError&&e.code==='SESSION_REQUIRED');
 assert.equal(original,2);
 assert.equal(forged,0);
});
