/**
 * AI-2 Round5: sandbox-only authenticated Google Play requery PORT.
 * Safe transport boundary, not live credentials or a claim of Play API success.
 * No network is executed by this module unless AI-4 supplies a real authenticated fetch.
 */
type SafeFetch = (url:string,init:RequestInit)=>Promise<Pick<Response,'ok'|'status'|'json'>>;
type TokenPort = ()=>Promise<string>;
export type PlayRequeryPort=Readonly<{
  querySubscriptionV2:(packageName:string,purchaseToken:string)=>Promise<unknown>;
}>;
const PKG=/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
function assert(ok:unknown,reason:string):asserts ok{if(!ok)throw new Error(reason);}
export function createSandboxPlaySubscriptionsV2Requery(opts:Readonly<{
  packageName:string;
  fetchTrusted:SafeFetch;
  obtainServerToken:TokenPort;
  allowedSandbox:true;
}>):PlayRequeryPort {
  assert(opts.allowedSandbox===true&&PKG.test(opts.packageName),'PLAY_SCOPE_DENIED');
  assert(typeof opts.fetchTrusted==='function'&&typeof opts.obtainServerToken==='function',
    'PLAY_SERVER_PORT_DENIED');
  return Object.freeze({
    async querySubscriptionV2(packageName:string,purchaseToken:string):Promise<unknown>{
      assert(packageName===opts.packageName,'PLAY_SCOPE_DENIED');
      // Never create URLs with arbitrary host/query from requests.
      assert(typeof purchaseToken==='string'&&purchaseToken.length>0&&purchaseToken.length<=4096
        &&/^[A-Za-z0-9._~-]+$/.test(purchaseToken),'PLAY_TOKEN_DENIED');
      const accessToken=await opts.obtainServerToken();
      assert(typeof accessToken==='string'&&/^[A-Za-z0-9._~-]{12,8192}$/.test(accessToken),
        'PLAY_SERVER_TOKEN_DENIED');
      const uri='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'
        +encodeURIComponent(opts.packageName)+'/purchases/subscriptionsv2/tokens/'
        +encodeURIComponent(purchaseToken);
      let response:Pick<Response,'ok'|'status'|'json'>;
      try {
        response=await opts.fetchTrusted(uri,{
          method:'GET',headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'},
          redirect:'error',cache:'no-store',
        });
      }catch{throw new Error('PLAY_REQUERY_UNAVAILABLE');}
      if(!response.ok)throw new Error(
        response.status===404?'PLAY_PURCHASE_MISSING':'PLAY_REQUERY_UNAVAILABLE');
      let result:unknown;
      try{result=await response.json();}catch{throw new Error('PLAY_RESPONSE_DENIED');}
      if(result===null||typeof result!=='object'||Array.isArray(result)
        ||Object.getPrototypeOf(result)!==Object.prototype)
        throw new Error('PLAY_RESPONSE_DENIED');
      const body=result as Record<string,unknown>;
      // Google subscriptionsv2.get does NOT return packageName in its response.
      // Request path + authenticated Play service account are the package authority.
      if(body.kind!==undefined&&body.kind!=='androidpublisher#subscriptionPurchaseV2')
        throw new Error('PLAY_RESPONSE_DENIED');
      if(typeof body.startTime!=='string'||!Array.isArray(body.lineItems)
        ||body.lineItems.length===0||body.lineItems.length>10
        ||typeof body.subscriptionState!=='string')
        throw new Error('PLAY_RESPONSE_DENIED');
      // StoreRTDN verifier's existing interface expects packageName from API.
      // Inject ONLY the trusted server-selected fixed path package, not caller data.
      return Object.freeze({...body,packageName:opts.packageName});
    },
  });
}
