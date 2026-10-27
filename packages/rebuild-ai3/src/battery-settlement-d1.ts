/**
 * AI-3 R10: OFFLINE D1-shaped settlement of EXISTING free Battery holds.
 * Requires 0005 + 0008 DRAFT SQLite schemas, NEVER automatically migrated.
 * The 10-statement D1 batch is one database transaction (not across DBs).
 * AI-1 Member + AI-4 committed-task proof are still external unverified Gates.
 */
export const BATTERY_D1_SETTLEMENT_LIVE=false as const;
export type D1Scope=Readonly<{brand_id:'starry';environment:'development'|'staging'}>;
export type SettlementKind='commit'|'release'|'expire';
export type SettlementRequest=Readonly<{
 member_ref:string;task_ref:string;kind:SettlementKind;price:number;
 policy_version:number;expected_version:number;expected_balance:number;
 hold_expires_ms:number;now_ms:number;
}>;
export type AtomicReceipt=Readonly<{outcome:'committed'|'blocked';wallet_version:number|null;live:false}>;
export type SqlValue=string|number|null;
export type SqlStmt=Readonly<{bind:(...values:SqlValue[])=>SqlStmt}>;
export type BatchRow=Readonly<{success:boolean;results?:unknown[];meta?:Readonly<{changes?:number}>}>;
export type D1AtomicPort=Readonly<{
 prepare:(sql:string)=>SqlStmt;
 batch:(stmts:SqlStmt[])=>Promise<BatchRow[]>;
}>;
/** Trusted server-only port. Client data or boolean flags are NOT authoritative. */
export type SettlementAuthority=Readonly<{
 approve:(scope:D1Scope,request:SettlementRequest)=>Promise<boolean>;
}>;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const NUM=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
function object(x:unknown,keys:readonly string[]):x is Record<string,unknown>{
 try{
  if(x===null||typeof x!=='object'||Array.isArray(x))return false;
  const proto=Object.getPrototypeOf(x);
  if(proto!==Object.prototype&&proto!==null)return false;
  const all=Reflect.ownKeys(x);
  return all.length===keys.length&&all.every(k=>{
   if(typeof k!=='string'||!keys.includes(k))return false;
   const d=Object.getOwnPropertyDescriptor(x,k);
   return !!d&&d.enumerable&&'value' in d;
  });
 }catch{return false;}
}
const KEYS=['member_ref','task_ref','kind','price','policy_version','expected_version',
 'expected_balance','hold_expires_ms','now_ms'] as const;
function requestOk(x:unknown):x is SettlementRequest{
 if(!object(x,KEYS))return false;
 return typeof x.member_ref==='string'&&ID.test(x.member_ref)&&
  typeof x.task_ref==='string'&&ID.test(x.task_ref)&&
  ['commit','release','expire'].includes(x.kind as string)&&
  NUM(x.price)&&x.price>0&&NUM(x.policy_version)&&x.policy_version>0&&
  NUM(x.expected_version)&&x.expected_version<Number.MAX_SAFE_INTEGER&&
  typeof x.expected_balance==='number'&&Number.isSafeInteger(x.expected_balance)&&
  NUM(x.hold_expires_ms)&&NUM(x.now_ms)&&
  (x.kind==='expire'?x.now_ms>=x.hold_expires_ms:x.now_ms<x.hold_expires_ms);
}
function one(v:unknown):Record<string,unknown>|null{
 try{
  if(!Array.isArray(v)||v.length!==1)return null;
  const r=v[0];
  if(!r||typeof r!=='object'||Array.isArray(r))return null;
  return r as Record<string,unknown>;
 }catch{return null;}
}
function blocked():AtomicReceipt{
 return Object.freeze({outcome:'blocked',wallet_version:null,live:false});
}
/**
 * "changes()" is read IMMEDIATELY AFTER the preceding guarded UPDATE/INSERT.
 * SQLite CHECK(ok=1) aborts the ENTIRE D1.batch on a 0-row CAS/hold miss.
 * Guard scratch rows are deleted within the same transaction. Fail closed
 * if the batch is not truly transactional or read-back proof is uncertain.
 */
