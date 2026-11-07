/**
 * Starry Client — one file for App frontends (Expo / React Native and web). No dependencies.
 * Copy this file into your App. It never holds a service key; the Battery key stays in your backend (starry-sdk.ts).
 *
 * What it does for you: sign-in (Apple / Google through the Starry login relay, or an ID token from a native
 * library, or a Passkey), token storage and refresh (one refresh at a time, retry once after a 401), reading the
 * App's config and announcements, and the account calls every App must offer.
 *
 *   const starry = new StarryClient({
 *     baseUrl: 'https://id.starry.phd',
 *     appId: 'clock',
 *     storage: secureStoreAdapter,            // Expo: expo-secure-store. Web: sessionStorageAdapter()
 *     sha256Hex: (text) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text), // Expo only
 *     openAuthSession: async (url, returnUrl) => { const r = await WebBrowser.openAuthSessionAsync(url, returnUrl); return r.type === 'success' ? r.url : null; },
 *   });
 *   const gate = await starry.checkApp('1.4.0');          // maintenance / update_required / killed / ok + notices
 *   if (!(await starry.restore())) await starry.signInWithRelay('google', { returnUrl: 'clock://auth/google' });
 *   const me = await starry.me();
 */

export type Provider = 'apple' | 'google';

/** Where the Refresh Token lives. Native: expo-secure-store (never AsyncStorage). Web: sessionStorage, never localStorage. */
export interface StarryStorage {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}

export interface PasskeyAssertion {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}
export interface PasskeyAttestation {
  clientDataJSON: string;
  attestationObject: string;
}
/** The platform's Passkey API. On the web use webPasskeyAdapter(); in Expo wrap react-native-passkey (all values base64url). */
export interface PasskeyAdapter {
  get(publicKey: Record<string, unknown>): Promise<PasskeyAssertion>;
  create(publicKey: Record<string, unknown>): Promise<PasskeyAttestation>;
}

export interface StarryClientOptions {
  baseUrl: string;
  appId: string;
  storage: StarryStorage;
  fetch?: typeof fetch;
  /** SHA-256 as lowercase hex. Defaults to Web Crypto (browsers, Node, Workers); Expo needs expo-crypto. */
  sha256Hex?: (text: string) => Promise<string>;
  /** Random URL-safe text for the relay `state`. Defaults to Web Crypto. */
  randomState?: () => string;
  /** Native relay sign-in: open the URL, resolve with the final return URL, or null when the member cancelled. */
  openAuthSession?: (url: string, returnUrl: string) => Promise<string | null>;
  /** Web relay sign-in: leave the page for the URL. Defaults to location.assign. */
  navigate?: (url: string) => void;
  passkey?: PasskeyAdapter;
  /**
   * Storage shared by every Starry App on the device (iOS keychain access group, Android shared account).
   * With it, signing in to any App signs in all of them, and signing out or switching member follows everywhere.
   * Call syncDeviceSignIn() when the App comes to the foreground.
   */
  sharedStorage?: StarryStorage;
  /** Shown to the member in their device list, e.g. "iPhone 16". */
  deviceLabel?: string;
  now?: () => number;
}

export interface StarryUser {
  user_id: string;
  status: string;
  is_new: boolean;
  deletion_purge_at: number | null;
}
export interface SignInResult {
  user: StarryUser;
  /** True when the member has to accept the current terms first: show them, then call acceptConsent(). */
  consent_required: boolean;
}
export interface AppNotice {
  message: string;
  starts_at: number;
  ends_at: number;
}
export interface AppConfig {
  app_id: string;
  status: 'active' | 'paused' | 'killed' | string;
  min_version: string;
  config: Record<string, unknown>;
  notices: AppNotice[];
}
export type AppGateState = 'ok' | 'maintenance' | 'killed' | 'update_required' | 'unreachable';
export interface AppGate {
  state: AppGateState;
  /** Announcements to show right now (empty when Starry ID could not be reached). */
  notices: AppNotice[];
  config: Record<string, unknown>;
  minVersion: string | null;
}
export interface Entitlement {
  entitlement: string;
  expires_at: number | null;
  product_id: string | null;
  store: string | null;
  environment: string | null;
}
export interface Me {
  user_id: string;
  member_no: string | null;
  status: string;
  profile: Record<string, unknown>;
  public_profile: Record<string, unknown>;
  identities: { provider: string; email: string | null; email_is_private_relay: boolean }[];
  consent: { terms_version: string; privacy_version: string; required: boolean };
  [key: string]: unknown;
}

