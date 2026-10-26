/**
 * Starry ID REBUILD | security-only domain slice v1.0.0-draft.
 * NO live OAuth, D1 adapter, API deployment or real users.
 * The verifier/record readers MUST be authoritative server implementations.
 * Never construct an identity from request body claims.
 */
export const CONTRACT_VERSION = '1.0.0-draft' as const;
export const CROSS_BRAND_SYNC_ENABLED = false as const;
export type RuntimeEnvironment = 'development' | 'staging' | 'production';
export type TrustedScope = Readonly<{ brand_id: 'starry'; app_id: string; environment: RuntimeEnvironment }>;
export type Provider = 'apple' | 'google';
export type VerifiedAuthEvidence = Readonly<{
  brand_id: 'starry'; app_id: string; environment: RuntimeEnvironment;
  provider: Provider; provider_subject: string;
  s_user_id: string; session_id: string; auth_version: number; expires_at: number;
}>;
export type MemberStatus = 'active' | 'suspended' | 'deleted';
export type Member = Readonly<{
  s_user_id: string; status: MemberStatus; auth_version: number; profile_revision: number;
  display_name: string | null; directory_opt_in: boolean; display_name_public: boolean;
}>;
export type StepUpMethod = 'passkey' | 'totp';
export type Session = Readonly<{
  session_id: string; s_user_id: string; auth_version: number; app_id: string;
  environment: RuntimeEnvironment; expires_at: number; revoked_at: number | null;
  step_up_method: StepUpMethod | null;
  step_up_verified_at: number | null; step_up_expires_at: number | null;
}>;
export type AdminGrant = Readonly<{
  s_user_id: string; brand_id: 'starry'; app_id: string; environment: RuntimeEnvironment;
  permission: 'member:suspend' | 'member:restore';
  revoked_at: number | null; expires_at: number;
}>;
const issued = new WeakSet<object>();
const marker: unique symbol = Symbol('starry-server-principal-v1');
const trustedNow = (v: unknown): v is number => Number.isSafeInteger(v) && typeof v === 'number' && v >= 0;
const validId = (v: unknown): v is string => typeof v === 'string'
  && v.length >= 1 && v.length <= 256 && v.trim() === v && !/[\r\n]/.test(v);
const validScope = (s: TrustedScope): boolean => s.brand_id === 'starry' && validId(s.app_id)
  && ['development','staging','production'].includes(s.environment);
