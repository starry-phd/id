/**
 * Development-only visual interaction fixture. NEVER makes a network call,
 * NEVER holds an Auth bearer and NEVER executes account erasure.
 */
import {
 M2DeletionClientError,
} from '../../../packages/sdk/src/m2-local-deletion-request-client.ts';
import type {
 M2DeletionPort,M2DeletionReceipt,
} from '../../../packages/sdk/src/m2-local-deletion-request-client.ts';
export type DeletionPreview=M2DeletionPort&Readonly<{
 failNext(code:'UNAVAILABLE'|'UNAUTHORIZED'):void;
}>;
export function createDeletionPreview():DeletionPreview{
 let record:M2DeletionReceipt|null=null;
 let failure:'UNAVAILABLE'|'UNAUTHORIZED'|null=null;
 function check(){
  if(failure!==null){
   const kind=failure;failure=null;
   throw new M2DeletionClientError(kind);
  }
 }
 return Object.freeze({
  failNext(code:'UNAVAILABLE'|'UNAUTHORIZED'){failure=code;},
  async getStatus(){check();return record;},
  async requestDeletion(){
   check();
   if(record!==null)return record;
   const bytes=new Uint8Array(24);
   // For a visual fixture only; never a backend identity/authorization token.
   if(typeof globalThis.crypto?.getRandomValues==='function'){
    globalThis.crypto.getRandomValues(bytes);
   }else{
    bytes.fill(1);
   }
   const id='m2del-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
   record=Object.freeze({
    request_id:id,
    status:'awaiting_second_confirmation',
    first_confirmed_at:Math.floor(Date.now()/1000),
    second_confirmed_at:null,
    physical_erasure_completed:false,
    execution_authorized:false,
   });
   return record;
  },
  async confirmDeletion(requestId:string){
   check();
   if(!record||record.request_id!==requestId)throw new M2DeletionClientError('NO_REQUEST');
   if(record.status==='pending_processing')return record;
   record=Object.freeze({
    ...record,status:'pending_processing',
    second_confirmed_at:Math.floor(Date.now()/1000),
   });
   return record;
  },
 });
}
