import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { apiRouter, bearer, ErrorSchema, errorResponses, json, jsonBody } from '../api/openapi';
import { requireAuth } from '../auth/middleware';
import { fail, resolveApp } from '../auth/routes';
import { perAppSecrets } from '../billing/revenuecat';
import type { AppBindings } from '../env';
import { errorBody } from '../lib/errors';
import { anyStoredKeys, appForServiceKey, appForStoredKey, finish, getBalance, IDEMPOTENCY_KEY, recentActivity, reserve, type Balance, type Reservation } from './battery';

/**
 * Spec S-BAT-03/04/06. Members read their own balance with their access token. Only App
 * backends spend Battery: they present their service key (x-starry-app-key, from the
 * BATTERY_SERVICE_KEYS secret, or the key Admin Lite created for the App) and, to reserve, the member's access token for the same App,
 * so a backend can never spend for a member who is not signed in to it.
 */
export const batteryRoutes = apiRouter();
export const myBatteryRoutes = apiRouter();

type Ctx = Context<AppBindings>;

export const BalanceSchema = z
  .object({
    period: z.string().openapi({ example: '2026-11', description: 'Calendar month in Taiwan time' }),
    allowance: z.number().int(),
    used: z.number().int(),
    reserved: z.number().int(),
    remaining: z.number().int(),
    resets_at: z.number().int().openapi({ description: 'Next reset: the 1st of next month, 00:00 Taiwan time (epoch ms)' }),
  })
  .openapi('BatteryBalance');

const ActivitySchema = z
  .object({
    balance: BalanceSchema,
    activity: z.array(
      z.object({
        entry_id: z.string(),
        kind: z.enum(['usage', 'adjustment']),
        amount: z.number().int().openapi({ description: 'usage: Battery spent; adjustment: change made by Starry staff' }),
        app_id: z.string().nullable(),
        task_label: z.string().nullable(),
        created_at: z.number().int(),
      }),
    ),
    next_cursor: z.string().nullable(),
  })
  .openapi('BatteryActivity');

const ReservationSchema = z
  .object({
    reservation_id: z.string(),
    task_type: z.string(),
    units: z.number().int(),
    amount: z.number().int(),
    status: z.enum(['reserved', 'committed', 'released', 'expired']),
    charged: z.number().int().nullable(),
    created_at: z.number().int(),
    expires_at: z.number().int(),
    replayed: z.boolean().openapi({ description: 'true when an earlier request with the same idempotency key created it' }),
  })
  .openapi('BatteryReservation');

const BatteryConflictSchema = ErrorSchema.extend({ balance: BalanceSchema.optional(), reservation: ReservationSchema.optional() }).openapi('BatteryConflict');

const appKey = [{ appKey: [] }];
const reservationJson = (r: Reservation, replayed = false) => ({
  reservation_id: r.reservation_id,
  task_type: r.task_type,
  units: r.units,
  amount: r.amount,
  status: r.status,
  charged: r.charged,
  created_at: r.created_at,
  expires_at: r.expires_at,
  replayed,
});

// Never valid app_ids (registry ids are lowercase letters, digits and dashes).
export const UNCONFIGURED = '#unconfigured';
export const INVALID = '#invalid';

type ConflictCode = 'BATTERY_INSUFFICIENT' | 'RESERVATION_EXPIRED' | 'RESERVATION_CLOSED' | 'IDEMPOTENCY_CONFLICT';

function conflictBody(c: Ctx, code: ConflictCode, message: string, extra: { balance?: Balance; reservation?: Reservation } = {}): z.infer<typeof BatteryConflictSchema> {
  return {
    ...errorBody(code, message, c.get('requestId')),
    ...(extra.balance ? { balance: extra.balance } : {}),
    ...(extra.reservation ? { reservation: reservationJson(extra.reservation) } : {}),
  };
}

/**
 * The App whose backend is calling, from x-starry-app-key: its app_id, 'unconfigured' or 'invalid'.
 * Keys come from the BATTERY_SERVICE_KEYS secret or from Admin Lite (hashed in battery_app_keys).
 */
export async function callingApp(c: Ctx): Promise<string> {
  const presented = c.req.header('x-starry-app-key');
  const fromSecret = appForServiceKey(perAppSecrets(c.env.BATTERY_SERVICE_KEYS), presented);
  if (fromSecret) return fromSecret;
  const fromAdmin = await appForStoredKey(c.env.DB_BATTERY, presented);
  if (fromAdmin) return fromAdmin;
  if (Object.keys(perAppSecrets(c.env.BATTERY_SERVICE_KEYS)).length === 0 && !(await anyStoredKeys(c.env.DB_BATTERY))) return UNCONFIGURED;
  return INVALID;
}

