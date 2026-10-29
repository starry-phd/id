/**
 * W3 hard quarantine: offline-only composition of the ORIGINAL AI3 adapters.
 * This is NOT a Worker entry, does not take capabilities/ports from callers,
 * and cannot expose a Cloudflare ACK, D1 write, delivery, erase or restore.
 * A server-owned scope is a prerequisite, never an HTTP-supplied permission.
 */
import {assertScope} from './index.ts';
import type {Scope} from './index.ts';
import {dispatchQueueMessage} from './queue-transport.ts';
import {createAi3AuditD1Store} from './d1-audit-adapter.ts';

export const AI3_W3_LIVE_CAPABLE=false as const;
export type OfflineDisposition=Readonly<{
 status:'disabled'|'offline_review_only'|'offline_blocked';
 live:false;ack_safe:false;real_ack:false;side_effects_performed:false;
}>;

const result=(status:OfflineDisposition['status']):OfflineDisposition=>
 Object.freeze({status,live:false,ack_safe:false,real_ack:false,side_effects_performed:false});

function validScope(scope:unknown):asserts scope is Scope {
 // Do not evaluate getters/prototypes from untrusted objects.
 if(!scope||typeof scope!=='object'||Array.isArray(scope)
   ||Object.getPrototypeOf(scope)!==Object.prototype)
  throw new Error('AI3_W3_SCOPE_DENIED');
 const expected=['app_id','brand_id','environment'];
 const keys=Reflect.ownKeys(scope);
 if(keys.length!==3||keys.some(k=>typeof k!=='string'||!expected.includes(k)))
  throw new Error('AI3_W3_SCOPE_DENIED');
 for(const key of expected){
  const d=Object.getOwnPropertyDescriptor(scope,key);
  if(!d||!('value' in d)||!d.enumerable)throw new Error('AI3_W3_SCOPE_DENIED');
 }
 const s=scope as Scope;
 if(s.brand_id!=='starry'||!['development','staging'].includes(s.environment)
   ||typeof s.app_id!=='string')throw new Error('AI3_W3_SCOPE_DENIED');
 assertScope(s,s);
}

// An intentionally NON-writable D1-shaped adapter: the original adapter is
// reused for offline validation, but neither production nor injected DB exists.
const sealedD1={
 prepare(_sql:string):never{throw new Error('AI3_W3_OFFLINE_NO_DB');},
 batch(_statements:never[]):Promise<never>{throw new Error('AI3_W3_OFFLINE_NO_DB');},
};

/**
 * No db/msg/consumer/DLQ/send/erase/restore port parameter on purpose.
 * enableOfflineTest is exactly true ONLY for explicit non-production tests;
 * it never provides Live permission, including for self-issued proofs.
 */
export function createAi3OfflineOnlyFactory(
 serverScope:unknown,options:Readonly<{enableOfflineTest?:boolean}>={},
){
 validScope(serverScope);
 if(!options||typeof options!=='object'||Array.isArray(options)
   ||Object.getPrototypeOf(options)!==Object.prototype
   ||Reflect.ownKeys(options).some(k=>k!=='enableOfflineTest')
   ||(Object.hasOwn(options,'enableOfflineTest')
     &&Object.getOwnPropertyDescriptor(options,'enableOfflineTest')?.value!==true
     &&Object.getOwnPropertyDescriptor(options,'enableOfflineTest')?.value!==false))
  throw new Error('AI3_W3_OPTIONS_DENIED');
 const enabled=options.enableOfflineTest===true;
 const scope=Object.freeze({...serverScope});
 return Object.freeze({
  scope,
  async queueReview(_incoming:unknown):Promise<OfflineDisposition>{
   if(!enabled)return result('disabled');
   // Reuse the old dispatcher but ONLY with locally constructed, powerless
   // adapters. Deliberately never feed it incoming ack_safe or real ports.
   const msg={
    body:Object.freeze({event_ref:'b_'+'0'.repeat(64)}),attempts:1,
    ack:():never=>{throw new Error('AI3_W3_ACK_IMPOSSIBLE');},
    retry:(_options?:{delaySeconds:number}):void=>{},
   };
   const consumer={consume:async()=>({
    outcome:'retry' as const,ack_safe:false as const,
    reason:'OFFLINE_ONLY',retry_after_ms:1000,
   })};
   const deadLetter={persist:async():Promise<never>=>{
    throw new Error('AI3_W3_DLQ_IMPOSSIBLE');
   }};
   const disposition=await dispatchQueueMessage(msg,consumer,deadLetter);
   if(disposition!=='retried')throw new Error('AI3_W3_NOT_RETRIED');
   return result('offline_review_only');
  },
  async auditReview(_incoming:unknown):Promise<OfflineDisposition>{
   if(!enabled)return result('disabled');
   // Constructor reuse only: no supplied DB can reach original D1 store.
   const adapter=createAi3AuditD1Store(sealedD1,scope);
   // Do not invoke the mutation methods. A real claim is never valid offline
   // evidence and would not turn this factory into a persistence service.
   void adapter;
   return result('offline_review_only');
  },
 });
}
