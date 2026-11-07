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
  /** HTTPS origins of the App's web version: CORS on /v1, Apple redirect_uri, and sign-in relay return pages. */
  web_origins: readonly string[];
  /** App deep links the sign-in relay may return to (Android), e.g. echostarry://auth/apple. */
  return_urls: readonly string[];
  /** Apple Developer Team ID; with ios_bundle_id it lets the iOS App use Starry Passkeys (apple-app-site-association). */
  ios_team_id: string | null;
  /** SHA-256 fingerprints of the Android signing certificates (AA:BB:…); with android_package they allow Passkeys (assetlinks.json). */
  android_cert_sha256: readonly string[];
}

const APP_ID = /^[a-z][a-z0-9-]{1,31}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const STATUSES: readonly AppStatus[] = ['active', 'paused', 'killed'];
const SCOPE = /^[a-z]+:[a-z]+$/;
const TEAM_ID = /^[A-Z0-9]{10}$/;
const CERT_SHA256 = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const AUDIENCE = /^[A-Za-z0-9._:-]{1,200}$/;
const WEB_ORIGIN = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/;
// Custom-scheme deep links only, so the relay can never send tokens to a web page.
const RETURN_URL = /^(?!(?:https?|javascript|data|file|intent|blob|about):)[a-z][a-z0-9+.-]{1,30}:\/\/[A-Za-z0-9._~/-]{1,100}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string, appId: string): string | null {
  if (value === null) return null;
  if (typeof value === 'string' && value.length > 0 && value.length <= 200) return value;
  throw new Error(`App registry: ${appId}.${field} must be null or a non-empty string`);
}

function patternList(value: unknown, pattern: RegExp, field: string, appId: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && pattern.test(v))) {
    throw new Error(`App registry: ${appId}.${field} has an invalid entry`);
  }
  return Object.freeze([...(value as string[])]);
}

function teamId(value: unknown, appId: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && TEAM_ID.test(value)) return value;
  throw new Error(`App registry: ${appId}.ios_team_id must be the 10-character Apple Team ID`);
}

function audiences(value: unknown, field: string, appId: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((a) => typeof a === 'string' && AUDIENCE.test(a))) {
    throw new Error(`App registry: ${appId}.auth.${field} must be a list of client IDs`);
  }
  return Object.freeze([...(value as string[])]);
}

/** Validates one App definition (same shape as an entry of config/apps.json). */
export function parseApp(item: unknown): AppEntry {
  if (!isRecord(item) || typeof item.app_id !== 'string' || !APP_ID.test(item.app_id)) {
    throw new Error('App registry: every app needs a lowercase app_id');
  }
  const id = item.app_id;
  if (typeof item.name !== 'string' || item.name.length === 0 || item.name.length > 80) {
    throw new Error(`App registry: ${id}.name is required (at most 80 characters)`);
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
  return Object.freeze({
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
    web_origins: patternList(item.web_origins, WEB_ORIGIN, 'web_origins', id),
    return_urls: patternList(item.return_urls, RETURN_URL, 'return_urls', id),
    ios_team_id: teamId(item.ios_team_id, id),
    android_cert_sha256: patternList(item.android_cert_sha256, CERT_SHA256, 'android_cert_sha256', id),
  });
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
    const app = parseApp(item);
    if (apps.has(app.app_id)) throw new Error(`App registry: duplicate app_id ${app.app_id}`);
    apps.set(app.app_id, app);
  }
  return apps;
}

const staticApps: ReadonlyMap<string, AppEntry> = parseRegistry(registryFile);

/** The JSON shape of one App definition (an entry of config/apps.json). */
export function appDefinition(app: AppEntry): Record<string, unknown> {
  return {
    app_id: app.app_id,
    name: app.name,
    ios_bundle_id: app.ios_bundle_id,
    android_package: app.android_package,
    status: app.status,
    scopes: app.scopes,
    min_version: app.min_version,
    config: app.config,
    auth: { apple_audiences: app.auth.apple, google_audiences: app.auth.google },
    web_origins: app.web_origins,
    return_urls: app.return_urls,
    ios_team_id: app.ios_team_id,
    android_cert_sha256: app.android_cert_sha256,
  };
}

/**
 * Every App except the account center, registered by the Owner in Admin Lite (table registered_apps). The Worker
 * refreshes this map at most every 30 seconds (see dynamic.ts). config/apps.json holds only the account center.
 */
let dynamicApps: ReadonlyMap<string, AppEntry> = new Map();

export function setDynamicApps(apps: ReadonlyMap<string, AppEntry>): void {
  dynamicApps = apps;
}

/** The registered App as last loaded successfully (used to keep an App alive when its row turns out to be broken). */
export function registeredApp(appId: string): AppEntry | undefined {
  return dynamicApps.get(appId);
}

/** True for the App defined in config/apps.json (only the account center); every other App is registered in Admin Lite. */
export function isStaticApp(appId: string): boolean {
  return staticApps.has(appId);
}

/** Read-only view over the account center (config/apps.json) plus every App registered in Admin Lite. */
export const appRegistry = {
  has: (appId: string): boolean => staticApps.has(appId) || dynamicApps.has(appId),
  get: (appId: string): AppEntry | undefined => staticApps.get(appId) ?? dynamicApps.get(appId),
  keys: (): string[] => [...staticApps.keys(), ...[...dynamicApps.keys()].filter((id) => !staticApps.has(id))],
  values: (): AppEntry[] => [...staticApps.values(), ...[...dynamicApps.values()].filter((a) => !staticApps.has(a.app_id))],
};

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
