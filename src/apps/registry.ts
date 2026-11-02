import registryFile from '../../config/apps.json';

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
}

const APP_ID = /^[a-z][a-z0-9-]{1,31}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const STATUSES: readonly AppStatus[] = ['active', 'paused', 'killed'];
const SCOPE = /^[a-z]+:[a-z]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string, appId: string): string | null {
  if (value === null) return null;
  if (typeof value === 'string' && value.length > 0 && value.length <= 200) return value;
  throw new Error(`App registry: ${appId}.${field} must be null or a non-empty string`);
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
    apps.set(id, Object.freeze({
      app_id: id,
      name: item.name,
      ios_bundle_id: optionalString(item.ios_bundle_id, 'ios_bundle_id', id),
      android_package: optionalString(item.android_package, 'android_package', id),
      status: item.status as AppStatus,
      scopes: Object.freeze([...(item.scopes as string[])]),
      min_version: item.min_version,
      config: Object.freeze({ ...item.config }),
    }));
  }
  return apps;
}

export const appRegistry: ReadonlyMap<string, AppEntry> = parseRegistry(registryFile);

export function getApp(appId: string): AppEntry | undefined {
  return appRegistry.get(appId);
}
