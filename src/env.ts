export type StarryEnvironment = 'development' | 'staging' | 'production';

/** Cloudflare bindings available to the platform Worker. */
export interface Env {
  STARRY_ENV: StarryEnvironment;
  DB_IDENTITY: D1Database;
}

/** Hono context type shared by every route module. */
export type AppBindings = {
  Bindings: Env;
  Variables: { requestId: string };
};
