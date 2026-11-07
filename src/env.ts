import type { RateLimiter } from './lib/rate-limit';
import type { EmailSender } from './notify/email';

export interface CleanupMessage {
  jobId: string;
}

export type StarryEnvironment = 'development' | 'staging' | 'production';

/** Cloudflare bindings available to the platform Worker. */
export interface Env {
  STARRY_ENV: StarryEnvironment;
  DB_IDENTITY: D1Database;
  /** RevenueCat entitlement projection (S-BIL-04). */
  DB_BILLING: D1Database;
  /** Starry Battery (S-BAT-06): monthly allowance, reservations and ledger; only src/battery writes it. */
  DB_BATTERY: D1Database;
  /** Private R2 bucket for avatars (S-ID-08); reads only through signed URLs. */
  AVATARS?: R2Bucket;
  /** Private R2 bucket for support ticket attachments (S-WEB-02); staff read them through Admin Lite. */
  SUPPORT_FILES?: R2Bucket;
  /** Current legal document versions; members must accept these (spec S-ID-09). */
  TERMS_VERSION: string;
  PRIVACY_VERSION: string;
  /** Secret: ES256 private JWK (with kid) used to sign access tokens. */
  /** Optional JSON array of retired public JWKs (with kid) still accepted after a signing key rotation. */
  ACCESS_TOKEN_PREVIOUS_JWKS?: string;
  ACCESS_TOKEN_PRIVATE_JWK?: string;
  /** Secret: comma-separated member IDs that hold the Owner role (spec S-ID-10). */
  OWNER_USER_IDS?: string;
  /** Secret, temporary: passphrase (12+ chars) for the one-time owner claim at /account/claim-owner. */
  OWNER_CLAIM_CODE?: string;
  /** Secrets for Sign in with Apple token exchange and revocation (spec S-ID-06). */
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  /** Secrets, JSON per App: RevenueCat webhook Authorization values and secret API keys, e.g. {"echo": "..."}. */
  REVENUECAT_WEBHOOK_AUTH?: string;
  REVENUECAT_API_KEYS?: string;
  /** Secret, JSON per App: service keys (32+ chars) that App backends present to spend Battery, e.g. {"echo": "..."}. */
  BATTERY_SERVICE_KEYS?: string;
  /** Secret: 32 random bytes, base64url; seals stored third-party tokens. */
  DATA_ENCRYPTION_KEY?: string;
  /** Cloudflare Email Service send_email binding (S-NTF-02); without it no email is sent. */
  EMAIL?: EmailSender;
  /** Sender and support mailbox for system email, e.g. support@starry.phd for both sending and the support mailbox. */
  EMAIL_FROM?: string;
  SUPPORT_EMAIL?: string;
  /** Sentry DSN (public key, set as a variable) for error monitoring; without it nothing is sent. */
  SENTRY_DSN?: string;
  /** Turnstile for the public support form (S-WEB-02); without the secret the form relies on rate limits. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Rate Limiting bindings (S-PLT-05): sign-in per IP, API per IP and member, web forms per IP. */
  RL_AUTH?: RateLimiter;
  RL_API?: RateLimiter;
  RL_WEB?: RateLimiter;
  /** Per App service key (Battery, member directory): a larger bucket so one App cannot use up another's allowance. */
  RL_APP?: RateLimiter;
  /** Queue for deletion clean-up retries (ADR 0009); optional, the minute schedule retries the same jobs without it. */
  CLEANUP_QUEUE?: Queue<CleanupMessage>;
  /** Development only: provider JWKS and audiences used by local tests instead of Apple/Google. */
  AUTH_TEST_JWKS?: string;
  AUTH_TEST_AUDIENCES?: string;
}

export interface AuthContext {
  userId: string;
  sessionId: string;
  appId: string;
  status: 'active';
  /** When this session was created by a sign-in; used for the recent-login rule. */
  sessionCreatedAt: number;
}

/** Signed-in web account center / Admin Lite visitor (cookie session). */
export interface WebVisitor {
  sessionId: string;
  userId: string;
  status: 'active';
  createdAt: number;
}

/** Hono context type shared by every route module. */
export type AppBindings = {
  Bindings: Env;
  Variables: { requestId: string; auth: AuthContext; web: WebVisitor | null; cspNonce: string };
};