export type AuthEvent = 'signed-in' | 'signed-out';

/** Every failure is a StarryError: `status` is the HTTP status, or 0 for problems before/outside HTTP. */
export class StarryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
    /** Seconds to wait before retrying (429 only). */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = 'StarryError';
  }
  /** The member closed the sign-in or Passkey sheet: not an error to show. */
  get cancelled(): boolean {
    return this.code === 'RELAY_CANCELLED' || this.code === 'PASSKEY_CANCELLED';
  }
  get suspended(): boolean {
    return this.code === 'ACCOUNT_SUSPENDED';
  }
  get insufficientBattery(): boolean {
    return this.code === 'BATTERY_INSUFFICIENT';
  }
}

// ---------- small helpers ----------

const encoder = new TextEncoder();

export function base64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of view) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function webSha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function webRandomState(): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(18)));
}

/** "1.4.0" vs "1.10.2": numeric, missing parts count as 0, anything after a "-" or "+" is ignored. Negative: a < b. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[-+]/)[0]!.split('.').map((p) => Number.parseInt(p, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length, 3); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** What the relay appended to the return URL: after `#` for web addresses, after `?` for App schemes. */
export interface RelayResult {
  idToken: string | null;
  code: string | null;
  state: string | null;
  error: string | null;
}
export function parseRelayResult(url: string): RelayResult | null {
  const hash = url.indexOf('#');
  const query = url.indexOf('?');
  const raw = hash >= 0 ? url.slice(hash + 1) : query >= 0 ? url.slice(query + 1) : '';
  const params = new URLSearchParams(raw);
  if (!params.has('id_token') && !params.has('error')) return null;
  return { idToken: params.get('id_token'), code: params.get('code'), state: params.get('state'), error: params.get('error') };
}

/** Refresh Token in sessionStorage: survives a page reload, gone when the tab closes. */
export function sessionStorageAdapter(): StarryStorage {
  return {
    get: (key) => globalThis.sessionStorage.getItem(key),
    set: (key, value) => globalThis.sessionStorage.setItem(key, value),
    remove: (key) => globalThis.sessionStorage.removeItem(key),
  };
}

/** In memory only (tests, server rendering). */
export function memoryStorage(): StarryStorage {
  const map = new Map<string, string>();
  return { get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v), remove: (k) => void map.delete(k) };
}

/** Passkeys in a browser (Chrome 128+, Safari 18+). Check `window.PublicKeyCredential` first and fall back to Apple / Google. */
export function webPasskeyAdapter(): PasskeyAdapter {
  const buffers = (list: unknown): unknown =>
    Array.isArray(list) ? list.map((item) => ({ ...(item as object), id: base64urlDecode(String((item as { id: string }).id)) })) : undefined;
  return {
    async get(publicKey) {
      const credential = (await navigator.credentials.get({
        publicKey: { ...publicKey, challenge: base64urlDecode(String(publicKey.challenge)), allowCredentials: buffers(publicKey.allowCredentials) ?? [] } as unknown as PublicKeyCredentialRequestOptions,
      })) as PublicKeyCredential | null;
      if (!credential) throw new StarryError(0, 'PASSKEY_CANCELLED', 'Passkey cancelled');
      const response = credential.response as AuthenticatorAssertionResponse;
      return {
        id: credential.id,
        clientDataJSON: base64urlEncode(response.clientDataJSON),
        authenticatorData: base64urlEncode(response.authenticatorData),
        signature: base64urlEncode(response.signature),
      };
    },
    async create(publicKey) {
      const user = publicKey.user as { id: string };
      const credential = (await navigator.credentials.create({
        publicKey: {
          ...publicKey,
          challenge: base64urlDecode(String(publicKey.challenge)),
          user: { ...user, id: base64urlDecode(user.id) },
          excludeCredentials: buffers(publicKey.excludeCredentials),
        } as unknown as PublicKeyCredentialCreationOptions,
      })) as PublicKeyCredential | null;
      if (!credential) throw new StarryError(0, 'PASSKEY_CANCELLED', 'Passkey cancelled');
      const response = credential.response as AuthenticatorAttestationResponse;
      return { clientDataJSON: base64urlEncode(response.clientDataJSON), attestationObject: base64urlEncode(response.attestationObject) };
    },
  };
}