// ---- Member: GET /v1/me/battery ----

const myBatteryRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Battery'],
  summary: "The member's Starry Battery: this month's balance and the last 30 days",
  description: 'Free monthly AI allowance shared by every Starry App (S-BAT-04). Read-only; Battery cannot be bought.',
  security: bearer,
  middleware: [requireAuth] as const,
  request: { query: z.object({ cursor: z.string().max(64).optional() }) },
  responses: { 200: json(ActivitySchema, 'Balance and activity'), ...errorResponses(400, 401, 403, 429, 503) },
});

myBatteryRoutes.openapi(myBatteryRoute, async (c) => {
  const { userId } = c.get('auth');
  const now = Date.now();
  const db = c.env.DB_BATTERY;
  const [balance, activity] = await Promise.all([getBalance(db, userId, now), recentActivity(db, userId, now, { cursor: c.req.valid('query').cursor })]);
  return c.json(
    {
      balance,
      activity: activity.entries.map((e) => ({ entry_id: e.entry_id, kind: e.kind, amount: e.amount, app_id: e.app_id, task_label: e.task_label, created_at: e.created_at })),
      next_cursor: activity.nextCursor,
    },
    200,
  );
});

// ---- App backends: reserve, commit, release ----

const reserveRoute = createRoute({
  method: 'post',
  path: '/reservations',
  tags: ['Battery'],
  summary: 'App backend: reserve Battery before starting an AI task',
  description:
    'Needs the App backend service key (x-starry-app-key) and the member access token of the same App. Retrying with the same idempotency_key returns the same reservation. 409 BATTERY_INSUFFICIENT when the allowance does not cover it.',
  security: [{ appKey: [], bearerAuth: [] }],
  middleware: [requireAuth] as const,
  request: {
    headers: z.object({ 'x-starry-app-key': z.string().optional() }),
    body: jsonBody(
      z.object({
        task_type: z.string().min(3).max(64).openapi({ example: 'echo.transcribe', description: 'Starts with "<app_id>."; chosen by the App, no registration needed' }),
        task_label: z.string().min(1).max(40).optional().openapi({ example: '語音轉文字', description: 'Name shown to the member in their Battery history' }),
        units: z.number().int().min(1).max(100000).openapi({ description: 'Battery units to reserve (what the App decided this task costs). The server refuses more than 100 with 400.' }),
        idempotency_key: z.string().min(8).max(128),
      }),
    ),
  },
  responses: {
    201: json(ReservationSchema, 'Reserved'),
    200: json(ReservationSchema, 'Same idempotency key: the existing reservation'),
    409: json(BatteryConflictSchema, 'Not enough Battery, or the idempotency key was used for a different request'),
    ...errorResponses(400, 401, 403, 404, 415, 429, 503),
  },
});

batteryRoutes.openapi(reserveRoute, async (c) => {
  const caller = await callingApp(c);
  if (caller === UNCONFIGURED) return fail(c, 503, 'SERVICE_UNAVAILABLE', 'Battery is not configured');
  if (caller === INVALID) return fail(c, 401, 'UNAUTHORIZED', 'Invalid app key');
  const auth = c.get('auth');
  if (auth.appId !== caller) return fail(c, 403, 'FORBIDDEN', 'The access token belongs to another App');
  const app = await resolveApp(c, caller);
  if (app === 'unknown' || app === 'unavailable') return fail(c, 403, 'APP_UNAVAILABLE', 'This app is not available');
  const body = c.req.valid('json');
  if (!IDEMPOTENCY_KEY.test(body.idempotency_key)) return fail(c, 400, 'BAD_REQUEST', 'idempotency_key: 8-128 of A-Z a-z 0-9 . _ : -');
  const result = await reserve(c.env.DB_BATTERY, { userId: auth.userId, appId: caller, taskType: body.task_type, taskLabel: body.task_label ?? null, units: body.units, idempotencyKey: body.idempotency_key }, Date.now());
  if (result.ok && result.replayed) return c.json(reservationJson(result.reservation, true), 200);
  if (result.ok) return c.json(reservationJson(result.reservation), 201);
  switch (result.reason) {
    case 'invalid_task':
      return fail(c, 400, 'BAD_REQUEST', 'task_type must start with "<app_id>." and use lowercase letters, digits, - or _');
    case 'invalid_units':
      return fail(c, 400, 'BAD_REQUEST', 'units must be a whole number from 1 to 100');
    case 'idempotency_conflict':
      return c.json(conflictBody(c, 'IDEMPOTENCY_CONFLICT', 'This idempotency_key was used for a different request'), 409);
    case 'insufficient':
      return c.json(conflictBody(c, 'BATTERY_INSUFFICIENT', 'Not enough Battery this month', { balance: result.balance }), 409);
  }
});

