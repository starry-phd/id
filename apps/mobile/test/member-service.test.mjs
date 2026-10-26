import test from 'node:test';
import assert from 'node:assert/strict';
import {offlineMemberView,loadMemberView} from '../src/member-service.ts';
test('Expo profile always remains disabled while approved Auth flag is false',async()=>{
 let fetchCount=0;
 const client={readSelf:async()=>{fetchCount++;return {s_user_id:'fake'};}};
 assert.deepEqual(await loadMemberView(client),offlineMemberView);
 assert.deepEqual(await loadMemberView(null),offlineMemberView);
 assert.equal(fetchCount,0);
 assert.equal(offlineMemberView.profile,null);
});
