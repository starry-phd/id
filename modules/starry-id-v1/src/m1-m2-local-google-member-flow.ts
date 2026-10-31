/**
 * AI-1 | Local-only M1→M2 Google member lifecycle composition.
 *
 * One Auth authority: reuse the already-reviewed M1 callback, first-login
 * transaction, signed Session and W3 five-field reader, plus M2 CAS/logout.
 * This is NEVER a public Worker route or an approval to use real Google/D1.
 */
import {createM1LocalAuthSessionCore} from './m1-local-auth-session-core.ts';
import type {M1WriteDatabase} from './m1-local-auth-session-core.ts';
import {
  createM1GoogleAuthorizeUrl,createM1GoogleCodeExchange,
} from './m1-google-oauth-exchange.ts';
import type {PinnedOidcProvider} from './oidc-crypto.ts';
import type {createM1GoogleJwksSource} from './m1-google-jwks-source.ts';
import type {SessionSigningKey} from './session-crypto.ts';
import type {M1VerifierCustody} from './m1-oauth-verifier-custody.ts';
import {createM2LocalSelfMutationHandler} from './m2-local-self-mutation.ts';
import type {TrustedScope} from './index.ts';

export const M1_M2_GOOGLE_FLOW_LIVE_ENABLED = false as const;
export const M1_M2_GOOGLE_FLOW_CONTRACT =
  'starry.ai1.local.google-member-mutation-flow.v1' as const;
export const M1_M2_GOOGLE_CALLBACK_PATH =
  '/v1/starry-id/oauth/google/callback' as const;

type Scope = TrustedScope & {environment:'development'|'staging'};
type Deps = Readonly<{
  enabled?:boolean;
  serverScope:Scope;
  expectedOrigin:string;
  /** Must be the exact registered HTTPS callback, not a client-supplied URL. */
  redirectUri:string;
  authDb:M1WriteDatabase;
  googleProvider:PinnedOidcProvider;
  /** Optional source-only server-owned official JWKS; no separate OAuth/Auth. */
  googleJwksSource?:Pick<ReturnType<typeof createM1GoogleJwksSource>,'getProvider'>;
  /** Server-owned exact signed Google sub values of explicitly invited testers. */
  allowedGoogleTestSubjects?:readonly string[];
  /** Explicit source-only app handoff; never enables a public Worker route. */
  sessionHandoffEnabled?:boolean;
  verifierCustody:M1VerifierCustody;
  activeKey:()=>Promise<SessionSigningKey>;
  getVerificationKey:(kid:string)=>Promise<CryptoKey|null>;
  readGoogleClientSecret:()=>Promise<string|null>;
  googleTransport:(url:string,init:RequestInit)=>Promise<Response>;
  now:()=>number;
  /** Test seam ONLY: server-owned CSPRNG in a real deployment. */
  randomBytes?:(n:number)=>Uint8Array;
}>;