export type TrustedPrincipal = Readonly<{
  [marker]: true; brand_id: 'starry'; app_id: string; environment: RuntimeEnvironment;
  s_user_id: string; session_id: string; auth_version: number;
  member_status: 'active'; checked_at: number; expires_at: number;
}>;
export type ServerIdentityDependencies = Readonly<{
  trusted_scope: TrustedScope; // server-owned registry; NEVER request JSON
  verify_oidc_or_session: (opaqueRequest: unknown) => Promise<VerifiedAuthEvidence | null>;
  // Verifier must complete signature/JWKS, issuer/audience, state/nonce/PKCE,
  // Apple/Google stable-subject lookup or cryptographic session verification.
  read_member: (s_user_id: string) => Promise<Member | null>;
  read_session: (session_id: string) => Promise<Session | null>;
  identity_matches: (provider: Provider, subject: string, s_user_id: string) => Promise<boolean>;
}>;
/** Verifier is injected but NOT implemented. Tests use a synthetic verified stub. */
export function createServerIdentityResolver(deps: ServerIdentityDependencies) {
  const scope = Object.freeze({ ...deps.trusted_scope });
  if (!validScope(scope)) throw new Error('INVALID_SERVER_SCOPE');
  return async (opaqueRequest: unknown, now: number): Promise<TrustedPrincipal | null> => {
    if (!trustedNow(now)) return null;
    const e = await deps.verify_oidc_or_session(opaqueRequest);
    if (!e || e.brand_id !== 'starry' || e.app_id !== scope.app_id
        || e.environment !== scope.environment
        || (e.provider !== 'apple' && e.provider !== 'google')
        || !validId(e.provider_subject) || !validId(e.s_user_id) || !validId(e.session_id)
        || !trustedNow(e.expires_at) || e.expires_at <= now
        || !trustedNow(e.auth_version)) return null;
    // Provider/subject stable, Starry-only; NEVER auto-link on email or name.
    const [member, session, linked] = await Promise.all([
      deps.read_member(e.s_user_id),
      deps.read_session(e.session_id),
      deps.identity_matches(e.provider, e.provider_subject, e.s_user_id),
    ]);
    if (!linked || !member || !session
        || member.status !== 'active'
        || member.s_user_id !== e.s_user_id || session.s_user_id !== e.s_user_id
        || session.session_id !== e.session_id
        || session.app_id !== scope.app_id || session.environment !== scope.environment
        || session.revoked_at !== null || !trustedNow(session.expires_at) || session.expires_at <= now
        || !trustedNow(member.auth_version) || !trustedNow(session.auth_version)
        || e.auth_version !== member.auth_version || e.auth_version !== session.auth_version) return null;
    const p = Object.freeze({
      [marker]: true as const, brand_id: 'starry' as const, app_id: scope.app_id,
      environment: scope.environment, s_user_id: e.s_user_id, session_id: e.session_id,
      auth_version: e.auth_version, member_status: 'active' as const,
      checked_at: now, expires_at: Math.min(e.expires_at, session.expires_at),
    });
    issued.add(p);
    return p;
  };
}
export function isTrustedPrincipal(p: unknown): p is TrustedPrincipal {
  return typeof p === 'object' && p !== null && issued.has(p);
}
/** Every request must re-resolve; do not retain as a cross-request token. */
function requirePrincipal(p: unknown, trusted: TrustedScope, now: number): TrustedPrincipal {
  if (!isTrustedPrincipal(p) || !validScope(trusted)
      || p.app_id !== trusted.app_id || p.environment !== trusted.environment
      || !trustedNow(now) || now < p.checked_at || now - p.checked_at > 60
      || now >= p.expires_at) throw new Error('IDENTITY_DENIED');
  return p;
}
export type SelfProfile = Readonly<{
  s_user_id: string; display_name: string | null;
  directory_opt_in: boolean; display_name_public: boolean; profile_revision: number;
}>;
/** Self-read returns only an explicitly scoped minimal profile projection. */
export function readSelf(p: unknown, scope: TrustedScope, member: Member, now: number): SelfProfile {
  const actor = requirePrincipal(p, scope, now);
  if (member.s_user_id !== actor.s_user_id || member.status !== 'active'
      || member.auth_version !== actor.auth_version) throw new Error('MEMBER_DENIED');
  return Object.freeze({
    s_user_id: member.s_user_id, display_name: member.display_name,
    directory_opt_in: member.directory_opt_in, display_name_public: member.display_name_public,
    profile_revision: member.profile_revision,
  });
}
function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).some(k => typeof k !== 'string')) return false;
    return Object.values(descriptors).every(d => 'value' in d);
  } catch { return false; }
}
/** Produce a CAS mutation plan; AI-4 must commit atomically before returning success. */
export function planSelfUpdate(p: unknown, scope: TrustedScope, current: Member,
  expectedRevision: number, input: unknown, now: number): Member {
  readSelf(p, scope, current, now);
  if (!trustedNow(expectedRevision) || current.profile_revision !== expectedRevision)
    throw new Error('PROFILE_VERSION_CONFLICT');
  if (!plainRecord(input) || Object.keys(input).length === 0
      || Object.keys(input).some(k => !['display_name','directory_opt_in','display_name_public'].includes(k)))
    throw new Error('PROFILE_FIELDS_DENIED');
  const display = Object.hasOwn(input,'display_name') ? input.display_name : current.display_name;
  if (display !== null && (typeof display !== 'string' || display.trim() !== display
      || display.length < 1 || display.length > 80 || /[\x00-\x1F\x7F]/.test(display)))
    throw new Error('PROFILE_FIELDS_DENIED');
  const optIn = Object.hasOwn(input,'directory_opt_in') ? input.directory_opt_in : current.directory_opt_in;
  const publicName = Object.hasOwn(input,'display_name_public')
    ? input.display_name_public : current.display_name_public;
  if (typeof optIn !== 'boolean' || typeof publicName !== 'boolean')
    throw new Error('PROFILE_FIELDS_DENIED');
  if (!trustedNow(current.profile_revision) || current.profile_revision === Number.MAX_SAFE_INTEGER)
    throw new Error('PROFILE_VERSION_CONFLICT');
  return Object.freeze({
    ...current, display_name: display as string | null, directory_opt_in: optIn,
    display_name_public: publicName, profile_revision: current.profile_revision + 1,
  });
}
/** Opt-in public discovery preview ONLY; search endpoint/pagination/policy pending Gate. */
export function publicDirectoryProjection(member: Member): {s_user_id: string; display_name: string} | null {
  if (member.status !== 'active' || !member.directory_opt_in
      || !member.display_name_public || !member.display_name) return null;
  return Object.freeze({ s_user_id: member.s_user_id, display_name: member.display_name });
}
export type MemberControlAction = 'suspend' | 'restore';
/** Server-side grants + recorded Passkey/TOTP step-up only; role names not finalized. */
export function requireMemberAdmin(p: unknown, scope: TrustedScope, session: Session,
    grant: AdminGrant | null, action: MemberControlAction, now: number): void {
  const actor = requirePrincipal(p, scope, now);
  if (!grant || !['suspend','restore'].includes(action)
      || grant.permission !== `member:${action}`
      || grant.s_user_id !== actor.s_user_id || grant.brand_id !== 'starry'
      || grant.app_id !== scope.app_id || grant.environment !== scope.environment
      || grant.revoked_at !== null || !trustedNow(grant.expires_at) || grant.expires_at <= now)
    throw new Error('ADMIN_SCOPE_DENIED');
  if (session.session_id !== actor.session_id || session.s_user_id !== actor.s_user_id
      || session.app_id !== scope.app_id || session.environment !== scope.environment
      || session.auth_version !== actor.auth_version
      || session.revoked_at !== null || !trustedNow(session.expires_at) || session.expires_at <= now)
    throw new Error('SESSION_DENIED');
  if (!['passkey','totp'].includes(session.step_up_method ?? '')
      || !trustedNow(session.step_up_verified_at) || !trustedNow(session.step_up_expires_at)
      || session.step_up_verified_at > now || now - session.step_up_verified_at > 300
      || session.step_up_expires_at <= now)
    throw new Error('STEP_UP_REQUIRED');
}
export type DeletionChallenge = Readonly<{s_user_id: string; session_id: string; expires_at: number}>;
const confirmedChallenges = new WeakSet<object>();
/** Only trusted backend's second-factor challenge verifier may issue this. */
export function createDeletionChallengeVerifier(verify: (proof: unknown) => Promise<DeletionChallenge | null>) {
  return async (proof: unknown): Promise<DeletionChallenge | null> => {
    const challenge = await verify(proof);
    if (!challenge || !validId(challenge.s_user_id) || !validId(challenge.session_id)
        || !trustedNow(challenge.expires_at)) return null;
    const issuedChallenge = Object.freeze({...challenge});
    confirmedChallenges.add(issuedChallenge);
    return issuedChallenge;
  };
}
/** Delete plan = bump auth_version + tombstone profile; adapter must revoke all sessions atomically. */
export function planSelfDeletion(p: unknown, scope: TrustedScope, member: Member,
    proof: unknown, now: number): Member {
  const actor = requirePrincipal(p, scope, now);
  readSelf(actor, scope, member, now);
  if (typeof proof !== 'object' || !proof || !confirmedChallenges.has(proof)
      || (proof as DeletionChallenge).s_user_id !== actor.s_user_id
      || (proof as DeletionChallenge).session_id !== actor.session_id
      || (proof as DeletionChallenge).expires_at <= now)
    throw new Error('DELETE_CONFIRMATION_REQUIRED');
  if (member.auth_version === Number.MAX_SAFE_INTEGER) throw new Error('VERSION_CONFLICT');
  return Object.freeze({
    ...member, status: 'deleted' as const, auth_version: member.auth_version + 1,
    display_name: null, directory_opt_in: false, display_name_public: false,
    profile_revision: member.profile_revision + 1,
  });
}
