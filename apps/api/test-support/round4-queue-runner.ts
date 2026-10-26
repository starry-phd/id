/**
 * AI-4 Round4 OFFLINE-ONLY delivery executor for AI-3 QueueDecision.
 * No real Cloudflare Queue, no actual D1/Store, and no automatic DLQ provision.
 * The supplied consumer / DLQ persistence must originate from a trusted server.
 */
import type {QueueDecision} from '../../../packages/rebuild-ai3/src/queue-consumer.ts';
type QueueLikeMessage=Readonly<{
 body:unknown; attempts:number;
 ack:()=>void;retry:(options:{delaySeconds:number})=>void;
}>;
type AuditConsumer=Readonly<{consume:(ref:unknown,attempt:unknown)=>Promise<QueueDecision>}>;
type DurableDlq=Readonly<{persist:(ref:string,reason:string)=>Promise<boolean>}>;
const refPattern=/^b_[a-f0-9]{64}$/;
function readRef(payload:unknown):string|null {
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
 try{
  if(Object.getPrototypeOf(payload)!==Object.prototype)return null;
  const entries=Reflect.ownKeys(payload);
  if(entries.length!==1||entries[0]!=='eventRef')return null;
  const descriptor=Object.getOwnPropertyDescriptor(payload,'eventRef');
  if(!descriptor||!('value' in descriptor))return null;
  return typeof descriptor.value==='string'&&refPattern.test(descriptor.value)?descriptor.value:null;
 }catch{return null;}
}
/** Only returned ACK after the AI-3 atomic commit or after durable quarantine/DLQ. */
export function createOfflineRound4QueueRunner(consumer:AuditConsumer,dlq:DurableDlq){
 return Object.freeze({
  async deliver(message:QueueLikeMessage):Promise<'ack'|'retry'> {
   const ref=readRef(message.body);
   const attempts=message.attempts;
   if(ref===null||!Number.isSafeInteger(attempts)||attempts<1||attempts>5){
    message.retry({delaySeconds:60});return 'retry';
   }
   let decision:QueueDecision;
   try{decision=await consumer.consume(ref,attempts);}
   catch{message.retry({delaySeconds:60});return 'retry';}
   if(!decision.ack_safe){
    if(decision.outcome==='dlq_required'){
     // A durable DLQ receipt must exist before source Queue ACK.
     let saved=false;
     try{saved=await dlq.persist(ref,decision.reason);}
     catch{saved=false;}
     if(saved){message.ack();return 'ack';}
    }
    message.retry({delaySeconds:Math.max(1,Math.min(60,Math.ceil(decision.retry_after_ms/1000)||1))});
    return 'retry';
   }
   // A caller may only ACK recognized AI-3 positive outcomes.
   if(decision.outcome==='ack'||decision.outcome==='quarantine_recorded'){
    message.ack();return 'ack';
   }
   message.retry({delaySeconds:60});return 'retry';
  }
 });
}
