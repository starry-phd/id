/**
 * AI-3 fourth-round offline Queue message adapter candidate.
 * AI-4 owns real Worker queue() handler, bindings, settings, DLQ and deployment.
 * Cloudflare auto-ACKs unresolved successful batches: EVERY non-ACK outcome
 * here explicitly calls message.retry() or throws to prevent silent loss.
 */
import type {QueueDecision} from './queue-consumer.ts';

export type QueueMessagePort=Readonly<{
 body:unknown;attempts:number;ack:()=>void;
 retry:(options?:{delaySeconds:number})=>void;
}>;
export type AuditConsumerPort=Readonly<{
 consume:(eventRef:unknown,attempt:unknown)=>Promise<QueueDecision>;
}>;
export type DeadLetterReceipt=Readonly<{
 outcome:'durably_written'|'already_written';
 event_ref:string;
}>;
export type DeadLetterPort=Readonly<{
 persist:(record:Readonly<{event_ref:string;reason_code:string;attempt:number}>)
  =>Promise<DeadLetterReceipt>;
}>;
const KEY=/^b_[a-f0-9]{64}$/;
const REASON=/^[A-Z0-9_]{3,72}$/;
function queueRef(value:unknown):unknown{
 if(value===null||typeof value!=='object'||Array.isArray(value))
  return null;
 try {
  if(Object.getPrototypeOf(value)!==Object.prototype)return null;
  const own=Reflect.ownKeys(value);
  if(own.length!==1||own[0]!=='event_ref')return null;
  const descriptor=Object.getOwnPropertyDescriptor(value,'event_ref');
  return descriptor&&descriptor.enumerable===true&&'value' in descriptor?descriptor.value:null;
 }catch{return null;}
}
/** ONLY for trusted Worker composition; can be exercised without any cloud call. */
export async function dispatchQueueMessage(
 msg:QueueMessagePort,consumer:AuditConsumerPort,deadLetter:DeadLetterPort,
):Promise<'acked'|'retried'|'dlq_acked'>{
 const ref=queueRef(msg.body);
 // After failed durable DLQ, delivery 6+ must not remain HOLD indefinitely.
 // Cap policy evaluation at five; retain actual attempt for the DLQ receipt.
 const retry=(seconds=1):'retried'=>{
  const delaySeconds=Number.isFinite(seconds)?Math.max(1,Math.min(60,Math.ceil(seconds))):1;
  msg.retry({delaySeconds});return 'retried';
 };
 if(typeof ref!=='string'||!KEY.test(ref)||!Number.isSafeInteger(msg.attempts)
  ||msg.attempts<1)return retry();
 let decision:QueueDecision;
 try{decision=await consumer.consume(ref,Math.min(msg.attempts,5));}
 catch{return retry();}
 if(decision.outcome==='ack'||decision.outcome==='quarantine_recorded'){
  if(decision.ack_safe!==true)return retry();
  msg.ack();return 'acked';
 }
 if(decision.outcome==='retry')
  return retry(Math.max(1,Math.ceil(decision.retry_after_ms/1000)));
 if(decision.outcome==='dlq_required'){
  if(decision.ack_safe||!REASON.test(decision.reason)
   ||!Number.isInteger(msg.attempts)||msg.attempts<1)return retry();
  // DO NOT place error stacks, client body, payment ref or actor PII in DLQ.
  // persist() is a server-only, atomic and durable AI-4/AI-3 adapter contract.
  try {
   const receipt=await deadLetter.persist(Object.freeze({
    event_ref:ref,reason_code:decision.reason,attempt:msg.attempts,
   }));
   if((receipt.outcome==='durably_written'||receipt.outcome==='already_written')
    &&receipt.event_ref===ref){
    msg.ack();return 'dlq_acked';
   }
  }catch{/* deliberately never ACK or swallow the Queue failure */}
  return retry();
 }
 // hold/unknown must NOT be silently acknowledged by Cloudflare's default.
 return retry();
}
