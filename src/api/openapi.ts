import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppBindings } from '../env';
import { errorBody } from '../lib/errors';

/**
 * Spec S-PLT-03: every /v1 route is declared with @hono/zod-openapi, so the OpenAPI 3.1
 * document is generated from the same schemas that validate requests. Invalid input keeps
 * the platform's error shape: 400 BAD_REQUEST.
 */
export function apiRouter(): OpenAPIHono<AppBindings> {
  return new OpenAPIHono<AppBindings>({
    defaultHook: (result, c) => {
      if (!result.success) return c.json(errorBody('BAD_REQUEST', 'Invalid request', c.get('requestId')), 400);
      return undefined;
    },
  });
}

export const DOCUMENT_CONFIG = {
  openapi: '3.1.0',
  info: {
    title: 'Starry ID API',
    version: '1.0.0',
    description: 'Starry 平台 API：會員與登入、App 設定、購買權益與推播。串接方式見 docs/integration-guide.md。',
  },
  servers: [{ url: 'https://id.starry.phd', description: 'production' }],
};

export const bearer = [{ bearerAuth: [] }];

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'UNAUTHORIZED' }),
      message: z.string(),
      request_id: z.string().optional(),
    }),
  })
  .openapi('Error');

const ERROR_DESCRIPTIONS = {
  400: 'Invalid request',
  401: 'Not signed in, or the token or nonce is invalid',
  403: 'Suspended, deletion pending, App unavailable or not allowed',
  404: 'Not found',
  409: 'Conflict with the current state',
  413: 'Payload too large',
  415: 'Unsupported media type',
  428: 'If-Match required',
  429: 'Rate limited',
  503: 'Not configured or temporarily unavailable',
} as const;

type ErrorStatus = keyof typeof ERROR_DESCRIPTIONS;
type ErrorResponses<S extends ErrorStatus> = {
  [K in S]: { description: string; content: { 'application/json': { schema: typeof ErrorSchema } } };
};

/** Response entries for the given error statuses, all with the shared Error schema. */
export function errorResponses<S extends ErrorStatus>(...statuses: S[]): ErrorResponses<S> {
  const out: Partial<Record<ErrorStatus, unknown>> = {};
  for (const status of statuses) {
    out[status] = { description: ERROR_DESCRIPTIONS[status], content: { 'application/json': { schema: ErrorSchema } } };
  }
  return out as ErrorResponses<S>;
}

export function json<T extends z.ZodType>(schema: T, description: string) {
  return { description, content: { 'application/json': { schema } } };
}

export function jsonBody<T extends z.ZodType>(schema: T) {
  return { required: true, content: { 'application/json': { schema } } };
}

// ---- Shared schemas ----

export const TokenPairSchema = z
  .object({
    token_type: z.string().openapi({ example: 'Bearer' }),
    access_token: z.string(),
    expires_in: z.number().int().openapi({ example: 900 }),
    refresh_token: z.string(),
    refresh_expires_in: z.number().int(),
  })
  .openapi('TokenPair');

export const SignInResponseSchema = TokenPairSchema.extend({
  user: z.object({
    user_id: z.string().openapi({ description: 'Starry member ID (UUIDv7); use as RevenueCat App User ID' }),
    status: z.string().openapi({ example: 'active' }),
    is_new: z.boolean(),
    deletion_purge_at: z.number().int().nullable(),
  }),
  consent_required: z.boolean(),
}).openapi('SignInResponse');

export const ProfileSchema = z
  .object({
    display_name: z.string().nullable(),
    avatar_url: z.string().nullable().openapi({ description: 'Signed path, valid for one hour' }),
    birthday: z.string().nullable().openapi({ example: '1990-02-28' }),
    locale: z.string().openapi({ example: 'zh-TW' }),
    version: z.number().int().openapi({ description: 'Send as If-Match when changing the profile' }),
    updated_at: z.number().int(),
  })
  .openapi('Profile');

export const ProfileResponseSchema = z.object({ profile: ProfileSchema }).openapi('ProfileResponse');

export const VersionConflictSchema = ErrorSchema.extend({ profile: ProfileSchema }).openapi('VersionConflict');

export const MeSchema = z
  .object({
    user_id: z.string(),
    status: z.string(),
    created_at: z.number().int(),
    deletion_requested_at: z.number().int().nullable(),
    deletion_purge_at: z.number().int().nullable(),
    profile: ProfileSchema,
    identities: z.array(z.object({ provider: z.string(), email: z.string().nullable(), email_is_private_relay: z.boolean() })),
    consent: z.object({ terms_version: z.string(), privacy_version: z.string(), required: z.boolean() }),
  })
  .openapi('Me');

export const EntitlementsSchema = z
  .object({
    app_id: z.string(),
    entitlements: z.array(
      z.object({
        entitlement: z.string(),
        expires_at: z.number().int().nullable(),
        product_id: z.string().nullable(),
        store: z.string().nullable(),
        environment: z.string().nullable(),
      }),
    ),
  })
  .openapi('Entitlements');

export const NotificationPreferencesSchema = z
  .object({ app_id: z.string(), categories: z.record(z.string(), z.boolean()) })
  .openapi('NotificationPreferences');

export const ProviderRequestSchema = z.object({
  id_token: z.string().min(1).max(8192),
  nonce: z.string().min(16).max(128),
  authorization_code: z.string().max(1024).optional().openapi({ description: 'Apple only; lets Starry revoke the token at account deletion' }),
  redirect_uri: z.string().max(512).optional().openapi({
    description:
      'Apple web flows only: the redirect URI the authorization code was issued for (Android relay: https://id.starry.phd/auth/apple/callback; an App web version: its own registered URL)',
  }),
});