const reservationParams = z.object({ reservationId: z.string().min(1).max(64) });

const commitRoute = createRoute({
  method: 'post',
  path: '/reservations/{reservationId}/commit',
  tags: ['Battery'],
  summary: 'App backend: the AI task succeeded; charge the reservation',
  description: 'Idempotent. units (optional) is the actual usage, at most what was reserved. After the timeout nothing is charged: 409 RESERVATION_EXPIRED.',
  security: appKey,
  request: {
    params: reservationParams,
    headers: z.object({ 'x-starry-app-key': z.string().optional() }),
    body: { required: false, content: { 'application/json': { schema: z.object({ units: z.number().int().min(0).max(100000).optional() }) } } },
  },
  responses: {
    200: json(ReservationSchema, 'Committed'),
    409: json(BatteryConflictSchema, 'Expired or already released'),
    ...errorResponses(400, 401, 404, 415, 429, 503),
  },
});

const releaseRoute = createRoute({
  method: 'post',
  path: '/reservations/{reservationId}/release',
  tags: ['Battery'],
  summary: 'App backend: the AI task failed or was cancelled; return the reservation',
  description: 'Idempotent. 409 RESERVATION_CLOSED when it was already committed.',
  security: appKey,
  request: { params: reservationParams, headers: z.object({ 'x-starry-app-key': z.string().optional() }) },
  responses: {
    200: json(ReservationSchema, 'Released'),
    409: json(BatteryConflictSchema, 'Already committed'),
    ...errorResponses(400, 401, 404, 429, 503),
  },
});

type FinishOutcome =
  | { kind: 'ok'; reservation: Reservation }
  | { kind: 'conflict'; body: z.infer<typeof BatteryConflictSchema> }
  | { kind: 'not_found' }
  | { kind: 'invalid_units' };

async function finishOutcome(c: Ctx, appId: string, action: 'commit' | 'release', reservationId: string, units?: number): Promise<FinishOutcome> {
  const result = await finish(c.env.DB_BATTERY, { reservationId, appId, action, ...(units === undefined ? {} : { units }) }, Date.now());
  if (result.ok) return { kind: 'ok', reservation: result.reservation };
  const extra = result.reservation ? { reservation: result.reservation } : {};
  switch (result.reason) {
    case 'not_found':
      return { kind: 'not_found' };
    case 'invalid_units':
      return { kind: 'invalid_units' };
    case 'expired':
      return { kind: 'conflict', body: conflictBody(c, 'RESERVATION_EXPIRED', 'The reservation timed out and was released; nothing was charged', extra) };
    case 'closed':
      return { kind: 'conflict', body: conflictBody(c, 'RESERVATION_CLOSED', action === 'commit' ? 'The reservation was already released' : 'The reservation was already committed', extra) };
  }
}

batteryRoutes.openapi(commitRoute, async (c) => {
  const caller = await callingApp(c);
  if (caller === UNCONFIGURED) return fail(c, 503, 'SERVICE_UNAVAILABLE', 'Battery is not configured');
  if (caller === INVALID) return fail(c, 401, 'UNAUTHORIZED', 'Invalid app key');
  const { units } = c.req.valid('json') ?? {};
  const outcome = await finishOutcome(c, caller, 'commit', c.req.valid('param').reservationId, units);
  if (outcome.kind === 'ok') return c.json(reservationJson(outcome.reservation), 200);
  if (outcome.kind === 'conflict') return c.json(outcome.body, 409);
  if (outcome.kind === 'invalid_units') return fail(c, 400, 'BAD_REQUEST', 'units must be between 0 and the reserved units');
  return fail(c, 404, 'NOT_FOUND', 'Reservation not found');
});

batteryRoutes.openapi(releaseRoute, async (c) => {
  const caller = await callingApp(c);
  if (caller === UNCONFIGURED) return fail(c, 503, 'SERVICE_UNAVAILABLE', 'Battery is not configured');
  if (caller === INVALID) return fail(c, 401, 'UNAUTHORIZED', 'Invalid app key');
  const outcome = await finishOutcome(c, caller, 'release', c.req.valid('param').reservationId);
  if (outcome.kind === 'ok') return c.json(reservationJson(outcome.reservation), 200);
  if (outcome.kind === 'conflict') return c.json(outcome.body, 409);
  if (outcome.kind === 'invalid_units') return fail(c, 400, 'BAD_REQUEST', 'units must be between 0 and the reserved units');
  return fail(c, 404, 'NOT_FOUND', 'Reservation not found');
});