export function createOfflineBatterySettlementD1(db:D1AtomicPort,
 scope:D1Scope,authority:SettlementAuthority){
 if(!object(scope,['brand_id','environment'])||scope.brand_id!=='starry'||
  (scope.environment!=='development'&&scope.environment!=='staging'))
  throw Error('AI3_BATTERY_D1_SCOPE_DENIED');
 if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function'||
  !authority||typeof authority.approve!=='function')
  throw Error('AI3_BATTERY_D1_TRUSTED_PORT_MISSING');
 return Object.freeze({
  async settle(raw:unknown):Promise<AtomicReceipt>{
   if(!requestOk(raw))return blocked();
   const q=raw;
   const delta=q.kind==='commit'?0:q.price;
   const finalBalance=q.expected_balance+delta;
   if(!Number.isSafeInteger(finalBalance))return blocked();
   const revision=q.expected_version+1;
   if(!Number.isSafeInteger(revision))return blocked();
   const status=q.kind==='commit'?'committed':q.kind==='release'?'released':'expired';
   const reason=q.kind==='commit'?'TASK_SUCCEEDED':
    q.kind==='release'?'TASK_FAILED':'TTL_EXPIRED';
   try{
    if(await authority.approve(scope,q)!==true)return blocked();
    // Previous wallet revision and held task must both still be current.
    const a=db.prepare('UPDATE ai3_battery_wallet SET balance=?, '+
     'overdraft_used=CASE WHEN ?>=0 THEN 0 ELSE overdraft_used END, version=version+1 '+
     'WHERE brand_id=? AND member_ref=? AND version=? AND balance=? AND revoked=0 '+
     'AND EXISTS(SELECT 1 FROM ai3_battery_hold WHERE brand_id=? AND member_ref=? '+
     'AND task_ref=? AND status=? AND price=? AND policy_version=? AND expires_ms=? '+
     'AND ((?=? AND expires_ms<=?) OR (?<>? AND expires_ms>?)))'
    ).bind(finalBalance,finalBalance,'starry',q.member_ref,q.expected_version,
     q.expected_balance,'starry',q.member_ref,q.task_ref,'held',
     q.price,q.policy_version,q.hold_expires_ms,q.kind,'expire',q.now_ms,
     q.kind,'expire',q.now_ms);
    const assertSql='INSERT INTO ai3_battery_atomic_assert(ok) VALUES ('+
     'CASE WHEN changes()=1 THEN 1 ELSE 0 END)';
    const check1=db.prepare(assertSql).bind();
    const b=db.prepare('UPDATE ai3_battery_hold SET status=? '+
     'WHERE brand_id=? AND member_ref=? AND task_ref=? AND status=? '+
     'AND price=? AND policy_version=? AND expires_ms=? '+
     'AND EXISTS(SELECT 1 FROM ai3_battery_wallet WHERE brand_id=? AND member_ref=? '+
     'AND version=? AND balance=?)'
    ).bind(status,'starry',q.member_ref,q.task_ref,'held',q.price,q.policy_version,
     q.hold_expires_ms,'starry',q.member_ref,revision,finalBalance);
    const check2=db.prepare(assertSql).bind();
    const c=db.prepare('INSERT INTO ai3_battery_journal '+
     '(brand_id,member_ref,revision,event_ref,kind,delta,balance_after,'+
     'reason_code,policy_version,at_ms) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).bind('starry',q.member_ref,revision,q.task_ref,q.kind,delta,finalBalance,
     reason,q.policy_version,q.now_ms);
    const check3=db.prepare(assertSql).bind();
    const readWallet=db.prepare('SELECT version,balance FROM ai3_battery_wallet '+
     'WHERE brand_id=? AND member_ref=?').bind('starry',q.member_ref);
    const readHold=db.prepare('SELECT status,price,expires_ms FROM ai3_battery_hold '+
     'WHERE brand_id=? AND member_ref=? AND task_ref=?'
    ).bind('starry',q.member_ref,q.task_ref);
    const readJournal=db.prepare('SELECT kind,delta,balance_after,revision FROM '+
     'ai3_battery_journal WHERE brand_id=? AND member_ref=? AND event_ref=? AND revision=?'
    ).bind('starry',q.member_ref,q.task_ref,revision);
    const cleanup=db.prepare('DELETE FROM ai3_battery_atomic_assert').bind();
    const rows=await db.batch([a,check1,b,check2,c,check3,readWallet,readHold,readJournal,cleanup]);
    if(!Array.isArray(rows)||rows.length!==10||rows.some(x=>!x||x.success!==true))
     return blocked();
    if(rows[0].meta?.changes!==1||rows[2].meta?.changes!==1||
       rows[4].meta?.changes!==1||rows[9].meta?.changes!==3)return blocked();
    const w=one(rows[6].results),h=one(rows[7].results),j=one(rows[8].results);
    if(!w||w.version!==revision||w.balance!==finalBalance||
     !h||h.status!==status||h.price!==q.price||h.expires_ms!==q.hold_expires_ms||
     !j||j.kind!==q.kind||j.delta!==delta||j.balance_after!==finalBalance||
     j.revision!==revision)return blocked();
    return Object.freeze({outcome:'committed',wallet_version:revision,live:false});
   }catch{return blocked();}
  }
 });
}
