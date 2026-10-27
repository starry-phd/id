/**
 * AI-4 Starry staged access policy candidate. This is an INTERNAL, read-only
 * evaluation contract, NOT a live Worker route and NOT an authorization service.
 * The current G00–G10 verdict is all BLOCKED; caller fields cannot change it.
 * Q124 kill switches are AI-proposed pending Gate, not owner-approved rollout.
 */
export const POLICY_REVISION = 'starry-rollout.v0-draft' as const;
export const RELEASE_AUTHORIZED = false as const;
export const STARRY_SERVICE_SCOPE = Object.freeze({
  brand_id:'starry' as const, app_id:'starry-id' as const,
  environments:Object.freeze(['development','staging'] as const),
  standalone_store_app:false as const,
  advertisements_enabled:false as const,
  cross_brand_sync_enabled:false as const,
});
export const STAGE_ORDER = Object.freeze(['identity','battery','billing'] as const);
export type Stage = typeof STAGE_ORDER[number];
export type Operation = 'public_health'|'identity'|'battery'|'billing'|'admin'|'cross_brand';
export type AccessDecision = Readonly<{
  allowed: boolean;
  reason: 'PUBLIC_LIVENESS_ONLY'|'INVALID_CONTEXT'|'APP_OR_BRAND_DENIED'|
    'ENVIRONMENT_DENIED'|'CROSS_BRAND_DISABLED'|'RELEASE_GATE_BLOCKED';
  gate:'blocked'; verified_identity:false; live_deployment:false;
}>;
const decision=(allowed:boolean,reason:AccessDecision['reason']):AccessDecision=>
 Object.freeze({allowed,reason,gate:'blocked' as const,
   verified_identity:false as const,live_deployment:false as const});
const OWN_KEYS = new Set(['brand_id','app_id','environment','operation','auth_service_available']);
function data(v:unknown):v is Record<string,unknown>{
  if(!v||typeof v!=='object')return false;
  try {
    if(Array.isArray(v))return false;
    const proto=Object.getPrototypeOf(v);
    if(proto!==Object.prototype&&proto!==null)return false;
    const keys=Reflect.ownKeys(v);
    return keys.length===OWN_KEYS.size&&keys.every(k=>{
      if(typeof k!=='string'||!OWN_KEYS.has(k))return false;
      const d=Object.getOwnPropertyDescriptor(v,k);
      return !!d&&d.enumerable===true&&'value' in d;
    });
  } catch {return false;}
}
/**
 * No client-provided release flags, admin claims, identities, regions or Kill
 * Switch states are accepted. Even the "allowed" result is ONLY for *public*
 * process liveness (and does not mean any real Worker deployment).
 */
export function inspectStarryAccess(input:unknown):AccessDecision{
  if(!data(input)||typeof input.auth_service_available!=='boolean'
    ||!['public_health','identity','battery','billing','admin','cross_brand'].includes(String(input.operation)))
    return decision(false,'INVALID_CONTEXT');
  if(input.brand_id!=='starry'||input.app_id!=='starry-id')
    return decision(false,'APP_OR_BRAND_DENIED');
  if(input.environment!=='development'&&input.environment!=='staging')
    return decision(false,'ENVIRONMENT_DENIED');
  if(input.operation==='cross_brand')return decision(false,'CROSS_BRAND_DISABLED');
  if(input.operation==='public_health')return decision(true,'PUBLIC_LIVENESS_ONLY');
  return decision(false,'RELEASE_GATE_BLOCKED');
}
/** Gate status is an offline planning input, never a credential or release authority. */
export function planStageOrder(input:unknown):Readonly<{
  ready_for_review: readonly Stage[]; blocked:readonly Stage[]; release_authorized:false;
}>{
  if(!input||typeof input!=='object')throw Error('STAGE_INPUT_DENIED');
  let names:(string|symbol)[];
  try{
    if(Array.isArray(input))throw Error('STAGE_INPUT_DENIED');
    if(Object.getPrototypeOf(input)!==Object.prototype)throw Error('STAGE_INPUT_DENIED');
    names=Reflect.ownKeys(input);
  }catch{throw Error('STAGE_INPUT_DENIED');}
  if(names.length!==3||names.some(k=>typeof k!=='string'||!STAGE_ORDER.includes(k as Stage)))
    throw Error('STAGE_INPUT_DENIED');
  const states=input as Record<string,unknown>;
  const values:('offline_pass'|'blocked')[]=[];
  for(const k of STAGE_ORDER){
    const d=Object.getOwnPropertyDescriptor(states,k);
    if(!d||!d.enumerable||!('value' in d)
      ||(d.value!=='offline_pass'&&d.value!=='blocked'))throw Error('STAGE_INPUT_DENIED');
    values.push(d.value as 'offline_pass'|'blocked');
  }
  const ready:Stage[]=[];const blocked:Stage[]=[];
  let predecessorPass=true;
  STAGE_ORDER.forEach((stage,i)=>{
    // Billing cannot be review-ready until ID and Battery predecessors
    // have at least finished their *offline* checks. Never live approval.
    if(values[i]==='offline_pass'&&predecessorPass)ready.push(stage);
    else blocked.push(stage);
    predecessorPass=predecessorPass&&values[i]==='offline_pass';
  });
  return Object.freeze({ready_for_review:Object.freeze(ready),blocked:Object.freeze(blocked),
    release_authorized:false as const});
}
