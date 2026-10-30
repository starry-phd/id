import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveInertStagingCandidate} from '../src/inert-staging-scope.ts';
const origin='https://staging.example.invalid';
const req=(path,method='GET',headers={})=>new Request(origin+path,{method,headers});
test('UP07 staging exact GET contract is reviewed but not dispatchable or authenticated',()=>{
 const d=resolveInertStagingCandidate(req('/v1/starry-id/members/me'),'staging');
 assert.deepEqual(d,{kind:'reserved_inert',dispatchable:false,
   auth:'starry-session',port:'STARRY_SESSION_DB'});
});
test('UP07 denied environments, aliases, methods, token spoof and query do not register member endpoint',()=>{
 for(const env of ['production','development','preview','']){
   assert.equal(resolveInertStagingCandidate(req('/v1/starry-id/members/me'),env).kind,'not_found');
 }
 for(const request of [req('/v1/member/me'),req('/v1/profile'),
   req('/v1/starry-id/members/me?user_id=x'),req('/v1/starry-id/members/me','POST'),
   req('/v1/starry-id/members/me','GET',{authorization:'Bearer synthetic'}),
   req('/v1/starry-id/members/me','GET',{cookie:'sid=test'})]){
   assert.equal(resolveInertStagingCandidate(request,'staging').kind,'not_found');
 }
});
