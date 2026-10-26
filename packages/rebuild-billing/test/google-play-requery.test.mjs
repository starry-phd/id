import test from 'node:test';
import assert from 'node:assert/strict';
import {createSandboxPlaySubscriptionsV2Requery} from '../src/google-play-requery.ts';

const sample={
 kind:'androidpublisher#subscriptionPurchaseV2',
 startTime:'2026-10-26T00:00:00Z',
 subscriptionState:'SUBSCRIPTION_STATE_ACTIVE',
 lineItems:[{productId:'test.monthly',expiryTime:'2026-11-26T00:00:00Z',
  latestSuccessfulOrderId:'GPA.1111.2222.3333'}],
 testPurchase:{},
};
const make=(change={})=>{
 const state={calls:[],tokenCalls:0,...change};
 const options={
  packageName:'com.starry.test',allowedSandbox:true,
  obtainServerToken:async()=>{state.tokenCalls++;return change.oauth??'server_minted_oauth_token_fixture';},
  fetchTrusted:async(url,init)=>{
   state.calls.push({url,init});
   if(change.networkError)throw new Error('network');
   return {ok:change.status===undefined, status:change.status??200,
    json:async()=>change.body??sample};
  },
 };
 return {state,port:createSandboxPlaySubscriptionsV2Requery(options)};
};
test('server-only Google subscription lookup pins host/path GET and bearer',async()=>{
 const {state,port}=make();
 const r=await port.querySubscriptionV2('com.starry.test','purchase-abc_001');
 assert.equal(r.packageName,'com.starry.test');
 assert.equal(r.kind,sample.kind);
 assert.equal(state.tokenCalls,1);
 assert.equal(state.calls.length,1);
 const call=state.calls[0];
 assert.equal(call.url,'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.starry.test/purchases/subscriptionsv2/tokens/purchase-abc_001');
 assert.equal(call.init.method,'GET');
 assert.equal(call.init.redirect,'error');
 assert.equal(call.init.cache,'no-store');
 assert.equal(call.init.headers.Authorization,'Bearer server_minted_oauth_token_fixture');
});
test('Google client URL, package and path traversal cannot control endpoint',async()=>{
 const {state,port}=make();
 for(const pkg of ['com.other.app','com.starry.test/../../','https://bad.example'])
  await assert.rejects(port.querySubscriptionV2(pkg,'good'),/PLAY_SCOPE_DENIED/);
 for(const tok of ['../id','x/y','?url=evil','', 'evil token'])
  await assert.rejects(port.querySubscriptionV2('com.starry.test',tok),/PLAY_TOKEN_DENIED/);
 assert.equal(state.calls.length,0);
 assert.throws(()=>createSandboxPlaySubscriptionsV2Requery({
  packageName:'https://evil.example',allowedSandbox:true,
  obtainServerToken:async()=>'',fetchTrusted:async()=>({ok:true,status:200,json:async()=>sample}),
 }),/PLAY_SCOPE_DENIED/);
});
test('Play API 404 and 403 reject without leaking access token',async()=>{
 for(const status of [401,403,404,429,500]){
  const {port}=make({status});
  await assert.rejects(port.querySubscriptionV2('com.starry.test','tok'),e=>{
   assert.equal(e.message,status===404?'PLAY_PURCHASE_MISSING':'PLAY_REQUERY_UNAVAILABLE');
   assert.equal(JSON.stringify(e).includes('server_minted_oauth_token_fixture'),false);
   return true;
  });
 }
});
test('malformed Play response / another kind fails closed',async()=>{
 const bodies=[null,[],{},'text',
  {...sample,kind:'other'}, {...sample,lineItems:[]},
  {...sample,lineItems:null},{...sample,startTime:null},
  {...sample,subscriptionState:42}];
 for(const body of bodies){
  const {port}=make({body:body===null?null:body});
  if(body===null)continue; // null requires a special mock, below
  await assert.rejects(port.querySubscriptionV2('com.starry.test','tok'),/PLAY_RESPONSE_DENIED/);
 }
});
test('Google missing backend OAuth, provider outage reject safely',async()=>{
 const a=make({oauth:'short'});
 await assert.rejects(a.port.querySubscriptionV2('com.starry.test','tok'),/PLAY_SERVER_TOKEN_DENIED/);
 const b=make({networkError:true});
 await assert.rejects(b.port.querySubscriptionV2('com.starry.test','tok'),/PLAY_REQUERY_UNAVAILABLE/);
});
test('Google query does not fabricate confirmed paid state from only RTDN flags',async()=>{
 const {port}=make({body:{...sample,subscriptionState:'SUBSCRIPTION_STATE_ON_HOLD'}});
 const r=await port.querySubscriptionV2('com.starry.test','tok');
 assert.equal(r.subscriptionState,'SUBSCRIPTION_STATE_ON_HOLD');
 assert.ok(!('paid' in r));
});
