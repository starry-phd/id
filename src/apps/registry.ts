import registryFile from '../../config/apps.json';
import type { Env } from '../env';
import type { Provider } from '../auth/provider-keys';

export type AppStatus = 'active' | 'paused' | 'killed';

export interface AppEntry {
  app_id: string;
  name: string;
  ios_bundle_id: string | null;
  android_package: string | null;
  status: AppStatus;
  scopes: readonly string[];
  min_version: string;
  config: Readonly<Record<string, unknown>>;
  /** Accepted ID-token audiences per provider: iOS bundle ID, Apple Services ID, Google client IDs. */
  auth: Readonly<Record<Provider, readonly string[]>>;
}

const APP_ID = /^[a-z][a-z0-9-]{1,31}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const STATUSES: readonly AppStatus[] = ['active', 'paused', 'killed'];
const SCOPE = /^[a-z]+:[a-z]+$/;
const AUDIENCE = /^[A-Za-z0-9._:-]{1,200}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string, appId: string): string | null {
  if (value === null) return null;
  if (typeof value === 'string' && value.length > 0 && value.length <= 200) return value;
  throw new Error(`App registry: ${appId}.${field} must be null or a non-empty string`);
}

function audiences(value: unknown, field: string, appId: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((a) => typeof a === 'string' && AUDIENCE.test(a))) {
    throw new Error(`App registry: ${appId}.auth.${field} must be a list of client IDs`);
  }
  return Object.freeze([...(value as string[])]);
}

/**
 * Validates config/apps.json once at module load. An invalid registry fails
 * the build and every test, so a broken entry can never be deployed.
 */
export function parseRegistry(raw: unknown): ReadonlyMap<string, AppEntry> {
  if (!isRecord(raw) || raw.brand !== 'starry' || !Array.isArray(raw.apps)) {
    throw new Error('App registry: expected { brand: "starry", apps: [...] }');
  }
  const apps = new Map<string, AppEntry>();
  for (const item of raw.apps) {
    if (!isRecord(item) || typeof item.app_id !== 'string' || !APP_ID.test(item.app_id)) {
      throw new Error('App registry: every app needs a lowercase app_id');
    }
    const id = item.app_id;
    if (apps.has(id)) throw new Error(`App registry: duplicate app_id ${id}`);
    if (typeof item.name !== 'string' || item.name.length === 0) {
      throw new Error(`App registry: ${id}.name is required`);
    }
    if (!STATUSES.includes(item.status as AppStatus)) {
      throw new Error(`App registry: ${id}.status must be one of ${STATUSES.join(', ')}`);
    }
    if (typeof item.min_version !== 'string' || !SEMVER.test(item.min_version)) {
      throw new Error(`App registry: ${id}.min_version must look like 1.2.3`);
    }
    if (!Array.isArray(item.scopes) || !item.scopes.every((s) => typeof s === 'string' && SCOPE.test(s))) {
      throw new Error(`App registry: ${id}.scopes must be strings like "profile:read"`);
    }
    if (!isRecord(item.config)) throw new Error(`App registry: ${id}.config must be an object`);
    if (!isRecord(item.auth)) throw new Error(`App registry: ${id}.auth must be an object`);
    apps.set(id, Object.freeze({
      app_id: id,
      name: item.name,
      ios_bundle_id: optionalString(item.ios_bundle_id, 'ios_bundle_id', id),
      android_package: optionalString(item.android_package, 'android_package', id),
      status: item.status as AppStatus,
      scopes: Object.freeze([...(item.scopes as string[])]),
      min_version: item.min_version,
      config: Object.freeze({ ...item.config }),
      auth: Object.freeze({
        apple: audiences(item.auth.apple_audiences, 'apple_audiences', id),
        google: audiences(item.auth.google_audiences, 'google_audiences', id),
      }),
    }));
  }
  return apps;
}

export const appRegistry: ReadonlyMap<string, AppEntry> = parseRegistry(registryFile);

export function getApp(appId: string): AppEntry | undefined {
  return appRegistry.get(appId);
}

/**
 * ID-token audiences accepted for this App. In development only, tests may
 * supply AUTH_TEST_AUDIENCES as {"<app_id>": {"apple": [...], "google": [...]}}.
 */
export function audiencesFor(env: Env, app: AppEntry, provider: Provider): readonly string[] {
  if (env.STARRY_ENV === 'development' && env.AUTH_TEST_AUDIENCES) {
    let all: unknown;
    try {
      all = JSON.parse(env.AUTH_TEST_AUDIENCES);
    } catch {
      return [];
    }
    const entry = isRecord(all) ? all[app.app_id] : undefined;
    const list = isRecord(entry) ? entry[provider] : undefined;
    return Array.isArray(list) ? list.filter((a): a is string => typeof a === 'string') : [];
  }
  return app.auth[provider];
}