function passkeyFailure(error: unknown): StarryError {
  if (error instanceof StarryError) return error;
  const name = (error as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'AbortError' || name === 'UserCancelled') return new StarryError(0, 'PASSKEY_CANCELLED', 'Passkey cancelled');
  if (name === 'InvalidStateError') return new StarryError(0, 'PASSKEY_EXISTS', 'This device already has this Passkey');
  if (name === 'NotSupportedError' || name === 'SecurityError') return new StarryError(0, 'PASSKEY_UNSUPPORTED', 'Passkeys are not available here');
  return new StarryError(0, 'PASSKEY_FAILED', error instanceof Error ? error.message : 'Passkey failed');
}

// ---------- the client ----------

interface PendingRelay {
  provider: Provider;
  nonce: string;
  state: string;
}

const EARLY_MS = 30_000;

export class StarryClient {
  private readonly f: typeof fetch;
  private readonly base: string;
  private readonly listeners = new Set<(event: AuthEvent) => void>();
  private accessToken: string | null = null;
  private accessExpiresAt = 0;
  private refreshing: Promise<string | null> | null = null;

  constructor(private readonly options: StarryClientOptions) {
    // fetch must stay bound to its owner in browsers.
    this.f = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.base = options.baseUrl.replace(/\/+$/, '');
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }
  private key(name: string): string {
    return `starry.${name}.${this.options.appId}`;
  }
  private emit(event: AuthEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** Called after a successful sign-in and after the member is signed out (also when another request notices). */
  onAuthChange(listener: (event: AuthEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ----- HTTP -----

  private async send<T>(method: string, path: string, init: { body?: unknown; token?: string | null } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await this.f(`${this.base}${path}`, { method, headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
    } catch {
      throw new StarryError(0, 'NETWORK', 'Cannot reach Starry ID');
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const e = (parsed as { error?: { code?: string; message?: string; request_id?: string } } | null)?.error;
      const retry = Number(res.headers.get('retry-after'));
      throw new StarryError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `HTTP ${res.status}`, e?.request_id ?? null, Number.isFinite(retry) && retry > 0 ? retry : null);
    }
    return parsed as T;
  }

  /** A signed-in request. A 401 triggers one refresh and one retry; a suspended account signs the member out. */
  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const first = await this.getAccessToken();
    if (!first) throw new StarryError(401, 'NOT_SIGNED_IN', 'Please sign in');
    try {
      return await this.send<T>(method, path, { body, token: first });
    } catch (error) {
      if (error instanceof StarryError && error.status === 401) {
        const renewed = await this.refresh();
        if (!renewed) throw error;
        return this.send<T>(method, path, { body, token: renewed });
      }
      if (error instanceof StarryError && error.suspended) await this.clearSession();
      throw error;
    }
  }

  // ----- tokens -----

  /** A valid Access Token (refreshing if it is about to expire), or null when nobody is signed in. */
  async getAccessToken(): Promise<string | null> {
    if (this.accessToken && this.now() < this.accessExpiresAt - EARLY_MS) return this.accessToken;
    return this.refresh();
  }

  /**
   * Exchanges the stored Refresh Token. Concurrent callers share one exchange: a Refresh Token can be used only once,
   * and a second use would revoke the whole session. A network failure keeps the session; a rejected token ends it.
   */
  refresh(): Promise<string | null> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<string | null> {
    const stored = await this.options.storage.get(this.key('refresh'));
    if (!stored) {
      this.accessToken = null;
      return null;
    }
    try {
      const pair = await this.send<{ access_token: string; expires_in: number; refresh_token: string }>('POST', '/v1/auth/refresh', { body: { refresh_token: stored } });
      await this.storeTokens(pair);
      return pair.access_token;
    } catch (error) {
      if (error instanceof StarryError && (error.status === 401 || error.suspended)) await this.clearSession();
      if (error instanceof StarryError && error.status === 0) throw error;
      return null;
    }
  }

  private async storeTokens(pair: { access_token: string; expires_in: number; refresh_token: string }): Promise<void> {
    this.accessToken = pair.access_token;
    this.accessExpiresAt = this.now() + pair.expires_in * 1000;
    // The new Refresh Token replaces the old one before anything else can use the old one again.
    await this.options.storage.set(this.key('refresh'), pair.refresh_token);
  }

  private async clearSession(): Promise<void> {
    const had = this.accessToken !== null || (await this.options.storage.get(this.key('refresh'))) !== null;
    this.accessToken = null;
    this.accessExpiresAt = 0;
    await this.options.storage.remove(this.key('refresh'));
    if (had) this.emit('signed-out');
  }

  /** App start: true when a stored session is still good (call before showing the sign-in screen). */
  async restore(): Promise<boolean> {
    try {
      if (this.options.sharedStorage) return await this.syncDeviceSignIn();
      return (await this.getAccessToken()) !== null;
    } catch {
      // Offline: keep the session; calls that need the server will fail until the connection is back.
      return (await this.options.storage.get(this.key('refresh'))) !== null;
    }
  }

  get signedIn(): boolean {
    return this.accessToken !== null;
  }

  private memberOfToken(token: string | null): string | null {
    try {
      const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(String(token).split('.')[1] ?? ''))) as { sub?: string };
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  /**
   * Keeps this App in step with the device sign-on shared by all Starry Apps: signed out elsewhere → signed out here,
   * another member elsewhere → switched here, signed in elsewhere → signed in here. Call at start and when the App
   * returns to the foreground. Resolves true when a member is signed in afterwards. Offline keeps the current state.
   */
  async syncDeviceSignIn(): Promise<boolean> {
    const shared = this.options.sharedStorage;
    if (!shared) return (await this.getAccessToken()) !== null;
    const ssoToken = await shared.get('starry.sso');
    const hasOwn = (await this.options.storage.get(this.key('refresh'))) !== null;
    if (!ssoToken) {
      // Nobody is signed in on the device. An App that signed in before this feature adopts the session as the device's.
      const token = hasOwn ? await this.getAccessToken() : null;
      if (token) await this.startDeviceSignIn(token);
      return token !== null;
    }
    let status: { active: boolean; user_id: string | null };
    try {
      status = await this.send('POST', '/v1/auth/sso/status', { body: { sso_token: ssoToken } });
    } catch (error) {
      if (error instanceof StarryError && error.status === 0) return hasOwn;
      throw error;
    }
    if (!status.active) {
      await shared.remove('starry.sso');
      await this.clearSession();
      return false;
    }
    if (hasOwn) {
      const token = await this.getAccessToken();
      if (token && this.memberOfToken(token) === status.user_id) return true;
      await this.clearSession();
    }
    try {
      const result = await this.send<SignInResult & { access_token: string; expires_in: number; refresh_token: string }>('POST', '/v1/auth/sso/exchange', {
        body: { app_id: this.options.appId, sso_token: ssoToken, ...(this.options.deviceLabel ? { device_label: this.options.deviceLabel } : {}) },
      });
      await this.storeTokens(result);
      this.emit('signed-in');
      return true;
    } catch (error) {
      if (error instanceof StarryError && error.status === 0) return false;
      if (error instanceof StarryError && error.status === 401) await shared.remove('starry.sso');
      return false;
    }
  }

  /** Tells the other Apps on this device who is signed in. Best effort: this App is already signed in either way. */
  private async startDeviceSignIn(token: string): Promise<void> {
    const shared = this.options.sharedStorage;
    if (!shared) return;
    try {
      const previous = await shared.get('starry.sso');
      const started = await this.send<{ sso_token: string }>('POST', '/v1/auth/sso/start', { token, body: previous ? { previous_sso_token: previous } : {} });
      await shared.set('starry.sso', started.sso_token);
    } catch {
      // The other Apps will not follow until the next sign-in; this App works normally.
    }
  }

  private async finishSignIn(result: SignInResult & { access_token: string; expires_in: number; refresh_token: string }): Promise<SignInResult> {
    await this.storeTokens(result);
    await this.startDeviceSignIn(result.access_token);
    this.emit('signed-in');
    return { user: result.user, consent_required: result.consent_required };
  }

  // ----- sign-in -----

  nonce(): Promise<string> {
    return this.send<{ nonce: string }>('POST', '/v1/auth/nonce', { body: { app_id: this.options.appId } }).then((r) => r.nonce);
  }

  /** You already have an ID token from a native Apple / Google library: nonce() first, hand it to that library, then call this. */
  async signInWithIdToken(provider: Provider, input: { idToken: string; nonce: string; authorizationCode?: string; redirectUri?: string }): Promise<SignInResult> {
    const result = await this.send<SignInResult & { access_token: string; expires_in: number; refresh_token: string }>('POST', `/v1/auth/${provider}`, {
      body: {
        app_id: this.options.appId,
        id_token: input.idToken,
        nonce: input.nonce,
        ...(input.authorizationCode ? { authorization_code: input.authorizationCode } : {}),
        ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
        ...(this.options.deviceLabel ? { device_label: this.options.deviceLabel } : {}),
      },
    });
    return this.finishSignIn(result);
  }

  private async relayUrl(provider: Provider, returnUrl: string): Promise<{ url: string; pending: PendingRelay }> {
    const nonce = await this.nonce();
    const hash = await (this.options.sha256Hex ?? webSha256Hex)(nonce);
    const state = (this.options.randomState ?? webRandomState)();
    const url = `${this.base}/auth/${provider}/start?${new URLSearchParams({ app_id: this.options.appId, nonce: hash, return: returnUrl, state })}`;
    return { url, pending: { provider, nonce, state } };
  }

  private async finishRelay(pending: PendingRelay, resultUrl: string): Promise<SignInResult> {
    const result = parseRelayResult(resultUrl);
    if (!result || result.state !== pending.state) throw new StarryError(0, 'RELAY_STATE_MISMATCH', 'Sign-in could not be verified, please try again');
    if (result.error || !result.idToken) {
      const cancelled = /cancel|access_denied|user_cancelled/i.test(result.error ?? '');
      throw new StarryError(0, cancelled ? 'RELAY_CANCELLED' : 'RELAY_FAILED', result.error ?? 'Sign-in failed');
    }
    if (pending.provider === 'apple' && !result.code) throw new StarryError(0, 'RELAY_FAILED', 'Apple did not return a code');
    return this.signInWithIdToken(pending.provider, {
      idToken: result.idToken,
      nonce: pending.nonce,
      ...(pending.provider === 'apple' && result.code ? { authorizationCode: result.code, redirectUri: `${this.base}/auth/apple/callback` } : {}),
    });
  }

  /**
   * Apps (iOS, Android, or a web view with a popup-style browser): opens the Starry relay and finishes the sign-in.
   * returnUrl is your App scheme, e.g. "clock://auth/google" (it must be registered for the App in Admin Lite).
   * Throws a StarryError whose `cancelled` is true when the member closed the sheet.
   */
  async signInWithRelay(provider: Provider, options: { returnUrl: string }): Promise<SignInResult> {
    const open = this.options.openAuthSession;
    if (!open) throw new Error('openAuthSession is required for signInWithRelay (use beginRelayRedirect on the web)');
    const { url, pending } = await this.relayUrl(provider, options.returnUrl);
    const finalUrl = await open(url, options.returnUrl);
    if (!finalUrl) throw new StarryError(0, 'RELAY_CANCELLED', 'Sign-in cancelled');
    return this.finishRelay(pending, finalUrl);
  }

  /** Web, step 1: leaves the page. returnUrl is a page on your registered web origin, e.g. "https://clock.starry.phd/auth/done". */
  async beginRelayRedirect(provider: Provider, options: { returnUrl: string }): Promise<void> {
    const { url, pending } = await this.relayUrl(provider, options.returnUrl);
    await this.options.storage.set(this.key('relay'), JSON.stringify(pending));
    (this.options.navigate ?? ((target) => globalThis.location.assign(target)))(url);
  }

  /**
   * Web, step 2: call on your return page. Returns null when the address carries no sign-in result. The result is
   * removed from the address bar before anything else happens.
   */
  async completeRelayRedirect(url: string = globalThis.location.href): Promise<SignInResult | null> {
    if (!parseRelayResult(url)) return null;
    const raw = await this.options.storage.get(this.key('relay'));
    await this.options.storage.remove(this.key('relay'));
    try {
      globalThis.history?.replaceState(null, '', url.split('#')[0]!.split('?')[0]!);
    } catch {
      // Not in a browser (tests): nothing to clean.
    }
    let pending: PendingRelay | null;
    try {
      pending = raw ? (JSON.parse(raw) as PendingRelay) : null;
    } catch {
      pending = null;
    }
    if (!pending) throw new StarryError(0, 'RELAY_STATE_MISMATCH', 'Sign-in could not be verified, please try again');
    return this.finishRelay(pending, url);
  }

  private passkeys(): PasskeyAdapter {
    if (this.options.passkey) return this.options.passkey;
    if (typeof navigator !== 'undefined' && 'credentials' in navigator && typeof globalThis.PublicKeyCredential !== 'undefined') return webPasskeyAdapter();
    throw new StarryError(0, 'PASSKEY_UNSUPPORTED', 'Passkeys are not available here');
  }

  /** Passkey sign-in (no prior sign-in needed). A cancelled sheet throws a StarryError with `cancelled` true. */
  async signInWithPasskey(): Promise<SignInResult> {
    const adapter = this.passkeys();
    const options = await this.send<{ publicKey: Record<string, unknown> }>('POST', '/v1/auth/passkey/options', { body: { app_id: this.options.appId } });
    let assertion: PasskeyAssertion;
    try {
      assertion = await adapter.get(options.publicKey);
    } catch (error) {
      throw passkeyFailure(error);
    }
    const result = await this.send<SignInResult & { access_token: string; expires_in: number; refresh_token: string }>('POST', '/v1/auth/passkey', {
      body: { app_id: this.options.appId, ...assertion, ...(this.options.deviceLabel ? { device_label: this.options.deviceLabel } : {}) },
    });
    return this.finishSignIn(result);
  }

  /** Adds a Passkey to the signed-in member. */
  async registerPasskey(name?: string): Promise<void> {
    const adapter = this.passkeys();
    const options = await this.request<{ publicKey: Record<string, unknown> }>('POST', '/v1/me/passkeys/options');
    let attestation: PasskeyAttestation;
    try {
      attestation = await adapter.create(options.publicKey);
    } catch (error) {
      throw passkeyFailure(error);
    }
    await this.request('POST', '/v1/me/passkeys', { ...attestation, ...(name ? { name } : {}) });
  }

  async listPasskeys(): Promise<{ id: string; name: string; created_at: number; last_used_at: number | null }[]> {
    return (await this.request<{ passkeys: { id: string; name: string; created_at: number; last_used_at: number | null }[] }>('GET', '/v1/me/passkeys')).passkeys;
  }

  async removePasskey(id: string): Promise<void> {
    await this.request('DELETE', `/v1/me/passkeys/${encodeURIComponent(id)}`);
  }

  // ----- App config and announcements -----

  getConfig(): Promise<AppConfig> {
    return this.send<AppConfig>('GET', `/v1/apps/${encodeURIComponent(this.options.appId)}/config`);
  }

  /**
   * The start-up check: maintenance (paused), stopped (killed), update required (below min_version) or ok, plus the
   * announcements to show and the App's remote config. When Starry ID cannot be reached the state is "unreachable":
   * keep screens that need no sign-in working and refuse anything that needs authorization, purchases or Battery.
   */
  async checkApp(appVersion: string): Promise<AppGate> {
    let config: AppConfig;
    try {
      config = await this.getConfig();
    } catch (error) {
      if (error instanceof StarryError && error.status === 0) return { state: 'unreachable', notices: [], config: {}, minVersion: null };
      throw error;
    }
    const now = this.now();
    const notices = config.notices.filter((n) => n.starts_at <= now && now < n.ends_at);
    const state: AppGateState = config.status === 'killed' ? 'killed' : config.status === 'paused' ? 'maintenance' : compareVersions(appVersion, config.min_version) < 0 ? 'update_required' : 'ok';
    return { state, notices, config: config.config, minVersion: config.min_version };
  }

  // ----- account -----

  me(): Promise<Me> {
    return this.request<Me>('GET', '/v1/me');
  }

  async entitlements(): Promise<Entitlement[]> {
    return (await this.request<{ entitlements: Entitlement[] }>('GET', '/v1/me/entitlements')).entitlements;
  }

  /** After sign-in returned consent_required: show /terms and /privacy, then call this once the member agrees. */
  async acceptConsent(): Promise<void> {
    const { consent } = await this.me();
    await this.request('POST', '/v1/me/consents', { terms_version: consent.terms_version, privacy_version: consent.privacy_version });
  }

  async registerPushToken(token: string, platform: 'ios' | 'android'): Promise<void> {
    await this.request('PUT', '/v1/me/push-tokens', { token, platform });
  }

  async notificationPreferences(): Promise<Record<string, boolean>> {
    const r = await this.request<{ categories?: Record<string, boolean> }>('GET', '/v1/me/notification-preferences');
    return r.categories ?? {};
  }

  async setNotificationPreferences(categories: Record<string, boolean>): Promise<void> {
    await this.request('PUT', '/v1/me/notification-preferences', { categories });
  }

  /**
   * Signs out of this device. Pass the push token so it is removed first (the member must not keep getting
   * notifications). Never throws: the local session is always cleared, even if the server cannot be reached.
   * Remember RevenueCat logOut() in your App.
   */
  async signOut(options: { pushToken?: string } = {}): Promise<void> {
    try {
      if (options.pushToken) await this.request('DELETE', '/v1/me/push-tokens', { token: options.pushToken });
    } catch {
      // The server forgets dead tokens by itself; do not block signing out.
    }
    try {
      await this.request('POST', '/v1/auth/logout');
    } catch {
      // Already expired or offline: the local session is cleared below either way.
    }
    await this.endDeviceSignIn();
    await this.clearSession();
  }

  /** With shared storage, signing out here signs out every Starry App on the device. */
  private async endDeviceSignIn(): Promise<void> {
    const shared = this.options.sharedStorage;
    if (!shared) return;
    const ssoToken = await shared.get('starry.sso');
    await shared.remove('starry.sso');
    if (!ssoToken) return;
    try {
      await this.send('POST', '/v1/auth/sso/logout', { body: { sso_token: ssoToken } });
    } catch {
      // Offline: the shared token is gone locally, and the server drops it when it expires or on the next logout-all.
    }
  }

  /** Signs the member out of every device and every Starry App. */
  async signOutEverywhere(): Promise<void> {
    try {
      await this.request('POST', '/v1/auth/logout-all');
    } finally {
      await this.options.sharedStorage?.remove('starry.sso');
      await this.clearSession();
    }
  }

  /** Immediate, permanent deletion (Apple and Google require an in-App entry). Confirm with the member first. */
  async deleteAccount(): Promise<void> {
    await this.request('POST', '/v1/me/deletion', { confirm: true });
    await this.clearSession();
  }
}
