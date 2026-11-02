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
  /** Development only: provider JWKS and audiences used by local tests instead of Apple/Google. */
  AUTH_TEST_JWKS?: string;
  AUTH_TEST_AUDIENCES?: string;
}

export interface AuthContext {
  userId: string;
  sessionId: string;
  appId: string;
  status: 'active' | 'pending_deletion';
}

/** Hono context type shared by every route module. */
export type AppBindings = {
  Bindings: Env;
  Variables: { requestId: string; auth: AuthContext };
};