export function createM1M2LocalGoogleFlow(deps:Deps){
  if(!deps||!deps.googleProvider||deps.googleProvider.provider!=='google'||
    (deps.googleJwksSource!==undefined&&
      typeof deps.googleJwksSource?.getProvider!=='function')||
    !deps.verifierCustody||typeof deps.verifierCustody.seal!=='function'||
    typeof deps.verifierCustody.open!=='function')
    throw Error('M1_M2_GOOGLE_FLOW_CONFIGURATION_DENIED');
  let origin:URL;
  let redirect:URL;
  try{
    origin=new URL(deps.expectedOrigin);
    redirect=new URL(deps.redirectUri);
  }catch{throw Error('M1_M2_GOOGLE_FLOW_ORIGIN_DENIED');}
  if(origin.protocol!=='https:'||origin.username||origin.password||
    origin.pathname!=='/'||origin.search||origin.hash||
    origin.href!==origin.origin+'/'||
    redirect.protocol!=='https:'||redirect.username||redirect.password||
    redirect.origin!==origin.origin||redirect.pathname!==M1_M2_GOOGLE_CALLBACK_PATH||
    redirect.search||redirect.hash||redirect.href!==deps.redirectUri)
    throw Error('M1_M2_GOOGLE_FLOW_ORIGIN_DENIED');
  // M1 Session issuance and M2 mutations must share one Starry D1 authority
  // and one verified scope. Caller-owned DI getters must not switch either.
  const authDb=deps.authDb;
  const serverScope=Object.freeze({...deps.serverScope});
  // Session verification and trusted clock must come from the SAME captured
  // provider in M1 reads and M2 writes; changing the caller DI object must
  // not make an issued, current Session unusable for the mutation handler.
  const getVerificationKey=deps.getVerificationKey;
  const now=deps.now;
  const enabled=deps.enabled===true;
  if(deps.sessionHandoffEnabled!==undefined&&typeof deps.sessionHandoffEnabled!=='boolean')
    throw Error('M1_M2_GOOGLE_FLOW_CONFIGURATION_DENIED');
  const sessionHandoffEnabled=deps.sessionHandoffEnabled===true;
  if(sessionHandoffEnabled&&enabled&&(
    serverScope.environment!=='staging'||!deps.googleJwksSource))
    throw Error('M1_M2_GOOGLE_FLOW_CONFIGURATION_DENIED');
  // A staging Google-JWKS composition cannot accidentally become open signup.
  // An explicit allowlist is REQUIRED before any remote-like source is used.
  const requireGoogleTestAllowlist=
    enabled&&serverScope.environment==='staging'&&!!deps.googleJwksSource;
  // Capture the exact Google configuration before any OAuth or keyring await.
  const clientId=deps.googleProvider.clientId;
  const redirectUri=redirect.href;
  const exchangeCode=createM1GoogleCodeExchange({
    enabled,clientId,redirectUri,
    readClientSecret:deps.readGoogleClientSecret,transport:deps.googleTransport,
  });
  const core=createM1LocalAuthSessionCore({
    enabled,serverScope,expectedOrigin:origin.origin,
    authDb,provider:deps.googleProvider,exchangeCode,
    getGoogleJwksProvider:deps.googleJwksSource?.getProvider,
    allowedGoogleTestSubjects:deps.allowedGoogleTestSubjects,
    requireGoogleTestAllowlist,sessionHandoffEnabled,
    verifierCustody:deps.verifierCustody,requireSealedVerifier:true,
    activeKey:deps.activeKey,getVerificationKey,
    now,randomBytes:deps.randomBytes,
  });
  const mutations=createM2LocalSelfMutationHandler({
    enabled,serverScope,expectedOrigin:origin.origin,
    authDb,getVerificationKey,now,
  });
  return Object.freeze({
    contract:M1_M2_GOOGLE_FLOW_CONTRACT,
    local_only:true as const,
    live_enabled:M1_M2_GOOGLE_FLOW_LIVE_ENABLED,
    public_worker_route_registered:false as const,
    /** Persist server-private PKCE/nonce/state, return *only* a public URL. */
    async beginGoogleLogin():Promise<string|null>{
      if(!enabled)return null;
      const attempt=await core.beginOAuthAttempt();
      if(!attempt||attempt.provider!=='google')return null;
      return createM1GoogleAuthorizeUrl({
        clientId,redirectUri,state:attempt.state,
        nonce:attempt.nonce,codeChallenge:attempt.codeChallenge,
      });
    },
    /** Server-only callback result; bearer is NEVER placed in redirect URL. */
    completeGoogleLogin(input:unknown){return core.issueFromVerifiedCallback(input);},
    /** App-facing callback returns only a 60-second opaque one-time code, never a bearer. */
    async completeGoogleLoginForApp(input:unknown){
      if(!enabled||!sessionHandoffEnabled)return null;
      const issued=await core.issueFromVerifiedCallback(input);
      if(!issued?.handoff_code||!Number.isSafeInteger(issued.handoff_expires_at))return null;
      return Object.freeze({status:'handoff_issued' as const,
        handoff_code:issued.handoff_code,expires_at:issued.handoff_expires_at});
    },
    /** One-time code is consumed before a current, non-revoked D1 Session is re-signed. */
    redeemSessionHandoff(input:unknown){
      if(!enabled||!sessionHandoffEnabled)return Promise.resolve(null);
      return core.redeemSessionHandoff(input);
    },
    /** Unchanged W3 five-field authenticated GET. */
    readSelf(request:Request):Promise<Response>{return core.readSelf(request);},
    /** Reused M2 PATCH/current-session logout port, not publicly registered. */
    mutateSelf(request:Request):Promise<Response>{return mutations.handle(request);},
  });
}
