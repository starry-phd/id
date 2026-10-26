/**
 * Starry Expo entry-point contract. Member Auth is intentionally DISABLED until
 * AI-1 real OAuth/JWKS/session and AI-0 API Gate approval. No stored mock token.
 */
import {STARRY_ID_TEMPLATE} from './brand-registry.ts';
import type {PreviewSelfProfile} from '../../../packages/sdk/src/member-preview.ts';
export type MemberView =
 |Readonly<{status:'disabled';message:string;profile:null}>
 |Readonly<{status:'authorized';message:string;profile:PreviewSelfProfile}>;
export const offlineMemberView:MemberView=Object.freeze({
 status:'disabled',message:'會員驗證／D1 尚未接通，無法讀取會員資料。',profile:null
});
export async function loadMemberView(client:Readonly<{readSelf():Promise<PreviewSelfProfile>}>|null):Promise<MemberView>{
 if(!STARRY_ID_TEMPLATE.memberAuthEnabled||client===null)return offlineMemberView;
 // This branch is intentionally unreachable under the approved Phase0 flags.
 const profile=await client.readSelf();
 return Object.freeze({status:'authorized' as const,message:'',profile});
}
