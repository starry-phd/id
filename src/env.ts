import type { RateLimiter } from './lib/rate-limit';

export type StarryEnvironment = 'development' | 'staging' | 'production';

/** Cloudflare bindings available to the platform Worker. */
export interface Env {
  STARRY_ENV: StarryEnvironment;
  DB_IDENTITY: D1Database;
  /** Current legal document versions; members must accept these (spec S-ID-09). */
  TERMS_VERSION: string;
  PRIVACY_VERSION: string;
  /** Secret: ES256 private JWK (with kid) used to sign access tokens. */
  ACCESS_TOKEN_PRIVATE_JWK?: string;
  /** Secret: comma-separated member IDs that hold the Owner role (spec S-ID-10). */
  OWNER_USER_IDS?: string;
  /** Secrets for Sign in with Apple token exchange and revocation (spec S-ID-06). */
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  /** Secret: 32 random bytes, base64url; seals stored third-party tokens. */
  DATA_ENCRYPTION_KEY?: string;
  /** Turnstile for the public support form (S-WEB-02); without the secret the form relies on rate limits. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Rate Limiting bindings (S-PLT-05): sign-in per IP, API per IP and member, web forms per IP. */
  RL_AUTH?: RateLimiter;
  RL_API?: RateLimiter;
  RL_WEB?: RateLimiter;
  /** Development only: provider JWKS and audiences used by local tests instead of Apple/Google. */
  AUTH_TEST_JWKS?: string;
  AUTH_TEST_AUDIENCES?: string;
}

export interface AuthContext {
  userId: string;
  sessionId: string;
  appId: string;
  status: 'active' | 'pending_deletion';
  /** When this session was created by a sign-in; used for the recent-login rule. */
  sessionCreatedAt: number;
}

/** Signed-in web account center / Admin Lite visitor (cookie session). */
export interface WebVisitor {
  sessionId: string;
  userId: string;
  status: 'active' | 'pending_deletion';
  createdAt: number;
}

/** Hono context type shared by every route module. */
export type AppBindings = {
  Bindings: Env;
  Variables: { requestId: string; auth: AuthContext; web: WebVisitor | null; cspNonce: string };
};
