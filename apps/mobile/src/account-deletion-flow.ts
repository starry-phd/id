/** AI-4: client-only M2 UI state; the server remains the sole session/receipt authority. */
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
 /** React 19 StrictMode replays effect setup after cleanup on the same flow. */
 activate():void;
 /** Called when Auth identity or port changes/unmounts: reject late results. */
 invalidate():void;
}>;
const empty:DeletionView=Object.freeze({
 phase:'idle',receipt:null,intent:null,error:null,
});
const phaseFor=(receipt:M2DeletionReceipt|null):DeletionViewPhase=>
 receipt?.status==='pending_processing'?'pending_processing':
 receipt?.status==='awaiting_second_confirmation'?'awaiting_second_confirmation':'idle';

export function createDeletionFlow(port:M2DeletionPort):DeletionFlow{
 let view:DeletionView=empty;
 let inflight=false,active=true,epoch=0;
 const listeners=new Set<(state:DeletionView)=>void>();
 const set=(next:DeletionView)=>{
  view=Object.freeze(next);
  for(const listener of listeners)listener(view);
 };
 async function run(intent:DeletionIntent,recovery=false):Promise<void>{
  if(!active||inflight||view.phase==='unauthorized')return;
  if(intent==='second'&&view.receipt?.status!=='awaiting_second_confirmation')return;
  if(intent==='first'&&view.receipt!==null)return;
  inflight=true;
  const generation=epoch;
  const current=()=>active&&epoch===generation;
  const previous=view;
  set({...previous,phase:'loading',intent,error:null});
  try{
   let record:M2DeletionReceipt|null;
   // An ambiguous previous operation (including a failed status GET)
   // must recover the server's authoritative state before any new POST,
   // even when the user taps the ORIGINAL first/second button rather than
   // the explicit retry control. A second confirmation is NEVER implicit.
   if((recovery||previous.phase==='error')&&intent!=='status'){
    // A lost POST response is ambiguous. Re-read the authoritative current
    // member request BEFORE repeating a mutation.
    const authoritative=await port.getStatus();
    if(!current())return;
    if(authoritative!==null){
     // Awaiting must NEVER trigger a hidden second confirm; that always
     // requires a new, distinct human press, even after a lost response.
     set({phase:phaseFor(authoritative),receipt:authoritative,intent:null,error:null});
     return;
    }
    if(intent==='second'){
     // The first receipt no longer exists. Do not replay a detached request ID.
     set(empty);
     return;
    }
   }
   record=intent==='status'?await port.getStatus():
    intent==='first'?await port.requestDeletion():
    await port.confirmDeletion(previous.receipt!.request_id);
   if(!current())return;
   set({phase:phaseFor(record),receipt:record,intent:null,error:null});
  }catch(error){
   if(!current())return;
   const code:M2DeletionClientErrorCode=error instanceof M2DeletionClientError?
    error.code:'UNAVAILABLE';
   if(code==='UNAUTHORIZED'||code==='SESSION_REQUIRED'){
    // Security boundary: no old request ID can remain visible/replayable.
    // Latch until a trusted Auth provider creates a NEW flow/port.
    set({phase:'unauthorized',receipt:null,intent:null,error:code});
   }else{
    set({phase:'error',receipt:code==='NO_REQUEST'?null:previous.receipt,
     intent:code==='NO_REQUEST'?null:intent,error:code});
   }
  }finally{if(current())inflight=false;}
 }
 return Object.freeze({
  snapshot:()=>view,
  subscribe(listener){
   // React can subscribe between StrictMode cleanup and second effect setup.
   // Do not orphan this subscription while the flow is inactive.
   listeners.add(listener);
   return ()=>{listeners.delete(listener);};
  },
  refresh:()=>run('status'),
  requestFirst:()=>run('first'),
  confirmSecond:()=>run('second'),
  retry:()=>{
   // Never resend a failed POST directly: recover via GET first.
   const intent=view.intent;
   return run(intent??'status',intent==='first'||intent==='second');
  },
  activate(){
   // StrictMode setup -> cleanup -> setup reuses this memoized flow.
   // Each replay starts a fresh generation with the SAME injected Auth port.
   // A previously started request may still resolve, but its generation can
   // never paint this new mount.
   if(active)return;
   epoch++;active=true;inflight=false;
   set(empty);
  },
  invalidate(){
   // Retire all in-flight results from this mount/identity. The component
   // may re-activate on StrictMode effect replay with the SAME trusted port;
   // switching identity must supply a new port/flow instance.
   epoch++;active=false;inflight=false;
   view=empty;
   listeners.clear();
  },
 });
}
