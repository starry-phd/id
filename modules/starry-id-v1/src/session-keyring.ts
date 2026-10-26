/** AI-1 Round5: Server-only Session HMAC key rotation policy.
 * No hardcoded secret, no key material output or network; AI-4 injects keyring
 * from managed environment secrets AFTER Gate. Never use this for real traffic.
 */
import {signServerSession} from './session-crypto.ts';
import type {SessionClaims,SessionSigningKey} from './session-crypto.ts';
import type {TrustedScope} from './index.ts';

export type SessionKeyPeriod=Readonly<{
 kid:string;key:CryptoKey;notBefore:number;signUntil:number;verifyUntil:number;
}>;
const epoch=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const ident=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(s);
export function createStarryServerSessionKeyring(
 scope:TrustedScope,periods:ReadonlyArray<SessionKeyPeriod>,activeKid:string,
 nowSeconds:()=>number,
) {
 if(scope.brand_id!=='starry'||!ident(scope.app_id)||
  !['development','staging'].includes(scope.environment)||
  !ident(activeKid)||periods.length<1||periods.length>5)throw Error('KEYRING_SCOPE_DENIED');
 const keys=new Map<string,SessionKeyPeriod>();
 for(const item of periods){
  if(!ident(item.kid)||keys.has(item.kid)||
    !epoch(item.notBefore)||!epoch(item.signUntil)||!epoch(item.verifyUntil)||
    item.notBefore>=item.signUntil||item.signUntil>item.verifyUntil||
    item.key.algorithm.name!=='HMAC'||item.key.extractable||
    !item.key.usages.includes('verify'))throw Error('KEYRING_POLICY_DENIED');
  keys.set(item.kid,Object.freeze({...item}));
 }
 const active=keys.get(activeKid);
 if(!active||!active.key.usages.includes('sign'))throw Error('KEYRING_POLICY_DENIED');
 return Object.freeze({
  async issue(claims:SessionClaims):Promise<string>{
   const now=nowSeconds();
   if(!epoch(now)||now<active.notBefore||now>=active.signUntil||
      claims.key_id!==activeKid)throw Error('KEYRING_SIGN_DENIED');
   return signServerSession(claims,scope,now,{kid:activeKid,key:active.key} satisfies SessionSigningKey);
  },
  async verifyKey(kid:string):Promise<CryptoKey|null>{
   const now=nowSeconds(),entry=keys.get(kid);
   if(!epoch(now)||!entry||now<entry.notBefore||now>=entry.verifyUntil)return null;
   return entry.key;
  },
 });
}
