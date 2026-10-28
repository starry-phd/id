import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createSbaseOfflineBillingClient,SBASE_BILLING_CONTRACT,
 SBASE_BILLING_LIVE,SBASE_BATTERY_PURCHASABLE,
 SBASE_STORE_PAYMENTS_ENABLED} from '../src/sbase-billing-client-candidate.ts';

const ref=c=>'r_'+c.repeat(64),mem=c=>'m_'+c.repeat(64);
const scope={brand_id:'starry',environment:'staging',app_id:'starry.app_a',
 platform:'ios',store_app_ref:ref('a')};
const product={productKey:'premium.monthly',app_id:scope.app_id,
 store_app_ref:scope.store_app_ref,store_sku_ref:ref('b'),
 platform:'ios',intent:'subscription_monthly',
 official_product_approved:false};
const fields=['brand_id','environment','app_id','platform','store_app_ref',
 'store_sku_ref','productKey','member_digest','transaction_ref','event_ref',
 'source_version','state','store_signature_verified',
 'identity_mapping_approved'];
const floorFields=['brand_id','environment','app_id','productKey',
 'transaction_ref','member_digest','source_version',
 'external_witness_verified'];
function setup(options={}){
 const billing=new DatabaseSync(':memory:');
 const floor=new DatabaseSync(':memory:');
 // Tests own these disposable fixtures, NEVER a central Billing D1 migration.
 billing.exec('CREATE TABLE local_candidate (brand_id TEXT,environment TEXT,app_id TEXT,platform TEXT,store_app_ref TEXT,store_sku_ref TEXT,productKey TEXT,member_digest TEXT,transaction_ref TEXT,event_ref TEXT,source_version INTEGER,state TEXT,store_signature_verified INTEGER,identity_mapping_approved INTEGER,PRIMARY KEY(app_id,productKey))');
 floor.exec('CREATE TABLE local_floor (brand_id TEXT,environment TEXT,app_id TEXT,productKey TEXT,transaction_ref TEXT,member_digest TEXT,source_version INTEGER,external_witness_verified INTEGER,PRIMARY KEY(app_id,productKey))');
 const row={...scope,store_sku_ref:product.store_sku_ref,
  productKey:product.productKey,member_digest:mem('c'),transaction_ref:ref('d'),
  event_ref:ref('e'),source_version:12,state:options.state??'active',
  store_signature_verified:false,identity_mapping_approved:false};
 const w={brand_id:'starry',environment:'staging',app_id:scope.app_id,
  productKey:product.productKey,transaction_ref:row.transaction_ref,
  member_digest:row.member_digest,source_version:12,
  external_witness_verified:false};
 if(options.snapshot!==false) billing.prepare(
  'INSERT INTO local_candidate VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
 ).run(...fields.map(k=>Number.isInteger(row[k])||typeof row[k]==='boolean'
  ?Number(row[k]):row[k]));
 if(options.witness!==false) floor.prepare(
  'INSERT INTO local_floor VALUES (?,?,?,?,?,?,?,?)'
 ).run(...floorFields.map(k=>Number.isInteger(w[k])||typeof w[k]==='boolean'
  ?Number(w[k]):w[k]));
 const counts={policy:0,billing:0,floor:0};
 const ports={
  async lawfulProcessingAndRetention(){
   counts.policy++;
   return options.policy!==false&&!(options.policyDrift&&counts.policy>1);
  },
  async readCandidate(){
   counts.billing++;
   if(options.readError)throw Error('local SQLite unavailable');
   const r=billing.prepare('SELECT * FROM local_candidate WHERE app_id=? AND productKey=?')
    .get(scope.app_id,product.productKey);
   if(!r)return null;
   if(options.onRead) options.onRead({billing,floor,counts});
   return {...r,store_signature_verified:Boolean(r.store_signature_verified),
    identity_mapping_approved:Boolean(r.identity_mapping_approved)};
  },
  async readFloor(){
   counts.floor++;
   const r=floor.prepare('SELECT * FROM local_floor WHERE app_id=? AND productKey=?')
    .get(scope.app_id,product.productKey);
   return r?{...r,external_witness_verified:Boolean(r.external_witness_verified)}:null;
  }
 };
 const make=(x={})=>createSbaseOfflineBillingClient({
  scope,products:[product],ports,enabled:true,...x});
 return {make,counts,billing,floor,ports,product,scope,
  close(){billing.close();floor.close();}};
}
function denies(v){
 assert.equal(v.contract,SBASE_BILLING_CONTRACT);
 assert.equal(v.brand_id,'starry');assert.equal(v.app_id,scope.app_id);
 for(const k of ['official_store_verified','identity_mapping_approved',
  'purchased','subscription_active','lifetime_unlocked','ads_suppressed',
  'can_restore','may_grant','may_regrant','may_ack_queue','may_publish',
  'may_purchase','live'])assert.equal(v[k],false,k);
 const s=JSON.stringify(v);
 for(const raw of [mem('c'),ref('b'),ref('d'),ref('e'),
  'price','NT$','credit-card'])assert.ok(!s.includes(raw));
}
test('SBASE is strictly offline; default disabled has no DB/network reads',async t=>{
 const f=setup();t.after(()=>f.close());
 assert.equal(SBASE_BILLING_LIVE,false);
 assert.equal(SBASE_STORE_PAYMENTS_ENABLED,false);
 assert.equal(SBASE_BATTERY_PURCHASABLE,false);
 const v=await f.make({enabled:false}).getEntitlements('premium.monthly');
 denies(v);assert.equal(v.state,'unavailable');
 assert.deepEqual(f.counts,{policy:0,billing:0,floor:0});
});
test('thin BillingClient declares seven replaceable methods, no live adapters',async t=>{
 const f=setup();t.after(()=>f.close());const b=f.make();
 for(const method of ['purchase','getOfferings','getEntitlements',
  'restorePurchases','identifyUser','logout','observeEntitlementChanges'])
  assert.equal(typeof b[method],'function',method);
 const offerings=await b.getOfferings();assert.equal(offerings.sellable,false);
 assert.equal(offerings.status,'candidate_only');
 assert.equal(offerings.products.length,1);
 assert.equal(offerings.products[0].official_product_approved,false);
 assert.equal((await b.purchase('premium.monthly')).ok,false);
 assert.equal((await b.restorePurchases()).ok,false);
 assert.equal((await b.identifyUser({token:'fake'})).ok,false);
 assert.equal((await b.logout()).ok,false);
 let notified=0;const unsub=b.observeEntitlementChanges(()=>notified++);
 unsub();assert.equal(notified,0);
 assert.equal(f.counts.billing,0);
});
test('free Battery and sticker/top-up explicitly nonpurchasable',async t=>{
 const f=setup();t.after(()=>f.close());const b=f.make();
 for(const key of ['starry.battery.x','battery_topup','電池','legacy.sticker']){
  assert.equal((await b.purchase(key)).reason,'BATTERY_PERMANENTLY_FREE');
  denies(await b.getEntitlements(key));
 }
 assert.equal(f.counts.billing,0);
 assert.throws(()=>f.make({products:[{...product,productKey:'battery.X'}]}));
});
test('unapproved positive Store-like active record cannot remove ads or unlock',async t=>{
 const f=setup();t.after(()=>f.close());
 const v=await f.make().getEntitlements('premium.monthly');
 denies(v);assert.equal(v.state,'unverified');
 assert.equal(v.source,'local_unapproved_only');
 assert.equal(f.counts.billing,2);assert.equal(f.counts.floor,2);
 assert.equal(f.counts.policy,2);
});
test('refunded and revoked local records remain nonauthorizing',async t=>{
 for(const [status,expected] of [['refunded','refund_review_only'],
  ['revoked','revoked']]){
  const f=setup({state:status});t.after(()=>f.close());
  const v=await f.make().getEntitlements('premium.monthly');
  denies(v);assert.equal(v.state,expected);
 }
});
test('expired/grace/hold do not create active subscription or ad removal',async t=>{
 for(const [status,expected] of [['expired','expired'],
  ['grace','unverified'],['hold','unverified']]){
  const f=setup({state:status});t.after(()=>f.close());
  const v=await f.make().getEntitlements('premium.monthly');
  denies(v);assert.equal(v.state,expected);
 }
});
test('no receipt or no independent floor does not grant, even on duplicate calls',async t=>{
 for(const opts of [{snapshot:false},{witness:false}]){
  const f=setup(opts);t.after(()=>f.close());
  for(let i=0;i<2;i++){
   const v=await f.make().getEntitlements('premium.monthly');
   denies(v);assert.equal(v.state,'unverified');
  }
 }
});
test('older Store source version loses to higher independent floor (PITR)',async t=>{
 const f=setup();t.after(()=>f.close());
 f.floor.exec('UPDATE local_floor SET source_version=13');
 denies(await f.make().getEntitlements('premium.monthly'));
 assert.equal((await f.make().getEntitlements('premium.monthly')).reason,
  'SOURCE_VERSION_OR_PITR_DRIFT');
});
test('out-of-order CHARGEBACK then older renewal is not a paid right',async t=>{
 const f=setup({state:'refunded'});t.after(()=>f.close());
 f.billing.exec("UPDATE local_candidate SET state='active', source_version=11");
 const o=await f.make().getEntitlements('premium.monthly');denies(o);
 assert.equal(o.state,'unverified');
});
test('another App, another Store app, wrong brand, platform or SKU rejects',async t=>{
 const f=setup();t.after(()=>f.close());
 const wrong=[
  {...product,app_id:'starry.app_b'},
  {...product,store_app_ref:ref('8')},
  {...product,store_sku_ref:ref('9'),platform:'android'},
 ];
 for(const candidate of wrong){
  assert.throws(()=>f.make({products:[candidate]}));
 }
 assert.deepEqual(f.counts,{policy:0,billing:0,floor:0});
 // A DIFFERENT candidate product for the SAME App is allowed in a
 // technical manifest, but absent official Store receipt it cannot grant.
 const novel={...product,productKey:'premium.yearly',store_sku_ref:ref('9')};
 const v=await f.make({products:[novel]}).getEntitlements('premium.yearly');
 denies(v);assert.equal(v.state,'unverified');
 assert.equal(v.ads_suppressed,false);
 assert.throws(()=>f.make({scope:{...scope,brand_id:'hglobal'}}));
 assert.throws(()=>f.make({scope:{...scope,environment:'production'}}));
 // Only the deliberate same-App novel candidate may invoke protected
 // local Billing read, but it still has no verified entitlement or ads-off.
 assert.equal(f.counts.billing,1);assert.equal(f.counts.floor,0);
});
test('same app cannot register duplicate productKey or Store SKU token',async t=>{
 const f=setup();t.after(()=>f.close());
 assert.throws(()=>f.make({products:[product,{...product}]}));
 assert.throws(()=>f.make({products:[product,{...product,productKey:'premium.yearly'}]}));
});
test('an App B request with an App A productKey never gains any entitlement',async t=>{
 const f=setup();t.after(()=>f.close());
 const v=await f.make().getEntitlements('premium.yearly');
 denies(v);assert.equal(v.state,'blocked');assert.equal(f.counts.billing,0);
});
test('lawful purpose denial blocks BEFORE reading Store/Billing candidates',async t=>{
 const f=setup({policy:false});t.after(()=>f.close());
 const v=await f.make().getEntitlements('premium.monthly');
 denies(v);assert.equal(v.state,'blocked');
 assert.equal(f.counts.billing,0);assert.equal(f.counts.floor,0);
});
test('policy drift after protected reads invalidates the candidate',async t=>{
 const f=setup({policyDrift:true});t.after(()=>f.close());
 const v=await f.make().getEntitlements('premium.monthly');
 denies(v);assert.equal(v.reason,'LAW_CHANGED_AFTER_READ');
 assert.equal(f.counts.billing,1);
});
test('replay/change between two protected reads is rejected',async t=>{
 const f=setup({onRead({billing,counts}){
  if(counts.billing===1)billing.exec(
   "UPDATE local_candidate SET state='refunded'");
 }});t.after(()=>f.close());
 const v=await f.make().getEntitlements('premium.monthly');denies(v);
 assert.equal(v.reason,'SOURCE_CHANGED_AFTER_READ');
});
test('pretending to be official Store + identity authority is rejected',async t=>{
 const f=setup();t.after(()=>f.close());
 f.billing.exec('UPDATE local_candidate SET store_signature_verified=1, identity_mapping_approved=1');
 const v=await f.make().getEntitlements('premium.monthly');
 denies(v);assert.equal(v.reason,'NO_OFFICIAL_STORE_SOURCE');
});
test('malicious accessor, Proxy, bad ports, SQL failure fail closed',async t=>{
 const f=setup({readError:true});t.after(()=>f.close());
 const v=await f.make().getEntitlements('premium.monthly');
 denies(v);assert.equal(v.state,'blocked');
 const malicious=new Proxy(product,{ownKeys(){throw Error('surprise');}});
 assert.throws(()=>f.make({products:[malicious]}));
 const getter=Object.defineProperty({...product},'productKey',{
  enumerable:true,get(){throw Error('getter');}
 });
 assert.throws(()=>f.make({products:[getter]}));
 assert.throws(()=>f.make({ports:{...f.ports,readCandidate:null}}));
});
