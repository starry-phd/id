import test from 'node:test';
import assert from 'node:assert/strict';
import {BATTERY_D1_SETTLEMENT_LIVE,createOfflineBatterySettlementD1} from '../src/battery-settlement-d1.ts';
const scope={brand_id:'starry',environment:'staging'};
const q={member_ref:'member_1',task_ref:'task_1',kind:'commit',price:7,
 policy_version:1,expected_version:3,expected_balance:-2,
 hold_expires_ms:181000,now_ms:180999};
function dbFixture(fault=''){
 const calls=[],checks=[];
 const db={prepare(sql){
  const x={sql,values:[],bind(...v){this.values=v;return this;}};
  calls.push(x);return x;
 },async batch(stmts){
  checks.push(stmts);
  if(fault==='throw')throw Error('D1 DOWN');
  const d=q.kind==='commit'?0:q.price;
  const bal=q.expected_balance+d;
  const status=q.kind==='commit'?'committed':q.kind==='release'?'released':'expired';
  const out=Array.from({length:10},()=>({success:true,meta:{changes:1},results:[]}));
  out[9].meta.changes=3;
  out[6].results=[{version:4,balance:bal}];
  out[7].results=[{status,price:7,expires_ms:181000}];
  out[8].results=[{kind:q.kind,delta:d,balance_after:bal,revision:4}];
  if(fault==='wallet_cas')out[0].meta.changes=0;
  if(fault==='hold_cas')out[2].meta.changes=0;
  if(fault==='ledger_write')out[4].meta.changes=0;
  if(fault==='wrong_readback')out[6].results[0].balance=999;
  if(fault==='cleanup')out[9].meta.changes=1;
  if(fault==='missing_row')out[7].results=[];
  return out;
 }};
 return {db,calls,checks};
}
const authority=(yes=true)=>({approve:async()=>yes});
const create=(fixture,auth=authority())=>createOfflineBatterySettlementD1(fixture.db,scope,auth);
test('R10 purely offline, no real D1 settlement',()=>{
 assert.equal(BATTERY_D1_SETTLEMENT_LIVE,false);
 assert.throws(()=>createOfflineBatterySettlementD1({}, {...scope,environment:'production'},authority()),/SCOPE_DENIED/);
 assert.throws(()=>createOfflineBatterySettlementD1({}, {...scope,brand_id:'hglobal'},authority()),/SCOPE_DENIED/);
});
test('R10 commit held wallet/hold/journal in ONE batch plus scratch guard',async()=>{
 const f=dbFixture(),r=await create(f).settle(q);
 assert.deepEqual(r,{outcome:'committed',wallet_version:4,live:false});
 assert.equal(f.checks.length,1);assert.equal(f.checks[0].length,10);
 assert.match(f.calls[0].sql,/WHERE brand_id=\?/);
 assert.match(f.calls[0].sql,/AND revoked=0/);
 assert.match(f.calls[0].sql,/expires_ms<=\?/);
 assert.match(f.calls[1].sql,/changes\(\)=1/);
 assert.match(f.calls[2].sql,/UPDATE ai3_battery_hold/);
 assert.match(f.calls[4].sql,/INSERT INTO ai3_battery_journal/);
 assert.match(f.calls[9].sql,/DELETE FROM ai3_battery_atomic_assert/);
 assert.equal(f.calls[0].values[0],-2); // no double debit on commit
});
test('R10 success cannot settle after 3min boundary, release/expiry semantics',async()=>{
 const f=dbFixture();
 for(const changed of [
  {...q,now_ms:181000},{...q,kind:'release',now_ms:181000},
  {...q,kind:'expire',now_ms:180999},
 ])assert.equal((await create(f).settle(changed)).outcome,'blocked');
 assert.equal(f.checks.length,0);
});
test('R10 fail closed on forged hidden, extra or getter-provided fields',async()=>{
 const f=dbFixture(),adapter=create(f);
 const hidden={...q};Object.defineProperty(hidden,'client_success',{value:true,enumerable:false});
 const access={...q};Object.defineProperty(access,'member_ref',{get(){return 'member_1'},enumerable:true});
 const revoked=Proxy.revocable(q,{});revoked.revoke();
 for(const bad of [hidden,access,revoked.proxy,{...q,entitlement:true},
  {...q,member_ref:'hglobal/member'}, {...q,price:0},{...q,expected_version:-1},
  {...q,now_ms:NaN}]){
  assert.equal((await adapter.settle(bad)).outcome,'blocked');
 }
 assert.equal(f.checks.length,0);
});
test('R10 trusted authority must approve before DB prepare and transaction',async()=>{
 const f=dbFixture();
 assert.equal((await create(f,authority(false)).settle(q)).outcome,'blocked');
 assert.equal(f.calls.length,0);assert.equal(f.checks.length,0);
});
test('R10 CAS or journal/guard receipt fail-closed, never claim success',async()=>{
 for(const fault of ['throw','wallet_cas','hold_cas','ledger_write','wrong_readback','cleanup','missing_row']){
  const f=dbFixture(fault);
  assert.equal((await create(f).settle(q)).outcome,'blocked',fault);
 }
});
test('R10 no client-supplied alternate brand, expiry or amount overflow',async()=>{
 const f=dbFixture(),a=create(f);
 for(const altered of [{...q,price:Number.MAX_SAFE_INTEGER,kind:'release',now_ms:180999},
  {...q,expected_balance:Number.MAX_SAFE_INTEGER,kind:'release',now_ms:180999},
  {...q,expected_version:Number.MAX_SAFE_INTEGER},
  {...q,hold_expires_ms:1000,now_ms:2000,kind:'commit'}]){
  assert.equal((await a.settle(altered)).outcome,'blocked');
 }
});
test('R10 reject invalid ports or unavailable trusted source',async()=>{
 const f=dbFixture();
 assert.throws(()=>createOfflineBatterySettlementD1(null,scope,authority()),/PORT_MISSING/);
 const down={approve:async()=>{throw Error('AUTH OUTAGE')}};
 assert.equal((await create(f,down).settle(q)).outcome,'blocked');
 assert.equal(f.calls.length,0);
});
