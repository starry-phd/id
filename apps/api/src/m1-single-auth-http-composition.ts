/**
 * One SOURCE-ONLY composition root for the already-reviewed Google OAuth /
 * signed Starry Session / original member GET-CAS-PATCH-logout and
 * two-step deletion-REQUEST receipt handlers (never physical erasure).
 *
 * This closes the previous manual bridge wiring seam: the read and mutation
 * routes may not accidentally be given different Auth databases, scopes,
 * verification keys or clocks. No public Worker route is registered.
 *
 * To deploy requires separately approved remote Starry D1, Google OIDC,
 * strict tester access, secret custody and release/staging Gates.
 */
import {createM1M2LocalGoogleFlow} from
  '../../../modules/starry-id-v1/src/m1-m2-local-google-member-flow.ts';
import {createM1LocalMemberPlatformBridge} from
  './m1-local-member-platform-bridge.ts';
import {createM2LocalDeletionRequestHandler} from
  '../../../modules/starry-id-v1/src/m2-local-deletion-request.ts';
import {createM1GoogleSessionHandoffHttp} from './m1-google-session-handoff-http.ts';

export const M1_SINGLE_AUTH_HTTP_LIVE_ENABLED = false as const;
export const M1_SINGLE_AUTH_HTTP_CONTRACT =
  'starry.ai0.m1.local-single-auth-http-composition.v1' as const;

type GoogleDeps = Parameters<typeof createM1M2LocalGoogleFlow>[0] & Readonly<{
  /** Owner-verified HTTPS Universal Link; source-only until app association is proven. */
  appReturnUri?:string;
}>;

export function createM1SingleAuthHttpComposition(deps:GoogleDeps) {
  if (!deps || !deps.serverScope ||
      deps.serverScope.brand_id !== 'starry' ||
      deps.serverScope.app_id !== 'starry-id' ||
      !['development', 'staging'].includes(deps.serverScope.environment))
    throw Error('M1_SINGLE_AUTH_SCOPE_DENIED');

  const scope = Object.freeze({
    brand_id: 'starry' as const,
    app_id: 'starry-id' as const,
    environment: deps.serverScope.environment,
  });
  const expectedOrigin = deps.expectedOrigin;
  const enabled = deps.enabled === true;
  if(deps.sessionHandoffEnabled!==undefined&&typeof deps.sessionHandoffEnabled!=='boolean')
    throw Error('M1_SINGLE_AUTH_HANDOFF_CONFIGURATION_DENIED');
  const sessionHandoffEnabled=deps.sessionHandoffEnabled===true;
  if(sessionHandoffEnabled&&(!deps.appReturnUri||
    (enabled&&(scope.environment!=='staging'||!deps.googleJwksSource))))
    throw Error('M1_SINGLE_AUTH_HANDOFF_CONFIGURATION_DENIED');

  // Capture the trusted configuration once; both handlers are built from the
  // exact SAME original AI-1 flow, not separate credential or D1 providers.
  const authDeps = Object.freeze({
    enabled,serverScope:scope,expectedOrigin,
    redirectUri:deps.redirectUri,authDb:deps.authDb,
    googleProvider:deps.googleProvider,
    googleJwksSource:deps.googleJwksSource,
    allowedGoogleTestSubjects:deps.allowedGoogleTestSubjects,
    sessionHandoffEnabled,
    verifierCustody:deps.verifierCustody,
    activeKey:deps.activeKey,getVerificationKey:deps.getVerificationKey,
    readGoogleClientSecret:deps.readGoogleClientSecret,
    googleTransport:deps.googleTransport,now:deps.now,
    randomBytes:deps.randomBytes,
  });
  const auth = createM1M2LocalGoogleFlow(authDeps);
  // The original AI-1 two-confirmation *receipt* handler, not an erasure
  // executor. It reuses this exact AuthDb, keyring, clock, origin and scope.
  // Never mint a second Session or trust a client-supplied member ID.
  const deletion = createM2LocalDeletionRequestHandler({
    enabled,serverScope:scope,expectedOrigin,
    authDb:authDeps.authDb,getVerificationKey:authDeps.getVerificationKey,
    now:authDeps.now,randomBytes:authDeps.randomBytes,
  });
  const handoffHttp=sessionHandoffEnabled?createM1GoogleSessionHandoffHttp({
    enabled,expectedOrigin,redirectUri:deps.redirectUri,
    appReturnUri:deps.appReturnUri!,
    completeGoogleLoginForApp:auth.completeGoogleLoginForApp,
    redeemSessionHandoff:auth.redeemSessionHandoff,
  }):null;
  const handoffDisabled=()=>new Response(JSON.stringify({error:{code:'FEATURE_DISABLED'}}),{
    status:503,headers:{'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store','x-content-type-options':'nosniff'},
  });
  const http = createM1LocalMemberPlatformBridge({
    enabled,scope,expectedOrigin,
    readPort:{handle:(request:Request)=>auth.readSelf(request)},
    mutationPort:{handle:(request:Request)=>auth.mutateSelf(request)},
    deletionPort:{handle:(request:Request)=>deletion.handle(request)},
  });

  return Object.freeze({
    contract:M1_SINGLE_AUTH_HTTP_CONTRACT,
    live_enabled:M1_SINGLE_AUTH_HTTP_LIVE_ENABLED,
    local_only:true as const,
    public_worker_route_registered:false as const,
    // Server-only primitives. The app-facing callback exposes only a one-time code.
    beginGoogleLogin:()=>auth.beginGoogleLogin(),
    completeGoogleLogin:(input:unknown)=>auth.completeGoogleLogin(input),
    completeGoogleLoginForApp:(input:unknown)=>auth.completeGoogleLoginForApp(input),
    redeemSessionHandoff:(input:unknown)=>auth.redeemSessionHandoff(input),
    handleOAuthCallback:(request:Request)=>handoffHttp?
      handoffHttp.handleOAuthCallback(request):Promise.resolve(handoffDisabled()),
    handleSessionExchange:(request:Request)=>handoffHttp?
      handoffHttp.handleSessionExchange(request):Promise.resolve(handoffDisabled()),
    // Member transport is exactly the pre-existing AI-4 fail-closed bridge.
    handleMember:(request:unknown)=>http.handle(request),
  });
}
