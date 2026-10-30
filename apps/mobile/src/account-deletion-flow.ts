/** Headless state machine for the M2 mobile screen; no identity or DB authority. */
import {M2DeletionClientError} from '../../../packages/sdk/src/m2-local-deletion-request-client.ts';
import type {
 M2DeletionPort,M2DeletionReceipt,M2DeletionClientErrorCode,
} from '../../../packages/sdk/src/m2-local-deletion-request-client.ts';

export type DeletionIntent='status'|'first'|'second';
export type DeletionViewPhase='idle'|'loading'|'awaiting_second_confirmation'|
 'pending_processing'|'error'|'unauthorized';
export type DeletionView=Readonly<{
 phase:DeletionViewPhase;
 receipt:M2DeletionReceipt|null;
 intent:DeletionIntent|null;
 error:M2DeletionClientErrorCode|null;
}>;
export type DeletionFlow=Readonly<{
 snapshot():DeletionView;
 subscribe(listener:(state:DeletionView)=>void):()=>void;
 refresh():Promise<void>;
 requestFirst():Promise<void>;
 confirmSecond():Promise<void>;
 retry():Promise<void>;
}>;
export function createDeletionFlow(port:M2DeletionPort):DeletionFlow{
 let view:DeletionView=Object.freeze({
  phase:'idle',receipt:null,intent:null,error:null,
 });
 let inflight=false;
 const listeners=new Set<(state:DeletionView)=>void>();
 const set=(next:DeletionView)=>{
  view=Object.freeze(next);
  for(const listener of listeners)listener(view);
 };
 const phaseFor=(receipt:M2DeletionReceipt|null):DeletionViewPhase=>
  receipt?.status==='pending_processing'?'pending_processing':
  receipt?.status==='awaiting_second_confirmation'?'awaiting_second_confirmation':'idle';
 async function run(intent:DeletionIntent):Promise<void>{
  if(inflight)return;
  if(intent==='second'&&view.receipt?.status!=='awaiting_second_confirmation')return;
  if(intent==='first'&&view.receipt!==null)return;
  inflight=true;
  const previous=view;
  set({...previous,phase:'loading',intent,error:null});
  try{
   const record=intent==='status'?await port.getStatus():
    intent==='first'?await port.requestDeletion():
      await port.confirmDeletion(previous.receipt!.request_id);
   set({phase:phaseFor(record),receipt:record,intent:null,error:null});
  }catch(error){
   const code:M2DeletionClientErrorCode=error instanceof M2DeletionClientError?
    error.code:'UNAVAILABLE';
   set({phase:code==='UNAUTHORIZED'||code==='SESSION_REQUIRED'?'unauthorized':'error',
    receipt:previous.receipt,intent,error:code});
  }finally{inflight=false;}
 }
 return Object.freeze({
  snapshot:()=>view,
  subscribe(listener){
   listeners.add(listener);
   return ()=>{listeners.delete(listener);};
  },
  refresh:()=>run('status'),
  requestFirst:()=>run('first'),
  confirmSecond:()=>run('second'),
  retry:()=>run(view.intent??'status'),
 });
}
