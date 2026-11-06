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

const VisibilityValue = z.enum(['public', 'private']);

export const VisibilitySchema = z
  .object({
    display_name: VisibilityValue,
    avatar: VisibilityValue,
    birthday: VisibilityValue.openapi({ description: 'Public shows month and day only; always private for members under 18' }),
    derived: VisibilityValue.openapi({ description: 'Zodiac and life path number; always private for members under 18' }),
    location: VisibilityValue.openapi({ description: 'Country, state/province and city' }),
    phone: VisibilityValue,
    motto: VisibilityValue,
    contact_email: VisibilityValue.openapi({ description: 'Shown only once verified' }),
  })
  .openapi('ProfileVisibility');

export const DerivedSchema = z
  .object({
    zodiac: z.string().openapi({ example: 'pisces' }),
    zodiac_name: z.string().openapi({ example: '雙魚座' }),
    talent_numbers: z.array(z.number().int()).openapi({ description: 'Digit sums of the birth date before the final digit, e.g. [31]', example: [31] }),
    life_path_number: z.number().int().openapi({ example: 4 }),
    grid: z.array(z.object({ number: z.number().int(), count: z.number().int() })).openapi({ description: '1-9 counts for the 3×3 grid (rows 3-6-9 / 2-5-8 / 1-4-7)' }),
    lines: z.array(z.string()).openapi({ description: 'Complete grid lines', example: ['1-2-3'] }),
  })
  .openapi('ProfileDerived');

export const PublicProfileSchema = z
  .object({
    display_name: z.string().nullable(),
    avatar_url: z.string().nullable(),
    birthday_month_day: z.string().nullable().openapi({ example: '02-28' }),
    zodiac_name: z.string().nullable(),
    life_path_number: z.number().int().nullable(),
    location: z.object({ country: z.string().nullable(), region: z.string().nullable(), city: z.string().nullable() }).nullable(),
    phone: z.string().nullable(),
    motto: z.string().nullable(),
    contact_email: z.string().nullable(),
  })
  .openapi('PublicProfile');

export const ProfileSchema = z
  .object({
    display_name: z.string().nullable().openapi({ description: 'Name shown to others (姓名), 1-50 characters' }),
    avatar_url: z.string().nullable().openapi({ description: 'Signed path, valid for one hour' }),
    birthday: z.string().nullable().openapi({ example: '1990-02-28' }),
    locale: z.string().openapi({ example: 'zh-TW' }),
    contact_email: z.string().nullable().openapi({ description: 'Main contact email typed by the member; system email uses it once verified' }),
    contact_email_verified: z.boolean(),
    phone: z.string().nullable().openapi({ description: 'E.164', example: '+886912345678' }),
    country: z.string().nullable().openapi({ description: 'ISO 3166-1 alpha-2', example: 'TW' }),
    region: z.string().nullable().openapi({ description: 'State, province or county', example: '臺北市' }),
    city: z.string().nullable().openapi({ example: '大安區' }),
    motto: z.string().nullable(),
    derived: DerivedSchema.nullable().openapi({ description: 'From the birthday; null without one' }),
    visibility: VisibilitySchema,
    field_updated_at: z
      .record(z.string(), z.object({ updated_at: z.number().int(), source: z.enum(['member', 'staff']) }))
      .openapi({ description: 'When each field was last changed and by whom (02.10)' }),
    version: z.number().int().openapi({ description: 'Send as If-Match when changing the profile' }),
    updated_at: z.number().int(),
  })
  .openapi('Profile');

export const ProfileResponseSchema = z.object({ profile: ProfileSchema }).openapi('ProfileResponse');

export const VersionConflictSchema = ErrorSchema.extend({ profile: ProfileSchema }).openapi('VersionConflict');

export const MeSchema = z
  .object({
    user_id: z.string(),
    member_no: z.string().nullable(),
    status: z.string(),
    created_at: z.number().int(),
    deletion_requested_at: z.number().int().nullable(),
    deletion_purge_at: z.number().int().nullable(),
    profile: ProfileSchema,
    public_profile: PublicProfileSchema.openapi({ description: 'What other members may see under the current visibility settings' }),
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
